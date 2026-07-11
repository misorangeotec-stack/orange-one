#!/usr/bin/env python3
"""
Purchase FMS masters loader: the "Purchase FMS - Master Data Collection" workbook
(tabs M1 Companies, M2 Categories, M3 Item Groups, M4 Items) -> fms_purchase_* masters.

EMITS reviewable SQL. Nothing is written to the database by this script; apply the
generated SQL yourself with psql after review:

    python db/seed/load_fms_purchase_masters.py
    psql "$SUPABASE_DB_URL" -f db/seed/fms_purchase_masters_load.sql

Source defaults to the live Google Sheet (public, exported as xlsx) so a corrected
sheet can simply be re-loaded; pass --file to use a local .xlsx instead.

The load is additive + deactivating, never destructive:
  - masters from the sheet are inserted (on conflict: reactivated, sort order refreshed)
  - every master row NOT in the sheet is set active=false, not deleted, because the
    demo requests/POs reference them through RESTRICT foreign keys.
Vendors (M5) are deliberately out of scope and left untouched.

Parsing is stdlib-only (zipfile + ElementTree); openpyxl is not a repo dependency.
"""
import argparse
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_LOAD = os.path.join(HERE, "fms_purchase_masters_load.sql")
OUT_ROLLBACK = os.path.join(HERE, "fms_purchase_masters_rollback.sql")

SHEET_ID = "1E8R6Et2vnIbTLNaKtXgbQqa9cwJgBFf4OfXO_x3q_Ek"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# tab name -> first row of real data (the rows above are title / help / header)
TABS = {
    "M1": ("M1 · Companies", 7),
    "M2": ("M2 · Categories", 6),
    "M3": ("M3 · Item Groups", 6),
    "M4": ("M4 · Items", 7),
}


# ---- xlsx reading ----------------------------------------------------------
def load_workbook(path):
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    targets = {r.get("Id"): r.get("Target") for r in rels}
    sheets = {s.get("name"): targets[s.get(R + "id")] for s in wb.find(M + "sheets")}
    shared = [
        "".join(t.text or "" for t in si.iter(M + "t"))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml"))
    ]
    return z, sheets, shared


def rows(z, sheets, shared, tab, first_row):
    if tab not in sheets:
        die(f"tab {tab!r} not found in the workbook (tabs: {', '.join(sheets)})")
    target = sheets[tab]
    path = target if target.startswith("xl/") else "xl/" + target.lstrip("/")
    ws = ET.fromstring(z.read(path))
    out = []
    for row in ws.iter(M + "row"):
        rn = int(row.get("r"))
        if rn < first_row:
            continue
        cells = {}
        for c in row:
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v, inline = c.find(M + "v"), c.find(M + "is")
            if inline is not None:
                val = "".join(x.text or "" for x in inline.iter(M + "t"))
            elif v is None:
                val = ""
            elif c.get("t") == "s":
                val = shared[int(v.text)]
            else:
                val = v.text
            val = (val or "").strip()
            if val:
                cells[col] = val
        if cells:
            out.append((rn, cells))
    return out


def num(val, default=0):
    """Sheet numbers arrive as '1.0'."""
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return default


def yes(val):
    return str(val or "Yes").strip().lower() != "no"


def die(msg):
    sys.exit(f"ERROR: {msg}")


def q(val):
    """SQL string literal."""
    return "'" + str(val).replace("'", "''") + "'"


