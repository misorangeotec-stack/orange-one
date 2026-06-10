#!/usr/bin/env python3
"""
One-time loader: turn the master "Task List" spreadsheet into recurring tasks.

Reads  FETCH DAILY DATA/MISC/Task List (2).xlsx  (sheet "Task Work") — READ-ONLY —
and EMITS a reviewable SQL file (db/seed/task_list_load.sql). Nothing is written to
the database by this script; you apply the generated SQL yourself with psql after
reviewing it:

    python db/seed/load_task_list.py
    psql "$BACKUP_IDENTITY_DB_URL" -f db/seed/task_list_load.sql

Mapping (confirmed with the user):
  - created_by  = Ritesh Tulsyan (HOD, Accounting & Finance)
  - assigned_to = the employee in the Name column
  - title       = Category (typo-cleaned),  description = Task (typo-cleaned)
  - Frequency:  Daily->daily | "As and When"->when | Weekly->weekly {Mon}
                Monthly->monthly (1st Saturday, nth-weekday) | Quartely->quarterly
  - Company columns Y -> the task's location checklist
All writes are additive INSERTs, guarded so the script is safe to re-run.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# repo root = .../Orange One ; the sheets live in a sibling working dir.
MISC = os.path.normpath(os.path.join(
    HERE, "..", "..", "..", "FETCH DAILY DATA", "MISC"))
# Source sheets (delegation work), loaded in order into one SQL file.
CSV_FILES = [
    os.path.join(MISC, "Delegation work(Task Work ).csv"),
    os.path.join(MISC, "Delegation work(DIMPLE).csv"),
]
OUT = os.path.join(HERE, "task_list_load.sql")

# ---- identity-project ids (queried live; see plan) -------------------------
CREATED_BY = "79174071-1f03-46dd-bdf7-a6a7d3699877"   # Ritesh Tulsyan
DEPT_AF = "f64dfa08-103d-45bd-ba29-1079d774b526"      # Accounting & Finance

EMP = {  # sheet Name -> (profile id, department id)
    "Jyoti":  ("261ae1c1-9389-427a-9fa3-1c8df7326f73", DEPT_AF),
    "Ravina": ("fde9faec-c6f5-4670-91b6-5e4ee4c085ff", DEPT_AF),
    "Neha":   ("0600d53e-8077-4ee6-9f12-239d3c198558", DEPT_AF),
    "Yash":   ("bf164ac0-e945-427b-9a99-89a3f5018956", DEPT_AF),  # Yash Joshi (NOT Yash Agarwal)
    "Bharat": ("42653aeb-7c22-4be9-91a8-44513e2d291d", DEPT_AF),
    "Dimple": ("e27f15d6-6335-4387-8842-fd883988dab4", DEPT_AF),  # Senior Manager (DIMPLE sheet)
}

# Existing locations (company+place). The last 3 columns are created by this script.
LOC_EXISTING = {
    "otec_st":  "01c1f41e-50fa-459f-b21b-f098fdf204b0",  # O-Tec Surat
    "otec_ncr": "1c9c6c9f-6fa2-450b-b883-64fbfe9cd882",  # O-Tec Noida
    "ent_st":   "2943b5b6-a1d9-4afc-a38b-381425d1dd6c",  # Enterprise Surat
    "ent_ncr":  "521b79c0-80df-480d-a130-7d946b7683ae",  # Enterprise Noida
}
# New standalone locations (company NULL, label = name). Deterministic UUIDs so the
# task<->location links below resolve by name even on a fresh run.
LOC_NEW = [
    ("Ink Jet",           5),
    ("Colorix",           6),
    ("Personal Accounts", 7),
]
# column index (0-based) -> location key. Cols: 0 Name,1 Category,2 Task,3 Freq,
# 4 O-Tec ST,5 O-Tec NCR,6 Ent ST,7 Ent NCR,8 Ink Jet,9 Colorix,10 P(ersonal)
COL_LOC = {
    4: ("existing", "otec_st"),
    5: ("existing", "otec_ncr"),
    6: ("existing", "ent_st"),
    7: ("existing", "ent_ncr"),
    8: ("new", "Ink Jet"),
    9: ("new", "Colorix"),
    10: ("new", "Personal Accounts"),
}

# ---- obvious-typo cleanup (word- and phrase-level) -------------------------
PHRASE_FIX = {
    "Daily Posting of Sales Invoices": "Daily Posting of Sales Invoices",  # ok
    "URT Details": "UTR Details",
    "MESME Follow UP": "MSME Follow Up",
    "Diretcors Personal A/c Entry": "Directors Personal A/c Entry",
    "Quatrly email Customer ledger confirmation": "Quarterly email Customer ledger confirmation",
    "Physical Stock Compariosn": "Physical Stock Comparison",
}
WORD_FIX = {
    "Salae": "Sales",
    "Reproting": "Reporting",
    "Reprots": "Reports",
    "Reprot": "Report",
    "reprot": "report",
    "Expesne": "Expense",
    "Expnses": "Expenses",
    "Complinace": "Compliance",
    "Perosnal": "Personal",
    "Domestice": "Domestic",
    "Retuns": "Returns",
    "Creidtors": "Creditors",
    "Quatrly": "Quarterly",
    "Diretcors": "Directors",
    "Compariosn": "Comparison",
    # DIMPLE sheet tokens
    "Convenyance": "Conveyance",
    "Cartidage": "Cartridge",
    "Compnay": "Company",
    "Adjsutment": "Adjustment",
    "Exchnage": "Exchange",
    "Verfiy": "Verify",
    "Maching": "Matching",
    "veriifcation": "verification",
    "cordination": "coordination",
}


def clean(text):
    t = (text or "").strip()
    if t in PHRASE_FIX:
        return PHRASE_FIX[t]
    out = []
    for w in t.split(" "):
        out.append(WORD_FIX.get(w, w))
    return " ".join(out).strip()


def freq_config(raw):
    """Return (recurrence_type, weekly_days_sql, monthly_days_sql, monthly_nth, monthly_weekday)."""
    f = (raw or "").strip().lower()
    if f in ("daily", "dialy"):                         # "dialy" = DIMPLE-sheet typo
        return "daily", "{}", "{}", "NULL", "NULL"
    if f in ("as and when", "as and when "):
        return "when", "{}", "{}", "NULL", "NULL"
    if f == "weekly":
        return "weekly", "{1}", "{}", "NULL", "NULL"   # Monday
    if f == "15 days":                                  # twice a month ~= every 15 days
        return "monthly", "{}", "{1,15}", "NULL", "NULL"  # day-of-month mode: 1st & 15th
    if f == "monthly":
        return "monthly", "{}", "{}", "1", "6"          # 1st Saturday
    if f.startswith("quart"):
        return "quarterly", "{}", "{}", "NULL", "NULL"
    raise ValueError(f"Unknown frequency: {raw!r}")


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def read_rows(path):
    """Yield (row_number, cells[0..10]) data rows (skip the 2 header rows)."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for i, row in enumerate(csv.reader(fh), start=1):
            if i <= 2:               # row 1 = group header, row 2 = column header
                continue
            cells = [(c or "").strip() for c in row]
            cells += [""] * (11 - len(cells))  # pad short rows to 11 cols
            yield i, cells[:11]


