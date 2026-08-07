-- ─────────────────────────────────────────────────────────────────────────────────────
-- Collection Performance report — two additions to the ConnectWave mirror.
--
--   1. collection_customer_snapshot.last_receipt_amount
--      The snapshot has always carried last_receipt_date but never the AMOUNT, so the
--      report's "Last Receipt ₹" column read "—" on every row of the Live (Tally) source
--      (lib/collections.ts hardcoded null there, because the bulk snapshot genuinely had
--      no per-voucher figure). The receipt vouchers themselves have been in
--      tally_voucher_line all along — 21,047 receipt-class lines back to Apr-2024 — so no
--      Tally refresh is needed to fill this in, only a place to put it.
--
--   2. collection_range_facts(from, to, prior_from, as_of)
--      Day-level collection facts for an ARBITRARY date range, so the report's "Custom"
--      period can mean real dates instead of whole months. Everything the report reads
--      today is monthly (collection_customer_snapshot.monthly is a month→totals jsonb),
--      which is why Custom could only ever offer month pickers.
--
-- Additive only: one nullable column, two new functions, and a single line appended to
-- collection_refresh(). No existing column, row or behaviour is changed.
-- ─────────────────────────────────────────────────────────────────────────────────────


-- ── 1. The column ────────────────────────────────────────────────────────────────────
alter table public.collection_customer_snapshot
  add column if not exists last_receipt_amount numeric;

comment on column public.collection_customer_snapshot.last_receipt_amount is
  '₹ of the voucher(s) dated last_receipt_date. Same-day receipts are summed — they make up '
  'one "last receipt". NULL when unknown; NEVER set unless the computed date agrees with '
  'last_receipt_date, so the two always describe the same voucher.';


-- ── 2. Filling it ────────────────────────────────────────────────────────────────────
-- Set-based, and deliberately NOT part of collection_refresh's per-customer loop: the loop
-- runs ~1,800 times and this is one pass. It mirrors the pipeline source's rule in
-- lib/collections.ts buildLastReceiptAmounts — newest receipt date, same-day receipts summed.
--
-- TWO THINGS THAT LOOK WRONG BUT ARE DELIBERATE:
--
--  * `l.amount > 0` selects the debtor's receipt lines. tally_voucher_line.amount is
--    Cr-POSITIVE for the party (verified: Apollo Digitex's 13-05-2026 BANK RECEIPT line is
--    +142898 with is_deemed_positive='No'). That is the INVERSE of ledger_txn_by_id, which
--    flips to Dr-positive — collection_refresh works in the flipped convention, this works
--    in the raw one. Don't "fix" one to match the other.
--
--  * No as-of cap. The mirror legitimately holds future-dated receipts (to Aug-2026 today),
--    and collection_refresh does not cap v_lastrcpt either. Capping here would desynchronise
--    the amount from the date already on screen.
--
-- The `s.last_receipt_date = d.vch_date` guard is the safety property: if the two ever
-- disagree the amount stays NULL (the cell reads "—") rather than showing a figure that
-- belongs to a different voucher. It matched 931 of 931 rows when this was written.
create or replace function public.collection_last_receipt_amount_apply()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n_set integer;
begin
  with per_day as (
    -- Aggregate FIRST, join to the snapshot after. Joining first makes the planner probe the
    -- ledger index once per customer — 5.1s instead of ~1s.
    select l.tenant_id, l.ledger_guid, l.vch_date, sum(l.amount) as amt
      from public.tally_voucher_line l
      join public.collection_voucher_class c
        on  c.tenant_id    = l.tenant_id
        and c.voucher_type = l.voucher_type
     where c.vclass = 'Receipt'
       and l.amount > 0
       and l.ledger_guid is not null
       and not l.is_cancelled
       and not l.is_optional
     group by l.tenant_id, l.ledger_guid, l.vch_date
  ),
  last_day as (
    select distinct on (p.tenant_id, p.ledger_guid)
           p.tenant_id, p.ledger_guid, p.vch_date, p.amt
      from per_day p
     order by p.tenant_id, p.ledger_guid, p.vch_date desc
  )
  update public.collection_customer_snapshot s
     set last_receipt_amount = d.amt
    from last_day d
   where d.tenant_id           = s.tenant_id
     and d.ledger_guid         = s.ledger_id
     and s.last_receipt_date   = d.vch_date;

  get diagnostics n_set = row_count;
  return n_set;
