-- SOA Sales Register — the sales-on-approval ledger behind Tally Reports → SOA Sales Register.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb, tenant acct_orange), NOT the
--    Orange One identity project. Same as sales_register_despatch.sql beside it.
--
-- WHY
--   Stock sent out on approval is not a sale. It was landing in the Sales Register as `type='SOA'`
--   carrying full rate and value — ₹12.48 cr of FY 26-27 "revenue" that nobody had billed. Those
--   lines now leave the Sales Register (filtered in the report's own query, so the masters sync
--   keeps reading them) and get their own report, which follows each one until it is closed.
--
-- HOW TALLY LINKS THE LIFECYCLE — the TRACKING NUMBER
--   Every approval challan stamps a tracking number on each stock line, inside
--   ALLINVENTORYENTRIES.LIST → BATCHALLOCATIONS.LIST → TRACKINGNUMBER. The same number reappears on
--   the sales invoice that bills it and on the 'Rejections In' voucher that takes it back. So one
--   pass over batch allocations, bucketed by voucher type, is the whole ledger:
--
--       pending = issued − billed − rejected
--
--   This reproduces Tally's own **Sales Bills Pending** report ("Goods Delivered but Bills not
--   Made"). Verified 2026-09-12 against a screenshot of that report for
--   'ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2026-27)', 1-Apr-26 to 28-Sep-26: the same 5 rows, same
--   dates, tracking numbers, items, parties, quantities and rates, totalling ₹75,33,000.00 exactly.
--
-- THREE THINGS THE VERIFICATION FORCED, EACH OF WHICH WOULD OTHERWISE CORRUPT THE FIGURES
--   1. THE KEY IS (tracking number, ITEM) — NOT the tracking number alone. 'MC/SOA/2526/1' is
--      reused across years and items: one machine issued Apr-25 and rejected Jun-25, a second
--      billed Jun-25, a third issued 25-Aug-26 and still pending. Keyed on the tracking number
--      alone those net to zero and the ₹73,00,000 pending machine disappears. Tally's own report
--      shows Date + Tracking Number + Item together for exactly this reason.
--   2. EACH BOOK IS ITS OWN LEDGER. Never merge across companies or FY-split books; Tally treats
--      each company file separately, and merging drags a settled prior-FY issue onto a live one.
--   3. THE LEDGER RUNS OVER FULL HISTORY, the report window only chooses which ISSUES you see.
--      Netting inside the window alone leaves bills and rejections stranded — in FY 26-27 that
--      showed up as 2 tracking numbers going negative because their issue was in an earlier year.
--
-- WHY A TABLE, NOT A VIEW
--   The same reason as every other rpt_ table: walking two nested jsonb arrays across a book's full
--   history times out on PostgREST's statement limit. Measured — the all-books version of this
--   query died with 57014 before returning a row.
--
-- Reversal:
--   select cron.unschedule('rpt-soa-register-after-sync');
--   drop function if exists public.rpt_soa_register_refresh_if_stale();
--   drop function if exists public.rpt_soa_register_refresh_company(text);
--   drop function if exists public.rpt_soa_register_fill(text);
--   drop table if exists public.rpt_soa_register_refresh_log;
--   drop table if exists public.rpt_soa_register;
-- ============================================================================


-- ------------------------------------------------------------------ the table --

create table if not exists public.rpt_soa_register (
  tenant_id            text not null,
  company_guid         text,
  fy                   text,          -- FY of the ISSUE, so the report can page by year
  tracking_no          text not null,
  item                 text not null,
  soa_date             text,          -- YYYYMMDD, earliest issue for this (tracking, item)
  soa_date_display     text,          -- DD-MM-YYYY
  soa_voucher_no       text,          -- ', '-joined if the same (tracking, item) was issued twice
  soa_voucher_type     text,
  party                text,          -- the per-salesperson scope narrows on this
  rate                 numeric,       -- from the issuing challan line, as Tally's report shows it
  issued_qty           numeric not null default 0,
  billed_qty           numeric not null default 0,
  rejected_qty         numeric not null default 0,
  pending_qty          numeric not null default 0,
  issued_value         numeric not null default 0,
  pending_value        numeric not null default 0,
  billed_voucher_no    text,
  billed_date_display  text,
  rejected_voucher_no  text,
  rejected_date_display text,
  status               text,          -- Pending | Converted | Rejected | Part pending | Closed
  built_at             timestamptz not null default now(),
  primary key (tenant_id, tracking_no, item)
);

