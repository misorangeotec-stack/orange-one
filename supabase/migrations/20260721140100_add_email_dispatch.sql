-- Email Alerts — step 2 of 2: deliver what step 1 enqueued.
--
-- WHAT THIS DOES (mirrors the proven app_leads → push-to-google trigger)
--   * INSTANT path: an AFTER INSERT trigger on public.email_outbox pings the
--     `send-email` Edge Function (via pg_net) the moment a row lands, passing that
--     row's id. The function sends it within ~a second. pg_net's http_post is
--     async/non-blocking, so it never slows the task write that caused the row.
--   * SAFETY NET: a pg_cron job every 3 minutes pings `send-email` with no id,
--     telling it to drain anything still pending/failed (e.g. the instant ping was
--     lost, or Google was briefly down). Retries are capped inside the function.
--
-- CONFIG IS OUT-OF-BAND (no secret in git)
--   The function URL + shared secret live in a PRIVATE table populated by hand
--   after deploy (see supabase/functions/send-email/README-DEPLOY.md). Until it is
--   populated, both the trigger and the cron sweep are harmless no-ops — rows just
--   accumulate as 'pending' and go out the moment config is filled in. This is why
--   applying this migration before the Google mailbox exists is safe.
--
-- Reversible:
--   drop trigger if exists email_outbox_dispatch_trg on public.email_outbox;
--   drop function if exists private.email_outbox_dispatch();
--   select cron.unschedule('email-outbox-sweep');
--   drop table if exists private.email_dispatch_config;

create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists private;

create table if not exists private.email_dispatch_config (
  id             int  primary key default 1,
  function_url   text,   -- e.g. https://coshondiqdhorwvibrwu.functions.supabase.co/send-email
  dispatch_secret text   -- must equal the function's EMAIL_DISPATCH_SECRET env secret
);

-- ---------------------------------------------------------------------------
-- Instant: ping the sender for this one new row.
-- ---------------------------------------------------------------------------
create or replace function private.email_outbox_dispatch()
  returns trigger
  language plpgsql
  security definer
  set search_path = private, public
as $$
declare
  cfg record;
begin
  select function_url, dispatch_secret into cfg from private.email_dispatch_config where id = 1;
  if cfg.function_url is null then
    return null;  -- not configured yet → no-op (rows wait for the sweep/config)
  end if;

  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', cfg.dispatch_secret),
    body    := jsonb_build_object('id', new.id)
  );
  return null;
end;
$$;

drop trigger if exists email_outbox_dispatch_trg on public.email_outbox;
create trigger email_outbox_dispatch_trg
  after insert on public.email_outbox
  for each row
  execute function private.email_outbox_dispatch();

-- ---------------------------------------------------------------------------
-- Safety net: every 3 minutes, ask the sender to drain the whole backlog.
-- (Body with no id => the function selects all pending/failed rows.)
-- ---------------------------------------------------------------------------
create or replace function private.email_outbox_sweep()
  returns void
  language plpgsql
  security definer
  set search_path = private, public
as $$
declare
  cfg record;
begin
  select function_url, dispatch_secret into cfg from private.email_dispatch_config where id = 1;
  if cfg.function_url is null then
    return;
  end if;
  -- only bother if there is something to send
  if not exists (select 1 from public.email_outbox
                 where status in ('pending', 'failed') and attempts < 5) then
    return;
  end if;
  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', cfg.dispatch_secret),
    body    := '{}'::jsonb
  );
end;
$$;

select cron.schedule(
  'email-outbox-sweep',
  '*/3 * * * *',
  $$select private.email_outbox_sweep();$$
);
