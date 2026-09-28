-- Sales Register — despatch details (Delivery Note No. & Date, Despatch Doc No.,
-- Despatch Through, Destination, Vehicle No.) as a sidecar to `rpt_sales_register`.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb, tenant acct_orange), NOT the
--    Orange One identity project. The repo's `supabase/migrations/` + `supabase db push` target the
--    identity project — this one runs in the ConnectWave SQL editor as service role, exactly like
--    `rpt_sales_register_after_sync.sql` and `supabase/clevel-mirror/objects.sql` beside it.
--
-- WHY
--   The Sales Register screen showed the 12-column "Append1" layout. Finance also reconcile against
--   Tally's own Voucher Register, which carries the despatch block for each invoice — Delivery Note
--   No. & Date, Despatch Doc No., Despatch Through, Destination. Those five fields live in the
--   voucher's raw payload and were simply never projected.
--
-- WHERE THE FIELDS COME FROM (verified 2026-09-10 by reading tally_object in this project, against
-- a screenshot of Tally's own Voucher Register for "ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)"):
--   INVOICEDELNOTES.LIST → BASICSHIPDELIVERYNOTE  → Delivery Note No.        ('SP/SOA/2627/139')
--   INVOICEDELNOTES.LIST → BASICSHIPPINGDATE      → the "& Date" half of it  ('20260806')
--       ⚠ These two are NESTED, one level down, not top-level like the four below. A first draft of
--       this file read `raw_payload->'BASICSHIPDELIVERYNOTE'` and got NULL for every voucher, while
--       Tally showed SP/SOA/2627/139 dt.6-Aug-26 on SPARE/26-27/919. The list is shaped three ways:
--       '' (a bare string — no delivery note; ~27k vouchers in FY 26-27), an object (one note; 68),
--       or an array (several notes on one invoice; 1). All three are handled below, and several
--       notes are joined ', ' in list order with their dates joined the same way, so position N of
--       one column always pairs with position N of the other.
--   BASICSHIPDOCUMENTNO    → Despatch Doc No.
--   BASICSHIPPEDBY         → Despatch Through         ('Harish', 'By Porter', 'BHUSHAN')
--   BASICFINALDESTINATION  → Destination              ('Surat')
--   BASICSHIPVESSELNO      → Vehicle No.              ('Gj05kr3557') — carried because it sits in
--                            the same Tally despatch block and costs nothing to project.
--   These are the voucher's OWN despatch fields, not the tracking-number link. A tracking number
--   (`TRACKINGNUMBER` on the inventory line) is a different thing — Tally's own Voucher Register
--   column reads the fields above, so this matches what finance see on screen in Tally.
--
-- WHY A SIDECAR TABLE AND NOT COLUMNS ON rpt_sales_register
--   1. `rpt_sales_register_rebuild` is not version-controlled here. Adding columns it does not know
--      about would leave them NULL after every rebuild until something else refilled them. A sidecar
--      keyed on the VOUCHER survives register rebuilds untouched.
--   2. The register is one row per voucher LINE (~250k for a FY); despatch is one row per VOUCHER
--      (~30k). The sidecar is an order of magnitude smaller.
--   3. Nothing existing is modified. Additive-only, per the project rule.
--
-- WHY A TABLE AND NOT A VIEW OVER tally_object
--   Tried first, and rejected on measurement: a view has to derive the voucher date with
--   `jtext(raw_payload->'DATE')`, which is not indexable, so a plain
--   `?vch_date=gte.20260401&vch_date=lte.20260908` from the browser died on PostgREST's statement
--   timeout (57014) before returning a row. A precomputed table with a real `vch_date` column
--   answers the same query on an index — the same reason `rpt_sales_register` itself is a table.
--
-- WHY ITS OWN CRON RATHER THAN A LINE INSIDE rpt_sales_register_refresh_if_stale()
--   That function writes its log row AFTER the rebuild returns, and its exception handler catches
--   everything in the loop body. A fill call added inside it that threw would skip the register's
--   own log insert, leaving the book permanently "stale" and rebuilding it every five minutes.
--   A separate job with a separate log cannot do that to the register.
--
-- Reversal:
--   select cron.unschedule('rpt-sales-despatch-after-sync');
--   drop function if exists public.rpt_sales_despatch_refresh_if_stale();
--   drop function if exists public.rpt_sales_despatch_refresh_company(text);
--   drop function if exists public.rpt_sales_despatch_fill(text, text);
--   drop table if exists public.rpt_sales_despatch_refresh_log;
--   drop table if exists public.rpt_sales_despatch;
-- ============================================================================


-- ------------------------------------------------------------------ the table --
-- One row per voucher that actually carries at least one despatch field. A voucher with an empty
-- despatch block is not stored: it would be ~40% of the table holding six NULLs, and the reader
-- joins with a left join anyway, so its absence renders identically.

create table if not exists public.rpt_sales_despatch (
  tenant_id                  text not null,
  voucher_guid               text not null,
  -- Denormalised from the voucher so the browser can filter this table on its own, on an index,
  -- without first reading the register. `party` in particular is what the per-salesperson scope
  -- narrows on — see lib/scopeParties.ts; without it a scoped viewer would pull despatch rows for
  -- parties they are not allowed to see.
  vch_date                   text not null,       -- YYYYMMDD, same shape as rpt_sales_register
  party                      text,
  voucher_no                 text,
  voucher_type               text,
  delivery_note_no           text,                -- ', '-joined when an invoice carries several
  delivery_note_date         text,                -- YYYYMMDD as Tally stores it; ', '-joined in the same order
  delivery_note_date_display text,                -- DD-MM-YYYY, mirroring rpt_sales_register.date_display
  despatch_doc_no            text,
  despatch_through           text,
  destination                text,
  vehicle_no                 text,
  built_at                   timestamptz not null default now(),
  primary key (tenant_id, voucher_guid)
);

create index if not exists rpt_sales_despatch_date_idx
  on public.rpt_sales_despatch (tenant_id, vch_date);
create index if not exists rpt_sales_despatch_party_idx
  on public.rpt_sales_despatch (party);

comment on table public.rpt_sales_despatch is
  'Despatch block (delivery note, despatch doc, despatch through, destination, vehicle) per sales voucher, read by the Orange One Sales Register. Sidecar to rpt_sales_register, joined on (tenant_id, voucher_guid). Rebuilt per book by rpt_sales_despatch_fill().';

alter table public.rpt_sales_despatch enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'rpt_sales_despatch'
       and policyname = 'rpt_sales_despatch anon read'
  ) then
    create policy "rpt_sales_despatch anon read"
      on public.rpt_sales_despatch for select to anon using (true);
  end if;