end;
$function$;

grant execute on function public.collection_last_receipt_amount_apply() to anon, authenticated, service_role;


-- ── 3. Keeping it filled ─────────────────────────────────────────────────────────────
-- collection_refresh() opens with `delete from collection_customer_snapshot where true` and
-- is driven by two cron jobs (collection_refresh_if_stale every 30 min, a full run at 01:30),
-- so a one-off backfill would be gone within the half hour. The refresh has to call this.
--
-- Patched by rewriting the function's OWN definition rather than restating 501 lines here:
-- pg_get_functiondef gives the current text verbatim, one line is inserted before the
-- advisory unlock, and the result is executed. Exact by construction, and idempotent.
-- The unlock is the right anchor — it appears exactly once, and the only early `return`
-- (line 53) fires before the lock is ever acquired, so it can't reach the new call.
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'collection_refresh';

  if v_src is null then
    raise exception 'collection_refresh() not found';
  end if;

  if position('collection_last_receipt_amount_apply' in v_src) > 0 then
    raise notice 'collection_refresh() already patched; leaving it alone';
    return;
  end if;

  v_new := replace(
    v_src,
    '  perform pg_advisory_unlock(778899123);',
    '  -- Fill last_receipt_amount for the rows just rebuilt (see collection_last_receipt_amount_apply).' || E'\n' ||
    '  perform public.collection_last_receipt_amount_apply();' || E'\n' ||
    '  perform pg_advisory_unlock(778899123);'
  );

  if v_new = v_src then
    raise exception 'anchor "perform pg_advisory_unlock(778899123);" not found — collection_refresh NOT patched';
  end if;

  execute v_new;
  raise notice 'collection_refresh() patched';
end;
$do$;


-- ── 4. Day-level facts for an arbitrary date range ───────────────────────────────────
-- Powers the report's Custom period. Returns ONE row per ledger, so ~1,800 rows and a
-- single round trip; the report then applies its own company/salesperson/category scoping
-- exactly as it does with the monthly series.
--
-- The classification below mirrors collection_refresh's voucher loop one-for-one. Two
-- deliberate agreements with the monthly path, so the two can never drift:
--
--  * `dr` flips the raw Cr-positive amount to Dr-positive, which is the convention
--    collection_refresh works in (it reads ledger_txn, which already flipped).
--
--  * `movement` uses the same formula as movementOf() in lib/collections.ts:
--        sales + debitNotes + journals − (receipts − chequeReturns) − creditNotes
--    Note there is no payments-out term. A non-CHQ.R Payment (a refund) genuinely does
--    increase the receivable, but the monthly path has never counted it and matching that
--    is the point of this function. Do not "improve" it on one side only.
--
-- Voucher types collection_voucher_class leaves unmapped (vclass is null — 303 of 488) are
-- dropped here exactly as collection_refresh drops them.
--
-- p_horizon IS NOT THE AS-OF DATE, and getting this wrong is silent. Opening balance is the
-- canonical outstanding wound BACK through mv_since_from, so the wind-back must cover every
-- voucher that outstanding already reflects. The monthly path winds back through whole month
-- buckets — including the current, part-elapsed one — so p_horizon must be the END OF THE AS-OF
-- MONTH. Capping at the as-of date instead drops the rest of this month (50 debtor lines on
-- 07-08-2026) and Opening quietly stops agreeing with the presets.
--
-- Dates are yyyymmdd text throughout, which compares correctly as text.
drop function if exists public.collection_range_facts(text, text, text, text);

