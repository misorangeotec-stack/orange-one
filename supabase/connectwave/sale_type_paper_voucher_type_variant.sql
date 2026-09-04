-- Sale type — the SECOND spelling of the paper sales voucher.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb, tenant acct_orange), NOT the
--    Orange One identity project. Runs in the ConnectWave SQL editor.
--
-- Follow-on from `sale_type_paper_bucket.sql`, which created the `paper` bucket and two rules
-- (ids 44-45). Rule 45 types the SALES path and matches exactly one string: 'GST SALES-PAPER'.
-- Tally carries the same voucher type under a second spelling in a second book, and that book's
-- paper sales therefore still report as **Other**.
--
-- ─── THE TWO SPELLINGS, READ OFF THE LIVE MIRROR ───────────────────────────────────────────────
--
-- `v_voucher_type_nature` (the same view the resolver and the frontend classify from) holds three
-- sales-side paper rows, in three different company books:
--
--   'GST SALES-PAPER'    chain -> GST SALES            COLORIX DIGITAL PRINTING SOLUTIONS LLP
--   'GST SALES-PAPER'    chain -> Sales Accounts-HSS   ORANGE O TEC PRIVATE LIMITED (01-04-25..27)
--   'GST SALES - PAPER'  chain -> Sales                ORANGE O TEC PRIVATE LIMITED-NOIDA (1-Apr-25)
--                        ^^^^^^^ spaces on BOTH sides of the dash
--
-- ⚠ WORKLIST.md (RC-7) recorded this variant as 'GST SALES- PAPER' — one space, AFTER the dash.
--   That string does not exist in the mirror. Rule 45 is `match_mode = 'exact'` and
--   `case_sensitive = true`, so inserting the work list's version verbatim would have added a row
--   that can never fire and left the bug exactly where it was, while reading as fixed. The value
--   below is copied from `v_voucher_type_nature`, not retyped.
--
-- This is not a new failure mode — it is the same one already handled for spare parts, where ids 24
-- and 25 carry 'GST SALES - SPARE PARTS' and 'GST SALE- SPARE PARTS' as two separate rows. Tally
-- spells a voucher type per book, and the resolver matches literally.
--
-- ─── SCOPE: SALES ONLY. OPEN BILLS ARE ALREADY CORRECT ─────────────────────────────────────────
--
-- `collection_refresh()` types an open bill with the voucher type passed EMPTY
-- (`resolve_sale_type(acct, '', bill_ref)`), so on that path every `voucher_type` rule is dead code
-- and only `voucher_no_prefix 'PAPER/'` (rule 44) fires. Outstanding paper is therefore unaffected
-- by this file, in either direction. What is broken today is the other half: paper SALES on the
-- NOIDA book resolve to Other while paper OUTSTANDING reads correctly — the split-brain
-- `sale_type_rules_spare_head_prefixes.sql` documents.
--
-- ─── NO REFRESH NEEDED, AND THAT IS THE POINT ──────────────────────────────────────────────────
--
-- `collection_invoice_snapshot` stores no voucher type, so nothing in it can change. The sales
-- figures are resolved at read time — `connectwaveFetcher` fetches `sale_type_rule` and applies it
-- in the browser, and `v_sales_voucher` is a view, not a snapshot. So this takes effect on the next
-- page load. Do NOT run `collection_refresh()` for it; it would be 2.5 minutes of work for no
-- change.

-- ── The rule ───────────────────────────────────────────────────────────────────────────────────
-- Same shape as rule 45, same priority. Added for every tenant already carrying the `paper` bucket,
-- which is what keeps the composite FK (tenant_id, sale_type) -> sale_type (tenant_id, code)
-- satisfied. `on conflict do nothing` against `sale_type_rule_uniq`, so re-running is a no-op.
insert into public.sale_type_rule
  (tenant_id, rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
select st.tenant_id, r.rule_kind, r.match_value, r.sale_type, r.match_mode, r.case_sensitive,
       r.priority, r.notes
from (select distinct tenant_id from public.sale_type) st
cross join (values
  ('voucher_type', 'GST SALES - PAPER', 'paper', 'exact', true, 20,
     'Second spelling of the paper sales voucher (spaces both sides of the dash), used by the ORANGE O TEC NOIDA book. Companion to GST SALES-PAPER; same pattern as the two SPARE PARTS spellings, ids 24-25.')
) as r(rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
where exists (
  select 1 from public.sale_type s
   where s.tenant_id = st.tenant_id and s.code = r.sale_type and s.is_active
)
on conflict do nothing;

-- ── Verify 1: no THIRD spelling has appeared ───────────────────────────────────────────────────
-- Run this FIRST if any time has passed since 2026-08-21. Every sales-side row it returns must be
-- covered by a rule below; a new book can introduce a new spelling at any sync.
--   select distinct voucher_type, chain
--     from public.v_voucher_type_nature
--    where voucher_type ilike '%PAPER%'
--    order by voucher_type;
-- Expected sales-side today: 'GST SALES-PAPER' (x2 books), 'GST SALES - PAPER' (x1).
-- The rest are purchases, challans and orders, and must NOT be ruled:
--   GST PURCHASE - PAPER, GST PURCHASE-PAPER, DELIVERY CHALLAN-PAPER,
--   PROFORMA INVOICE - PAPER, Purchase Order-Paper, PURCHASE OREDR-IMPORT-PAPER ROLL.

-- ── Verify 2: the resolver's answer on both spellings ──────────────────────────────────────────
-- Expected, top to bottom: paper, paper, other, other.
-- Rows 3-4 are the controls that must NOT move — a purchase and a challan are not sales.
select v.voucher_type,
       public.resolve_sale_type('acct_orange', v.voucher_type, 'XYZ/1') as sale_type
from (values
  ('GST SALES-PAPER'),
  ('GST SALES - PAPER'),
  ('GST PURCHASE - PAPER'),
  ('DELIVERY CHALLAN-PAPER')
) as v(voucher_type);

-- ── Verify 3: open bills did not move ──────────────────────────────────────────────────────────
-- Expected: paper, paper, other. Unchanged before and after this file — proof that the open-bill
-- path never saw it.
select v.bill_ref,
       public.resolve_sale_type('acct_orange', '', v.bill_ref) as sale_type
from (values ('PAPER/126/25-26'), ('PAPER/26-27/12'), ('OTPL/001')) as v(bill_ref);

-- ── Rollback ───────────────────────────────────────────────────────────────────────────────────
-- Deactivate rather than delete, matching how the other rules roll back. NOIDA paper sales fall
-- back to 'other', which is where they are today.
-- update public.sale_type_rule set is_active = false
--  where tenant_id = 'acct_orange'
--    and rule_kind = 'voucher_type' and match_value = 'GST SALES - PAPER';
--
-- The frontend needs NO matching rollback: `paper` already exists as a bucket and stays populated
-- from rule 44 and rule 45 either way. Unlike the bucket file, this one is safe to reverse alone.