create index if not exists rpt_soa_register_date_idx  on public.rpt_soa_register (tenant_id, soa_date);
create index if not exists rpt_soa_register_party_idx on public.rpt_soa_register (party);
create index if not exists rpt_soa_register_open_idx  on public.rpt_soa_register (tenant_id) where pending_qty > 0;

comment on table public.rpt_soa_register is
  'Sales-on-approval ledger per (book, tracking number, item): issued / billed / rejected / pending qty and value. Reproduces Tally''s Sales Bills Pending. Read by Orange One''s SOA Sales Register. Rebuilt per book by rpt_soa_register_fill().';

alter table public.rpt_soa_register enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename='rpt_soa_register' and policyname='rpt_soa_register anon read') then
    create policy "rpt_soa_register anon read" on public.rpt_soa_register for select to anon using (true);
  end if;
end $$;

grant select on public.rpt_soa_register to anon;


-- -------------------------------------------------------------------- the log --

create table if not exists public.rpt_soa_register_refresh_log (
  id        bigserial primary key,
  ran_at    timestamptz not null default now(),
  tenant_id text,
  row_count integer,
  seconds   numeric,
  error     text,
  source    text
);

create index if not exists rpt_soa_register_refresh_log_tenant_idx
  on public.rpt_soa_register_refresh_log (tenant_id, ran_at desc);

grant select on public.rpt_soa_register_refresh_log to anon;


-- ------------------------------------------------------------------- the fill --
-- One book, FULL HISTORY (see note 3 above — no date floor, or the netting strands bills).

