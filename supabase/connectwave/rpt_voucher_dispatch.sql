-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- rpt_voucher_dispatch — Tally's four DISPATCH columns, one row per voucher.
--
-- ⚠ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb / tenant acct_orange),
--   NOT the Orange One identity project.
--
-- WHY THIS EXISTS
--   Tally's Voucher Register prints Delivery Note No. & Date, Despatch Doc No, Despatch Through
--   and Destination. None of them had a column anywhere, and for FY2026-27 they were not even in
--   raw_payload — the current-period collection FETCH never named them, and Tally returns only a
--   node's DEFAULT columns. Closed FYs had them all along, because the Voucher Register REPORT
--   path carries every field with no FETCH at all. Same split that hid the lot number and the
--   godown. See rpt_batch_line.sql for the full account of the two paths.
--
--   Probed live 10-Sep-2026 against ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27):
--     BASICSHIPPEDBY .............. 4,350 of 4,820 current-year sales/delivery vouchers
--     BASICFINALDESTINATION ....... 1,660 of 4,820
--     BASICSHIPDOCUMENTNO ......... returns, but EMPTY IN TALLY ITSELF (14 of 3,036 in FY25-26)
--     INVOICEDELNOTES ............. 65 vouchers, matching the client's own screenshot row for row
--
-- GRAIN
--   One row per voucher that carries AT LEAST ONE dispatch value. Vouchers with none are not
--   stored — a receipt or a journal has no despatch. A full dispatch register joins from its own
--   voucher list and left-joins this; that keeps the table small and its meaning unambiguous.
--
-- SOURCE
--   tally_object.raw_payload, voucher level, EXCEPT the delivery note which is one level down in
--   INVOICEDELNOTES.LIST.
--
-- ⚠ THREE TRAPS
--
--   1. ALWAYS public.jtext(), never ->>'#text'. Closed FYs store scalars as BARE STRINGS, the
--      current FY wraps them as {"#text": .., "@TYPE": ..}. Reading '#text' returns NULL for
--      every closed-FY row — the exact mistake that once reported the lot number absent.
--
--   2. INVOICEDELNOTES.LIST IS SOMETIMES AN ARRAY. Any .LIST is an OBJECT when it holds one
--      entry and an ARRAY when it holds many. One current-year voucher cites TWO delivery notes.
--      Normalise before expanding or that voucher vanishes silently. Multiple notes are stored
--      comma-joined in note order, the way Tally's own report stacks them in one cell, with the
--      raw dates kept alongside in the same order.
--
--   3. CURRBASICSHIPDELIVERYNOTE IS A DECOY. It exists at voucher level and is empty on all
--      3,036 FY25-26 spare invoices. The real value is nested. Do not read it.
--
-- DATA QUALITY, for whoever builds the report
--   These are free-text boxes a human types into. Despatch Through has 288 distinct values in one
--   year, including 'BY TEMPO' (893) and 'BYTEMPO' (767) as separate entries. Destination has 115,
--   including '50' on 115 vouchers, which is plainly the wrong box. Stored RAW and unmodified —
--   normalisation is a reporting decision, not a mirroring one.
--
-- ADDITIVE ONLY: new table, new functions, new policies, new cron. Nothing existing is altered,
-- dropped, or even re-created — deliberately, so this cannot disturb the live batch/lot pipeline.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.rpt_voucher_dispatch (
  tenant_id        text    not null,
  company_guid     text    not null,
  fy               text,
  vch_date         text,                    -- 'YYYYMMDD', the house convention
  voucher_guid     text    not null,

  voucher_type     text,
  voucher_no       text,
  party            text,

  despatch_through text,                    -- BASICSHIPPEDBY        — Tally's "Despatch Through"
  destination      text,                    -- BASICFINALDESTINATION — Tally's "Destination"
  despatch_doc_no  text,                    -- BASICSHIPDOCUMENTNO   — near-always blank in Tally

  delivery_note_no    text,                 -- comma-joined when a voucher cites more than one
  delivery_note_date  date,                 -- the FIRST note's date, parsed
  delivery_note_dates text,                 -- every note's raw date, same order as the numbers
  delivery_note_count integer not null default 0,

  built_at         timestamptz not null default now(),

  primary key (tenant_id, voucher_guid)
);

create index if not exists rpt_voucher_dispatch_date_idx
  on public.rpt_voucher_dispatch (tenant_id, vch_date);
