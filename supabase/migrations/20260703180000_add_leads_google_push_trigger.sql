-- Orange One LEADS — auto-fire the Google mirror when a lead lands.
--
-- After a lead is inserted/edited in app_leads, call the `push-to-google` Edge
-- Function (which writes the "Leads DB" sheet + Drive folders) via pg_net. This is
-- what makes Save → Supabase → Google happen on its own — no PC, no script.
--
-- Config (function URL + shared secret) is kept in a PRIVATE table that is NOT
-- exposed to the API, and is populated OUT-OF-BAND (never committed), so no secret
-- lives in git. The Edge Function checks the x-push-secret header against its
-- PUSH_GOOGLE_SECRET secret.
--
-- Recursion-safe: the function stamps only google_synced_at / google_media (not
-- payload / updated_at); the trigger fn detects that "google-only" update and skips
-- re-firing. Purely additive.

create extension if not exists pg_net;

create schema if not exists private;

create table if not exists private.leads_push_config (
  id            int primary key default 1,
  function_url  text,
  push_secret   text
);

create or replace function private.app_leads_google_push()
  returns trigger
  language plpgsql
  security definer
  set search_path = private, public
as $$
declare
  cfg record;
begin
  -- Skip the Edge Function's own stamp-only write (google_synced_at/google_media)
  -- to avoid an infinite trigger loop.
  if tg_op = 'UPDATE'
     and new.payload is not distinct from old.payload
     and new.updated_at is not distinct from old.updated_at then
    return null;
  end if;

  select function_url, push_secret into cfg from private.leads_push_config where id = 1;
  if cfg.function_url is null then
    return null; -- not configured yet → no-op
  end if;

  perform net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.push_secret),
    body := jsonb_build_object('id', new.id)
  );
  return null;
end;
$$;

drop trigger if exists app_leads_google_push_trg on public.app_leads;
create trigger app_leads_google_push_trg
  after insert or update on public.app_leads
  for each row
  execute function private.app_leads_google_push();