end $$;

grant select on public.rpt_sales_despatch to anon;


-- -------------------------------------------------------------------- the log --

create table if not exists public.rpt_sales_despatch_refresh_log (
  id        bigserial primary key,
  ran_at    timestamptz not null default now(),
  tenant_id text,
  fy_from   text,
  row_count integer,
  seconds   numeric,
  error     text,
  source    text
);

create index if not exists rpt_sales_despatch_refresh_log_tenant_idx
  on public.rpt_sales_despatch_refresh_log (tenant_id, ran_at desc);

grant select on public.rpt_sales_despatch_refresh_log to anon;


-- ------------------------------------------------------------------- the fill --
-- Rebuilds one book's despatch rows from `p_from` (YYYYMMDD) forward. Delete-then-insert over the
-- same window, so an edited voucher's despatch details follow the edit and a cleared field clears
-- here too. Bounded to one FY by the caller, exactly like rpt_sales_register_rebuild.

create or replace function public.rpt_sales_despatch_fill(
  p_tenant text,
  p_from   text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '0'
as $function$
declare
  v_from text := coalesce(
    p_from,
    to_char(
      case when extract(month from (now() at time zone 'Asia/Kolkata')) >= 4
           then make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int, 4, 1)
           else make_date(extract(year from (now() at time zone 'Asia/Kolkata'))::int - 1, 4, 1)
      end, 'YYYYMMDD'));
  n integer;