# ---- read + validate -------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="local .xlsx (default: download the live Google Sheet)")
    args = ap.parse_args()

    src = args.file
    if not src:
        src = os.path.join(HERE, "_master_data_collection.xlsx")
        print(f"downloading {SHEET_URL}")
        urllib.request.urlretrieve(SHEET_URL, src)
    z, sheets, shared = load_workbook(src)

    problems = []

    companies = []  # (name, location, active, sort_order)
    for rn, c in rows(z, sheets, shared, *TABS["M1"]):
        if not c.get("A"):
            problems.append(f"M1 row {rn}: blank Company Name")
            continue
        companies.append((c["A"], c.get("B") or "", yes(c.get("C")), num(c.get("D"))))

    categories = []  # (name, active, sort_order)
    for rn, c in rows(z, sheets, shared, *TABS["M2"]):
        if not c.get("A"):
            problems.append(f"M2 row {rn}: blank Category Name")
            continue
        categories.append((c["A"], yes(c.get("B")), num(c.get("C"))))

    groups = []  # (category, name, active, sort_order)
    for rn, c in rows(z, sheets, shared, *TABS["M3"]):
        if not c.get("A") or not c.get("B"):
            problems.append(f"M3 row {rn}: Category and Item Group Name are both required")
            continue
        groups.append((c["A"], c["B"], yes(c.get("C")), num(c.get("D"))))

    items = []  # (category, group, name, unit, active, sort_order)
    for rn, c in rows(z, sheets, shared, *TABS["M4"]):
        if not (c.get("A") and c.get("B") and c.get("C")):
            problems.append(f"M4 row {rn}: Category, Item Group and Item Name are all required")
            continue
        if not c.get("D"):
            problems.append(f"M4 row {rn}: item {c['C']!r} has no Unit")
            continue
        items.append((c["A"], c["B"], c["C"], c["D"], yes(c.get("E")), num(c.get("F"))))

    # duplicates within the sheet would silently collapse on the unique keys
    for label, keys in (
        ("M1 (Company, Location)", [(x[0], x[1]) for x in companies]),
        ("M2 Category", [x[0] for x in categories]),
        ("M3 (Category, Item Group)", [(x[0], x[1]) for x in groups]),
        ("M4 (Category, Item Group, Item)", [(x[0], x[1], x[2]) for x in items]),
    ):
        dups = [k for k, n in Counter(keys).items() if n > 1]
        if dups:
            problems.append(f"{label}: duplicate rows {dups}")

    cat_names = {c[0] for c in categories}
    for cat in sorted({g[0] for g in groups} - cat_names):
        problems.append(f"M3: category {cat!r} is not declared in M2")
    for cat in sorted({i[0] for i in items} - cat_names):
        problems.append(f"M4: category {cat!r} is not declared in M2")

    if problems:
        die("the workbook did not validate:\n  - " + "\n  - ".join(problems))

    # M4 may reference an item group M3 forgot to declare -> create it (agreed with the user)
    declared = {(g[0], g[1]) for g in groups}
    implied = sorted({(i[0], i[1]) for i in items} - declared)
    for cat, grp in implied:
        groups.append((cat, grp, True, 0))
        print(f"note: item group {cat} / {grp} is used by M4 but missing from M3 - creating it")

    print(
        f"read {len(companies)} companies, {len(categories)} categories, "
        f"{len(groups)} item groups ({len(implied)} implied), {len(items)} items"
    )

    write_load_sql(companies, categories, groups, items)
    write_rollback_sql(companies, categories, groups, items)
    print(f"wrote {OUT_LOAD}\nwrote {OUT_ROLLBACK}")
    print(f"\nreview it, then:\n  psql \"$SUPABASE_DB_URL\" -f db/seed/fms_purchase_masters_load.sql")


# ---- SQL emission ----------------------------------------------------------
HEADER = """-- Purchase FMS masters, loaded from the "Purchase FMS - Master Data Collection"
-- workbook (tabs M1-M4). GENERATED by db/seed/load_fms_purchase_masters.py - do not
-- hand-edit; fix the sheet and re-run the loader.
--
--   psql "$SUPABASE_DB_URL" -f db/seed/fms_purchase_masters_load.sql
--
-- Additive + deactivating, never destructive: sheet masters are inserted (re-running
-- reactivates them and refreshes sort order), and masters NOT in the sheet are set
-- active=false rather than deleted, because the existing requests/POs reference them
-- through RESTRICT foreign keys. Vendors (M5) are out of scope and left untouched.
"""


def values_block(tuples, indent="  "):
    return ",\n".join(indent + "(" + ", ".join(t) + ")" for t in tuples)


