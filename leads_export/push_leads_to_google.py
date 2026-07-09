"""Mirror synced Orange One leads into a Google Sheet + Drive folders.

Each lead that has reached Supabase (`app_leads` + private `lead-media` bucket)
is mirrored to Google:

  * one row per lead is UPSERTED into the ``leads-dp`` Google Sheet (keyed by the
    stable Lead ID, so re-runs never duplicate rows), and
  * its media is uploaded into two Drive subfolders — ``visiting cards`` (card
    images / photos) and ``voice notes`` (audio) — with human-readable names,
    then the Drive links are written back into the row.

All three live inside the shared parent folder ``LEADS_PARENT_FOLDER_ID`` and are
discovered by name, so config is minimal.

Incremental + idempotent:
  * a lead is (re)pushed only when ``google_synced_at`` is null OR older than
    ``updated_at`` (i.e. edited since the last mirror);
  * media already uploaded is remembered in ``app_leads.google_media``
    ({storage path -> {"id","link"}}) and never re-uploaded;
  * after a successful mirror the row's ``google_synced_at`` / ``google_media``
    are stamped in Supabase.

This is a SELF-CONTAINED copy of the Google connection used by the FETCH DAILY
DATA project — it reuses the same ``orange-o-tec`` OAuth *client* (credentials.json
copied here) but keeps its own Drive-enabled token (token_leads.json). It does not
read or write anything in the FETCH DAILY DATA project.

Required env (leads_export/.env):
    IDENTITY_SUPABASE_URL              https://coshondiqdhorwvibrwu.supabase.co
    IDENTITY_SUPABASE_SERVICE_ROLE_KEY <service_role key of the identity project>
    LEADS_PARENT_FOLDER_ID            1sjzeBLO4lOgZ1O0fSFjXdEDoj8mrMw-z
Optional env:
    LEADS_SHEET_NAME       (default "leads-dp")
    LEADS_SHEET_TAB        (default: first tab of the spreadsheet)
    LEADS_CARDS_FOLDER     (default "visiting cards")
    LEADS_VOICE_FOLDER     (default "voice notes")
    GOOGLE_CREDENTIALS_FILE (default: ./credentials.json next to this script)
    GOOGLE_TOKEN_FILE       (default: ./token_leads.json next to this script)

Usage:
    python push_leads_to_google.py            # mirror all pending leads
    python push_leads_to_google.py --dry-run  # show what would change, touch nothing
    python push_leads_to_google.py --limit 5  # cap the number of leads this run
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httplib2
import requests
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_httplib2 import AuthorizedHttp
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")

# Sheets write + Drive read/write. The FETCH DAILY DATA token is Sheets-only, so
# the first run here re-consents (adds Drive) into our own token_leads.json.
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

BUCKET = "lead-media"
HTTP_TIMEOUT = 120  # httplib2 has no default timeout; a stalled call must fail, not hang.

# ---- Sheet schema (order == column order; header row is written/frozen) ------
# Each column is (header, function(ctx) -> cell string). ctx keys are built in
# build_context(). Keep this list the single source of truth for the layout.
COLUMNS: list[tuple[str, str]] = [
    ("Lead ID", "lead_id"),
    ("Captured On", "captured_date"),
    ("Captured Time", "captured_time"),
    ("Salesperson", "salesperson"),
    ("Person Name", "person_name"),
    ("Job Title", "job_title"),
    ("Company", "company"),
    ("Mobiles", "mobiles"),
    ("Emails", "emails"),
    ("Websites", "websites"),
    ("Address", "address"),
    ("Interest Level", "interest"),
    ("Categories", "categories"),
    ("Asked About", "asked_about"),
    ("Follow-up Action", "follow_up"),
    ("Quantity", "quantity"),
    ("Team Size", "team_size"),
    ("Notes", "notes"),
    ("Voice Summary", "voice_summary"),
    ("Voice Transcript", "voice_transcript"),
    ("Follow-ups", "follow_ups"),
    ("Visiting Card (front)", "card_front"),
    ("Visiting Card (back)", "card_back"),
    ("Voice Note(s)", "voice_links"),
    ("Location", "location"),
    ("Last Updated", "last_updated"),
]
HEADERS = [h for h, _ in COLUMNS]
LEAD_ID_COL = 0  # index of "Lead ID" — the upsert key column


# ============================ Google auth ==================================

def authorize() -> Credentials:
    creds_path = os.environ.get("GOOGLE_CREDENTIALS_FILE", str(HERE / "credentials.json"))
    token_path = os.environ.get("GOOGLE_TOKEN_FILE", str(HERE / "token_leads.json"))
    creds: Credentials | None = None
    if Path(token_path).exists():
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not Path(creds_path).exists():
                raise SystemExit(
                    f"ERROR: {creds_path} not found. Copy credentials.json from the FETCH DAILY "
                    "DATA project into this folder (read-only on the source)."
                )
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            # Opens a browser once to grant Sheets + Drive. Headless machines: use
            # flow.run_console() instead (set env RUN_CONSOLE=1).
            if os.environ.get("RUN_CONSOLE") == "1":
                creds = flow.run_console()
            else:
                creds = flow.run_local_server(port=0)
        Path(token_path).write_text(creds.to_json(), encoding="utf-8")
    return creds


def _service(name: str, version: str, creds: Credentials) -> Any:
    # A fresh AuthorizedHttp per service (httplib2.Http is single-use across builds)
    # with a hard timeout so a stalled API call fails fast instead of hanging.
    authed = AuthorizedHttp(creds, http=httplib2.Http(timeout=HTTP_TIMEOUT))
    return build(name, version, http=authed, cache_discovery=False)


# ============================ Supabase REST ================================

class Supa:
    """Thin PostgREST + Storage client using the identity project's service role."""

    def __init__(self) -> None:
        self.url = os.environ["IDENTITY_SUPABASE_URL"].rstrip("/")
        key = os.environ["IDENTITY_SUPABASE_SERVICE_ROLE_KEY"]
        self.rest = f"{self.url}/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}
        self._masters: dict[str, dict[str, dict[str, str]]] = {}
        self._profiles: dict[str, dict[str, Any]] = {}

    def _get(self, path: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        r = requests.get(f"{self.rest}/{path}", headers=self.headers, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def candidate_ids(self) -> list[str]:
        """Ids of non-deleted leads that need (re)mirroring — cheap id/timestamp scan."""
        rows = self._get(
            "app_leads",
            {"select": "id,updated_at,google_synced_at", "deleted": "eq.false", "order": "captured_on.asc"},
        )
        out: list[str] = []
        for row in rows:
            gs = row.get("google_synced_at")
            if gs is None or _ts(gs) < _ts(row["updated_at"]):
                out.append(row["id"])
        return out

    def leads_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        if not ids:
            return []
        # PostgREST in.() list; chunk to keep the URL sane.
        out: list[dict[str, Any]] = []
        for i in range(0, len(ids), 50):
            chunk = ids[i : i + 50]
            in_list = ",".join(chunk)
            out.extend(
                self._get(
                    "app_leads",
                    {"select": "id,user_id,updated_at,payload,google_media", "id": f"in.({in_list})"},
                )
            )
        return out

    def masters_for(self, user_id: str) -> dict[str, dict[str, str]]:
        """Return {master_type: {id: label}} for a user (cached)."""
        if user_id in self._masters:
            return self._masters[user_id]
        rows = self._get("app_lead_masters", {"select": "masters", "user_id": f"eq.{user_id}"})
        maps: dict[str, dict[str, str]] = {}
        masters = (rows[0].get("masters") if rows else None) or {}
        for mtype, items in masters.items():
            if isinstance(items, list):
                maps[mtype] = {it.get("id"): it.get("label", "") for it in items if isinstance(it, dict)}
        self._masters[user_id] = maps
        return maps

    def profile_for(self, user_id: str) -> dict[str, Any]:
        if user_id in self._profiles:
            return self._profiles[user_id]
        rows = self._get("profiles", {"select": "name,email", "id": f"eq.{user_id}"})
        prof = rows[0] if rows else {}
        self._profiles[user_id] = prof
        return prof

    def download_media(self, storage_value: str) -> bytes:
        """storage_value like 'lead-media/<uid>/<cid>/<file>' -> bytes (private, service role)."""
        # object endpoint: /storage/v1/object/authenticated/<bucket>/<path>
        obj = storage_value  # already includes the bucket prefix
        r = requests.get(
            f"{self.url}/storage/v1/object/authenticated/{obj}",
            headers=self.headers,
            timeout=120,
        )
        r.raise_for_status()
        return r.content

    def stamp(self, lead_id: str, google_media: dict[str, Any]) -> None:
        body = {"google_synced_at": _now_iso(), "google_media": google_media}
        r = requests.patch(
            f"{self.rest}/app_leads",
            headers={**self.headers, "Content-Type": "application/json", "Prefer": "return=minimal"},
            params={"id": f"eq.{lead_id}"},
            json=body,
            timeout=60,
        )
        r.raise_for_status()


# ============================ Drive helpers ================================

def find_child(drive: Any, parent_id: str, name: str, folder: bool | None = None) -> dict[str, Any] | None:
    """Find a child by name under parent, CASE-INSENSITIVELY (Drive's `name =` is
    case-sensitive, so we list candidates and match in Python). `folder` filters
    by type: True = folder, False = native Google Sheet, None = any."""
    q = [f"'{parent_id}' in parents", "trashed=false"]
    if folder is True:
        q.append("mimeType = 'application/vnd.google-apps.folder'")
    elif folder is False:
        q.append("mimeType = 'application/vnd.google-apps.spreadsheet'")
    resp = (
        drive.files()
        .list(q=" and ".join(q), fields="files(id,name,mimeType)", pageSize=200,
              includeItemsFromAllDrives=True, supportsAllDrives=True)
        .execute()
    )
    files = resp.get("files", [])
    want = name.strip().lower()
    for f in files:
        if f.get("name", "").strip().lower() == want:
            return f
    return None


def upload_media(drive: Any, folder_id: str, name: str, data: bytes, content_type: str) -> dict[str, str]:
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=content_type, resumable=False)
    f = (
        drive.files()
        .create(body={"name": name, "parents": [folder_id]}, media_body=media,
                fields="id,webViewLink", supportsAllDrives=True)
        .execute()
    )
    return {"id": f["id"], "link": f.get("webViewLink", "")}


# ============================ Sheet helpers ================================

def open_sheet(drive: Any, sheets: Any, parent_id: str) -> tuple[str, str, int]:
    """Return (spreadsheet_id, tab_title, tab_grid_id). Finds leads-dp under the parent."""
    name = os.environ.get("LEADS_SHEET_NAME", "leads-dp")
    hit = find_child(drive, parent_id, name, folder=False)
    if not hit:
        raise SystemExit(
            f"ERROR: Google Sheet named '{name}' not found in the shared folder. "
            "Make sure it is a native Google Sheet (not an .xlsx upload) and sits in that folder."
        )
    sheet_id = hit["id"]
    meta = sheets.spreadsheets().get(spreadsheetId=sheet_id, fields="sheets.properties").execute()
    tabs = meta.get("sheets", [])
    want = os.environ.get("LEADS_SHEET_TAB")
    chosen = None
    for s in tabs:
        p = s.get("properties", {})
        if want and p.get("title") == want:
            chosen = p
            break
    if chosen is None:
        chosen = tabs[0]["properties"]  # default to first tab
    return sheet_id, chosen["title"], int(chosen["sheetId"])


def read_rows(sheets: Any, sheet_id: str, tab: str) -> list[list[str]]:
    resp = sheets.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=f"'{tab}'", majorDimension="ROWS"
    ).execute()
    return resp.get("values", [])


