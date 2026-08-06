-- Sales Register — rebuild each book when its Tally sync lands, not at a fixed evening hour.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (tenant acct_orange), NOT the Orange One identity
--    project. The repo's `supabase/migrations/` + `supabase db push` target the identity project —
--    this one runs in the ConnectWave SQL editor. ALREADY APPLIED 2026-08-06; this file is the
--    version-controlled record of what is live.
--
-- WHY (2026-08-06):
--   `rpt-sales-register-refresh-nightly` (cron jobid 14, `30 14 * * *` UTC = 20:00 IST) was healthy —
--   it succeeded every night. The complaint that the register "wasn't refreshing" was a LAG, not a
--   failure: Tally syncs all five live books at ~10:20 AM IST, so the register served the previous
--   build from ~10:24 AM until 8:00 PM. Users were manually refreshing to work around it.
--
--   This ports the pattern Stock Summary already uses (`rpt_stock_summary_refresh_if_stale` +
--   `rpt-stock-summary-after-sync`): a cheap 5-minute poll that rebuilds only the books whose sync
--   is newer than their last build. The 20:00 IST nightly STAYS ON as an unconditional backstop,
--   exactly as inventory keeps its 23:15 one.
--
-- TWO DELIBERATE DIFFERENCES FROM THE STOCK SUMMARY VERSION:
--   1. The staleness marker is `rpt_sales_register_refresh_log.ran_at`, NOT
--      `max(rpt_sales_register.built_at)`. The FY-split archive book
--      `acct_orange::59a6c2d9-...~20240401` legitimately rebuilds to ZERO rows, so it has no
--      built_at at all — a built_at gate would call it stale forever and rebuild it every five
--      minutes. Every rebuild writes a log row, empty ones included.
--   2. Errored attempts advance the marker too (the gate does not filter `error is null`), so a
--      persistently failing book cannot write an error row every five minutes. It waits for the
--      next sync, and the nightly heals it.

create or replace function public.rpt_sales_register_refresh_if_stale()
returns text
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '0'
as $function$
declare
  r        record;
  n        integer;
  rebuilt  integer := 0;
  rows_n   integer := 0;
  t0       timestamptz := clock_timestamp();
  t1       timestamptz;
  books    text := '';
  secs     numeric;
  v_fyfrom text;
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_sales_register:if_stale')) then
    return 'another poll is running; skipped';
  end if;

  -- Same current-FY window the nightly and the per-company refresh use.
  v_fyfrom := to_char(
    case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
         then make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int, 4, 1)
         else make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1, 4, 1)
    end, 'YYYYMMDD');

  for r in
    select s.tenant_id
      from public.tally_sync_state s
     where s.tenant_id in (select distinct tenant_id from public.v_company)
       and s.last_sync_at is not null
       and s.last_sync_at > coalesce(
             (select max(l.ran_at) from public.rpt_sales_register_refresh_log l
               where l.tenant_id = s.tenant_id), '-infinity'::timestamptz)
     order by s.last_sync_at
  loop
    t1 := clock_timestamp();
    begin
      n := coalesce(public.rpt_sales_register_rebuild(r.tenant_id, v_fyfrom, '99999999'), 0);
      rebuilt := rebuilt + 1;
      rows_n  := rows_n + n;
      books   := books || case when books = '' then '' else ', ' end
                        || split_part(split_part(r.tenant_id, '::', 2), '-', 1);
      insert into public.rpt_sales_register_refresh_log (tenant_id, fy_from, row_count, seconds, source)
      values (r.tenant_id, v_fyfrom, n,
              round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), 'sync');
    exception when others then
      insert into public.rpt_sales_register_refresh_log (tenant_id, fy_from, seconds, error, source)
      values (r.tenant_id, v_fyfrom,
              round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), sqlerrm, 'sync');
    end;
  end loop;

  if rebuilt = 0 then
    return 'up to date; skipped';
  end if;

  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);
  return format('rebuilt %s book(s) [%s], %s rows in %ss', rebuilt, books, rows_n, secs);
end;
$function$;

-- The 5-minute poll. Registered as cron jobid 60 on 2026-08-06.
-- `cron.schedule` upserts by name, so re-running this is safe.
select cron.schedule(
  'rpt-sales-register-after-sync',
  '*/5 * * * *',
  $$ set statement_timeout='30min';
     select public.rpt_sales_register_refresh_if_stale(); $$
);

-- NOT unscheduled, on purpose: `rpt-sales-register-refresh-nightly` (jobid 14) remains the backstop.