create index if not exists rpt_voucher_dispatch_dest_idx
  on public.rpt_voucher_dispatch (tenant_id, destination)
  where destination is not null;
create index if not exists rpt_voucher_dispatch_note_idx
  on public.rpt_voucher_dispatch (tenant_id, delivery_note_no)
  where delivery_note_no is not null;
create index if not exists rpt_voucher_dispatch_vno_idx
  on public.rpt_voucher_dispatch (tenant_id, voucher_no);

create table if not exists public.rpt_voucher_dispatch_log (
  ran_at    timestamptz not null default now(),
  tenant_id text,
  fy_from   text,
  fy_to     text,
  rows      integer,
  seconds   numeric,
  source    text,        -- 'cron' | 'sync' | 'manual' | 'backfill'
  error     text
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The extractor. Delete-and-reinsert of a DATE WINDOW per tenant, the house strategy.
-- Window-scoped, so a current-FY rebuild can never touch a closed-FY row.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.rpt_voucher_dispatch_rebuild(
  p_tenant text, p_from text, p_to text) returns integer
language plpgsql as $fn$
declare n integer;
begin
  delete from public.rpt_voucher_dispatch
   where tenant_id = p_tenant and vch_date between p_from and p_to;

  with vch as materialized (
    select o.tenant_id, o.company_guid, o.guid, o.fy, o.vch_date, o.raw_payload as p,
           o.raw_payload->>'VOUCHERTYPENAME'              as voucher_type,
           public.jtext(o.raw_payload->'VOUCHERNUMBER')   as voucher_no,
           public.jtext(o.raw_payload->'PARTYLEDGERNAME') as party
    from public.tally_object o
    where o.tenant_id = p_tenant
      and o.object_type = 'Voucher'
      and o.vch_date between p_from and p_to
      and o.vch_date ~ '^[0-9]{8}$'
      and not o.is_deleted
      -- A cancelled voucher shows blank dispatch in Tally's own register (invoice 921 in the
      -- client's screenshot). Excluding them keeps us honest against the printed report.
      and coalesce(public.jtext(o.raw_payload->'ISCANCELLED'), 'No') = 'No'
      and coalesce(public.jtext(o.raw_payload->'ISOPTIONAL'),  'No') = 'No'
  ),
  -- TRAP 2: normalise object-or-array BEFORE expanding, or the multi-note voucher disappears.
  notes as (
    select v.guid,
           nullif(string_agg(x.no, ', ' order by x.ord), '')                as note_no,
           -- coalesce, NOT bare x.dt: string_agg SKIPS nulls, so one undated note among several
           -- would shift every later date onto the wrong number. An empty slot keeps them aligned.
           nullif(string_agg(coalesce(x.dt,''), ', ' order by x.ord), '')   as note_dates,
           count(x.no)                                                     as note_count,
           (array_agg(x.dt order by x.ord))[1]                             as first_dt
    from vch v
    left join lateral (
      select dn.ord,
             nullif(btrim(coalesce(public.jtext(dn.e->'BASICSHIPDELIVERYNOTE'),'')),'') as no,
             nullif(btrim(coalesce(public.jtext(dn.e->'BASICSHIPPINGDATE'),'')),'')     as dt
      from jsonb_array_elements(
             case jsonb_typeof(v.p->'INVOICEDELNOTES.LIST')
               when 'array'  then v.p->'INVOICEDELNOTES.LIST'
               when 'object' then jsonb_build_array(v.p->'INVOICEDELNOTES.LIST')
               else '[]'::jsonb
             end) with ordinality as dn(e, ord)
    ) x on x.no is not null
    group by v.guid
  ),
  d as (
    select v.tenant_id, v.company_guid, v.fy, v.vch_date, v.guid,
           v.voucher_type, v.voucher_no, v.party,
           nullif(btrim(coalesce(public.jtext(v.p->'BASICSHIPPEDBY'),'')),'')        as despatch_through,
           nullif(btrim(coalesce(public.jtext(v.p->'BASICFINALDESTINATION'),'')),'') as destination,
           nullif(btrim(coalesce(public.jtext(v.p->'BASICSHIPDOCUMENTNO'),'')),'')   as despatch_doc_no,
           n.note_no                        as delivery_note_no,
           public.rpt_try_date(n.first_dt)  as delivery_note_date,
           n.note_dates                     as delivery_note_dates,
           coalesce(n.note_count, 0)::int   as delivery_note_count
    from vch v
    left join notes n on n.guid = v.guid
  )
  insert into public.rpt_voucher_dispatch (
    tenant_id, company_guid, fy, vch_date, voucher_guid,
    voucher_type, voucher_no, party,
    despatch_through, destination, despatch_doc_no,
    delivery_note_no, delivery_note_date, delivery_note_dates, delivery_note_count)
  select tenant_id, company_guid, fy, vch_date, guid,
         voucher_type, voucher_no, party,
         despatch_through, destination, despatch_doc_no,
         delivery_note_no, delivery_note_date, delivery_note_dates, delivery_note_count
  from d
  -- Only vouchers that actually carry dispatch. See the GRAIN note in the header.
  where despatch_through is not null
     or destination      is not null
     or despatch_doc_no  is not null
     or delivery_note_no is not null
  on conflict (tenant_id, voucher_guid) do nothing;

  get diagnostics n = row_count;
  return n;
end $fn$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Refresh wrappers. Deliberately SEPARATE from the rpt_batch_* family rather than bolted into it:
-- those three functions drive the live lot picker, and re-creating them to add a call here would
-- put a working pipeline in the blast radius of this change for no benefit. Same shape, own log.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- Current Indian financial year as a 'YYYYMMDD' pair. This database is UTC, so the IST correction
-- has to be explicit or a rebuild running after 18:30 UTC on 31-Mar picks the wrong year.
create or replace function public.rpt_dispatch_fy_window(out v_from text, out v_to text)
language plpgsql immutable as $fn$
begin
  v_from := to_char(
    case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
         then make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int,     4, 1)
         else make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1, 4, 1)
    end, 'YYYYMMDD');
  v_to := to_char((to_date(v_from,'YYYYMMDD') + interval '1 year - 1 day')::date, 'YYYYMMDD');
