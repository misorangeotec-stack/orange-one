#!/usr/bin/env python3
"""
One-time loader: Ritesh Tulsyan's own delegation/review list -> recurring tasks.

Reads  FETCH DAILY DATA/MISC/Delegation work(Ritesh).csv  — READ-ONLY — and EMITS a
reviewable SQL file (db/seed/ritesh_tasks_load.sql). Nothing is written to the
database by this script; you apply the generated SQL yourself with psql after review:

    python db/seed/load_ritesh_tasks.py
    psql "$BACKUP_IDENTITY_DB_URL" -f db/seed/ritesh_tasks_load.sql

Mapping (confirmed with the user):
  - created_by  = Ritesh Tulsyan (HOD, Accounting & Finance) for every row
  - title       = Category (col B, typo-cleaned)
  - description = col F ("Review -<task>") if present, else col C (covers the last
                  3 MIS rows, where F is blank and the task text lives in C)
  - Frequency   = col D if present else col E (the last 3 rows put "Monthly" in E)
  - Most rows   -> a single template assigned to Ritesh with the generic frequency.
  - DATED rows (an explicit due day-of-month for two people) override that:
      * numeric J/K  -> Ritesh (monthly_days={J}) + Dimple (monthly_days={K})
      * numeric H/I  -> Bushra (monthly_days={H}) + Ritesh (monthly_days={I})
    These become recurrence_type='monthly' with prepone_off_holidays=true, so a due
    day landing on a Sunday/public holiday is preponed to the previous working day
    (Saturday counts as working) — see db/migrations/0020_holiday_prepone.sql.
  - The embedded "Ritesh/Dimples" and "Bushar/Ritesh" sub-headers (non-numeric text
    in H/I/J/K on rows 12, 17, 34) are ignored; those rows load as plain Ritesh tasks.
  - The sheet has no company columns, but every task applies to ALL companies,
    so each template gets the full 7-company location checklist (ALL_COMPANY_LOCATIONS).

ADDITIVE only: all writes are NOT-EXISTS-guarded INSERTs, safe to re-run. Do NOT run
task_list_clear.sql — it deletes every created_by=Ritesh template (the 113 team tasks).
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MISC = os.path.normpath(os.path.join(
    HERE, "..", "..", "..", "FETCH DAILY DATA", "MISC"))
CSV_FILE = os.path.join(MISC, "Delegation work(Ritesh).csv")
OUT = os.path.join(HERE, "ritesh_tasks_load.sql")

# ---- identity-project ids --------------------------------------------------
RITESH = "79174071-1f03-46dd-bdf7-a6a7d3699877"   # Ritesh Tulsyan (also created_by)
DIMPLE = "e27f15d6-6335-4387-8842-fd883988dab4"   # Dimple
BUSHRA = "a43038e5-1c05-45b0-b316-9e87bbb2b11b"   # Bushra
DEPT_AF = "f64dfa08-103d-45bd-ba29-1079d774b526"  # Accounting & Finance (all three)
CREATED_BY = RITESH

# Ritesh's review list has no per-row company columns, but (per the user) every
# task applies to ALL companies, so each template gets the full company checklist:
# the 7 active non-General locations. See ritesh_tasks_all_companies.sql, which
# backfilled the same set onto the already-loaded live templates + open instances.
ALL_COMPANY_LOCATIONS = [
    "01c1f41e-50fa-459f-b21b-f098fdf204b0",  # O-Tec Surat
    "1c9c6c9f-6fa2-450b-b883-64fbfe9cd882",  # O-Tec Noida
    "2943b5b6-a1d9-4afc-a38b-381425d1dd6c",  # Enterprise Surat
    "521b79c0-80df-480d-a130-7d946b7683ae",  # Enterprise Noida
    "e98c2cf0-ca28-446e-8633-f99291f3d058",  # Ink Jet
    "940fa09a-6472-4249-b17e-d47818159a06",  # Colorix
    "d7c30d44-997f-4eb4-bce6-35339ad0f86d",  # Personal Accounts
]

# ---- obvious-typo cleanup (shared with load_task_list.py) ------------------
WORD_FIX = {
    "reprot": "report", "Reprot": "Report", "Reprots": "Reports",
    "Maching": "Matching", "Adjsutment": "Adjustment", "Exchnage": "Exchange",
    "Verfiy": "Verify", "cordination": "coordination", "Quatrly": "Quarterly",
}


def _fix_word(w):
    # The F column glues the "Review -" prefix to the next word (e.g. "-Verfiy"),
    # so look past a leading hyphen when matching typos.
    if w.startswith("-"):
        return "-" + WORD_FIX.get(w[1:], w[1:])
    return WORD_FIX.get(w, w)


def clean(text):
    t = (text or "").strip()
    return " ".join(_fix_word(w) for w in t.split(" ")).strip()


def freq_config(raw):
    """Generic frequency -> (recurrence_type, weekly_days, monthly_days, nth, weekday)."""
    f = (raw or "").strip().lower()
    if f in ("daily", "dialy"):                          # "dialy" = sheet typo
        return "daily", "{}", "{}", "NULL", "NULL"
    if f in ("as and when", "as and when "):
        return "when", "{}", "{}", "NULL", "NULL"
    if f == "weekly":
        return "weekly", "{1}", "{}", "NULL", "NULL"     # Monday
    if f == "15 days":
        return "monthly", "{}", "{1,15}", "NULL", "NULL"  # 1st & 15th (day-of-month)
    if f == "monthly":
        return "monthly", "{}", "{}", "1", "6"           # 1st Saturday (nth-weekday)
    if f.startswith("quart"):                            # "Quartertly" = sheet typo
        return "quarterly", "{}", "{}", "NULL", "NULL"
    raise ValueError(f"Unknown frequency: {raw!r}")


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def day_of(cell):
    """Return int 1..31 if the cell is a plain day number, else None."""
    c = (cell or "").strip()
    if c.isdigit():
        n = int(c)
        if 1 <= n <= 31:
            return n
    return None


def read_rows(path):
    """Yield (row_number, cells[0..10]). This sheet has ONE header row (row 1)."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for i, row in enumerate(csv.reader(fh), start=1):
            if i == 1:                       # single column-header row
                continue
            cells = [(c or "").strip() for c in row]
            cells += [""] * (11 - len(cells))  # pad short rows to 11 cols
            yield i, cells[:11]


