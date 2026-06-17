#!/usr/bin/env python3
"""
One-time loader: Jayshree Patil's collection task list -> recurring tasks.

Source is "Jayshree - task.pdf" (FETCH DAILY DATA/MISC), the TASK LIST for
JAYSHREE SANDIP PATIL - Executive Accounts (COLLECTION), reporting to Ritesh Tulsyan.
EMITS a reviewable SQL file (db/seed/jayshree_tasks_load.sql). Nothing is written to
the database by this script; apply the generated SQL yourself with psql after review:

    python db/seed/load_jayshree_tasks.py
    psql "$SUPABASE_DB_URL" -f db/seed/jayshree_tasks_load.sql

Mapping (categories supplied by the user, follows load_bushra_tasks.py logic):
  - created_by  = Ritesh Tulsyan
  - assigned_to = Jayshree Patil (Accounting & Finance)
  - title       = Category,  description = Task
  - Categories: tasks 1-4 -> Collection, 5 -> Meeting, 6-13 -> Reporting,
                14-16 -> Meeting (frequency As and When).
  - Frequency:  DAILY->daily | WEEKLY->weekly {Mon} | MONTHLY->monthly (1st Saturday)
                | WHEN->when (As and When, Mon-Sat per-day Not Applicable toggle).
  - Company:    ALL -> O-Tec Surat/Noida + Enterprise Surat/Noida + Colorix (5).
                Ink Jet and Personal Accounts are NEVER added (user instruction).
All writes are additive INSERTs, guarded so the script is safe to re-run.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "jayshree_tasks_load.sql")

# ---- identity-project ids --------------------------------------------------
CREATED_BY = "79174071-1f03-46dd-bdf7-a6a7d3699877"   # Ritesh Tulsyan
ASSIGNED_TO = "bb096b8e-bbae-4476-ae6b-89111fbad4bd"  # Jayshree Patil
DEPT_AF = "f64dfa08-103d-45bd-ba29-1079d774b526"      # Accounting & Finance

LOC = {
    "otec_st":  "01c1f41e-50fa-459f-b21b-f098fdf204b0",  # O-Tec Surat
    "otec_ncr": "1c9c6c9f-6fa2-450b-b883-64fbfe9cd882",  # O-Tec Noida
    "ent_st":   "2943b5b6-a1d9-4afc-a38b-381425d1dd6c",  # Enterprise Surat
    "ent_ncr":  "521b79c0-80df-480d-a130-7d946b7683ae",  # Enterprise Noida
    "colorix":  "940fa09a-6472-4249-b17e-d47818159a06",  # Colorix
}
COMPANY_MAP = {
    "ALL": ["otec_st", "otec_ncr", "ent_st", "ent_ncr", "colorix"],
}

# (Category, Task, Frequency, Company) - Sr.No order from the PDF.
# Categories per the user; minor obvious typos in the task text corrected.
TASKS = [
    # 1-4 Collection (daily)
    ("Collection", "Take entry in Tally before depositing cheques in the bank.",                                                                       "DAILY",   "ALL"),
    ("Collection", "Confirm whether ink and part is given to customers based on payment status, and inform customers whose ink or part are on hold.",   "DAILY",   "ALL"),
    ("Collection", "Update collection sheet.",                                                                                                          "DAILY",   "ALL"),
    ("Collection", "Customer payment follow-up.",                                                                                                       "DAILY",   "ALL"),
    # 5 Meeting (daily)
    ("Meeting",    "Meet salesperson and discuss about payment.",                                                                                       "DAILY",   "ALL"),
    # 6-9 Reporting (weekly)
    ("Reporting",  "Update machine PDC sheet weekly.",                                                                                                  "WEEKLY",  "ALL"),
    ("Reporting",  "Update dispute sheet weekly.",                                                                                                       "WEEKLY",  "ALL"),
    ("Reporting",  "Share due sheet to salesperson.",                                                                                                    "WEEKLY",  "ALL"),
    ("Reporting",  "Make redmark customer list.",                                                                                                        "WEEKLY",  "ALL"),
    # 10-13 Reporting (monthly)
    ("Reporting",  "Homer machine licence confirmation.",                                                                                                "MONTHLY", "ALL"),
    ("Reporting",  "Make overdue report.",                                                                                                                "MONTHLY", "ALL"),
    ("Reporting",  "Make dispute report.",                                                                                                                "MONTHLY", "ALL"),
    ("Reporting",  "Make PDC report.",                                                                                                                    "MONTHLY", "ALL"),
    # 14-16 Meeting (As and When)
    ("Meeting",    "Check ledgers and resolve disputes related to them.",                                                                                "WHEN",    "ALL"),
    ("Meeting",    "Resolve customer queries regarding: ink rate, FOC parts or FOC ink, ink return matters. Coordinate with Director and Salesperson for resolution.", "WHEN", "ALL"),
    ("Meeting",    "If there are any legal matters then send all documents related to it to advocate.",                                                   "WHEN",    "ALL"),
]


def freq_config(raw):
    """Return (recurrence_type, weekly_days, monthly_days, monthly_nth, monthly_weekday)."""
    f = raw.strip().upper()
    if f == "DAILY":
        return "daily", "{}", "{}", "NULL", "NULL"
    if f == "WEEKLY":
        return "weekly", "{1}", "{}", "NULL", "NULL"     # Monday
    if f == "MONTHLY":
        return "monthly", "{}", "{}", "1", "6"           # 1st Saturday (nth-weekday)
    if f == "WHEN":
        return "when", "{}", "{}", "NULL", "NULL"         # As and When (Mon-Sat)
    raise ValueError(f"Unknown frequency: {raw!r}")


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    lines = []
    w = lines.append
    w("-- GENERATED by db/seed/load_jayshree_tasks.py - review before applying.")
    w("-- Additive only: recurring tasks for Jayshree Patil (idempotent NOT EXISTS guards).")
    w("begin;")
    w("")

    per_freq, total = {}, 0
    for category, task, timeline, company in TASKS:
        rtype, wd, md, nth, wday = freq_config(timeline)
        title_s, desc_s = sql_str(category), sql_str(task)
        w(
            f"with ins as (\n"
            f"  insert into public.recurring_tasks\n"
            f"    (title, description, recurrence_type, weekly_days, monthly_days, monthly_nth, monthly_weekday,\n"
            f"     assigned_to, created_by, department_id, active)\n"
            f"  select {title_s}, {desc_s}, '{rtype}', '{wd}'::int[], '{md}'::int[], {nth}, {wday},\n"
            f"         {sql_str(ASSIGNED_TO)}, {sql_str(CREATED_BY)}, {sql_str(DEPT_AF)}, true\n"
            f"  where not exists (\n"
            f"    select 1 from public.recurring_tasks t\n"
            f"    where t.created_by = {sql_str(CREATED_BY)} and t.assigned_to = {sql_str(ASSIGNED_TO)}\n"
            f"      and t.title = {title_s} and t.description = {desc_s} and t.recurrence_type = '{rtype}')\n"
            f"  returning id\n"
            f")"
        )
        link_selects = [
            f"  select id, {sql_str(LOC[k])}::uuid from ins"
            for k in COMPANY_MAP[company]
        ]
        w(
            "insert into public.recurring_task_locations (recurring_task_id, location_id)\n"
            + "\n  union all\n".join(link_selects)
            + "\non conflict (recurring_task_id, location_id) do nothing;"
        )
        w("")
        total += 1
        per_freq[rtype] = per_freq.get(rtype, 0) + 1

    w("commit;")
    w("")
    w("-- After applying, materialise today's instances:")
    w("--   select public.generate_recurring_tasks();")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"Wrote {OUT}")
    print(f"Tasks: {total}")
    print("Per frequency:", per_freq)


if __name__ == "__main__":
    main()