end $fn$;

-- -- Per-company, for a UI "Refresh now" button ------------------------------------------------
create or replace function public.rpt_voucher_dispatch_refresh_company(p_tenant text)
returns jsonb language plpgsql as $fn$
declare
  t0 timestamptz := clock_timestamp();
  n integer; secs numeric; w record; last timestamptz;
begin
  if not exists (select 1 from public.v_company c where c.tenant_id = p_tenant) then
    return jsonb_build_object('status','error','message','unknown tenant');
  end if;

  select max(ran_at) into last
    from public.rpt_voucher_dispatch_log
   where tenant_id = p_tenant and error is null;
  if last is not null and last > now() - interval '2 minutes' then
    return jsonb_build_object('status','cooldown','message','refreshed less than 2 minutes ago');
  end if;

  if not pg_try_advisory_xact_lock(hashtext('rpt_voucher_dispatch:' || p_tenant)) then
    return jsonb_build_object('status','busy','message','a refresh is already running');
  end if;

  select * into w from public.rpt_dispatch_fy_window();
  n := public.rpt_voucher_dispatch_rebuild(p_tenant, w.v_from, w.v_to);
  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);

  insert into public.rpt_voucher_dispatch_log (tenant_id, fy_from, fy_to, rows, seconds, source)
  values (p_tenant, w.v_from, w.v_to, n, secs, 'manual');

  return jsonb_build_object('status','ok','rows',n,'seconds',secs,'from',w.v_from,'to',w.v_to);
end $fn$;

-- -- Nightly backstop ---------------------------------------------------------------------------
create or replace procedure public.rpt_voucher_dispatch_refresh_nightly()
language plpgsql as $pr$
declare r record; n integer; w record; t0 timestamptz;
begin
  select * into w from public.rpt_dispatch_fy_window();
  for r in select distinct tenant_id from public.v_company loop
    t0 := clock_timestamp();
    begin
      n := public.rpt_voucher_dispatch_rebuild(r.tenant_id, w.v_from, w.v_to);
      insert into public.rpt_voucher_dispatch_log (tenant_id, fy_from, fy_to, rows, seconds, source)
      values (r.tenant_id, w.v_from, w.v_to, n,
              round(extract(epoch from (clock_timestamp() - t0))::numeric, 1), 'cron');
    exception when others then
      insert into public.rpt_voucher_dispatch_log (tenant_id, fy_from, fy_to, source, error)
      values (r.tenant_id, w.v_from, w.v_to, 'cron', sqlerrm);
    end;
  end loop;
end $pr$;