def emit_template(w, assigned_to, title_s, desc_s, rtype, wd, md, nth, wday, prepone):
    """Emit one guarded recurring-task INSERT + its all-companies checklist."""
    links = "\n  union all\n".join(
        f"  select id, {sql_str(loc)}::uuid from ins" for loc in ALL_COMPANY_LOCATIONS)
    w(
        f"with ins as (\n"
        f"  insert into public.recurring_tasks\n"
        f"    (title, description, recurrence_type, weekly_days, monthly_days, monthly_nth, monthly_weekday,\n"
        f"     assigned_to, created_by, department_id, active, prepone_off_holidays)\n"
        f"  select {title_s}, {desc_s}, '{rtype}', '{wd}'::int[], '{md}'::int[], {nth}, {wday},\n"
        f"         {sql_str(assigned_to)}, {sql_str(CREATED_BY)}, {sql_str(DEPT_AF)}, true, {str(prepone).lower()}\n"
        f"  where not exists (\n"
        f"    select 1 from public.recurring_tasks t\n"
        f"    where t.created_by = {sql_str(CREATED_BY)} and t.assigned_to = {sql_str(assigned_to)}\n"
        f"      and t.title = {title_s} and t.description = {desc_s} and t.recurrence_type = '{rtype}')\n"
        f"  returning id\n"
        f")\n"
        f"insert into public.recurring_task_locations (recurring_task_id, location_id)\n"
        f"{links}\n"
        f"on conflict (recurring_task_id, location_id) do nothing;"
    )
    w("")


def main():
    lines = []
    w = lines.append
    w("-- GENERATED by db/seed/load_ritesh_tasks.py — review before applying.")
    w("-- Additive only: recurring tasks for Ritesh (+ Dimple/Bushra for dated rows).")
    w("-- Idempotent NOT-EXISTS guards. Requires migration 0020 (prepone_off_holidays).")
    w("begin;")
    w("")

    per_person, per_freq, total = {}, {}, 0
    for r, cells in read_rows(CSV_FILE):
        name = cells[0].strip()
        if name.lower() != "ritesh":          # every data row is Ritesh's sheet
            continue
        category = clean(cells[1])
        freq_raw = cells[3].strip() or cells[4].strip()
        desc_raw = cells[5].strip() or cells[2].strip()   # F, else C
        description = clean(desc_raw)
        if not category or not description:
            continue

        title_s, desc_s = sql_str(category), sql_str(description)

        # Dated rows: explicit due day for two people -> monthly + prepone.
        jd, kd = day_of(cells[9]), day_of(cells[10])
        hd, idd = day_of(cells[7]), day_of(cells[8])
        targets = []  # (assigned_to, label, rtype, wd, md, nth, wday, prepone)
        if jd is not None or kd is not None:
            if jd is not None:
                targets.append((RITESH, "Ritesh", "monthly", "{}", "{%d}" % jd, "NULL", "NULL", True))
            if kd is not None:
                targets.append((DIMPLE, "Dimple", "monthly", "{}", "{%d}" % kd, "NULL", "NULL", True))
        elif hd is not None or idd is not None:
            if hd is not None:
                targets.append((BUSHRA, "Bushra", "monthly", "{}", "{%d}" % hd, "NULL", "NULL", True))
            if idd is not None:
                targets.append((RITESH, "Ritesh", "monthly", "{}", "{%d}" % idd, "NULL", "NULL", True))
        else:
            rtype, wd, md, nth, wday = freq_config(freq_raw)
            targets.append((RITESH, "Ritesh", rtype, wd, md, nth, wday, False))

        w(f"-- row {r}: {category} / {description}")
        for assigned_to, label, rtype, wd, md, nth, wday, prepone in targets:
            emit_template(w, assigned_to, title_s, desc_s, rtype, wd, md, nth, wday, prepone)
            total += 1
            per_person[label] = per_person.get(label, 0) + 1
            per_freq[rtype] = per_freq.get(rtype, 0) + 1

    w("commit;")
    w("")
    w("-- After applying, materialise today's instances:")
    w("--   select public.generate_recurring_tasks();")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"Wrote {OUT}")
    print(f"Templates emitted: {total}")
    print("Per person:", per_person)
    print("Per frequency:", per_freq)


if __name__ == "__main__":
    main()
