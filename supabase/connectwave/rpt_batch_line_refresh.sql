-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_batch_line — refresh wrappers, exposure, and the coverage view.
-- Copy-edits of the rpt_sales_* / rpt_stock_summary_* family so this behaves like its siblings.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Per-company, for a UI "Refresh now" button ────────────────────────────────────────────────
create or replace function public.rpt_batch_refresh_company(p_tenant text)
returns jsonb language plpgsql as $fn$
declare
  t0 timestamptz := clock_timestamp();
  n integer; secs numeric; v_from text; v_to text; last timestamptz;
begin
  if not exists (select 1 from public.v_company c where c.tenant_id = p_tenant) then
    return jsonb_build_object('status','error','message','unknown tenant');
  end if;

  select max(ran_at) into last
    from public.rpt_batch_refresh_log
   where tenant_id = p_tenant and error is null;
  if last is not null and last > now() - interval '2 minutes' then
    return jsonb_build_object('status','cooldown','message','refreshed less than 2 minutes ago');
  end if;

  if not pg_try_advisory_xact_lock(hashtext('rpt_batch_refresh:' || p_tenant)) then
    return jsonb_build_object('status','busy','message','a refresh is already running');
  end if;

  v_from := to_char(
    case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
         then make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int,     4, 1)
         else make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1, 4, 1)
    end, 'YYYYMMDD');
  v_to := to_char((to_date(v_from,'YYYYMMDD') + interval '1 year - 1 day')::date, 'YYYYMMDD');

  n := public.rpt_batch_line_rebuild(p_tenant, v_from, v_to);
  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);

  insert into public.rpt_batch_refresh_log
    (tenant_id, fy_from, fy_to, rows, lots, godown_rows, seconds, source)
  values (p_tenant, v_from, v_to, n,
          (select count(distinct batch_name) from public.rpt_batch_line
            where tenant_id = p_tenant and is_real_lot),
          (select count(*) from public.rpt_batch_line
            where tenant_id = p_tenant and godown_name is not null),
          secs, 'manual');

  return jsonb_build_object('status','ok','rows',n,'seconds',secs,'from',v_from,'to',v_to);
end $fn$;

-- ── Nightly backstop ──────────────────────────────────────────────────────────────────────────
create or replace procedure public.rpt_batch_refresh_nightly()
language plpgsql as $pr$
declare
  r record; t0 timestamptz := clock_timestamp();
  n integer; total integer := 0; ntent integer := 0; v_from text; v_to text;
begin
  v_from := to_char(
    case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
         then make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int,     4, 1)
         else make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1, 4, 1)
    end, 'YYYYMMDD');
  v_to := to_char((to_date(v_from,'YYYYMMDD') + interval '1 year - 1 day')::date, 'YYYYMMDD');

  for r in select distinct tenant_id from public.v_company loop
    begin
      n := public.rpt_batch_line_rebuild(r.tenant_id, v_from, v_to);
      total := total + coalesce(n, 0);
      ntent := ntent + 1;
    exception when others then
      insert into public.rpt_batch_refresh_log (tenant_id, fy_from, fy_to, source, error)
      values (r.tenant_id, v_from, v_to, 'cron', sqlerrm);
    end;
  end loop;

  insert into public.rpt_batch_refresh_log
    (fy_from, fy_to, rows, lots, godown_rows, seconds, source)
  values (v_from, v_to, total,
          (select count(distinct batch_name) from public.rpt_batch_line where is_real_lot),
          (select count(*) from public.rpt_batch_line where godown_name is not null),
          round(extract(epoch from (clock_timestamp() - t0))::numeric, 1), 'cron');
end $pr$;