def ensure_header_and_format(sheets: Any, sheet_id: str, tab: str, grid_id: int, existing: list[list[str]]) -> None:
    # Write/refresh the header row to our canonical schema (this sheet is ours).
    header = existing[0] if existing else []
    if [c.strip() for c in header][: len(HEADERS)] != HEADERS:
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id, range=f"'{tab}'!A1",
            valueInputOption="RAW", body={"values": [HEADERS]},
        ).execute()
    # Freeze row 1 + basic filter over all columns → every column sortable/filterable.
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={
            "requests": [
                {"updateSheetProperties": {
                    "properties": {"sheetId": grid_id, "gridProperties": {"frozenRowCount": 1}},
                    "fields": "gridProperties.frozenRowCount",
                }},
                {"setBasicFilter": {"filter": {
                    "range": {"sheetId": grid_id, "startRowIndex": 0, "startColumnIndex": 0,
                              "endColumnIndex": len(HEADERS)}
                }}},
            ]
        },
    ).execute()


def id_to_rownum(existing: list[list[str]]) -> dict[str, int]:
    """Map Lead ID -> 1-based sheet row number (data rows start at row 2)."""
    out: dict[str, int] = {}
    for idx, row in enumerate(existing[1:], start=2):
        if len(row) > LEAD_ID_COL and row[LEAD_ID_COL].strip():
            out[row[LEAD_ID_COL].strip()] = idx
    return out


