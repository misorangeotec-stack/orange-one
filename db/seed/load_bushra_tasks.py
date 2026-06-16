#!/usr/bin/env python3
"""
One-time loader: Bushra's MIS task list -> recurring tasks.

Source is the user-supplied "Bushra task list" (Category | Task | Timeline | Company).
EMITS a reviewable SQL file (db/seed/bushra_tasks_load.sql). Nothing is written to
the database by this script; apply the generated SQL yourself with psql after review:

    python db/seed/load_bushra_tasks.py
    psql "$SUPABASE_DB_URL" -f db/seed/bushra_tasks_load.sql

Mapping (confirmed with the user, follows the previous delegation-work logic):
  - created_by  = Ritesh Tulsyan
  - assigned_to = Bushra (MIS Head, Accounting & Finance)
  - title       = Category,  description = Task
  - Frequency:  DAILY->daily | WEEKLY->weekly {Mon} | MONTHLY->monthly (1st Saturday)
  - Company:    ALL -> O-Tec Surat/Noida + Enterprise Surat/Noida + Colorix (5);
                ENT-SURAT -> Enterprise Surat;  OTEC-SURAT -> O-Tec Surat.
                Personal Accounts is NEVER added (user instruction).
All writes are additive INSERTs, guarded so the script is safe to re-run.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "bushra_tasks_load.sql")

# ---- identity-project ids --------------------------------------------------
CREATED_BY = "79174071-1f03-46dd-bdf7-a6a7d3699877"   # Ritesh Tulsyan
ASSIGNED_TO = "a43038e5-1c05-45b0-b316-9e87bbb2b11b"  # Bushra
DEPT_AF = "f64dfa08-103d-45bd-ba29-1079d774b526"      # Accounting & Finance

LOC = {
    "otec_st":  "01c1f41e-50fa-459f-b21b-f098fdf204b0",  # O-Tec Surat
    "otec_ncr": "1c9c6c9f-6fa2-450b-b883-64fbfe9cd882",  # O-Tec Noida
    "ent_st":   "2943b5b6-a1d9-4afc-a38b-381425d1dd6c",  # Enterprise Surat
    "ent_ncr":  "521b79c0-80df-480d-a130-7d946b7683ae",  # Enterprise Noida
    "colorix":  "940fa09a-6472-4249-b17e-d47818159a06",  # Colorix
}
COMPANY_MAP = {
    "ALL":        ["otec_st", "otec_ncr", "ent_st", "ent_ncr", "colorix"],
    "ENT-SURAT":  ["ent_st"],
    "OTEC-SURAT": ["otec_st"],
}

# (Category, Task, Timeline, Company) — verbatim from the sheet; MACHING->MATCHING fixed.
TASKS = [
    ("EXPENSE",    "ALL EXPENSE REPORT",                                                     "MONTHLY", "ALL"),
    ("FMS",        "ALL FMS SHEET",                                                          "MONTHLY", "ALL"),
    ("PRODUCTION", "BATCH WISE COSTING REPORT (POWERBI)",                                    "WEEKLY",  "ENT-SURAT"),
    ("REPORTING",  "BRANCH BALANCE SHEET AND P&L MATCHING",                                  "MONTHLY", "ALL"),
    ("SALES",      "COLOUR CONSUMPTION WISE SALES REPORT UPDATE",                            "DAILY",   "ALL"),
    ("SALES",      "CUSTOMER TRACKING SHEET -ACTIVE/INACTIVE",                               "DAILY",   "ALL"),
    ("SALES",      "DAILY SALES REPORT",                                                     "DAILY",   "ALL"),
    ("SALES",      "DAILY SALES REPORT SHARED TO MANAGEMENT",                                "DAILY",   "ALL"),
    ("AUDIT",      "DEBTOR AGING REPORT",                                                    "MONTHLY", "ALL"),
    ("REPORTING",  "GP REPORT -HEAD",                                                        "MONTHLY", "ALL"),
    ("REPORTING",  "GP REPORT -INK",                                                         "MONTHLY", "ALL"),
    ("REPORTING",  "GP REPORT -PAPER",                                                       "MONTHLY", "ALL"),
    ("REPORTING",  "GP REPORT -SPARE PARTS",                                                 "MONTHLY", "ALL"),
    ("REPORTING",  "IMPORT DATA DASHBOARD",                                                  "MONTHLY", "OTEC-SURAT"),
    ("IMS",        "IMS SHEET -HEAD",                                                        "MONTHLY", "ALL"),
    ("IMS",        "IMS SHEET -INK",                                                         "DAILY",   "ALL"),
    ("IMS",        "IMS SHEET -MACHINE",                                                     "WEEKLY",  "ALL"),
    ("IMS",        "IMS SHEET -PACKING MATERIAL",                                            "DAILY",   "ENT-SURAT"),
    ("IMS",        "IMS SHEET -RAW MATERIAL",                                                "DAILY",   "ENT-SURAT"),
    ("IMS",        "IMS SHEET -SPARE PARTS",                                                 "WEEKLY",  "ALL"),
    ("REPORTING",  "P&L & BS REPORT",                                                        "MONTHLY", "ALL"),
    ("PURCHASE",   "PRODUCT WISE PURCHASE REPORT UPDATE",                                    "WEEKLY",  "ALL"),
    ("SALES",      "PRODUCT WISE SALES REPORT UPDATE",                                       "DAILY",   "ALL"),
    ("PURCHASE",   "PURCHASE REPORT",                                                        "WEEKLY",  "ALL"),
    ("REPORTING",  "RELATED PARTY BALANCE SHEET AND P&L MATCHING",                           "MONTHLY", "ALL"),
    ("AUDIT",      "STOCK VALUATION",                                                        "MONTHLY", "ALL"),
    ("REPORTING",  "TARGET VS ACHIEVEMENT DASHBOARD UPDATE AND SHARED WITH SALES REPORT",    "DAILY",   "ALL"),
    ("AUDIT",      "INVENTORY AGING REPORT",                                                 "MONTHLY", "ALL"),
    ("AUDIT",      "CUSTOMER AGING REPORT",                                                  "MONTHLY", "ALL"),
    ("AUDIT",      "VENDOR AGING REPORT",                                                    "MONTHLY", "ALL"),
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
    raise ValueError(f"Unknown frequency: {raw!r}")


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def main():
    lines = []
    w = lines.append
    w("-- GENERATED by db/seed/load_bushra_tasks.py - review before applying.")
    w("-- Additive only: recurring tasks for Bushra (idempotent NOT EXISTS guards).")
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
