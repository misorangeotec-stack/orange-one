"""
Tool: sync_tally_lot_index.py

Extracts Batch/LOT allocations from Tally and upserts them into Supabase
`fms_complaint_lot_index`, so the Complaint (RM/FG) FMS can resolve a LOT number
to the shipments it was on.

WHY THIS EXISTS
---------------
Tally holds the lot on every inventory line, at
    ALLINVENTORYENTRIES.BATCHALLOCATIONS.BATCHNAME
but it cannot be queried interactively. Measured against the live books on
05-09-2026:

    whole FY 26-27, full inventory + batch    82.2s    90 MB
    whole FY 26-27, batch fields only         55.7s    88 MB

and there is no server-side filter on batch name — two attempts to build one
(TDL $$FilterCount and $$FullList CONTAINS) HUNG the live Tally instance.

So the browser cannot ask Tally per keystroke: it would be a 56-second, 88 MB
request, and only ever from a machine running Tally. Vercel could never do it.
This tool pays that cost ONCE, on a schedule, and every lookup afterwards is an
indexed Supabase query that works everywhere.

USAGE
-----
    python tools/sync_tally_lot_index.py                    # every open company, current FY
    python tools/sync_tally_lot_index.py --company "ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2026-27)"
    python tools/sync_tally_lot_index.py --from 20260401 --to 20270331
    python tools/sync_tally_lot_index.py --dry-run          # extract and report, write nothing

Requires in .env (repo root):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

The service key is used because this table has no write policy — nobody types
into it, and the extractor replaces a company's rows wholesale.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests
import xml.etree.ElementTree as ET

TALLY_URL = "http://localhost:9000"
TALLY_TIMEOUT = 900          # a full-year export is slow; see the header
PAGE = 500                   # rows per Supabase upsert request

# Tally's placeholders for "this item has no batch tracking". NOT lot numbers.
PLACEHOLDERS = {"primary batch", "any", "not applicable", ""}

# The lot is the trailing digit run. "#1637-26071173" -> "26071173".
# ⚠ MIRRORS normaliseLot() in frontend/src/apps/complaint/lib/resolveLot.ts.
#   If these two disagree, a hand-typed lot silently finds nothing.
LOT_RE = re.compile(r"(\d{5,})\s*$")


# ---------------------------------------------------------------------------
# env
# ---------------------------------------------------------------------------

def load_env() -> dict[str, str]:
    """Read the repo-root .env without a dependency on python-dotenv."""
    root = Path(__file__).resolve().parent.parent
    env: dict[str, str] = {}
    path = root / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    # A real environment variable wins over the file.
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


# ---------------------------------------------------------------------------
# Tally
# ---------------------------------------------------------------------------

def _clean_xml(raw: bytes) -> bytes:
    """Fix the XML quirks Tally emits, so ElementTree can parse it."""
    text = raw.decode("utf-8", errors="replace")

    def _strip_invalid_ref(m: re.Match) -> str:
        n = int(m.group(1))
        ok = n in (9, 10, 13) or (0x20 <= n <= 0xD7FF) or (0xE000 <= n <= 0xFFFD)
        return m.group(0) if ok else ""

    text = re.sub(r"&#(\d+);", _strip_invalid_ref, text)
    text = text.replace("<ENVELOPE>", '<ENVELOPE xmlns:UDF="TallyUDF">', 1)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return text.encode("utf-8")


def _txt(el, tag: str, default: str = "") -> str:
    v = el.findtext(tag, default)
    return v.strip() if v else default


def post(xml: str) -> ET.Element:
    r = requests.post(TALLY_URL, data=xml.encode("utf-8"),
                      headers={"Content-Type": "application/xml"}, timeout=TALLY_TIMEOUT)
    r.raise_for_status()
    return ET.fromstring(_clean_xml(r.content))


def open_companies() -> list[str]:
    xml = """<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
    <TDL><TDLMESSAGE><COLLECTION NAME="List of Companies" ISMODIFY="No">
      <TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL>
  </DESC></BODY></ENVELOPE>"""
    root = post(xml)
    return [c.strip() for c in (root.itertext() if False else
            [e.text or "" for e in root.iter("NAME")]) if c and c.strip()]


# ⚠ ONLY THE BATCH FIELDS. Adding rate/amount here costs ~26s and 2 MB more per
#   company for facts the lookup does not use.
FETCH = ",".join([
    "DATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "PARTYLEDGERNAME", "ISINVOICE",
    "ALLINVENTORYENTRIES.STOCKITEMNAME",
    "ALLINVENTORYENTRIES.BATCHALLOCATIONS.BATCHNAME",
    "ALLINVENTORYENTRIES.BATCHALLOCATIONS.GODOWNNAME",
    "ALLINVENTORYENTRIES.BATCHALLOCATIONS.BILLEDQTY",
])


def fetch_vouchers(company: str, from_date: str, to_date: str) -> list[ET.Element]:
    xml = f"""<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LotVouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
      <SVFROMDATE>{from_date}</SVFROMDATE><SVTODATE>{to_date}</SVTODATE>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE><COLLECTION NAME="LotVouchers" ISMODIFY="No">
      <TYPE>Voucher</TYPE><FETCH>{FETCH}</FETCH></COLLECTION></TDLMESSAGE></TDL>
  </DESC></BODY></ENVELOPE>"""
    return post(xml).findall(".//VOUCHER")


def direction_of(voucher_type: str) -> str:
    vt = voucher_type.lower()
    if "purchase" in vt:
        return "purchase"
    if "sale" in vt and "return" not in vt:
        return "sales"
    return "other"


def iso_date(tally_date: str) -> str | None:
    """Tally exports YYYYMMDD."""
    s = (tally_date or "").strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def extract(company: str, from_date: str, to_date: str) -> list[dict]:
    """Every (line x batch) with a REAL lot number. Placeholders are dropped."""
    vouchers = fetch_vouchers(company, from_date, to_date)
    rows: dict[tuple, dict] = {}
    dropped = 0

    for v in vouchers:
        vtype = _txt(v, "VOUCHERTYPENAME")
        vno = _txt(v, "VOUCHERNUMBER")
        if not vno:
            continue
        vdate = iso_date(_txt(v, "DATE"))
        party = _txt(v, "PARTYLEDGERNAME")
        dirn = direction_of(vtype)

        for ie in v.findall(".//ALLINVENTORYENTRIES.LIST"):
            item = _txt(ie, "STOCKITEMNAME")
            if not item:
                continue
            for ba in ie.findall("./BATCHALLOCATIONS.LIST"):
                batch = _txt(ba, "BATCHNAME")
                if batch.lower().strip() in PLACEHOLDERS:
                    dropped += 1
                    continue
                m = LOT_RE.search(batch)
                if not m:
                    dropped += 1
                    continue
                godown = _txt(ba, "GODOWNNAME")
                # Same natural key as the unique index, so a duplicate inside one
                # export cannot make the upsert fail on itself.
                key = (company, vno, item, batch, godown or "")
                rows[key] = {
                    "tally_company": company,
                    "direction": dirn,
                    "voucher_no": vno,
                    "voucher_date": vdate,
                    "voucher_type": vtype,
                    "party_name": party or None,
                    "item_name": item,
                    "batch_name": batch,
                    "lot_key": m.group(1),
                    "godown": godown or "",
                    "qty": _txt(ba, "BILLEDQTY") or None,
                }

    print(f"    {len(vouchers):>6} vouchers -> {len(rows):>6} lot rows "
          f"({dropped} placeholder/unparsed dropped)", flush=True)
    return list(rows.values())


# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------

def upsert(env: dict, rows: list[dict]) -> int:
    """Upsert on the natural key, in pages. Returns rows sent."""
    url = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/fms_complaint_lot_index"
    headers = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"],
        "Content-Type": "application/json",
        # Match the unique index, or PostgREST rejects the conflict target.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    sent = 0
    for i in range(0, len(rows), PAGE):
        chunk = rows[i:i + PAGE]
        r = requests.post(
            # ⚠ MUST match the PLAIN-COLUMN unique index from 20261110121000.
            # An expression index here fails with 42P10.
            url + "?on_conflict=tally_company,voucher_no,item_name,batch_name,godown",
            json=chunk, headers=headers, timeout=120)
        if r.status_code >= 300:
            raise RuntimeError(f"upsert failed ({r.status_code}): {r.text[:400]}")
        sent += len(chunk)
        print(f"      upserted {sent}/{len(rows)}", end="\r", flush=True)
    print(" " * 40, end="\r")
    return sent


def resolve_masters(env: dict) -> None:
    """
    Fill party_id / item_id where the Tally name matches a central master exactly.

    Best-effort and re-runnable: a null id is normal and never blocks a lookup —
    the form falls back to the frozen name, which is what a complaint stores
    anyway. Done in SQL rather than Python so it is one round trip.
    """
    url = env["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/fms_complaint_lot_index_resolve"
    headers = {
        "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"],
        "Content-Type": "application/json",
    }
    r = requests.post(url, json={}, headers=headers, timeout=180)
    if r.status_code >= 300:
        print(f"    (master resolution skipped: {r.status_code} {r.text[:120]})")
    else:
        print(f"    master ids resolved: {r.text[:80]}")


def current_fy() -> tuple[str, str]:
    """April-start financial year containing today."""
    t = date.today()
    start_year = t.year if t.month >= 4 else t.year - 1
    return f"{start_year}0401", f"{start_year + 1}0331"


def main() -> int:
    fy_from, fy_to = current_fy()
    ap = argparse.ArgumentParser(description="Sync Tally batch/LOT allocations into Supabase")
    ap.add_argument("--company", help="Exact Tally company name (default: every open company)")
    ap.add_argument("--from", dest="from_date", default=fy_from, help="YYYYMMDD")
    ap.add_argument("--to", dest="to_date", default=fy_to, help="YYYYMMDD")
    ap.add_argument("--dry-run", action="store_true", help="Extract and report, write nothing")
    args = ap.parse_args()

    env = load_env()
    if not args.dry_run:
        missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") if not env.get(k)]
        if missing:
            print(f"Missing in .env: {', '.join(missing)}", file=sys.stderr)
            return 2

    try:
        companies = [args.company] if args.company else open_companies()
    except Exception as e:
        print(f"Cannot reach Tally on {TALLY_URL} — is it running? ({e})", file=sys.stderr)
        return 2

    if not companies:
        print("No companies open in Tally.", file=sys.stderr)
        return 2

    print(f"Lot index sync — {args.from_date} to {args.to_date}, {len(companies)} company(ies)")
    total = 0
    for c in companies:
        print(f"  {c}")
        t0 = time.time()
        try:
            rows = extract(c, args.from_date, args.to_date)
        except Exception as e:
            # One bad company must not abort the rest.
            print(f"    FAILED: {str(e)[:160]}")
            continue
        if rows and not args.dry_run:
            upsert(env, rows)
        total += len(rows)
        print(f"    done in {time.time() - t0:.1f}s")

    if total and not args.dry_run:
        resolve_masters(env)

    print(f"\n{'Would index' if args.dry_run else 'Indexed'} {total} lot rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