def write_row(sheets: Any, sheet_id: str, tab: str, rownum: int, values: list[str]) -> None:
    end_col = _col_letter(len(values))
    sheets.spreadsheets().values().update(
        spreadsheetId=sheet_id, range=f"'{tab}'!A{rownum}:{end_col}{rownum}",
        valueInputOption="RAW", body={"values": [values]},
    ).execute()


def append_rows(sheets: Any, sheet_id: str, tab: str, rows: list[list[str]]) -> None:
    if not rows:
        return
    sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id, range=f"'{tab}'!A1",
        valueInputOption="RAW", insertDataOption="INSERT_ROWS", body={"values": rows},
    ).execute()


# ============================ Row building =================================

def _join(v: Any) -> str:
    if isinstance(v, list):
        return ", ".join(str(x).strip() for x in v if str(x).strip())
    return str(v).strip() if v else ""


def build_context(supa: Supa, lead: dict[str, Any], media_links: dict[str, dict[str, str]]) -> dict[str, str]:
    p = lead.get("payload") or {}
    user_id = lead["user_id"]
    masters = supa.masters_for(user_id)
    prof = supa.profile_for(user_id)
    person = p.get("person") or {}
    company = p.get("company") or {}
    voice_notes = p.get("voiceNotes") or []
    card = p.get("cardImages") or {}
    cap = p.get("capturedAt") or {}

    def label(mtype: str, mid: Any) -> str:
        return masters.get(mtype, {}).get(mid, "") if mid else ""

    def labels(mtype: str, ids: Any) -> str:
        ids = ids or []
        return ", ".join(masters.get(mtype, {}).get(i, "") for i in ids if masters.get(mtype, {}).get(i))

    def link(path: Any) -> str:
        return media_links.get(path, {}).get("link", "") if path else ""

    captured_on = p.get("capturedOn") or lead.get("updated_at") or ""
    cd, ct = _split_dt(captured_on)

    summary = " | ".join(v.get("summary", "") for v in voice_notes if v.get("summary"))
    transcript = "\n\n".join(v.get("transcript", "") for v in voice_notes if v.get("transcript"))
    follow_ups: list[str] = []
    for v in voice_notes:
        follow_ups.extend(v.get("followUps") or [])
    voice_links = ", ".join(link(v.get("uri")) for v in voice_notes if link(v.get("uri")))
    salesperson = prof.get("name") or prof.get("email") or user_id

    ctx = {
        "lead_id": lead["id"],
        "captured_date": cd,
        "captured_time": ct,
        "salesperson": salesperson,
        "person_name": person.get("name", ""),
        "job_title": _join(person.get("jobTitles")),
        "company": company.get("name", ""),
        "mobiles": _join(person.get("mobiles")) or _join(company.get("mobiles")),
        "emails": _join(person.get("emails")) or _join(company.get("emails")),
        "websites": _join(company.get("websites")),
        "address": _join(company.get("addresses")),
        "interest": label("interestLevels", p.get("interestLevelId")),
        "categories": labels("categories", p.get("categoryIds")),
        "asked_about": labels("askedAbout", p.get("askedAboutIds")),
        "follow_up": label("followUpActions", p.get("followUpActionId")),
        "quantity": str(p.get("quantityNeeded") or ""),
        "team_size": str(p.get("teamSize") or ""),
        "notes": " | ".join(n.get("text", "") for n in (p.get("notes") or []) if n.get("text")),
        "voice_summary": summary,
        "voice_transcript": transcript,
        "follow_ups": "; ".join(follow_ups),
        "card_front": link(card.get("front")),
        "card_back": link(card.get("back")),
        "voice_links": voice_links,
        "location": cap.get("address", "") if isinstance(cap, dict) else "",
        "last_updated": _fmt_dt(lead.get("updated_at") or ""),
    }
    return ctx