-- -- After-sync poller --------------------------------------------------------------------------
-- Gated on rpt_voucher_dispatch_log.ran_at vs tally_sync_state.last_sync_at, NOT on the table's
-- own built_at. Dormant archive books rebuild to zero rows; a built_at gate would find no row,
-- call them stale forever and re-run them every five minutes. rpt_batch_line_refresh.sql and
-- rpt_sales_register_after_sync.sql both record the same bug. Errors advance the marker too.
create or replace function public.rpt_voucher_dispatch_refresh_if_stale()
returns text language plpgsql as $fn$
declare
  r record; n integer; rebuilt integer := 0; total integer := 0;
  t0 timestamptz := clock_timestamp(); books text := ''; secs numeric; w record;
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_voucher_dispatch:if_stale')) then
    return 'another poll is running; skipped';
  end if;

  select * into w from public.rpt_dispatch_fy_window();

  for r in
    select s.tenant_id
      from public.tally_sync_state s
     where s.tenant_id in (select distinct tenant_id from public.v_company)
       and s.last_sync_at is not null
       and s.last_sync_at > coalesce(
             (select max(l.ran_at) from public.rpt_voucher_dispatch_log l
               where l.tenant_id = s.tenant_id), '-infinity'::timestamptz)
     order by s.last_sync_at
  loop
    begin
      n := public.rpt_voucher_dispatch_rebuild(r.tenant_id, w.v_from, w.v_to);
      rebuilt := rebuilt + 1;
      total := total + coalesce(n, 0);
      books := books || case when books = '' then '' else ', ' end
                     || split_part(split_part(r.tenant_id, '::', 2), '-', 1);
      insert into public.rpt_voucher_dispatch_log (tenant_id, fy_from, fy_to, rows, seconds, source)
      values (r.tenant_id, w.v_from, w.v_to, n,
              round(extract(epoch from (clock_timestamp() - t0))::numeric, 1), 'sync');
    exception when others then
      insert into public.rpt_voucher_dispatch_log (tenant_id, fy_from, fy_to, source, error)
      values (r.tenant_id, w.v_from, w.v_to, 'sync', sqlerrm);
    end;
  end loop;

  if rebuilt = 0 then return 'up to date; skipped'; end if;
  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);
  return format('rebuilt %s book(s) [%s], %s rows in %ss', rebuilt, books, total, secs);
end $fn$;

-- -- Coverage view: the anti-"PROVEN ABSENT" device ----------------------------------------------
-- The current-FY row of this view is the tripwire for the connector landing: every count below
-- reads 0 for FY2026-27 until the new FETCH ships, and non-zero after.
create or replace view public.rpt_voucher_dispatch_coverage as
select tenant_id,
       fy,
       count(*)                                        as dispatch_rows,
       count(despatch_through)                         as through_rows,
       count(destination)                              as destination_rows,
       count(despatch_doc_no)                          as doc_no_rows,
       count(delivery_note_no)                         as delivery_note_rows,
       count(*) filter (where delivery_note_count > 1) as multi_note_rows,
       count(distinct despatch_through)                as distinct_through,
       count(distinct destination)                     as distinct_destinations,
       min(vch_date) as first_vch_date,
       max(vch_date) as last_vch_date,
       max(built_at) as built_at
  from public.rpt_voucher_dispatch
 group by tenant_id, fy;

-- -- Exposure -----------------------------------------------------------------------------------
-- RLS ON + an explicit read policy, matching rpt_batch_line. tally_object is RLS-on with NO
-- policies, so the anon key the portal uses reads it as [] — a materialised table with its own
-- named policy is how that is already solved here, and the named policy says "deliberately
-- readable" to the next person auditing permissions.
alter table public.rpt_voucher_dispatch     enable row level security;
alter table public.rpt_voucher_dispatch_log enable row level security;

drop policy if exists rpt_voucher_dispatch_read on public.rpt_voucher_dispatch;
create policy rpt_voucher_dispatch_read on public.rpt_voucher_dispatch
  for select to anon, authenticated using (true);

drop policy if exists rpt_voucher_dispatch_log_read on public.rpt_voucher_dispatch_log;
create policy rpt_voucher_dispatch_log_read on public.rpt_voucher_dispatch_log
  for select to anon, authenticated using (true);

grant select on public.rpt_voucher_dispatch, public.rpt_voucher_dispatch_log,
                public.rpt_voucher_dispatch_coverage
  to anon, authenticated;