def write_load_sql(companies, categories, groups, items):
    sql = [HEADER, "begin;", ""]

    sql.append("-- ---- M1 Companies -------------------------------------------------------")
    sql.append("insert into public.fms_purchase_companies (name, location, active, sort_order) values")
    sql.append(
        values_block([(q(n), q(loc), str(a).lower(), str(so)) for n, loc, a, so in companies])
    )
    sql.append("on conflict (name, location) do update")
    sql.append("  set active = excluded.active, sort_order = excluded.sort_order;")
    sql.append("")

    sql.append("-- ---- M2 Categories ------------------------------------------------------")
    sql.append("insert into public.fms_purchase_categories (name, active, sort_order) values")
    sql.append(values_block([(q(n), str(a).lower(), str(so)) for n, a, so in categories]))
    sql.append("on conflict (name) do update")
    sql.append("  set active = excluded.active, sort_order = excluded.sort_order;")
    sql.append("")

    sql.append("-- ---- M3 Item Groups (parent resolved by category name) -------------------")
    sql.append("insert into public.fms_purchase_item_groups (category_id, name, active, sort_order)")
    sql.append("select c.id, g.name, g.active, g.sort_order")
    sql.append("from (values")
    sql.append(
        values_block(
            [(q(cat), q(n), str(a).lower(), str(so)) for cat, n, a, so in groups], indent="    "
        )
    )
    sql.append(") as g(cat, name, active, sort_order)")
    sql.append("join public.fms_purchase_categories c on c.name = g.cat")
    sql.append("on conflict (category_id, name) do update")
    sql.append("  set active = excluded.active, sort_order = excluded.sort_order;")
    sql.append("")

    sql.append("-- ---- M4 Items (parent resolved on the full category + group path) --------")
    sql.append("insert into public.fms_purchase_items (item_group_id, name, unit, active, sort_order)")
    sql.append("select ig.id, i.name, i.unit, i.active, i.sort_order")
    sql.append("from (values")
    sql.append(
        values_block(
            [
                (q(cat), q(grp), q(n), q(u), str(a).lower(), str(so))
                for cat, grp, n, u, a, so in items
            ],
            indent="    ",
        )
    )
    sql.append(") as i(cat, grp, name, unit, active, sort_order)")
    sql.append("join public.fms_purchase_categories c on c.name = i.cat")
    sql.append("join public.fms_purchase_item_groups ig")
    sql.append("  on ig.category_id = c.id and ig.name = i.grp")
    sql.append("on conflict (item_group_id, name) do update")
    sql.append("  set unit = excluded.unit, active = excluded.active, sort_order = excluded.sort_order;")
    sql.append("")

    sql.append("-- ---- Retire everything the sheet does not carry --------------------------")
    sql.append("-- Deactivate, never delete: the demo requests/POs hold RESTRICT references.")
    sql.append("update public.fms_purchase_companies c set active = false")
    sql.append("where c.active and not exists (")
    sql.append("  select 1 from (values")
    sql.append(values_block([(q(n), q(loc)) for n, loc, _a, _so in companies], indent="    "))
    sql.append("  ) as s(name, location)")
    sql.append("  where s.name = c.name and s.location is not distinct from coalesce(c.location, '')")
    sql.append(");")
    sql.append("")
    sql.append("update public.fms_purchase_categories c set active = false")
    sql.append("where c.active and c.name not in (")
    sql.append("  " + ", ".join(q(n) for n, _a, _so in categories))
    sql.append(");")
    sql.append("")
    sql.append("update public.fms_purchase_item_groups g set active = false")
    sql.append("where g.active and not exists (")
    sql.append("  select 1 from (values")
    sql.append(values_block([(q(cat), q(n)) for cat, n, _a, _so in groups], indent="    "))
    sql.append("  ) as s(cat, name)")
    sql.append("  join public.fms_purchase_categories c on c.name = s.cat")
    sql.append("  where c.id = g.category_id and s.name = g.name")
    sql.append(");")
    sql.append("")
    sql.append("update public.fms_purchase_items i set active = false")
    sql.append("where i.active and not exists (")
    sql.append("  select 1 from (values")
    sql.append(values_block([(q(cat), q(grp), q(n)) for cat, grp, n, _u, _a, _so in items], indent="    "))
    sql.append("  ) as s(cat, grp, name)")
    sql.append("  join public.fms_purchase_categories c on c.name = s.cat")
    sql.append("  join public.fms_purchase_item_groups ig on ig.category_id = c.id and ig.name = s.grp")
    sql.append("  where ig.id = i.item_group_id and s.name = i.name")
    sql.append(");")
    sql.append("")

    sql.append("-- ---- Assertions: bail out before commit if the counts are wrong ----------")
    sql.append("do $$")
    sql.append("declare n_co int; n_cat int; n_grp int; n_item int;")
    sql.append("begin")
    sql.append("  select count(*) into n_co   from public.fms_purchase_companies   where active;")
    sql.append("  select count(*) into n_cat  from public.fms_purchase_categories  where active;")
    sql.append("  select count(*) into n_grp  from public.fms_purchase_item_groups where active;")
    sql.append("  select count(*) into n_item from public.fms_purchase_items       where active;")
    sql.append(
        f"  if (n_co, n_cat, n_grp, n_item) is distinct from "
        f"({len(companies)}, {len(categories)}, {len(groups)}, {len(items)}) then"
    )
    sql.append(
        "    raise exception 'masters load mismatch: got % companies / % categories / "
        "% groups / % items, expected "
        f"{len(companies)} / {len(categories)} / {len(groups)} / {len(items)}',"
    )
    sql.append("      n_co, n_cat, n_grp, n_item;")
    sql.append("  end if;")
    sql.append("  raise notice 'masters loaded: % companies, % categories, % item groups, % items',")
    sql.append("    n_co, n_cat, n_grp, n_item;")
    sql.append("end $$;")
    sql.append("")
    sql.append("commit;")
    sql.append("")
    sql.append("-- What is live now:")
    sql.append("select c.name as category, g.name as item_group, count(i.id) filter (where i.active) as items")
    sql.append("from public.fms_purchase_categories c")
    sql.append("left join public.fms_purchase_item_groups g on g.category_id = c.id and g.active")
    sql.append("left join public.fms_purchase_items i on i.item_group_id = g.id")
    sql.append("where c.active")
    sql.append("group by 1, 2 order by 1, 2;")
    sql.append("")

    with open(OUT_LOAD, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(sql))