begin
  delete from public.rpt_sales_despatch d
   where d.tenant_id = p_tenant
     and d.vch_date >= v_from;

  insert into public.rpt_sales_despatch (
    tenant_id, voucher_guid, vch_date, party, voucher_no, voucher_type,
    delivery_note_no, delivery_note_date, delivery_note_date_display,
    despatch_doc_no, despatch_through, destination, vehicle_no)
  select o.tenant_id,
         o.guid,
         x.vch_date,
         nullif(x.party, ''),
         nullif(x.voucher_no, ''),
         nullif(x.voucher_type, ''),
         dn.dn_no,
         dn.dn_date,
         dn.dn_date_display,
         nullif(x.doc_no, ''),
         nullif(x.shipped_by, ''),
         nullif(x.destination, ''),
         nullif(x.vessel_no, '')
    from public.tally_object o
    cross join lateral (
      select btrim(coalesce(public.jtext(o.raw_payload->'DATE'), ''))                  as vch_date,
             btrim(coalesce(nullif(public.jtext(o.raw_payload->'PARTYLEDGERNAME'), ''),
                            public.jtext(o.raw_payload->'PARTYNAME'), ''))             as party,
             btrim(coalesce(public.jtext(o.raw_payload->'VOUCHERNUMBER'), ''))         as voucher_no,
             btrim(coalesce(public.jtext(o.raw_payload->'VOUCHERTYPENAME'), ''))       as voucher_type,
             btrim(coalesce(public.jtext(o.raw_payload->'BASICSHIPDOCUMENTNO'), ''))   as doc_no,
             btrim(coalesce(public.jtext(o.raw_payload->'BASICSHIPPEDBY'), ''))        as shipped_by,
             btrim(coalesce(public.jtext(o.raw_payload->'BASICFINALDESTINATION'), '')) as destination,
             btrim(coalesce(public.jtext(o.raw_payload->'BASICSHIPVESSELNO'), ''))     as vessel_no,
             lower(btrim(coalesce(public.jtext(o.raw_payload->'ISCANCELLED'), '')))    as cancelled,
             lower(btrim(coalesce(public.jtext(o.raw_payload->'ISDELETED'), '')))      as deleted
    ) x
    -- The delivery notes, flattened out of INVOICEDELNOTES.LIST (see the header for its three
    -- shapes). An aggregate over zero rows still returns one row of NULLs, so a voucher with no
    -- note is never dropped here — it simply gets NULL in both columns.
    cross join lateral (
      select string_agg(nullif(btrim(public.jtext(note->'BASICSHIPDELIVERYNOTE')), ''), ', ' order by ord) as dn_no,
             string_agg(nullif(btrim(public.jtext(note->'BASICSHIPPINGDATE')), ''),     ', ' order by ord) as dn_date,
             -- Tally sometimes leaves a half-typed date in the field; to_date would raise on it and
             -- take the whole book's fill down, so a date is only formatted when it is a clean YYYYMMDD.
             string_agg(case when btrim(public.jtext(note->'BASICSHIPPINGDATE')) ~ '^\d{8}$'
                             then to_char(to_date(btrim(public.jtext(note->'BASICSHIPPINGDATE')), 'YYYYMMDD'), 'DD-MM-YYYY')
                        end, ', ' order by ord) as dn_date_display
        from jsonb_array_elements(
               case jsonb_typeof(o.raw_payload->'INVOICEDELNOTES.LIST')
                 when 'array'  then o.raw_payload->'INVOICEDELNOTES.LIST'
                 when 'object' then jsonb_build_array(o.raw_payload->'INVOICEDELNOTES.LIST')
                 else '[]'::jsonb
               end) with ordinality as d(note, ord)
    ) dn
   where o.tenant_id   = p_tenant
     and o.object_type = 'Voucher'
     and not o.is_deleted
     and x.vch_date >= v_from
     and x.cancelled not in ('yes', 'true')
     and x.deleted   not in ('yes', 'true')
     -- Only vouchers that actually carry a despatch block. See the note on the table.
     and (dn.dn_no is not null or dn.dn_date is not null or x.doc_no <> ''
          or x.shipped_by <> '' or x.destination <> '' or x.vessel_no <> '')
  on conflict (tenant_id, voucher_guid) do update
    set vch_date                   = excluded.vch_date,
        party                      = excluded.party,
        voucher_no                 = excluded.voucher_no,
        voucher_type               = excluded.voucher_type,
        delivery_note_no           = excluded.delivery_note_no,
        delivery_note_date         = excluded.delivery_note_date,
        delivery_note_date_display = excluded.delivery_note_date_display,
        despatch_doc_no            = excluded.despatch_doc_no,
        despatch_through           = excluded.despatch_through,
        destination                = excluded.destination,
        vehicle_no                 = excluded.vehicle_no,
        built_at                   = now();

  get diagnostics n = row_count;
  return n;
