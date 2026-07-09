# leads_export — mirror synced leads to Google Sheet + Drive

Mirrors every Orange One lead that has reached Supabase into Google:

- one **row per lead** UPSERTED into the **`leads-dp`** Google Sheet (keyed by Lead ID → no duplicates), and
- its **media** uploaded to two Drive subfolders — **`visiting cards`** (card images / photos) and **`voice notes`** (audio) — with readable names; the Drive links are written back into the row.

Everything is created inside the shared Drive folder `1sjzeBLO4lOgZ1O0fSFjXdEDoj8mrMw-z` (sheet + subfolders are found by name).

This folder is **self-contained**: it has its own copy of the `orange-o-tec` Google OAuth client (`credentials.json`, copied from the FETCH DAILY DATA project) and its own Drive-enabled token (`token_leads.json`). It does **not** read or write anything in the FETCH DAILY DATA project.

## How it stays correct

- **Incremental**: a lead is (re)pushed only when `app_leads.google_synced_at` is null or older than `updated_at` (edited since last mirror).
- **No duplicate rows**: upsert by the stable Lead ID.
- **No re-uploaded media**: each uploaded file is remembered in `app_leads.google_media` (`{storage path: {id, link}}`).
- **Offline-safe**: capture works offline on the phone; once a lead lands in Supabase, this job mirrors it on its next run — independent of the phone.

## One-time setup

1. **Credentials** — `credentials.json` is already copied here (read-only from FETCH DAILY DATA). Do not commit it.
2. **`.env`** — `cp .env.example .env` and set `IDENTITY_SUPABASE_SERVICE_ROLE_KEY` (Supabase → project `coshondiqdhorwvibrwu` → Settings → API). `IDENTITY_SUPABASE_URL` and `LEADS_PARENT_FOLDER_ID` are prefilled.
3. **Install deps** (ideally in a venv):
   ```
   pip install -r requirements.txt
   ```
4. **First run = Google consent** — a browser opens once; click Allow for **Sheets + Drive**. This writes `token_leads.json` (Drive scope the daily-sync token lacks). On a headless box set `RUN_CONSOLE=1` in `.env` first.

## Run

```
python push_leads_to_google.py            # mirror all pending leads
python push_leads_to_google.py --dry-run  # list what would change; write nothing
python push_leads_to_google.py --limit 5  # cap leads this run (handy for the first test)
```

## Schedule

Run periodically (e.g. Windows Task Scheduler every 5–15 min) so leads appear shortly after they sync. Example command:

```
"C:\path\to\python.exe" "d:\Agentic AI Tools\Orange O tec\Orange One\leads_export\push_leads_to_google.py"
```

## Sheet columns

`Lead ID`, `Captured On`, `Captured Time`, `Salesperson`, `Person Name`, `Job Title`, `Company`, `Mobiles`, `Emails`, `Websites`, `Address`, `Interest Level`, `Categories`, `Asked About`, `Follow-up Action`, `Quantity`, `Team Size`, `Notes`, `Voice Summary`, `Voice Transcript`, `Follow-ups`, `Visiting Card (front)`, `Visiting Card (back)`, `Voice Note(s)`, `Location`, `Last Updated`.

Row 1 is frozen and a filter is applied, so every column is sortable/filterable in Google Sheets.

## Notes

- **Secrets** (`credentials.json`, `token_leads.json`, `.env`) are gitignored — never commit them.
- If the job ever stops with an auth error, delete `token_leads.json` and run once to re-consent (the `orange-o-tec` OAuth consent screen being in "Testing" can expire refresh tokens ~weekly; publishing it removes that).
- This is a one-way mirror (app → Google). Edits made directly in the sheet are not read back.