def write_rollback_sql(companies, categories, groups, items):
    """Undo: delete the loaded rows (only where nothing references them), then bring
    the previous masters back. Generated alongside the load so the two never drift."""
    sql = [
        "-- Rollback for db/seed/fms_purchase_masters_load.sql. GENERATED - do not hand-edit.",
        "--",
        "--   psql \"$SUPABASE_DB_URL\" -f db/seed/fms_purchase_masters_rollback.sql",
        "--",
        "-- Deletes the masters loaded from the sheet (skipping any that a request/PO has",
        "-- since referenced - those are only deactivated), then reactivates every master",
        "-- that the load retired.",
        "",
        "begin;",
        "",
        "-- 1. drop the loaded items (children first), keeping any that are now in use",
        "delete from public.fms_purchase_items i",
        "using public.fms_purchase_item_groups ig, public.fms_purchase_categories c",
        "where ig.id = i.item_group_id and c.id = ig.category_id",
        "  and (c.name, ig.name, i.name) in (",
        values_block([(q(cat), q(grp), q(n)) for cat, grp, n, _u, _a, _so in items], indent="    "),
        "  )",
        "  and not exists (select 1 from public.fms_purchase_request_items ri where ri.item_id = i.id);",
        "",
        "-- 2. drop the loaded item groups that are now empty",
        "delete from public.fms_purchase_item_groups g",
        "using public.fms_purchase_categories c",
        "where c.id = g.category_id",
        "  and (c.name, g.name) in (",
        values_block([(q(cat), q(n)) for cat, n, _a, _so in groups], indent="    "),
        "  )",
        "  and not exists (select 1 from public.fms_purchase_items i where i.item_group_id = g.id);",
        "",
        "-- 3. drop the loaded categories / companies that nothing references",
        "delete from public.fms_purchase_categories c",
        "where c.name in (" + ", ".join(q(n) for n, _a, _so in categories) + ")",
        "  and not exists (select 1 from public.fms_purchase_item_groups g where g.category_id = c.id)",
        "  and not exists (select 1 from public.fms_purchase_requests r where r.category_id = c.id);",
        "",
        "delete from public.fms_purchase_companies co",
        "where (co.name, coalesce(co.location, '')) in (",
        values_block([(q(n), q(loc)) for n, loc, _a, _so in companies], indent="    "),
        "  )",
        "  and not exists (select 1 from public.fms_purchase_requests r where r.company_id = co.id);",
        "",
        "-- 4. bring the previously-active masters back",
        "update public.fms_purchase_companies   set active = true where not active;",
        "update public.fms_purchase_categories  set active = true where not active;",
        "update public.fms_purchase_item_groups set active = true where not active;",
        "update public.fms_purchase_items       set active = true where not active;",
        "",
        "commit;",
        "",
    ]
    with open(OUT_ROLLBACK, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(sql))


if __name__ == "__main__":
    main()