end;
$function$;

-- NOT callable from the browser. It rewrites a whole FY for a book and has no rate limit of its
-- own, and the anon key ships in the page bundle — so granting it would let anyone loop it.
-- Postgres grants EXECUTE to PUBLIC on every new function, and Supabase's default privileges add
-- anon/authenticated on top, so this has to be an explicit revoke, not merely an absent grant.
-- The browser goes through rpt_sales_despatch_refresh_company() below instead.
revoke execute on function public.rpt_sales_despatch_fill(text, text) from public, anon, authenticated;


-- ------------------------------------------------- the browser's manual refresh --
-- The Sales Register screen's Refresh button calls this straight after
-- rpt_sales_register_refresh_company, so a manual refresh brings the despatch block with it
-- instead of waiting for the poll. Same guard rails as that function: one fill per book at a time,
-- and a 60-second cooldown per book. Its log row advances the poll's staleness marker too, which
-- is correct — the book is fresh.

create or replace function public.rpt_sales_despatch_refresh_company(p_tenant text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '0'
as $function$
declare
  v_last timestamptz;
  v_wait integer;
  n      integer;
  t0     timestamptz := clock_timestamp();
begin
  if not pg_try_advisory_xact_lock(hashtext('rpt_sales_despatch:' || p_tenant)) then
    return jsonb_build_object('status', 'busy');
  end if;

  select max(l.ran_at) into v_last
    from public.rpt_sales_despatch_refresh_log l
   where l.tenant_id = p_tenant and l.source = 'manual';
  if v_last is not null and v_last > now() - interval '60 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '60 seconds' - now())))::int;
    return jsonb_build_object('status', 'cooldown', 'retry_after_seconds', v_wait);
  end if;

  n := coalesce(public.rpt_sales_despatch_fill(p_tenant, null), 0);
  insert into public.rpt_sales_despatch_refresh_log (tenant_id, row_count, seconds, source)
  values (p_tenant, n, round(extract(epoch from (clock_timestamp() - t0))::numeric, 1), 'manual');
  return jsonb_build_object('status', 'ok', 'rows', n,
                            'seconds', round(extract(epoch from (clock_timestamp() - t0))::numeric, 1));
exception when others then
  return jsonb_build_object('status', 'error', 'message', sqlerrm);
end;
$function$;

revoke execute on function public.rpt_sales_despatch_refresh_company(text) from public, authenticated;
grant  execute on function public.rpt_sales_despatch_refresh_company(text) to anon;


-- ------------------------------------------------------- the after-sync poll --
-- Same shape as rpt_sales_register_refresh_if_stale(): rebuild only the books whose Tally sync is
-- newer than their last fill, and let an errored attempt advance the marker so a persistently
-- failing book cannot write an error row every five minutes.

create or replace function public.rpt_sales_despatch_refresh_if_stale()
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
  if not pg_try_advisory_xact_lock(hashtext('rpt_sales_despatch:if_stale')) then
    return 'another poll is running; skipped';
  end if;

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
             (select max(l.ran_at) from public.rpt_sales_despatch_refresh_log l
               where l.tenant_id = s.tenant_id), '-infinity'::timestamptz)
     order by s.last_sync_at
  loop
    t1 := clock_timestamp();
    begin
      n := coalesce(public.rpt_sales_despatch_fill(r.tenant_id, v_fyfrom), 0);
      rebuilt := rebuilt + 1;
      rows_n  := rows_n + n;
      books   := books || case when books = '' then '' else ', ' end
                        || split_part(split_part(r.tenant_id, '::', 2), '-', 1);
      insert into public.rpt_sales_despatch_refresh_log (tenant_id, fy_from, row_count, seconds, source)
      values (r.tenant_id, v_fyfrom, n,
              round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), 'sync');
    exception when others then
      insert into public.rpt_sales_despatch_refresh_log (tenant_id, fy_from, seconds, error, source)
      values (r.tenant_id, v_fyfrom,
              round(extract(epoch from (clock_timestamp() - t1))::numeric, 1), sqlerrm, 'sync');
    end;
  end loop;

  if rebuilt = 0 then
    return 'up to date; skipped';
  end if;

  secs := round(extract(epoch from (clock_timestamp() - t0))::numeric, 1);
  return format('filled %s book(s) [%s], %s rows in %ss', rebuilt, books, rows_n, secs);
