"""
build_ink_expiry_list.py — every ink lot that carries an expiry date in Tally, one row per lot.

Expiry lives on the Tally batch allocation of whatever voucher the user entered it on (production,
transfer, sale, purchase…), so this reads every `rpt_batch_line` with an expiry, in every company,
and folds the lines to one row per (company, stock item, lot). Where a lot shows two different
expiry dates across vouchers, the latest-dated voucher wins and the conflict is listed.

    Category        = the item's stock group in Tally (leaf), plus the full group path
    Balance         = rpt_lot_balance — qty still on hand for that lot in that book
    Status          = against --today: Expired / ≤30 d / ≤90 d / ≤180 d / >180 d

Ink only: group path contains 'INK' (finished, loose and printing ink). Raw materials and other
groups are reported on screen, not listed. READ-ONLY — only SELECTs from ConnectWave.

    python tools/build_ink_expiry_list.py
    python tools/build_ink_expiry_list.py --out some\\path.xlsx --today 2026-09-28
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

ENV_FILE = Path(r"C:/Users/admin/OneDrive - Orange O Tec Private Limited/AI-Sync/connectwave-deploy/.env")
DEFAULT_OUT = Path(r"C:/Users/admin/OneDrive - Orange O Tec Private Limited/Claude Code Working File"
                   r"/Ink Lot Expiry List.xlsx")
PAGE = 1000
COMPANY = {
    "59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e": "Enterprises Surat",
    "a4e100d1-3b6f-4193-876a-c754f1a74552": "Otec Surat",
    "779c26f4-3fd8-46bd-9995-4f9916c98856": "Enterprises Noida",
    "53d35745-5246-4e1a-a27a-d4769f245b50": "Otec Noida",
    "393ee4bd-4fdc-4aed-ae88-e2ff1394927a": "Colorix",
}


def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]


URL, KEY = load_env()


def get(path: str, tries: int = 4):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            if attempt == tries - 1:
                body = e.read()[:200] if isinstance(e, urllib.error.HTTPError) else b""
                raise RuntimeError(f"{e} on {path[:120]}… {body!r}") from None
            time.sleep(3 * (attempt + 1))


def get_all(table: str, params: dict, order: str) -> list:
    """PostgREST caps a page at 1000 rows; a stable ORDER is what keeps paging from skipping rows."""
    out, off = [], 0
    while True:
        q = urllib.parse.urlencode({**params, "order": order, "limit": PAGE, "offset": off}, safe=",.*:()>")
        rows = get(f"{table}?{q}")
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        off += len(rows)


def tally_date(s: str | None) -> date | None:
    """Tally batch dates arrive as text: '21-Aug-27', occasionally '21-Aug-2027' or ISO."""
    if not s:
        return None
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            pass
    return None


def ymd(s: str) -> date:
    return datetime.strptime(s, "%Y%m%d").date()


import re

# Not saleable ink with a shelf life — left out, as the user asked (01-10-2026): accounting
# provisions, dead stock, diff stock and loose (unpacked) ink. Same rule as the Hub page
# (frontend/src/apps/ink-expiry/lib/expiry.ts, EXCLUDED_GROUPS).
EXCLUDED = re.compile(r"PROVISION|DEAD STOCK|DIFF (INK )?STOCK|LOOSE INK", re.I)


def is_excluded(path: str | None, item: str = "") -> bool:
    return bool(EXCLUDED.search(path or "")) or item.strip().upper().startswith("PROVISION")


def is_ink(path: str | None) -> bool:
    return bool(path) and "INK" in path.upper() and "CHEMICALS" not in path.upper() and not is_excluded(path)


def fetch():
    lines = get_all("rpt_batch_line", {
        "or": "(batch_expiry_raw.not.is.null,batch_expiry.not.is.null)",
        "select": "tenant_id,company_guid,vch_date,voucher_type,voucher_no,voucher_guid,line_no,batch_no,"
                  "stock_item,batch_name,batch_mfd,batch_expiry,batch_expiry_raw,godown_name,built_at",
    }, "tenant_id,voucher_guid,line_no,batch_no")
    guids = sorted({r["company_guid"] for r in lines})
    items, bal = [], []
    for g in guids:
        items += get_all("rpt_stock_summary_item", {
            "company_guid": f"eq.{g}",
            "select": "tenant_id,company_guid,item,item_code,stock_group,primary_group,group_path,stock_category,base_unit",
        }, "tenant_id,item")
        bal += get_all("rpt_lot_balance", {"company_guid": f"eq.{g}", "select": "*"}, "stock_item,batch_name")
    return lines, items, bal


def status(days: int | None) -> str:
    if days is None:
        return "Expiry not a date"
    if days < 0:
        return "Expired"
    for lim, lab in ((30, "Expires ≤ 30 days"), (90, "Expires 31–90 days"), (180, "Expires 91–180 days")):
        if days <= lim:
            return lab
    return "Expires > 180 days"


def build(lines, items, bal, today: date):
    # Item master per company; the live (un-suffixed) tenant wins over older-year snapshots.
    master: dict[tuple, dict] = {}
    for x in sorted(items, key=lambda x: "~" not in x["tenant_id"]):
        master[(x["company_guid"], x["item"])] = x
    balance = {(b["company_guid"], b["stock_item"], b["batch_name"]): b for b in bal}

    by_lot: dict[tuple, list] = defaultdict(list)
    for r in lines:
        by_lot[(r["company_guid"], r["stock_item"], (r["batch_name"] or "").strip())].append(r)

    out, skipped = [], Counter()
    for (guid, item, lot), rs in by_lot.items():
        m = master.get((guid, item), {})
        path = m.get("group_path")
        if not is_ink(path):
            skipped[f"{COMPANY.get(guid, guid[:8])} | {path} | {item} | {lot}"] += len(rs)
            continue
        rs.sort(key=lambda r: (r["vch_date"], r["voucher_no"] or ""))
        raws = [r["batch_expiry_raw"] or r["batch_expiry"] for r in rs]
        latest_raw = raws[-1]
        exp = tally_date(latest_raw)
        distinct = sorted({x for x in raws if x}, key=lambda s: tally_date(s) or date.max)
        mfd = next((tally_date(r["batch_mfd"]) for r in reversed(rs) if r["batch_mfd"]), None)
        b = balance.get((guid, item, lot)) or {}
        days = (exp - today).days if exp else None
        first = rs[0]
        out.append({
            "company": COMPANY.get(guid, guid[:8]),
            "item": item,
            "code": m.get("item_code"),
            "category": m.get("stock_group"),
            "main_group": m.get("primary_group"),
            "path": path,
            "tally_cat": m.get("stock_category"),
            "lot": lot,
            "mfd": mfd,
            "exp": exp,
            "exp_raw": latest_raw,
            "days": days,
            "status": status(days),
            "balance": b.get("balance"),
            "uom": b.get("uom") or m.get("base_unit"),
            "godown": b.get("last_godown"),
            "last_move": ymd(b["last_movement"]) if b.get("last_movement") else None,
            "first_vch": f"{ymd(first['vch_date']):%d-%b-%Y} · {first['voucher_type']} · {first['voucher_no']}",
            "n_lines": len(rs),
            "conflict": " / ".join(distinct) if len(distinct) > 1 else "",
        })
    out.sort(key=lambda x: (x["exp"] or date.max, x["company"], x["category"] or "", x["item"], x["lot"]))
    return out, skipped


def write_excel(rows, out: Path, today: date, built_at: str):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_fill = PatternFill("solid", fgColor="1F3864")
    head_font = Font(bold=True, color="FFFFFF")
    fills = {
        "Expired": PatternFill("solid", fgColor="F8CBAD"),
        "Expires ≤ 30 days": PatternFill("solid", fgColor="FCE4D6"),
        "Expires 31–90 days": PatternFill("solid", fgColor="FFF2CC"),
        "Expiry not a date": PatternFill("solid", fgColor="D9D9D9"),
    }
    DF = "DD-MMM-YYYY"

    def sheet(ws, headers, data, widths, date_cols=()):
        ws.append(headers)
        for c in ws[1]:
            c.fill, c.font = head_fill, head_font
            c.alignment = Alignment(wrap_text=True, vertical="center")
        for r in data:
            ws.append(r)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        for col in date_cols:
            for c in ws[get_column_letter(col)][1:]:
                c.number_format = DF
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        ws.row_dimensions[1].height = 32

    ws = wb.active
    ws.title = "Ink Lot Expiry"
    sheet(ws, ["Company", "Stock item", "Item code", "Category (stock group)", "Main group", "Group path",
               "Tally stock category", "Lot no.", "Mfg date", "Expiry date", "Days to expiry", "Status",
               "Lot balance", "Unit", "Last godown", "Last movement", "First voucher carrying expiry",
               "Voucher lines", "Different expiries seen"],
          [[r["company"], r["item"], r["code"], r["category"], r["main_group"], r["path"], r["tally_cat"],
            r["lot"], r["mfd"], r["exp"] if r["exp"] else r["exp_raw"], r["days"], r["status"],
            r["balance"], r["uom"], r["godown"], r["last_move"], r["first_vch"], r["n_lines"], r["conflict"]]
           for r in rows],
          [17, 40, 11, 32, 18, 50, 16, 20, 12, 12, 9, 20, 11, 6, 16, 12, 48, 8, 24], date_cols=(9, 10, 16))
    for i, r in enumerate(rows, 2):
        f = fills.get(r["status"])
        if f:
            for c in ws[i]:
                c.fill = f

    # Summary: category × status
    ws = wb.create_sheet("By Category")
    statuses = ["Expired", "Expires ≤ 30 days", "Expires 31–90 days", "Expires 91–180 days",
                "Expires > 180 days", "Expiry not a date"]
    agg: dict[tuple, dict] = defaultdict(lambda: {"n": Counter(), "bal": 0.0, "next": None})
    for r in rows:
        a = agg[(r["company"], r["category"])]
        a["n"][r["status"]] += 1
        a["bal"] += r["balance"] or 0
        if r["exp"] and r["exp"] >= today and (a["next"] is None or r["exp"] < a["next"]):
            a["next"] = r["exp"]
    sheet(ws, ["Company", "Category (stock group)", "Lots", *statuses, "Balance on hand", "Nearest future expiry"],
          [[c, g, sum(a["n"].values()), *(a["n"][s] for s in statuses), round(a["bal"], 2), a["next"]]
           for (c, g), a in sorted(agg.items(), key=lambda kv: (kv[0][0], kv[0][1] or ""))],
          [17, 36, 7, 9, 10, 10, 10, 10, 10, 13, 13], date_cols=(11,))
    r0 = ws.max_row + 2
    notes = [
        f"Source: ConnectWave (Tally sync), rpt_batch_line built {built_at}. 'Today' = {today:%d-%b-%Y}.",
        "One row per company + stock item + lot. Expiry = as entered on the lot's batch allocation in Tally;",
        "if vouchers disagree, the latest-dated voucher wins and all values show in 'Different expiries seen'.",
        "Lot balance = rpt_lot_balance (movements netted per lot). Ink only — groups whose path contains 'INK'.",
    ]
    for i, n in enumerate(notes):
        ws.cell(r0 + i, 1, n)

    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--today", type=lambda s: datetime.strptime(s, "%Y-%m-%d").date(), default=date.today())
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    lines, items, bal = fetch()
    rows, skipped = build(lines, items, bal, a.today)
    built_at = max(r["built_at"] for r in lines)[:16].replace("T", " ") + " UTC"
    write_excel(rows, a.out, a.today, built_at)

    print(f"expiry lines: {len(lines)}; ink lots: {len(rows)}; built_at {built_at}")
    print("by company:", dict(Counter(r["company"] for r in rows)))
    print("by status:", dict(Counter(r["status"] for r in rows)))
    print("lots with conflicting expiries:", sum(1 for r in rows if r["conflict"]))
    print("lots with balance > 0:", sum(1 for r in rows if (r["balance"] or 0) > 0))
    print("skipped (not ink):", dict(skipped))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
