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
-- WHERE THE LINES COME FROM — rpt_batch_line, NOT tally_object (changed 2026-09-14)
--   The first version walked ALLINVENTORYENTRIES → BATCHALLOCATIONS in tally_object's raw JSON on
--   every run. For the main Orange O Tec book that is 79,077 vouchers / 1.18 GB, and every
--   after-sync refresh took 13–16 minutes. rpt_batch_line (supabase/connectwave/rpt_batch_line*.sql,
--   which must exist first) already holds those same batch allocations flattened — tracking number,
--   item, qty, rate, party, voucher type/no/date — and is rebuilt after every sync. Reading it gives
--   the identical ledger in about 11 seconds: verified on 2026-09-14, all 798 rows across every
--   book, every column, zero differences.
--   Two things to know:
--   • RATE — rpt_batch_line prefers the batch's own BATCHRATE and falls back to the line's RATE;
--     the first version read the line's RATE only. No row differed on the day. It stores a missing
--     rate as NULL where the first version had 0, hence the coalesce in the fill.
--   • CLOSED YEARS — the batch refresh rebuilds only the current FY. That loses nothing, because
--     the connector does not re-sync closed years either (0 of 60,755 prior-FY vouchers touched
--     since the 07-Sep batch backfill). If a closed FY is ever re-synced, rebuild its batch lines
--     (rpt_batch_line_rebuild over that window) and this ledger follows on the next poll.
--
-- WHY A TABLE, NOT A VIEW
--   The same reason as every other rpt_ table: the first version's walk over two nested jsonb
--   arrays died with 57014 on the all-books query before returning a row, and even the batch-line
--   read (~11 s for the main book) is far past anon's 3-second statement limit.
--
-- Reversal (the raw-JSON first version is commit 1c779fa of this file):
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

-- Which batch-line rebuild a poll consumed: the rpt_batch_refresh_log.ran_at it read. The poll
-- compares THIS, not its own ran_at, because every ran_at is a transaction START time — a batch
-- rebuild that began before a poll but committed after it would otherwise look already consumed.
-- NULL on manual refreshes and on rows written before 2026-09-14.
alter table public.rpt_soa_register_refresh_log add column if not exists batch_ran_at timestamptz;

create index if not exists rpt_soa_register_refresh_log_tenant_idx
  on public.rpt_soa_register_refresh_log (tenant_id, ran_at desc);

grant select on public.rpt_soa_register_refresh_log to anon;


-- ------------------------------------------------------------------- the fill --
-- One book, FULL HISTORY (see note 3 above — no date floor, or the netting strands bills).
-- Reads rpt_batch_line — see WHERE THE LINES COME FROM above. rpt_batch_line already drops deleted,
-- cancelled and optional vouchers, exactly the filters the raw-JSON version applied.

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

  with ba as (
    select bl.voucher_type vt,
           bl.voucher_no   vno,
           bl.vch_date     vdate,
           bl.party,
           bl.stock_item   item,
           -- Tally writes RATE as '460.00/KGS'; rpt_batch_line has already taken the amount side.
           bl.rate,
           nullif(btrim(coalesce(bl.tracking_number, '')), '') trk,
           -- ACTUALQTY is the physical movement ('80.0000 KGS'); BILLEDQTY can be 0 on a challan.
           bl.qty
      from public.rpt_batch_line bl
     where bl.tenant_id = p_tenant
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
           -- rpt_batch_line stores a missing rate as NULL; the ledger has always shown it as 0.
           coalesce(max(rate) filter (where bucket='issued'), 0) rate,
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
-- Follows the BATCH-LINE rebuild, not the sync: the fill reads rpt_batch_line, so refreshing on
-- last_sync_at could run before that book's batch lines were rebuilt and miss the sync entirely.
-- A book is due when a successful batch rebuild exists that this poll has not yet consumed —
-- tracked by batch_ran_at (see the log above), which does not depend on how long anything runs.
-- A rebuild still in flight is invisible until it commits, so a half-rebuilt book is never read.
--   • tenant_id IS NULL rows are the nightly batch run, which rebuilds every book — so every book
--     also gets one cheap SOA rebuild a night, a self-heal.
--   • Manual refreshes are ignored here: a Refresh click during a batch rebuild must not mark it consumed.
--   • An error still records batch_ran_at, so a failing book cannot re-run every 5 minutes.

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
    select c.tenant_id, c.batch_at
      from (select t.tenant_id,
                   (select max(b.ran_at) from public.rpt_batch_refresh_log b
                     where (b.tenant_id = t.tenant_id or b.tenant_id is null)
                       and b.error is null) batch_at
              from (select distinct tenant_id from public.v_company) t) c
     where c.batch_at is not null
       and c.batch_at > coalesce(
             (select max(l.batch_ran_at) from public.rpt_soa_register_refresh_log l
               where l.tenant_id = c.tenant_id and l.source <> 'manual'), '-infinity'::timestamptz)
     order by c.batch_at
  loop
    t1 := clock_timestamp();
    begin
      n := coalesce(public.rpt_soa_register_fill(r.tenant_id), 0);
      rebuilt := rebuilt + 1; rows_n := rows_n + n;
      books := books || case when books = '' then '' else ', ' end
                     || split_part(split_part(r.tenant_id, '::', 2), '-', 1);
      insert into public.rpt_soa_register_refresh_log (tenant_id, row_count, seconds, source, batch_ran_at)
      values (r.tenant_id, n, round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), 'sync', r.batch_at);
    exception when others then
      insert into public.rpt_soa_register_refresh_log (tenant_id, seconds, error, source, batch_ran_at)
      values (r.tenant_id, round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), sqlerrm, 'sync', r.batch_at);
    end;
  end loop;

  if rebuilt = 0 then return 'up to date; skipped'; end if;
  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);
  return format('rebuilt %s book(s) [%s], %s rows in %ss', rebuilt, books, rows_n, secs);
end;
$function$;

revoke execute on function public.rpt_soa_register_refresh_if_stale() from public, anon, authenticated;

-- Offset four minutes off the register's and the batch lines' `*/5` and two off the despatch fill,
-- so a batch rebuild usually lands before this polls; one that has not is picked up next poll. `cron.schedule` upserts by name, so re-running this is safe.
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