end;
$function$;

-- Cron-only. Same reasoning as the revoke on rpt_sales_despatch_fill.
revoke execute on function public.rpt_sales_despatch_refresh_if_stale() from public, anon, authenticated;

-- `cron.schedule` upserts by name, so re-running this file is safe. Offset two minutes off the
-- register's own `*/5` so the two polls do not contend for the same books at the same instant.
select cron.schedule(
  'rpt-sales-despatch-after-sync',
  '2-59/5 * * * *',
  $$ set statement_timeout='30min';
     select public.rpt_sales_despatch_refresh_if_stale(); $$
);


-- ------------------------------------------------------------- first backfill --
-- Run ONCE after applying, to populate the current FY for every live book without waiting for the
-- next Tally sync. Takes a few seconds per book.
--
--   select b.tenant_id,
--          public.rpt_sales_despatch_fill(b.tenant_id) as rows
--     from (select distinct tenant_id from public.v_company) b;


-- ---------------------------------------------------------------- verify --
--
-- 1) Rows landed, and every stored row really carries something:
--
--   select count(*) as vouchers,
--          count(delivery_note_no)  as with_delivery_note,
--          count(despatch_through)  as with_despatch_through,
--          count(destination)       as with_destination
--     from public.rpt_sales_despatch;
--
-- 2) The join the app makes actually hits. `matched` should be a large fraction of `lines`;
--    it will never be all of them, because vouchers with an empty despatch block are not stored:
--
--   select count(*) as lines, count(d.voucher_guid) as matched
--     from public.rpt_sales_register r
--     left join public.rpt_sales_despatch d
--       on d.tenant_id = r.tenant_id and d.voucher_guid = r.voucher_guid
--    where r.vch_date between '20260401' and '20260930';
--
-- 3) Spot-check one voucher against Tally's own Voucher Register:
--
--   select voucher_no, delivery_note_no, delivery_note_date_display,
--          despatch_doc_no, despatch_through, destination
--     from public.rpt_sales_despatch
--    where voucher_no in ('SPARE/26-27/919', 'SPARE/26-27/929', 'SPARE/26-27/917')
--    order by voucher_no;
--   -- expect, per Tally's Voucher Register:
--   --   SPARE/26-27/917 | (null)          | (null)     | (null) | DTDC       | HYDERABAD
--   --   SPARE/26-27/919 | SP/SOA/2627/139 | 06-08-2026 | (null) | NAREN BHAI | SURAT
--   --   SPARE/26-27/929 | SP/SOA/2627/149 | 10-08-2026 | (null) | Cargo      | Tamilnadu