create or replace function public.rpt_soa_register_fill(p_tenant text)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '0'
as $function$
declare n integer;
begin
  delete from public.rpt_soa_register where tenant_id = p_tenant;

  with v as (
    select o.raw_payload p,
           o.raw_payload->>'VOUCHERTYPENAME' vt,
           o.raw_payload->>'VOUCHERNUMBER'   vno,
           public.jtext(o.raw_payload->'DATE') vdate,
           coalesce(o.raw_payload->'PARTYLEDGERNAME'->>'#text',
                    o.raw_payload->>'PARTYLEDGERNAME') party
      from public.tally_object o
     where o.tenant_id = p_tenant
       and o.object_type = 'Voucher'
       and not o.is_deleted
       and coalesce(public.jtext(o.raw_payload->'ISCANCELLED'), 'No') = 'No'
       and coalesce(public.jtext(o.raw_payload->'ISOPTIONAL'),  'No') = 'No'
  ),
  ie as (
    select v.*, e.el
      from v cross join lateral jsonb_array_elements(
        case jsonb_typeof(v.p->'ALLINVENTORYENTRIES.LIST')
          when 'array'  then v.p->'ALLINVENTORYENTRIES.LIST'
          when 'object' then jsonb_build_array(v.p->'ALLINVENTORYENTRIES.LIST')
          else '[]'::jsonb end) as e(el)
  ),
  ba as (
    select ie.vt, ie.vno, ie.vdate, ie.party,
           coalesce(ie.el->'STOCKITEMNAME'->>'#text', ie.el->>'STOCKITEMNAME') item,
           -- Tally writes RATE as '460.00/KGS'; the unit is already implied by the quantity.
           public.amt(split_part(coalesce(ie.el->'RATE'->>'#text', ie.el->>'RATE', '0'), '/', 1)) rate,
           nullif(btrim(coalesce(b.bl->'TRACKINGNUMBER'->>'#text', b.bl->>'TRACKINGNUMBER', '')), '') trk,
           -- ACTUALQTY is the physical movement ('80.0000 KGS'); BILLEDQTY can be 0 on a challan.
           public.amt(split_part(coalesce(b.bl->'ACTUALQTY'->>'#text', b.bl->>'ACTUALQTY', ''), ' ', 1)) qty
      from ie cross join lateral jsonb_array_elements(
        case jsonb_typeof(ie.el->'BATCHALLOCATIONS.LIST')
          when 'array'  then ie.el->'BATCHALLOCATIONS.LIST'
          when 'object' then jsonb_build_array(ie.el->'BATCHALLOCATIONS.LIST')
          else '[]'::jsonb end) as b(bl)
  ),
  cls as (
    select *,
           case
             when vt ilike '%approval%'         then 'issued'
             when vt ilike '%rejection%'        then 'rejected'
             -- A non-approval delivery challan against the same tracking number is another
             -- DELIVERY, not a bill, and a sales return happens after billing — neither settles an
             -- approval. Bucketed as 'other' and left out of the arithmetic.
             when vt ilike '%delivery challan%' then 'other'
             when vt ilike '%return%'           then 'other'
             when vt ilike '%credit note%'      then 'other'
             when vt ilike '%debit note%'       then 'other'
             else 'billed'
           end bucket
      from ba
     where trk is not null and trk <> 'Not Applicable' and btrim(coalesce(item,'')) <> ''
  ),
  agg as (
    select trk, item,
           max(party)      filter (where bucket='issued') party,
           min(vdate)      filter (where bucket='issued') soa_date,
           max(rate)       filter (where bucket='issued') rate,
           max(vt)         filter (where bucket='issued') soa_vt,
           string_agg(distinct vno, ', ') filter (where bucket='issued')   soa_vno,
           string_agg(distinct vno, ', ') filter (where bucket='billed')   billed_vno,
           string_agg(distinct vno, ', ') filter (where bucket='rejected') rejected_vno,
           string_agg(distinct to_char(to_date(vdate,'YYYYMMDD'),'DD-MM-YYYY'), ', ')
             filter (where bucket='billed')   billed_dates,
           string_agg(distinct to_char(to_date(vdate,'YYYYMMDD'),'DD-MM-YYYY'), ', ')
             filter (where bucket='rejected') rejected_dates,
           coalesce(sum(qty) filter (where bucket='issued'),   0) issued_qty,
           coalesce(sum(qty) filter (where bucket='billed'),   0) billed_qty,
           coalesce(sum(qty) filter (where bucket='rejected'), 0) rejected_qty
      from cls
     group by trk, item
  )
  insert into public.rpt_soa_register (
    tenant_id, company_guid, fy, tracking_no, item, soa_date, soa_date_display,
    soa_voucher_no, soa_voucher_type, party, rate,
    issued_qty, billed_qty, rejected_qty, pending_qty, issued_value, pending_value,
    billed_voucher_no, billed_date_display, rejected_voucher_no, rejected_date_display, status)
  select p_tenant,
         split_part(split_part(p_tenant, '::', 2), '~', 1),
         case when substr(a.soa_date,5,2)::int >= 4
              then substr(a.soa_date,1,4) || '-' || lpad(((substr(a.soa_date,1,4)::int + 1) % 100)::text, 2, '0')
              else (substr(a.soa_date,1,4)::int - 1)::text || '-' || lpad((substr(a.soa_date,1,4)::int % 100)::text, 2, '0')
         end,
         a.trk, a.item, a.soa_date,
         to_char(to_date(a.soa_date, 'YYYYMMDD'), 'DD-MM-YYYY'),
         a.soa_vno, a.soa_vt, a.party, a.rate,
         a.issued_qty, a.billed_qty, a.rejected_qty,
         a.issued_qty - a.billed_qty - a.rejected_qty,
         round(a.issued_qty * coalesce(a.rate, 0), 2),
         round((a.issued_qty - a.billed_qty - a.rejected_qty) * coalesce(a.rate, 0), 2),
         a.billed_vno, a.billed_dates, a.rejected_vno, a.rejected_dates,
         case
           when a.issued_qty - a.billed_qty - a.rejected_qty > 0
                and a.billed_qty = 0 and a.rejected_qty = 0           then 'Pending'
           when a.issued_qty - a.billed_qty - a.rejected_qty > 0      then 'Part pending'
           when a.billed_qty > 0 and a.rejected_qty = 0               then 'Converted'
           when a.rejected_qty > 0 and a.billed_qty = 0               then 'Rejected'
           else 'Closed'
         end
    from agg a
   -- Only rows that began life as an approval issue. A tracking number seen solely on an invoice
   -- (its challan sits in a different book) has nothing to reconcile and would read as a phantom
   -- negative — the 2 such rows found in FY 26-27 are what note 3 above is about.
   where a.issued_qty > 0 and a.soa_date is not null;

  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Cron- and wrapper-only. Postgres grants EXECUTE to PUBLIC on new functions and Supabase adds
-- anon/authenticated, so this must be an explicit revoke.
revoke execute on function public.rpt_soa_register_fill(text) from public, anon, authenticated;


-- --------------------------------------------- the browser's manual refresh --

