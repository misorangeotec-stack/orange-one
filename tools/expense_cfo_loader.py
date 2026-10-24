"""Expense Analysis (CFO) loader - ConnectWave Tally mirror -> hub database.

Builds one expense line per expense-ledger entry on a voucher for the 5 FY 26-27 companies,
proves the lines against Tally's own Trial Balance, and writes both into the hub database
(tables from supabase/migrations/*_expense_cfo.sql) under one load_id. The Expense Analysis
(CFO) page only ever reads the newest load whose status is 'tied' or 'not_tied'.

    python tools/expense_cfo_loader.py                 # extract + tie + write
    python tools/expense_cfo_loader.py --dry-run       # extract + tie, print, write nothing
    python tools/expense_cfo_loader.py --to 2026-09-30 # cut the period at a month end

WHY IT READS THE RAW VOUCHER LINES AND NOT rpt_expense_line (proven 23-Oct-2026):
rpt_expense_line drops every ledger under Colorix's "OTHER EXPENSES" group - Rs 1,35,003.53
(LEGAL & PROFESSIONAL FEES 1,35,000 + ROUND OFF 3.53) that Tally's TB does carry. The raw
tally_voucher_line rows have them, so this loader classifies from the raw rows itself.

Rules copied from PL and BS/.claude/skills/refresh-expenses/scripts/fetch_tally_expenses.py,
so the hub and the Excel the CFO already knows classify identically:
  - group depth -> MAIN / SUB / SUB-SUB GROUP     (build_expense_ledger_map, :343-408)
  - spend is positive, reversals negative         (:1045)
  - component category keywords                   (classify_component_category, :127-149)
  - party from the party LINE, header as fallback (_resolve_party, :473-531)
One deliberate difference: Sales vouchers are KEPT (is_sales_vch = true). The Excel drops
them, which is why it can never equal the TB; the page shows them as a bridge instead.

Credentials are read from the files that already hold them, never copied:
  EXPENSE_CFO_CW_ENV  -> ConnectWave URL + service key (read-only use; default: the connector's .env)
  EXPENSE_CFO_HUB_ENV -> SUPABASE_DB_URL of the hub database (default: PL and BS/.env)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from dotenv import dotenv_values

PROJECTS = Path(__file__).resolve().parents[3]  # ...\00 Claude Project
CW_ENV = Path(os.environ.get("EXPENSE_CFO_CW_ENV",
                             PROJECTS / "connectwave-deploy-1" / "connectwave-deploy" / ".env"))
HUB_ENV = Path(os.environ.get("EXPENSE_CFO_HUB_ENV", PROJECTS / "PL and BS" / ".env"))

ACCOUNT = "acct_orange"
# The 5 FY 26-27 books (Files/TALLY Company_List.xlsx, column 2627). Short names and legal
# entity match the Company / Company Name columns of the Excel expense sheet.
COMPANIES = [
    ("a4e100d1-3b6f-4193-876a-c754f1a74552", "Otec-Surat", "Otec"),
    ("53d35745-5246-4e1a-a27a-d4769f245b50", "Otec-Noida", "Otec"),
    ("59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e", "Ent-Surat", "Ent"),
    ("779c26f4-3fd8-46bd-9995-4f9916c98856", "Ent-Noida", "Ent"),
    ("393ee4bd-4fdc-4aed-ae88-e2ff1394927a", "Colorix", "Colorix"),
]
FY_START = dt.date(2026, 4, 1)
DIRECT, INDIRECT = "DIRECT EXPENSES", "INDIRECT EXPENSES"
TOLERANCE = 0.99
PAGE = 1000      # PostgREST hard cap per request - every read pages past it
CHUNK = 80       # guids per in.(...) filter, keeps the URL well under limits


# ------------------------------------------------------------------ ConnectWave reads

class ConnectWave:
    def __init__(self) -> None:
        env = dotenv_values(CW_ENV)
        self.url = env.get("SUPABASE_URL")
        self.key = env.get("SUPABASE_SERVICE_KEY")
        if not self.url or not self.key:
            sys.exit(f"ConnectWave URL/key not found in {CW_ENV}")

    def _get(self, path: str, params: list[tuple[str, str]], count: bool = False):
        q = urllib.parse.urlencode(params)
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        if count:
            headers.update({"Prefer": "count=exact", "Range": "0-0"})
        last = None
        for attempt in range(5):
            try:
                req = urllib.request.Request(f"{self.url}/rest/v1/{path}?{q}", headers=headers)
                with urllib.request.urlopen(req, timeout=120) as r:
                    if count:
                        return int(r.headers["Content-Range"].split("/")[1])
                    return json.load(r)
            except (urllib.error.URLError, TimeoutError) as exc:
                # 57014 = statement timeout while ConnectWave rebuilds; back off and retry.
                last = exc
                time.sleep(2 + attempt * 3)
        raise RuntimeError(f"ConnectWave read failed: {path} {params[:3]}: {last}")

    def all(self, path: str, params: list[tuple[str, str]], order: str) -> list[dict]:
        """Every row, paged past the 1,000-row cap, then checked against count=exact."""
        rows: list[dict] = []
        while True:
            page = self._get(path, params + [("order", order), ("limit", str(PAGE)),
                                             ("offset", str(len(rows)))])
            rows += page
            if len(page) < PAGE:
                break
        filters = [p for p in params if p[0] != "select"]
        expected = self._get(path, filters + [("select", order.split(",")[0])], count=True)
        if expected != len(rows):
            raise RuntimeError(f"{path}: read {len(rows)} rows but the table holds {expected}")
        return rows


def _text(v) -> str:
    """Tally XML-as-JSON: a field is either a plain string or {"#text": ..., "@TYPE": ...}."""
    if isinstance(v, dict):
        return (v.get("#text") or "").strip()
    return (v or "").strip() if isinstance(v, str) else ""


def _u(s: str) -> str:
    """Tally names are case-insensitive: a ledger's PARENT says "OTHER EXPENSES" while the
    group object is "Other Expenses". Every name lookup goes through this."""
    return re.sub(r"\s+", " ", (s or "").strip()).upper()


# ------------------------------------------------------------------ classification

COMPONENT_RULES = [("FABRIC", r"\bFABRIC\b"), ("HEAD", r"\bHEAD\b"), ("INK", r"\bINK\b"),
                   ("MACHINE", r"\bMACHINE(RY)?\b"), ("SPARE", r"\bSPARE\b")]


def component_category(gl: str, party: str) -> str:
    text = f"{gl} {party}".upper()
    hits = [name for name, rx in COMPONENT_RULES if re.search(rx, text)]
    return " & ".join(hits) if hits else "GENERAL / OTHER"


def masters(cw: ConnectWave, tenant: str):
    """Ledger and group masters -> (ledger guid -> info, group display names)."""
    groups = cw.all("tally_object", [("select", "guid,name,raw_payload->PARENT"),
                                     ("tenant_id", f"eq.{tenant}"), ("object_type", "eq.Group"),
                                     ("is_deleted", "eq.false")], "guid")
    gparent = {_u(g["name"]): _u(_text(g["PARENT"])) for g in groups}
    gname = {_u(g["name"]): g["name"].strip() for g in groups}
    ledgers = cw.all("tally_object", [("select", "guid,name,raw_payload->PARENT"),
                                      ("tenant_id", f"eq.{tenant}"), ("object_type", "eq.Ledger"),
                                      ("is_deleted", "eq.false")], "guid")
    info = {}
    for l in ledgers:
        parent = _u(_text(l["PARENT"]))
        chain, cur, seen = [], parent, set()
        # Walk to the primary group. A primary's own PARENT is Tally's "&#4; Primary" root,
        # which is not a group - stop there or the chain ends at "PRIMARY" instead.
        while cur and cur not in seen and not cur.endswith("PRIMARY"):
            seen.add(cur)
            chain.append(cur)
            cur = gparent.get(cur, "")
        top = chain[-1] if chain else ""
        info[l["guid"]] = {"name": l["name"].strip(), "chain": chain, "top": top}
    return info, gname


def classify(chain: list[str], gname: dict[str, str]):
    """Same depth rule as build_expense_ledger_map. chain is bottom-up, ending at the primary."""
    if not chain or chain[-1] not in (DIRECT, INDIRECT):
        return None
    path = [gname.get(c, c) for c in reversed(chain[:-1])]   # top-down, below the primary
    if not path:
        path = [gname.get(chain[-1], chain[-1])]               # ledger sits on the primary itself
    main = path[0]
    sub = path[1] if len(path) > 1 else main
    subsub = path[2] if len(path) > 2 else sub
    return ("DIRECT" if chain[-1] == DIRECT else "INDIRECT"), main, sub, subsub


PARTY_TOPS = {"SUNDRY CREDITORS", "SUNDRY DEBTORS", "BANK ACCOUNTS", "BANK OD A/C", "CASH-IN-HAND",
              "LOANS & ADVANCES (ASSET)", "CURRENT LIABILITIES", "CURRENT ASSETS", "LOANS (LIABILITY)"}


def resolve_party(header: str, other_ledgers: list[dict]) -> tuple[str, str]:
    """_resolve_party, with "party line" = a non-expense, non-tax ledger on a party-type group
    (the mirror does not keep Tally's ISPARTYLEDGER flag)."""
    lines = []
    for l in other_ledgers:
        chain = set(l["chain"])
        if "DUTIES & TAXES" in chain or l["top"] in (DIRECT, INDIRECT):
            continue
        if chain & PARTY_TOPS and l["name"] not in lines:
            lines.append(l["name"])
    norm = lambda s: re.sub(r"[^A-Z0-9]", "", s.upper())
    if not lines:
        return (header, "HEADER (no party line)") if header else ("", "NONE")
    for name in lines:
        if norm(name) == norm(header):
            return name, "LINE"
    if len(lines) == 1:
        return (lines[0], f"CORRECTED <- {header}") if header else (lines[0], "LINE")
    if not header:
        return lines[0], f"LINE (1 of {len(lines)})"
    return header, f"AMBIGUOUS ({len(lines)} party lines)"


# Voucher natures that post to the books. Orders, notes, memoranda, reversing journals and the
# stock-only types carry ledger lines in the mirror too, but Tally's TB ignores them - found
# 23-Oct-2026 on Ent-Noida, where 12 Purchase/Sales Orders put Rs 8,607.81 of freight and office
# expense into the lines that the TB does not have.
ACCOUNTING_NATURES = {"Payment", "Receipt", "Contra", "Journal", "Sales", "Purchase",
                      "Credit Note", "Debit Note", "Payroll"}
NON_ACCOUNTING_NATURES = {"Purchase Order", "Sales Order", "Delivery Note", "Receipt Note",
                          "Rejections In", "Rejections Out", "Memorandum", "Reversing Journal",
                          "Stock Journal", "Physical Stock", "Attendance", "Job Work In Order",
                          "Job Work Out Order", "Material In", "Material Out"}


def voucher_natures(cw: ConnectWave, tenant: str) -> dict[str, str]:
    """Voucher type -> Tally's built-in nature. Walks PARENT up to the root type and takes its
    @RESERVEDNAME. v_voucher_type_nature cannot be used: a renamed built-in type (Otec-Surat's
    "GST PURCHASE" is Purchase, "Sales Accounts-HSS" is Sales) is its own parent, so the view's
    chain ends at the new name and never says Purchase or Sales."""
    rows = cw.all("tally_object", [("select", "guid,name,res:raw_payload->>@RESERVEDNAME,parent:raw_payload->PARENT"),
                                   ("tenant_id", f"eq.{tenant}"), ("object_type", "eq.VoucherType")], "guid")
    parent = {r["name"]: _text(r["parent"]) for r in rows}
    reserved = {r["name"]: r["res"] for r in rows if r["res"]}
    out = {}
    for name in parent:
        cur, seen = name, set()
        while cur not in reserved and cur in parent and cur not in seen:
            seen.add(cur)
            cur = parent[cur]
        out[name] = reserved.get(cur, "?")
    return out


def nature_of(vtype: str, natures: dict[str, str], notes: list[str]) -> str:
    """Some live vouchers name a type whose master is missing from the mirror (Otec-Surat, Oct-26:
    "GST INWARD SERVICE" beside the master "GST-INWARD SERVICE", "GST SALES-PAPER" beside
    "GST SALES- PAPER"). Match those on letters+digits only, and record that it happened."""
    if vtype in natures:
        return natures[vtype]
    key = re.sub(r"[^A-Z0-9]", "", vtype.upper())
    hits = {n for t, n in natures.items() if re.sub(r"[^A-Z0-9]", "", t.upper()) == key}
    if len(hits) == 1:
        nature = hits.pop()
        notes.append(f"voucher type '{vtype}' has no master in the mirror; matched by name -> {nature}")
        natures[vtype] = nature
        return nature
    return "?"


def is_sales(vtype: str) -> bool:
    v = vtype.lower()
    return "sale" in v and "isd" not in v


# ------------------------------------------------------------------ extract

def extract(cw: ConnectWave, guid: str, short: str, entity: str, date_to: dt.date):
    tenant = f"{ACCOUNT}::{guid}"
    led, gname = masters(cw, tenant)
    exp = {g: classify(i["chain"], gname) for g, i in led.items()}
    exp = {g: c for g, c in exp.items() if c}
    frm, to = FY_START.strftime("%Y%m%d"), date_to.strftime("%Y%m%d")

    lines = []
    ids = sorted(exp)
    for i in range(0, len(ids), CHUNK):
        lines += cw.all("tally_voucher_line", [
            ("select", "voucher_guid,list_key,line_no,ledger_guid,amount,vch_date,voucher_type,is_cancelled,is_optional"),
            ("tenant_id", f"eq.{tenant}"), ("vch_date", f"gte.{frm}"), ("vch_date", f"lte.{to}"),
            ("ledger_guid", f"in.({','.join(ids[i:i + CHUNK])})")], "voucher_guid,list_key,line_no")
    # Zero-value lines (a round-off that rounded to nothing) change no total; the Excel skips them too.
    lines = [l for l in lines if not l["is_cancelled"] and not l["is_optional"] and float(l["amount"]) != 0]
    natures, notes = voucher_natures(cw, tenant), []
    for l in lines:
        l["nature"] = nature_of(l["voucher_type"], natures, notes)
    unknown = {l["nature"] for l in lines} - ACCOUNTING_NATURES - NON_ACCOUNTING_NATURES
    if unknown:   # a new kind of voucher type: decide it deliberately, never by default
        types = sorted({l["voucher_type"] for l in lines if l["nature"] in unknown})
        raise RuntimeError(f"{short}: voucher nature not classified as accounting or not: "
                           f"{sorted(unknown)} on types {types}")
    lines = [l for l in lines if l["nature"] in ACCOUNTING_NATURES]

    vids = sorted({l["voucher_guid"] for l in lines})
    head, others = {}, defaultdict(list)
    for i in range(0, len(vids), CHUNK):
        chunk = f"in.({','.join(vids[i:i + CHUNK])})"
        for v in cw.all("tally_object", [
                ("select", "guid,is_deleted,vno:raw_payload->VOUCHERNUMBER,party:raw_payload->PARTYLEDGERNAME,"
                           "narr:raw_payload->NARRATION,vtype:raw_payload->VOUCHERTYPENAME"),
                ("tenant_id", f"eq.{tenant}"), ("object_type", "eq.Voucher"), ("guid", chunk)], "guid"):
            head[v["guid"]] = v
        for o in cw.all("tally_voucher_line", [
                ("select", "voucher_guid,list_key,line_no,ledger_guid"),
                ("tenant_id", f"eq.{tenant}"), ("voucher_guid", chunk)], "voucher_guid,list_key,line_no"):
            if o["ledger_guid"] in led and o["ledger_guid"] not in exp:
                others[o["voucher_guid"]].append(led[o["ledger_guid"]])

    out, dropped = [], 0
    for l in lines:
        h = head.get(l["voucher_guid"])
        if h is None or str(h.get("is_deleted")).lower() == "true":
            dropped += 1
            continue
        exp_type, main, sub, subsub = exp[l["ledger_guid"]]
        gl = led[l["ledger_guid"]]["name"]
        party, source = resolve_party(_text(h["party"]), others[l["voucher_guid"]])
        party = party or gl          # journals between two heads: the GL itself, as the Excel does
        d = dt.datetime.strptime(l["vch_date"], "%Y%m%d").date()
        out.append({
            "tenant_id": tenant, "company": short, "entity": entity, "vch_date": d.isoformat(),
            "voucher_guid": l["voucher_guid"], "list_key": l["list_key"], "line_no": l["line_no"],
            "voucher_type": l["voucher_type"], "voucher_no": _text(h["vno"]),
            "ledger_guid": l["ledger_guid"], "gl": gl, "exp_type": exp_type, "main_group": main,
            "sub_group": sub, "sub_sub_group": subsub, "party": party, "party_source": source,
            "narration": _text(h["narr"]), "amount": round(-float(l["amount"]), 2),
            "is_sales_vch": is_sales(l["voucher_type"] or ""),
            "component": component_category(gl, party) if exp_type == "DIRECT" else "",
        })
    return out, dropped, sorted(set(notes))


# ------------------------------------------------------------------ Trial Balance tie

def trial_balance(cw: ConnectWave, guid: str):
    """Tally's own TB rows (a primary group is followed by its first-level children)."""
    rows = cw.all("tally_trial_balance", [("select", "seq,name,closing,as_of,from_date,captured_at"),
                                          ("tenant_id", f"eq.{ACCOUNT}::{guid}")], "seq")
    return rows


def tb_children(tb: list[dict], primary: str, next_primaries: set[str]) -> dict[str, float]:
    out, inside = {}, False
    for r in tb:
        n = _u(r["name"])
        if n == primary:
            inside = True
            out["__TOTAL__"] = float(r["closing"])
            continue
        if inside and n in next_primaries:
            break
        if inside:
            out[n] = float(r["closing"])
    return out


PRIMARIES = {_u(x) for x in ["Capital Account", "Current Liabilities", "Current Assets", "Sales Accounts",
                             "Purchase Accounts", "Direct Expenses", "Direct Incomes", "Indirect Expenses",
                             "Indirect Incomes", "Loans (Liability)", "Fixed Assets", "Investments",
                             "Suspense A/c", "Misc. Expenses (ASSET)", "Branch / Divisions",
                             "Profit & Loss A/c", "Non Current Assest", "Non Current Liabilities",
                             "Opening Stock", "Stock-in-Hand"]}


def tie(lines: list[dict], tb: list[dict]) -> list[dict]:
    """Group total and every first-level child (sub-group or ledger) against Tally's TB.
    Both sides cover FY start to the TB's as_of date."""
    as_of = tb[0]["as_of"]
    result = []
    for primary, etype in ((DIRECT, "DIRECT"), (INDIRECT, "INDIRECT")):
        kids = tb_children(tb, primary, PRIMARIES - {primary})
        mine = defaultdict(float)
        for l in lines:
            if l["exp_type"] == etype and l["vch_date"] <= as_of:
                mine["__TOTAL__"] += l["amount"]
                mine[_u(l["main_group"])] += l["amount"]
        # A ledger posted straight onto the primary shows on the TB under its own name, and the
        # depth rule gives it MAIN GROUP = the primary's name; map it back to the ledger name.
        for l in lines:
            if l["exp_type"] == etype and l["vch_date"] <= as_of and _u(l["main_group"]) == primary:
                mine[_u(l["gl"])] += l["amount"]
                mine[primary] -= l["amount"]
        for name in sorted(set(kids) | {k for k in mine if k != primary}):
            t, m = kids.get(name, 0.0), mine.get(name, 0.0)
            result.append({"level": "group" if name == "__TOTAL__" else "child", "exp_type": etype,
                           "name": primary.title() if name == "__TOTAL__" else name,
                           "tb": round(t, 2), "lines": round(m, 2), "gap": round(t - m, 2),
                           "as_of": as_of, "captured_at": tb[0]["captured_at"]})
    return result


# ------------------------------------------------------------------ main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--to", help="last date to include (YYYY-MM-DD); default today")
    ap.add_argument("--dry-run", action="store_true", help="extract and tie only; write nothing")
    ap.add_argument("--company", action="append", help="limit to these short names (testing)")
    a = ap.parse_args()
    date_to = dt.date.fromisoformat(a.to) if a.to else dt.date.today()
    cw = ConnectWave()

    if a.company and not a.dry_run:
        sys.exit("--company is for testing only; a load written to the database must hold all 5 companies")
    loads, ties, meta = {}, {}, {}
    for guid, short, entity in COMPANIES:
        if a.company and short not in a.company:
            continue
        t0 = time.time()
        tb = trial_balance(cw, guid)
        lines, dropped, notes = extract(cw, guid, short, entity, date_to)
        for n in notes:
            print(f"   note: {n}")
        tb_after = trial_balance(cw, guid)
        if tb_after[0]["captured_at"] != tb[0]["captured_at"]:
            tb = tb_after          # TB re-captured mid-read: tie to the newer one
        ties[short] = tie(lines, tb)
        loads[short] = lines
        gaps = [r for r in ties[short] if abs(r["gap"]) > TOLERANCE]
        meta[short] = {"lines": len(lines), "tb_as_of": tb[0]["as_of"], "tb_captured_at": tb[0]["captured_at"],
                       "gaps": len(gaps), "deleted_dropped": dropped, "notes": notes}
        print(f"{short:11} {len(lines):>6} lines  dropped(deleted) {dropped:>3}  "
              f"TB {tb[0]['as_of']} @ {tb[0]['captured_at'][:16]}  "
              f"{'TIED' if not gaps else f'GAP x{len(gaps)}'}  ({time.time() - t0:.0f}s)")
        for r in gaps:
            print(f"      {r['exp_type']:8} {r['name'][:50]:50} TB {r['tb']:>15,.2f} lines {r['lines']:>15,.2f} gap {r['gap']:>13,.2f}")

    if a.dry_run:
        tmp = Path(__file__).resolve().parent.parent / ".tmp"
        tmp.mkdir(exist_ok=True)
        (tmp / "expense_cfo_dry_run.json").write_text(json.dumps({"lines": loads, "ties": ties}, default=str))
        print(f"dry run: nothing written to the database; detail in {tmp / 'expense_cfo_dry_run.json'}")
        return 0
    from expense_cfo_db import write_load   # imported late: a dry run needs no DB driver
    load_id = write_load(dotenv_values(HUB_ENV).get("SUPABASE_DB_URL"), loads, ties, meta, date_to, TOLERANCE)
    tied = all(m["gaps"] == 0 for m in meta.values())
    print(f"written load {load_id}: {'TIED to Tally TB' if tied else 'NOT TIED - page will show DRAFT'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
