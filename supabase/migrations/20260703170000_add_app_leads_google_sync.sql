-- Orange One LEADS — Google mirror tracking columns.
--
-- A separate Python job (Orange One\leads_export\push_leads_to_google.py) mirrors
-- each synced lead into the `leads-dp` Google Sheet + Drive folders. These two
-- columns let that job run incrementally and idempotently:
--   google_synced_at — when the lead was last mirrored to Google. The job picks up
--                      rows where this is null OR older than updated_at (i.e. edited
--                      since the last mirror), so it never re-does settled rows and
--                      always refreshes changed ones.
--   google_media     — map of { "<lead-media storage path>": "<drive file id>" } for
--                      media already uploaded to Drive, so files are never re-uploaded.
--
-- Both are pipeline-owned; the mobile app never reads or writes them. Purely
-- ADDITIVE — no existing column/data is changed. Apply in identity project
-- coshondiqdhorwvibrwu.

alter table public.app_leads
  add column if not exists google_synced_at timestamptz;

alter table public.app_leads
  add column if not exists google_media jsonb not null default '{}'::jsonb;
