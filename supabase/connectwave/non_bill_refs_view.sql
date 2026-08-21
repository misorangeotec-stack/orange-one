-- A bill reference raised by a MONEY voucher is not a bill.  (RC-7)
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb), NOT the Orange One identity
--    project. Runs in the ConnectWave SQL editor.
--
-- ⚠️ APPLY THIS **BEFORE** THE FRONTEND THAT READS IT GOES LIVE. The reader fails soft — a missing
--    view logs a warning and changes nothing — so the wrong order is not fatal, it just means the
--    fix quietly does nothing until this lands.
--
-- ─── WHAT AND WHY ──────────────────────────────────────────────────────────────────────────────
--
-- VAMA showed "1 open past-due bill": ref `ADV`, ₹17.00 L pending, Due Days 25, Received −₹8.50 L.
-- It is not a bill. Two real RTGS payments went OUT to VAMA on 27-07-2026 (₹8.5 L each, AXIS CC
-- A/C, different UTRs) and both were tagged in Tally to a reference literally named `ADV` — the
-- first as `New Ref`, the second as `Agst Ref`. An `Agst Ref` is meant to CLEAR a reference, so it
-- should carry the opposite sign; both were Dr, so the second doubled the reference instead of
-- clearing it. `bill_outstanding()` reports `amount` = the New Ref only and `pending` = the whole
-- reference, and the report shows `received = amount − pending` — hence the negative.
--
-- Tally is not being corrected (Ritesh Bhai, 2026-08-21), so the report has to recognise the shape.
--
-- ─── THE RULE, AND WHY IT IS THIS ONE ──────────────────────────────────────────────────────────
--
-- NOT the reference NAME. `ADV`, `M/C ADV`, `On Account`, `TDS` — name-matching is a guess, and a
-- wrong guess HIDES REAL MONEY, which is the worse of the two failure directions.
--
-- The voucher type that raised the reference is a fact. But the DIRECTION of the test matters, and
-- the dry run proved the obvious direction wrong:
--
--   ✗ "keep only what a SALES voucher raised, drop the rest" — would have removed 72 bills,
--     ₹1.66 Cr, of which ₹76 L was real: 60 paper invoices (₹63.78 L) purely because the voucher
--     type 'GST SALES- PAPER' is MISSING from v_voucher_type_nature, plus 5 genuine debit notes
--     (₹12.29 L). The classifier has holes and a drop-by-default rule reads a hole as "not a sale".
--
--   ✓ "drop ONLY what a MONEY voucher raised" — Receipt / Payment / Contra move cash and cannot
--     raise a receivable. Everything else stays, including anything unclassifiable.
--     DEFAULT = KEEP = never hide money.
--
-- ⚠ THE VIEW IS ONLY HALF THE RULE. It answers "was this reference raised by cash?", which is true
--   of DEBITS and CREDITS alike — and only the debits are phantoms. Of the 30 snapshot references
--   this view matches, 19 are CREDITS totalling −₹94,02,878 (`M/C ADV`, `REC 20.06.2026`,
--   `ON ACCOUNT` …): advances the customer genuinely PAID US. Dropping those would raise 17
--   customers' Outstanding by ₹94 L and un-credit money sitting in our bank. The reader
--   (`liveNonBillRefs.ts`) therefore acts on `pending > 0` ONLY. Any new consumer must do the same.
--
-- ✅ APPLIED to ConnectWave 2026-08-21. Verified against the live view, through the ANON key the
--    app actually uses (850 view rows; 49 of them match a snapshot bill):
--   bills removed              : 14 · ₹1,22,07,282 off Outstanding · 14 customers
--   of those, past due         : 10 · ₹1,01,34,928 off Overdue
--   credits matched but KEPT   : 35 · −₹1,91,49,520
--   customers whose O/S rises  : 0 (impossible by construction — only debits are removed)
--   sales-raised references    : none anywhere in the view
--   paper invoices removed     : 0 of 116
--   every removal raised by    : BANK RECEIPT / BANK PAYMENT / BANK PAYMENT-CHQ.R
--
-- ─── THREE THINGS THAT LOOK LIKE DETAILS AND ARE NOT ───────────────────────────────────────────
--
-- 1. `money_types` ignores tenant_id ON PURPOSE. 'BANK PAYMENT' resolves to chain
--    ["BANK PAYMENT","Payment"] in most books but bare ["BANK PAYMENT"] in one, so a per-tenant
--    match would MISS that book — including VAMA's. Matching the name across all books is what
--    makes the live result equal the dry run. A voucher type named the same in two books is the
--    same kind of voucher.
--
-- 2. `having bool_and(...)` — EVERY New Ref on a reference must be a money voucher before it is
--    excluded. A reference a sales invoice raised and a receipt later added to is still a bill.
--    This is why `all_refs` re-reads the candidates' ledgers in full rather than reusing `cand`:
--    `cand` only sees the money-voucher rows, so bool_and over it would be trivially true and
--    every mixed reference would be wrongly dropped.
--
-- 3. `cand` filters on voucher_type BEFORE the lateral unnest, and `all_refs` narrows to
--    `cand`'s ledgers. Unnesting all ~268,700 voucher lines to find ~7 answers is the slow way;
--    this touches a few hundred ledgers.
-- 4. The unnest is written out TWICE rather than shared in one `alloc` CTE. A CTE referenced by two
--    others is materialised, which would unnest all ~268,700 voucher lines on every read; written
--    inline, each copy keeps its own predicate — `cand` filters on voucher_type and `all_refs` on
--    `cand`'s ledgers — so both touch a few hundred ledgers instead.
--
-- 5. `is_money` is computed as a column in `all_refs`, not as `bool_and(… in (select …))` in the
--    HAVING. Keeping the sublink out of the aggregate's argument avoids relying on a corner of the
--    grammar, and it reads better.
--
-- SECURITY NOTE: `tally_voucher_line` is RLS-locked to service_role. A plain view runs with its
-- OWNER's rights, so creating this as `postgres` is what lets `anon` read the seven-row RESULT
-- without gaining access to the raw voucher table. That is deliberate — the same posture as
-- `collection_invoice_snapshot` and `v_voucher_type_nature`, which anon already reads. Do NOT add
-- `with (security_invoker = on)`: the view would return nothing to anon and the fix would silently
-- do nothing, which is this file's worst failure mode.
create or replace view public.v_non_bill_ref as
with money_types as (
  -- Vouchers that MOVE CASH. Read off the parent chain, never off the name — 'BANK RECIPT'
  -- (Tally's own typo) and 'BANK PAYMENT-CHQ.R' both classify correctly this way.
  select distinct upper(voucher_type) as voucher_type
  from public.v_voucher_type_nature
  where chain && array['Receipt', 'Payment', 'Contra']::text[]
),
cand as (   -- references with at least one money-raised New Ref (cheap pre-filter, see note 3)
  select distinct l.tenant_id, l.ledger_guid, nullif(b ->> 'NAME', '') as bill_ref
  from public.tally_voucher_line l
  -- allocs mirrors BILLALLOCATIONS.LIST verbatim: an ARRAY, a bare OBJECT (single allocation), or
  -- an empty STRING. All three must be normalised — the trap documented in ledger_bill_allocs_by_id.
  cross join lateral jsonb_array_elements(
    case jsonb_typeof(l.allocs)
      when 'array'  then l.allocs
      when 'object' then jsonb_build_array(l.allocs)
      else '[]'::jsonb
    end) as b
  where not l.is_cancelled and not l.is_optional
    and upper(l.voucher_type) in (select voucher_type from money_types)
    and b ->> 'BILLTYPE' ilike 'New Ref%'
    and nullif(b ->> 'NAME', '') is not null
),
all_refs as (   -- EVERY New Ref on those references, money or not (see note 2)
  select l.tenant_id, l.ledger_guid, nullif(b ->> 'NAME', '') as bill_ref, l.voucher_type,
         (upper(l.voucher_type) in (select voucher_type from money_types)) as is_money
  from public.tally_voucher_line l
  cross join lateral jsonb_array_elements(
    case jsonb_typeof(l.allocs)
      when 'array'  then l.allocs
      when 'object' then jsonb_build_array(l.allocs)
      else '[]'::jsonb
    end) as b
  where not l.is_cancelled and not l.is_optional
    and l.ledger_guid in (select ledger_guid from cand)
    and b ->> 'BILLTYPE' ilike 'New Ref%'
    and nullif(b ->> 'NAME', '') is not null
)
select r.tenant_id,
       r.ledger_guid as ledger_id,
       r.bill_ref,
       min(r.voucher_type) as origin_voucher_type
from all_refs r
group by r.tenant_id, r.ledger_guid, r.bill_ref
having bool_and(r.is_money);

comment on view public.v_non_bill_ref is
  'RC-7: bill references whose EVERY New Ref was raised by a cash voucher (Receipt/Payment/Contra). '
  'These are advances and on-account movements, not bills. The receivables report drops them from '
  'Outstanding and Overdue. Default is KEEP — anything unclassifiable is absent from this view.';

-- The receivables frontend reads ConnectWave with the ANON key, same as every other view it uses.
grant select on public.v_non_bill_ref to anon, authenticated;

-- ── Verify ─────────────────────────────────────────────────────────────────────────────────────
-- Expect VAMA's ADV (BANK PAYMENT) present, and nothing a sales voucher raised.
-- select * from public.v_non_bill_ref order by bill_ref;
--
-- The exact rupees leaving the report — expect 7 rows, Rs 89,98,378:
-- select i.bill_ref, i.pending, n.origin_voucher_type
--   from public.collection_invoice_snapshot i
--   join public.v_non_bill_ref n
--     on n.ledger_id = i.ledger_id and n.bill_ref = i.bill_ref
--  where i.pending > 0 and i.overdue_days > 0
--  order by i.pending desc;
--
-- Guard — must return ZERO rows. Anything a sales voucher raised must never appear here:
-- select * from public.v_non_bill_ref where origin_voucher_type ilike '%SALE%';

-- ── Rollback ───────────────────────────────────────────────────────────────────────────────────
-- The view is additive and read-only; nothing depends on it in the database. Dropping it makes the
-- frontend fail soft (it logs a warning and changes nothing), so the report simply returns to
-- today's behaviour.
-- drop view if exists public.v_non_bill_ref;