-- ── After-sync poller ─────────────────────────────────────────────────────────────────────────
-- ⚠ Staleness is gated on THIS LOG'S ran_at, deliberately NOT on max(built_at) of the fact table.
--   Two tenants are dormant archive books that rebuild to zero rows for the current FY; a
--   built_at gate would find no row, treat them as stale forever and re-run them every 5 minutes.
--   rpt_sales_register_after_sync.sql records the same bug. Errors advance the marker too.
create or replace function public.rpt_batch_refresh_if_stale()
returns text language plpgsql as $fn$
declare
  r record; n integer; rebuilt integer := 0; total integer := 0;
  t0 timestamptz := clock_timestamp(); books text := ''; secs numeric; v_from text; v_to text;
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_batch:if_stale')) then
    return 'another poll is running; skipped';
  end if;

  v_from := to_char(
    case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
         then make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int,     4, 1)
         else make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1, 4, 1)
    end, 'YYYYMMDD');
  v_to := to_char((to_date(v_from,'YYYYMMDD') + interval '1 year - 1 day')::date, 'YYYYMMDD');

  for r in
    select s.tenant_id
      from public.tally_sync_state s
     where s.tenant_id in (select distinct tenant_id from public.v_company)
       and s.last_sync_at is not null
       and s.last_sync_at > coalesce(
             (select max(l.ran_at) from public.rpt_batch_refresh_log l
               where l.tenant_id = s.tenant_id), '-infinity'::timestamptz)
     order by s.last_sync_at
  loop
    begin
      n := public.rpt_batch_line_rebuild(r.tenant_id, v_from, v_to);
      rebuilt := rebuilt + 1;
      total := total + coalesce(n, 0);
      books := books || case when books = '' then '' else ', ' end
                     || split_part(split_part(r.tenant_id, '::', 2), '-', 1);
      insert into public.rpt_batch_refresh_log
        (tenant_id, fy_from, fy_to, rows, seconds, source)
      values (r.tenant_id, v_from, v_to, n,
              round(extract(epoch from (clock_timestamp() - t0))::numeric, 1), 'sync');
    exception when others then
      -- The log row still lands, so a failing tenant cannot spin every 5 minutes forever.
      insert into public.rpt_batch_refresh_log (tenant_id, fy_from, fy_to, source, error)
      values (r.tenant_id, v_from, v_to, 'sync', sqlerrm);
    end;
  end loop;

  if rebuilt = 0 then return 'up to date; skipped'; end if;
  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);
  return format('rebuilt %s book(s) [%s], %s rows in %ss', rebuilt, books, total, secs);
end $fn$;

-- ── Coverage view: the anti-"PROVEN ABSENT" device ────────────────────────────────────────────
-- Owner-owned, security_invoker off, so it reads through RLS the way v_company already does.
-- Any future claim that batch data is missing must cite this view — it distinguishes
-- "no rows exist" from "your key cannot see them", which is the exact confusion that sent an
-- unnecessary escalation to the ConnectWave team.
create or replace view public.rpt_batch_coverage as
select tenant_id,
       fy,
       count(*)                                        as batch_rows,
       count(*) filter (where is_real_lot)             as real_lot_rows,
       count(distinct batch_name) filter (where is_real_lot) as lots,
       count(*) filter (where godown_name is not null) as godown_rows,
       count(*) filter (where batch_date is not null)  as dated_rows,
       count(*) filter (where batch_mfd is not null)   as mfd_rows,
       min(vch_date) as first_vch_date,
       max(vch_date) as last_vch_date,
       max(built_at) as built_at
  from public.rpt_batch_line
 group by tenant_id, fy;

-- ── Exposure ──────────────────────────────────────────────────────────────────────────────────
-- RLS ON + an explicit read policy, matching the collection_*/ext_* layer rather than the
-- RLS-off rpt_* layer. Same result for the anon key, but explicit: the next person auditing
-- permissions sees a named policy saying "deliberately readable" instead of having to notice
-- relrowsecurity = false. Given that the last permissions ambiguity here cost a false
-- "PROVEN ABSENT" and an escalation, explicitness is worth more than matching the older style.
alter table public.rpt_batch_line        enable row level security;
alter table public.rpt_batch_refresh_log enable row level security;

drop policy if exists rpt_batch_line_read on public.rpt_batch_line;
create policy rpt_batch_line_read on public.rpt_batch_line
  for select to anon, authenticated using (true);

drop policy if exists rpt_batch_refresh_log_read on public.rpt_batch_refresh_log;
create policy rpt_batch_refresh_log_read on public.rpt_batch_refresh_log
  for select to anon, authenticated using (true);

grant select on public.rpt_batch_line, public.rpt_batch_refresh_log, public.rpt_batch_coverage
  to anon, authenticated;
grant execute on function public.rpt_batch_refresh_company(text) to anon, authenticated;