def main():
    lines = []
    w = lines.append
    w("-- GENERATED by db/seed/load_task_list.py — review before applying.")
    w("-- Additive only: creates 3 locations + recurring tasks (idempotent guards).")
    w("begin;")
    w("")

    # 1) the 3 new locations (guard on name so re-runs are no-ops)
    w("-- 1. new standalone locations (company NULL -> label is just the name)")
    for name, sort in LOC_NEW:
        w(
            f"insert into public.locations (company, name, is_general, active, sort_order, created_by)\n"
            f"select null, {sql_str(name)}, false, true, {sort}, {sql_str(CREATED_BY)}\n"
            f"where not exists (select 1 from public.locations where name = {sql_str(name)} and company is null);"
        )
    w("")

    # 2) recurring tasks + their location links
    w("-- 2. recurring tasks (title=Category, description=Task) + location checklist")
    per_emp, per_freq, total, skipped = {}, {}, 0, 0
    for path in CSV_FILES:
        src = os.path.basename(path)
        w(f"-- source: {src}")
        for r, cells in read_rows(path):
            name = cells[0].strip()
            category = clean(cells[1])
            task = clean(cells[2])
            freq = cells[3].strip()
            if not name or not category or not task or not freq:
                continue
            if name not in EMP:
                skipped += 1
                w(f"-- SKIPPED {src} row {r}: unknown employee {name!r}")
                continue
            assigned_to, dept = EMP[name]
            rtype, wd, md, nth, wday = freq_config(freq)

            title_s, desc_s = sql_str(category), sql_str(task)
            # insert template, guarded against duplicates on a natural key
            w(
                f"with ins as (\n"
                f"  insert into public.recurring_tasks\n"
                f"    (title, description, recurrence_type, weekly_days, monthly_days, monthly_nth, monthly_weekday,\n"
                f"     assigned_to, created_by, department_id, active)\n"
                f"  select {title_s}, {desc_s}, '{rtype}', '{wd}'::int[], '{md}'::int[], {nth}, {wday},\n"
                f"         {sql_str(assigned_to)}, {sql_str(CREATED_BY)}, {sql_str(dept)}, true\n"
                f"  where not exists (\n"
                f"    select 1 from public.recurring_tasks t\n"
                f"    where t.created_by = {sql_str(CREATED_BY)} and t.assigned_to = {sql_str(assigned_to)}\n"
                f"      and t.title = {title_s} and t.description = {desc_s} and t.recurrence_type = '{rtype}')\n"
                f"  returning id\n"
                f")"
            )
            # location links for this template (only for Y columns)
            link_selects = []
            for ci, (kind, key) in COL_LOC.items():
                val = cells[ci].strip().upper()
                if val != "Y":
                    continue
                if kind == "existing":
                    loc_expr = sql_str(LOC_EXISTING[key])
                    link_selects.append(f"  select id, {loc_expr}::uuid from ins")
                else:
                    # resolve the new location id by name at apply-time
                    link_selects.append(
                        f"  select ins.id, l.id from ins, public.locations l "
                        f"where l.name = {sql_str(key)} and l.company is null"
                    )
            if link_selects:
                w(
                    "insert into public.recurring_task_locations (recurring_task_id, location_id)\n"
                    + "\n  union all\n".join(link_selects)
                    + "\non conflict (recurring_task_id, location_id) do nothing;"
                )
            else:
                w("select 1;  -- (template above has no location columns marked Y)")
            w("")

            total += 1
            per_emp[name] = per_emp.get(name, 0) + 1
            per_freq[rtype] = per_freq.get(rtype, 0) + 1

    w("commit;")
    w("")
    w("-- After applying, materialise today's instances:")
    w("--   select public.generate_recurring_tasks();")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"Wrote {OUT}")
    print(f"Tasks: {total}   Skipped rows: {skipped}")
    print("Per employee:", per_emp)
    print("Per frequency:", per_freq)
    print(f"Locations created (if missing): {[n for n, _ in LOC_NEW]}")


if __name__ == "__main__":
    main()