def row_from_ctx(ctx: dict[str, str]) -> list[str]:
    return [str(ctx.get(key, "")) for _, key in COLUMNS]


# ============================ Media routing ================================

_IMG_EXT = {"jpg", "jpeg", "png", "webp", "gif", "heic"}
_AUD_EXT = {"m4a", "mp4", "wav", "aac", "caf", "mp3", "ogg"}


def _content_type(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower()
    return {
        "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp",
        "gif": "image/gif", "heic": "image/heic",
        "m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav", "aac": "audio/aac",
        "caf": "audio/x-caf", "mp3": "audio/mpeg", "ogg": "audio/ogg",
    }.get(ext, "application/octet-stream")


def _is_audio(path: str) -> bool:
    return path.rsplit(".", 1)[-1].lower() in _AUD_EXT


def collect_media(payload: dict[str, Any]) -> list[tuple[str, str]]:
    """Return [(storage_path, kind)] for every uploaded (lead-media/...) media in the lead.
    kind is one of: card-front, card-back, photo, logo, voice."""
    out: list[tuple[str, str]] = []
    card = payload.get("cardImages") or {}
    person = payload.get("person") or {}
    company = payload.get("company") or {}

    def add(val: Any, kind: str) -> None:
        if isinstance(val, str) and val.startswith(f"{BUCKET}/"):
            out.append((val, kind))

    add(card.get("front"), "card-front")
    add(card.get("back"), "card-back")
    add(person.get("photoUri"), "photo")
    add(company.get("logoUri"), "logo")
    for i, ph in enumerate(payload.get("reminderPhotos") or [], start=1):
        add(ph, f"photo-{i}")
    for i, v in enumerate(payload.get("voiceNotes") or [], start=1):
        add(v.get("uri"), f"voice-{i}")
    return out


def media_name(ctx: dict[str, str], kind: str, storage_path: str) -> str:
    ext = storage_path.rsplit(".", 1)[-1].lower()
    company = _sanitize(ctx.get("company") or "NoCompany")
    person = _sanitize(ctx.get("person_name") or "NoName")
    date = (ctx.get("captured_date") or "").replace("-", "") or "nodate"
    short = ctx["lead_id"].split("-")[-1][:6]
    return f"{date}_{company}_{person}_{kind}_{short}.{ext}"


# ============================ Utilities ====================================

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


# Timestamps are stored in UTC; show them in IST (UTC+5:30, no DST).
IST = timezone(timedelta(hours=5, minutes=30))


def _split_dt(iso: str) -> tuple[str, str]:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(IST)
        return dt.strftime("%d-%m-%Y"), dt.strftime("%H:%M")
    except Exception:
        return iso, ""


def _fmt_dt(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(IST)
        return dt.strftime("%d-%m-%Y %H:%M")
    except Exception:
        return iso


def _sanitize(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")
    return s[:40] or "x"


def _col_letter(n: int) -> str:
    """1-based column index -> spreadsheet letter (1->A, 27->AA)."""
    out = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


# ============================ Main =========================================

def main() -> int:
    ap = argparse.ArgumentParser(description="Mirror synced leads to Google Sheet + Drive.")
    ap.add_argument("--dry-run", action="store_true", help="Show what would change; write nothing.")
    ap.add_argument("--limit", type=int, default=0, help="Cap number of leads processed (0 = all).")
    args = ap.parse_args()

    for var in ("IDENTITY_SUPABASE_URL", "IDENTITY_SUPABASE_SERVICE_ROLE_KEY", "LEADS_PARENT_FOLDER_ID"):
        if not os.environ.get(var):
            raise SystemExit(f"ERROR: missing required env var {var} (set it in leads_export/.env).")
    parent_id = os.environ["LEADS_PARENT_FOLDER_ID"]

    supa = Supa()
    ids = supa.candidate_ids()
    if args.limit:
        ids = ids[: args.limit]
    if not ids:
        print("Nothing to mirror — all leads are up to date in Google.")
        return 0
    leads = supa.leads_by_ids(ids)
    print(f"{len(leads)} lead(s) to mirror.")

    if args.dry_run:
        for lead in leads:
            ctx = build_context(supa, lead, {})
            print(f"  • {ctx['company'] or '—'} / {ctx['person_name'] or '—'}  (id {lead['id']})")
            for path, kind in collect_media(lead.get("payload") or {}):
                print(f"      {kind:10s} {'voice notes' if _is_audio(path) else 'visiting cards'}  <- {path}")
        print("Dry run — nothing written.")
        return 0

    creds = authorize()
    sheets = _service("sheets", "v4", creds)
    drive = _service("drive", "v3", creds)

    cards_folder = find_child(drive, parent_id, os.environ.get("LEADS_CARDS_FOLDER", "visiting cards"), folder=True)
    voice_folder = find_child(drive, parent_id, os.environ.get("LEADS_VOICE_FOLDER", "voice notes"), folder=True)
    if not cards_folder or not voice_folder:
        raise SystemExit(
            "ERROR: could not find the 'visiting cards' and/or 'voice notes' subfolders in the shared "
            "folder. Create them (exact names) or set LEADS_CARDS_FOLDER / LEADS_VOICE_FOLDER."
        )

    sheet_id, tab, grid_id = open_sheet(drive, sheets, parent_id)
    existing = read_rows(sheets, sheet_id, tab)
    ensure_header_and_format(sheets, sheet_id, tab, grid_id, existing)
    existing = read_rows(sheets, sheet_id, tab)  # re-read after header write
    row_index = id_to_rownum(existing)

    appended = 0
    updated = 0
    to_append: list[list[str]] = []
    for lead in leads:
        payload = lead.get("payload") or {}
        google_media: dict[str, Any] = dict(lead.get("google_media") or {})

        # 1) Upload any not-yet-mirrored media, remembering each path -> {id, link}.
        ctx_names = build_context(supa, lead, {})  # names need company/person; links added below
        for path, kind in collect_media(payload):
            if path in google_media and google_media[path].get("link"):
                continue
            try:
                data = supa.download_media(path)
            except Exception as exc:  # media missing/unreadable — skip, lead row still mirrors
                print(f"    ! media download failed ({kind}) for {lead['id']}: {exc}")
                continue
            folder = voice_folder["id"] if _is_audio(path) else cards_folder["id"]
            name = media_name(ctx_names, kind, path)
            info = upload_media(drive, folder, name, data, _content_type(path))
            google_media[path] = info
            print(f"    ↑ {name}")

        # 2) Build the row with resolved links + upsert by Lead ID.
        media_links = {k: v for k, v in google_media.items() if isinstance(v, dict)}
        ctx = build_context(supa, lead, media_links)
        values = row_from_ctx(ctx)
        rownum = row_index.get(lead["id"])
        if rownum:
            write_row(sheets, sheet_id, tab, rownum, values)
            updated += 1
        else:
            to_append.append(values)
            appended += 1

        # 3) Stamp so we don't redo this lead next run (media map persisted too).
        supa.stamp(lead["id"], google_media)

    append_rows(sheets, sheet_id, tab, to_append)
    print(f"Done. {appended} new row(s), {updated} updated row(s) in '{tab}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
