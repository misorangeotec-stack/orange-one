-- Sale type — PAPER becomes a product line of its own.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb, tenant acct_orange), NOT the
--    Orange One identity project. Runs in the ConnectWave SQL editor.
--
-- ✅ ALREADY APPLIED 2026-08-21 (bucket `paper`, rule ids 44–45, snapshot rebuilt). This file is the
--    version-controlled record of what is live. Re-running is a no-op.
--
-- ─── WHY ───────────────────────────────────────────────────────────────────────────────────────
--
-- Follow-on from `sale_type_rules_spare_head_prefixes.sql`, which fixed SPARE/ and HEAD/ and left
-- PAPER/ in Other pending a business call. It is the largest thing still misfiled — 117 open bills,
-- ₹1.05 Cr — and Tally already treats it as its own line with a dedicated voucher type
-- ('GST SALES-PAPER', 92 vouchers in FY 26-27, series PAPER/*). **Ritesh Bhai, 2026-08-21: give it
-- its own category.** So this is not a reclassification into an existing bucket; it is a NEW
-- product line, and the frontend gains a `paper` member everywhere it enumerates sale types.
--
-- ─── TWO RULES, NOT ONE — they cover the two different paths ───────────────────────────────────
--
--   voucher_no_prefix 'PAPER/'          → the OPEN-BILL path. `collection_refresh()` calls
--                                         resolve_sale_type(acct, '', bill_ref) with the voucher
--                                         type EMPTY, so a prefix rule is the only kind that can
--                                         fire there. This is what moves the 117 outstanding bills.
--   voucher_type 'GST SALES-PAPER'      → the SALES path, which does pass the real voucher type.
--                                         Without it, paper SALES would keep reporting as Other
--                                         while paper OUTSTANDING read correctly — the exact
--                                         split-brain the SPARE/HEAD file documents.
--
-- ⚠ NOT ruled, on purpose: 'OTPL/' and 'NOTPL/'. OTPL/ is 'DELIVERY CHALLAN-PAPER' — a challan, not
--   a sale, so it raises no bill. NOTPL/ has two open bills (₹5.10 L) and no matching voucher
--   anywhere in the mirror; the name *looks* like N + OTPL (a Nashik paper challan) but that is a
--   guess, and guessing is what put SPARE/ in Other for a year. Leave it for Ritesh Bhai.
--
-- ─── SORT ORDER ────────────────────────────────────────────────────────────────────────────────
--
-- `paper` takes sort_order 6, after the existing five (ink 1 … other 5), rather than slotting in at
-- 2 beside ink. The repo rule is additive-only, and renumbering the others to make room would
-- rewrite live rows for a field that is cosmetic here — resolve_sale_type only reads sort_order to
-- break ties among `is_default` buckets, and there is exactly one of those. READING order on screen
-- is the frontend's `SALE_TYPE_ORDER`, where paper does sit next to ink (both are consumables).

-- ── 1. The bucket ──────────────────────────────────────────────────────────────────────────────
-- Must exist before the rules: sale_type_rule has a composite FK (tenant_id, sale_type).
-- report_as_sales defaults true, which is right — paper IS a product sale, unlike non_product.
insert into public.sale_type (tenant_id, code, label, is_default, sort_order, is_active)
select st.tenant_id, 'paper', 'Paper', false, 6, true
from (select distinct tenant_id from public.sale_type) st
on conflict (tenant_id, code) do nothing;

-- ── 2. The rules ───────────────────────────────────────────────────────────────────────────────
insert into public.sale_type_rule
  (tenant_id, rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
select st.tenant_id, r.rule_kind, r.match_value, r.sale_type, r.match_mode, r.case_sensitive,
       r.priority, r.notes
from (select distinct tenant_id from public.sale_type) st
cross join (values
  ('voucher_no_prefix', 'PAPER/',          'paper', 'prefix', false, 10,
     'Current paper series (ORANGE O TEC) — GST SALES-PAPER. Types the OPEN-bill path, which sees no voucher.'),
  ('voucher_type',      'GST SALES-PAPER', 'paper', 'exact',  true,  20,
     'Paper sales voucher. Types the sales path, which does see the voucher type.')
) as r(rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
where exists (
  select 1 from public.sale_type s
   where s.tenant_id = st.tenant_id and s.code = r.sale_type and s.is_active
)
on conflict do nothing;

-- ── Verify ─────────────────────────────────────────────────────────────────────────────────────
-- Expected, top to bottom: paper, paper, other, other, ink, spare_parts.
-- Rows 3-4 are the controls that must NOT move — a delivery challan and the unidentified series.
select v.bill_ref,
       public.resolve_sale_type('acct_orange', '', v.bill_ref) as sale_type
from (values
  ('PAPER/26-27/12'), ('PAPER/25-26/3'), ('OTPL/001'), ('NOTPL/26-27/73'),
  ('INK/26-27/1'), ('SPARE/26-27/384')
) as v(bill_ref);
-- And the voucher-type path (expected: paper):
-- select public.resolve_sale_type('acct_orange', 'GST SALES-PAPER', 'XYZ/1');

-- ── Then rebuild ───────────────────────────────────────────────────────────────────────────────
--   select public.collection_refresh();
-- See the ⚠ in sale_type_rules_spare_head_prefixes.sql: over the REST API this always returns 504
-- (2.5 min job, 2 min gateway cap) and commits anyway. In the SQL editor it simply runs.

-- ── Rollback ───────────────────────────────────────────────────────────────────────────────────
-- Deactivate the rules first (the bucket cannot go while rules reference it), then the bucket.
-- Bills fall back to 'other', which is where they were before.
-- update public.sale_type_rule set is_active = false
--  where tenant_id = 'acct_orange' and sale_type = 'paper';
-- update public.sale_type set is_active = false
--  where tenant_id = 'acct_orange' and code = 'paper';
-- select public.collection_refresh();
--
-- ⚠ The frontend must roll back WITH it, or `paper` disappears from the data while the UI still
--   offers a Paper filter that can only ever return nothing.