create or replace function public.collection_range_facts(
  p_from       text,
  p_to         text,
  p_prior_from text,
  p_horizon    text
)
returns table (
  tenant_id           text,
  ledger_id           text,
  w_receipts          numeric,
  w_sales             numeric,
  w_credit_notes      numeric,
  w_debit_notes       numeric,
  w_journals          numeric,
  w_cheque_returns    numeric,
  prior_receipts      numeric,
  prior_sales         numeric,
  mv_since_from       numeric,
  mv_since_prior_from numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with parts as (
    select
      l.tenant_id   as t_id,
      l.ledger_guid as l_id,
      l.vch_date    as d,
      case when c.vclass = 'Sales'       and (-l.amount) > 0 then (-l.amount) else 0 end as sales,
      case when c.vclass = 'Receipt'     and (-l.amount) < 0 then  (l.amount) else 0 end as receipts,
      case when c.vclass = 'Credit Note' and (-l.amount) < 0 then  (l.amount) else 0 end as cnotes,
      case when c.vclass = 'Debit Note'  and (-l.amount) > 0 then (-l.amount) else 0 end as dnotes,
      case when c.vclass = 'Journal'                         then (-l.amount) else 0 end as journals,
      case when c.vclass = 'Payment' and (-l.amount) > 0
            and l.voucher_type ilike '%CHQ.R%'               then (-l.amount) else 0 end as chq
      from public.tally_voucher_line l
      join public.collection_voucher_class c
        on  c.tenant_id    = l.tenant_id
        and c.voucher_type = l.voucher_type
      join public.collection_customer_snapshot s
        on  s.tenant_id = l.tenant_id
        and s.ledger_id = l.ledger_guid
     where c.vclass is not null
       and l.ledger_guid is not null
       and not l.is_cancelled
       and not l.is_optional
       and l.vch_date >= least(p_from, coalesce(p_prior_from, p_from))
       and l.vch_date <= p_horizon
  ),
  moved as (
    select p.*,
           p.sales + p.dnotes + p.journals - (p.receipts - p.chq) - p.cnotes as movement
      from parts p
  )
  select
    m.t_id,
    m.l_id,
    coalesce(sum(m.receipts) filter (where m.d >= p_from and m.d <= p_to), 0),
    coalesce(sum(m.sales)    filter (where m.d >= p_from and m.d <= p_to), 0),
    coalesce(sum(m.cnotes)   filter (where m.d >= p_from and m.d <= p_to), 0),
    coalesce(sum(m.dnotes)   filter (where m.d >= p_from and m.d <= p_to), 0),
    coalesce(sum(m.journals) filter (where m.d >= p_from and m.d <= p_to), 0),
    coalesce(sum(m.chq)      filter (where m.d >= p_from and m.d <= p_to), 0),
    -- Prior window is [p_prior_from, p_from) — the day before From is its last day.
    coalesce(sum(m.receipts) filter (where p_prior_from is not null and m.d >= p_prior_from and m.d < p_from), 0),
    coalesce(sum(m.sales)    filter (where p_prior_from is not null and m.d >= p_prior_from and m.d < p_from), 0),
    -- Opening at a date = the canonical outstanding wound BACK through everything that has
    -- happened since. The report does the subtraction; this supplies the movement.
    coalesce(sum(m.movement) filter (where m.d >= p_from), 0),
    coalesce(sum(m.movement) filter (where p_prior_from is not null and m.d >= p_prior_from), 0)
  from moved m
  group by m.t_id, m.l_id;
$function$;

grant execute on function public.collection_range_facts(text, text, text, text) to anon, authenticated, service_role;


-- ── 5. Populate now, without waiting for a sync ──────────────────────────────────────
select public.collection_last_receipt_amount_apply() as rows_filled;