create or replace function public.rpt_soa_register_refresh_company(p_tenant text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '0'
as $function$
declare
  v_last timestamptz;
  n      integer;
  t0     timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_soa_register:' || p_tenant)) then
    return jsonb_build_object('status', 'busy');
  end if;

  select max(l.ran_at) into v_last
    from public.rpt_soa_register_refresh_log l
   where l.tenant_id = p_tenant and l.source = 'manual';
  if v_last is not null and v_last > now() - interval '60 seconds' then
    return jsonb_build_object('status', 'cooldown',
      'retry_after_seconds', ceil(extract(epoch from (v_last + interval '60 seconds' - now())))::int);
  end if;

  n := coalesce(public.rpt_soa_register_fill(p_tenant), 0);
  insert into public.rpt_soa_register_refresh_log (tenant_id, row_count, seconds, source)
  values (p_tenant, n, round(extract(epoch from (clock_timestamp() - t0))::numeric, 1), 'manual');
  return jsonb_build_object('status', 'ok', 'rows', n,
                            'seconds', round(extract(epoch from (clock_timestamp() - t0))::numeric, 1));
exception when others then
  return jsonb_build_object('status', 'error', 'message', sqlerrm);
end;
$function$;

revoke execute on function public.rpt_soa_register_refresh_company(text) from public, authenticated;
grant  execute on function public.rpt_soa_register_refresh_company(text) to anon;


-- ------------------------------------------------------- the after-sync poll --

create or replace function public.rpt_soa_register_refresh_if_stale()
returns text
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '0'
as $function$
declare
  r record; n integer; rebuilt integer := 0; rows_n integer := 0;
  t0 timestamptz := clock_timestamp(); t1 timestamptz; books text := ''; secs numeric;
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_soa_register:if_stale')) then
    return 'another poll is running; skipped';
  end if;

  for r in
    select s.tenant_id
      from public.tally_sync_state s
     where s.tenant_id in (select distinct tenant_id from public.v_company)
       and s.last_sync_at is not null
       and s.last_sync_at > coalesce(
             (select max(l.ran_at) from public.rpt_soa_register_refresh_log l
               where l.tenant_id = s.tenant_id), '-infinity'::timestamptz)
     order by s.last_sync_at
  loop
    t1 := clock_timestamp();
    begin
      n := coalesce(public.rpt_soa_register_fill(r.tenant_id), 0);
      rebuilt := rebuilt + 1; rows_n := rows_n + n;
      books := books || case when books = '' then '' else ', ' end
                     || split_part(split_part(r.tenant_id, '::', 2), '-', 1);
      insert into public.rpt_soa_register_refresh_log (tenant_id, row_count, seconds, source)
      values (r.tenant_id, n, round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), 'sync');
    exception when others then
      insert into public.rpt_soa_register_refresh_log (tenant_id, seconds, error, source)
      values (r.tenant_id, round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), sqlerrm, 'sync');
    end;
  end loop;

  if rebuilt = 0 then return 'up to date; skipped'; end if;
  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);
  return format('rebuilt %s book(s) [%s], %s rows in %ss', rebuilt, books, rows_n, secs);
end;
$function$;

revoke execute on function public.rpt_soa_register_refresh_if_stale() from public, anon, authenticated;

-- Offset four minutes off the register's `*/5` and two off the despatch fill, so the three polls
-- never contend for the same book. `cron.schedule` upserts by name, so re-running this is safe.
select cron.schedule(
  'rpt-soa-register-after-sync',
  '4-59/5 * * * *',
  $$ set statement_timeout='30min';
     select public.rpt_soa_register_refresh_if_stale(); $$
);


-- ------------------------------------------------------------- first backfill --
--   select b.tenant_id, public.rpt_soa_register_fill(b.tenant_id) as rows
--     from (select distinct tenant_id from public.v_company) b;
--
-- ---------------------------------------------------------------- verify --
-- Must reproduce Tally's Sales Bills Pending for the FY 26-27 Enterprise book — 5 rows, 75,33,000:
--
--   select soa_date_display, tracking_no, item, party, issued_qty, pending_qty, rate, pending_value
--     from public.rpt_soa_register
--    where tenant_id = 'acct_orange::59a6c2d9-0c5a-4fc5-b8c5-3be6fec3289e'
--      and pending_qty > 0 and soa_date between '20260401' and '20260928'
--    order by soa_date, tracking_no, item;
