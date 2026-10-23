"""Write one Expense Analysis (CFO) load into the hub database - all of it or none of it.

Called by expense_cfo_loader.py. One transaction per load: if anything fails half-way the
load row, its lines and its ties all disappear together, so the page can never read a
partial load. Status is 'tied' only when every company ties to Tally's TB within tolerance.
"""

from __future__ import annotations

import datetime as dt
import json

import psycopg

LINE_COLS = ["company", "entity", "vch_date", "voucher_guid", "list_key", "line_no", "voucher_type",
             "voucher_no", "ledger_guid", "gl", "exp_type", "main_group", "sub_group", "sub_sub_group",
             "party", "party_source", "narration", "amount", "is_sales_vch", "component"]
TIE_COLS = ["company", "exp_type", "level", "name", "tb", "lines", "gap", "as_of", "captured_at"]


def write_load(db_url: str | None, loads: dict, ties: dict, meta: dict, date_to: dt.date,
               tolerance: float) -> int:
    if not db_url:
        raise SystemExit("SUPABASE_DB_URL (hub database) not found - see EXPENSE_CFO_HUB_ENV")
    tied = all(abs(r["gap"]) <= tolerance for rows in ties.values() for r in rows)
    with psycopg.connect(db_url, connect_timeout=30) as conn:
        with conn.transaction():
            load_id = conn.execute(
                "insert into public.expense_cfo_load (date_to, companies) values (%s, %s) returning load_id",
                (date_to, json.dumps(meta, default=str))).fetchone()[0]
            with conn.cursor().copy(
                    f"copy public.expense_cfo_line (load_id, {', '.join(LINE_COLS)}) from stdin") as cp:
                for lines in loads.values():
                    for l in lines:
                        cp.write_row([load_id] + [l[c] for c in LINE_COLS])
            with conn.cursor().copy(
                    f"copy public.expense_cfo_tie (load_id, {', '.join(TIE_COLS)}) from stdin") as cp:
                for company, rows in ties.items():
                    for r in rows:
                        cp.write_row([load_id, company] + [r[c] for c in TIE_COLS[1:]])
            # Read back what landed and refuse the load if it differs from what was built.
            got = dict(conn.execute(
                "select company, count(*) from public.expense_cfo_line where load_id = %s group by 1",
                (load_id,)).fetchall())
            want = {c: len(v) for c, v in loads.items() if v}
            if got != want:
                raise RuntimeError(f"row count after write {got} differs from built {want}")
            conn.execute("update public.expense_cfo_load set status = %s, finished_at = now() where load_id = %s",
                         ("tied" if tied else "not_tied", load_id))
    return load_id
