"""
build_purchase_register_snapshot.py — localhost stand-in for ConnectWave's rpt_purchase_register.

The table (supabase/connectwave/rpt_purchase_register.sql) is not applied yet. Until it is, this script
builds the SAME rows from the Tally mirror and writes them to

    frontend/public/dev-data/rpt_purchase_register.json      (gitignored — live vendor data)

which the Bushra Purchase Register reads when frontend/.env.local has VITE_PURCHASE_REGISTER_SOURCE=local.
The rules below mirror the SQL rebuild line for line — change one, change the other.

READ-ONLY. It only SELECTs from ConnectWave, one request at a time, a month per request. Credentials
come from the ConnectWave .env beside connectwave.exe; the service key is never printed.

    python tools/build_purchase_register_snapshot.py                     # 01-04-2025 → today
    python tools/build_purchase_register_snapshot.py --from 20260401 --to 20260915
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ENV_FILE = Path(r"C:/Users/admin/OneDrive - Orange O Tec Private Limited/AI-Sync/connectwave-deploy/.env")
OUT_FILE = Path(__file__).resolve().parents[1] / "frontend" / "public" / "dev-data" / "rpt_purchase_register.json"
PAGE = 500


def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"')
    return env["SUPABASE_URL"].rstrip("/"), env["SUPABASE_SERVICE_KEY"]


URL, KEY = load_env()


def get(path: str, tries: int = 3):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if attempt == tries - 1:
                raise RuntimeError(f"{e.code} on {path[:120]}… {e.read()[:200]!r}") from None
            time.sleep(5 * (attempt + 1))


def get_all(path: str, order: str) -> list:
    """Every row, page by page. PostgREST caps one response at max-rows (1,000 here) and answers 200
    with the rest silently dropped, so a list that can grow is never read in one request."""
    out: list = []
    for offset in range(0, 10**7, PAGE):
        page = get(f"{path}&order={order}&limit={PAGE}&offset={offset}")
        out.extend(page)
        if len(page) < PAGE:
            return out
    return out


# ------------------------------------------------------------------ tally json helpers

def jtext(v):
    if isinstance(v, dict):
        return v.get("#text")
    return v


CLEAN_NUMBER = re.compile(r"\s*-?[0-9]+(\.[0-9]+)?\s*")


def amt(v) -> float:
    """public.amt, line for line (ConnectWave-App connector/supabase/00_helpers.sql).

    A forex line reads "-$4252.00 @ ₹87.30/$ = -₹371199.60": the BASE-currency value is the part after
    the last '='. Taking the first number instead gave +4252 there — a ₹3.7 L machine purchase shown as
    a ₹4,252 return. Anything else keeps only digits, '.' and '-', as the SQL does; a string that still
    will not parse raises, as the SQL cast does, rather than quietly becoming 0.
    """
    s = jtext(v)
    if s is None or not str(s).strip():
        return 0.0
    s = str(s)
    if CLEAN_NUMBER.fullmatch(s):
        return float(s)
    part = s.rsplit("=", 1)[-1] if "=" in s else s
    cleaned = re.sub(r"[^0-9.-]", "", part)
    return float(cleaned) if cleaned else 0.0


def as_list(v) -> list:
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        return [v]
    return []


def entry_lines(p: dict) -> list:
    return as_list(p.get("ALLLEDGERENTRIES.LIST")) or as_list(p.get("LEDGERENTRIES.LIST"))


# ------------------------------------------------------------------ the rules (mirror the SQL)

SKIP_LEDGER = re.compile(r"(GST|ROUND|TDS|TCS|CESS|OUTPUT TAX|INPUT TAX)")


def is_purchase_type(voucher_type: str, chain: list[str]) -> bool:
    ch = set(chain or [])
    if ch & {"Purchase", "GST PURCHASE"}:
        return True
    return bool(ch & {"Credit Note", "Debit Note"}) and "PURCHASE" in voucher_type.upper()


def classifier_of(company_name: str) -> tuple[str, str]:
    n = (company_name or "").upper()
    cls = "OOTEPL" if "ENTERPRISE" in n else "COLORIX" if "COLORIX" in n else "OOTPL"
    return cls, ("NOIDA" if "NOIDA" in n else "SURAT")


def company_label(cls: str, party: str) -> str:
    p = (party or "").upper()
    o_p, o_e, colorix = p.startswith("ORANGE O TEC P"), p.startswith("ORANGE O TEC E"), p.startswith("COLORIX DIGITAL PRINTING SOLUTIONS")
    if cls == "OOTPL":
        return "ORANGE O TEC BRANCH" if o_p else "ORANGE O TEC RELATED" if (o_e or colorix) else "ORANGE O TEC"
    if cls == "OOTEPL":
        return "ORANGE ENT RELATED" if (o_p or colorix) else "ORANGE ENT BRANCH" if o_e else "ORANGE ENTERPRISE"
    return "COLORIX RELATED" if (o_p or o_e) else "COLORIX"


def type_of(label: str, voucher_type: str) -> str:
    prefix = "Branch " if "BRANCH" in label else "Related " if "RELATED" in label else ""
    vt = voucher_type.upper()
    base = ("Purchase Return" if "RETURN" in vt else
            "Purchase Debit Note" if "DEBIT NOTE" in vt else
            "Purchase Credit Note" if "CREDIT NOTE" in vt else
            "Purchase")
    return prefix + base


def sign(x: float) -> float:
    return (x > 0) - (x < 0)


def rows_for_voucher(tenant: str, cls: str, location: str, o: dict) -> list[dict]:
    p = o["raw_payload"]
    if (jtext(p.get("ISCANCELLED")) or "No") != "No" or (jtext(p.get("ISOPTIONAL")) or "No") != "No":
        return []
    voucher_type = p.get("VOUCHERTYPENAME") or ""
    party = jtext(p.get("PARTYLEDGERNAME"))
    base = {
        "tenant_id": tenant,
        "company_guid": tenant.split("::")[1].split("~")[0],
        "fy": o["fy"],
        "vch_date": o["vch_date"],
        "voucher_guid": o["guid"],
        "location": location,
        "date_display": datetime.strptime(o["vch_date"], "%Y%m%d").strftime("%d-%m-%Y"),
        "party": party,
        "voucher_type": voucher_type,
        "voucher_no": jtext(p.get("VOUCHERNUMBER")),
        "gstin": jtext(p.get("PARTYGSTIN")),
    }
    label = company_label(cls, party or "")
    base["company_label"] = label
    base["type"] = type_of(label, voucher_type)

    out = []
    for ord_, e in enumerate(as_list(p.get("ALLINVENTORYENTRIES.LIST")), start=1):
        if not isinstance(e, dict):
            continue
        item = (jtext(e.get("STOCKITEMNAME")) or "").strip()
        if not item:
            continue
        a = amt(e.get("AMOUNT"))
        out.append({**base, "line_no": ord_, "kind": "item", "particulars": jtext(e.get("STOCKITEMNAME")),
                    "quantity": sign(-a) * abs(amt(e.get("BILLEDQTY"))), "rate": abs(amt(e.get("RATE"))), "amount": -a})
    if out:
        return out
    for ord_, e in enumerate(entry_lines(p), start=1):
        if not isinstance(e, dict):
            continue
        ledger = jtext(e.get("LEDGERNAME"))
        a = amt(e.get("AMOUNT"))
        if ledger == party or a == 0 or SKIP_LEDGER.search((ledger or "").upper()):
            continue
        out.append({**base, "line_no": ord_, "kind": "ledger", "particulars": ledger,
                    "quantity": 0, "rate": 0, "amount": -a})
    return out


# ------------------------------------------------------------------ main

def months(frm: str, to: str):
    d = datetime.strptime(frm, "%Y%m%d").date()
    end = datetime.strptime(to, "%Y%m%d").date()
    while d <= end:
        nxt = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        yield d.strftime("%Y%m%d"), min(nxt - timedelta(days=1), end).strftime("%Y%m%d")
        d = nxt


def pg_in(values: list[str]) -> str:
    return "(" + ",".join('"' + v.replace('"', '\\"') + '"' for v in values) + ")"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="frm", default="20250401")
    ap.add_argument("--to", dest="to", default=date.today().strftime("%Y%m%d"))
    args = ap.parse_args()

    companies = {c["tenant_id"]: c["company_name"]
                 for c in get_all("v_company?select=tenant_id,company_name", "tenant_id.asc")}
    tenants = sorted({b["tenant_id"] for b in get_all("rpt_sales_book?select=tenant_id", "tenant_id.asc")})
    natures = get_all("v_voucher_type_nature?select=tenant_id,voucher_type,chain", "tenant_id.asc,voucher_type.asc")

    # A book can hold vouchers whose voucher-type MASTER it no longer has (Enterprise Surat 2024-26 has
    # 'GST PURCHASE - INK' vouchers but no such type). Such a name is judged by the same type in the
    # other books — the SQL does the same with its `vn.chain is null` fallback.
    purchase_anywhere = {n["voucher_type"] for n in natures if is_purchase_type(n["voucher_type"], n["chain"])}

    rows: list[dict] = []
    for tenant in tenants:
        own = [n for n in natures if n["tenant_id"] == tenant]
        own_names = {n["voucher_type"] for n in own}
        types = sorted({n["voucher_type"] for n in own if is_purchase_type(n["voucher_type"], n["chain"])}
                       | (purchase_anywhere - own_names))
        name = companies.get(tenant, tenant)
        if not types:
            print(f"  {name[:50]:50} no purchase voucher types")
            continue
        cls, location = classifier_of(name)
        n_before = len(rows)
        for m_from, m_to in months(args.frm, args.to):
            base = (f"tally_object?select=guid,fy,vch_date,raw_payload"
                    f"&tenant_id=eq.{urllib.parse.quote(tenant)}&object_type=eq.Voucher&is_deleted=is.false"
                    f"&vch_date=gte.{m_from}&vch_date=lte.{m_to}"
                    f"&raw_payload->>VOUCHERTYPENAME=in.{urllib.parse.quote(pg_in(types))}"
                    f"&order=guid.asc")
            for offset in range(0, 10**7, PAGE):
                page = get(f"{base}&limit={PAGE}&offset={offset}")
                for o in page:
                    rows.extend(rows_for_voucher(tenant, cls, location, o))
                if len(page) < PAGE:
                    break
                time.sleep(0.3)
            time.sleep(0.3)
        print(f"  {name[:50]:50} {len(rows) - n_before:>7} lines")

    built_at = datetime.now(timezone.utc).isoformat()
    for r in rows:
        r["built_at"] = built_at
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({"from": args.frm, "to": args.to, "built_at": built_at, "rows": rows}), encoding="utf-8")
    print(f"wrote {len(rows)} lines -> {OUT_FILE}")


if __name__ == "__main__":
    sys.exit(main())
