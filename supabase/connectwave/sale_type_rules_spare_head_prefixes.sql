-- Sale type — the missing bill-name prefixes for SPARE / HEAD.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb, tenant acct_orange), NOT the
--    Orange One identity project. The repo's `supabase/migrations/` + `supabase db push` target the
--    identity project — this one runs in the ConnectWave SQL editor, the same way
--    `rpt_sales_register_after_sync.sql` did.
--
-- ✅ ALREADY APPLIED 2026-08-21 (rule ids 40–43, snapshot rebuilt 08:29 UTC). This file is the
--    version-controlled record of what is live. Re-running is a no-op.
--
--    Measured after the rebuild: spare_parts 74 → 731 bills · head 138 → 208 · machine 385 → 386 ·
--    other 1,219 → 491. No SPARE/ or HEAD/ bill is typed 'other' any more, and INK/, HD/HG/ and
--    HG/SPARE/ were re-checked unchanged.
--
-- ⚠ RUNNING THE REBUILD OVER THE REST API ALWAYS "FAILS". `collection_refresh()` takes ~2.5 min and
--   Supabase's HTTP gateway cuts the response at 2 min, so `POST /rest/v1/rpc/collection_refresh`
--   returns **504 — and the transaction keeps running server-side and commits anyway**. Do not
--   retry on that 504: a second call hits the `pg_try_advisory_lock(778899123)` overlap guard and
--   answers "another run in progress; skipped", which looks exactly like a stuck lock and is not
--   one. Poll `collection_meta` instead, and note `refreshed_at` is `now()` = TRANSACTION START, so
--   it stamps ~5 minutes before the new rows are actually visible.
--
-- ─── WHAT IS WRONG (2026-08-21) ────────────────────────────────────────────────────────────────
--
-- On the salesperson Collection Report ("customers with zero collection"), the per-customer bill
-- page groups every open bill by sale type. Spare-parts and print-head bills were landing in the
-- OTHER band:
--
--     HEAD/26-27/40    12-05-2026   ₹2.77 L   Other      <- is a print head
--     SPARE/26-27/384  22-05-2026   ₹0.05 L   Other      <- is a spare part
--     SPARE/EN/2627/5  24-06-2026   ₹0.03 L   Other      <- is a spare part
--
-- This is NOT a reporting bug. The report prints `collection_invoice_snapshot.sale_type` verbatim,
-- and the snapshot really does say 'other'.
--
-- ROOT CAUSE. `collection_refresh()` types an OPEN bill from its bill NAME alone — it calls
--
--     public.resolve_sale_type(v_acct, '', b.bill_ref)     -- collection_report.sql ~line 613
--                                     ^^ voucher type is passed EMPTY
--
-- because `bill_outstanding()` returns the bill ref and no voucher. So for open bills only the
-- `voucher_no_prefix` rules can ever fire; every `voucher_type` rule is dead code on this path.
-- The seeded prefix vocabulary was INK/ SP/ HD/ MC/ H/ HG/SPARE/ — five series taken off the
-- OPENING bills, back when that was the only case this had to cover. ORANGE O TEC and ORANGE
-- ENTERPRISE number their current sales SPARE/… , SPARE/EN/… and HEAD/… , none of which is in that
-- list, so all of them fell through to the 'other' default.
--
-- Note the contradiction this leaves inside one snapshot row: FY SALES by type are resolved from the
-- real voucher type (`resolve_sale_type(v_acct, t.voucher_type, t.voucher_no)`), so the same
-- customer can show spare-parts SALES and zero spare-parts OUTSTANDING.
--
-- ─── WHY PREFIX RULES ARE THE RIGHT FIX HERE, NOT A PATCH ──────────────────────────────────────
--
-- Tally numbers each voucher type on its own series, so the bill-name prefix carries the voucher
-- type. Checked against every voucher in `rpt_sales_register` (22,070 lines, FY 26-27, all
-- companies) — no prefix maps to two different sale types:
--
--     SPARE/      -> GST SALES - SPARE PARTS    ×1296   (ORANGE O TEC / BRANCH / RELATED)
--     SPARE/EN/   -> GST SALE- SPARE PARTS      ×8      (ORANGE ENTERPRISE / ENT BRANCH)
--     HEAD/       -> GST SALES - HEAD           ×128    (all four books)
--     HEAD/M/     -> GST SALES - HEAD(MACHINE)  ×1
--
-- and each of those voucher types already has a `voucher_type` rule pointing at the same bucket, so
-- these rows only teach the OPEN-BILL path what the voucher path already knew. As a bonus they also
-- type the handful of OPENING bills on these series, which no voucher lookup could ever reach.
--
-- ⚠ HEAD/M/ IS LOAD-BEARING, not tidiness. 'HEAD/M/24-25/11' (₹16.52 L) is a MACHINE deal. It is an
--   OPENING balance, so its own voucher is before the mirror's history — but the series is confirmed
--   by the FY 26-27 voucher on it, 'GST SALES - HEAD(MACHINE)' — which is the whole reason a prefix
--   rule can answer for a bill no voucher lookup could reach. Adding HEAD/ without HEAD/M/ would
--   move that bill out of Other and into Head — one wrong answer traded for another.
--   `resolve_sale_type` breaks a priority tie on
--   `length(match_value) desc`, so HEAD/M/ (7 chars) beats HEAD/ (5) and SPARE/EN/ (9) beats
--   SPARE/ (6) without needing distinct priorities. Same mechanism that already makes HG/SPARE/
--   beat HD/.
--
-- ─── WHAT THIS MOVES (measured against the live snapshot, refreshed 2026-08-21 10:30 IST) ──────
--
--     SPARE/      654 open bills   ₹2,18,40,030 pending   other -> spare_parts
--     HEAD/        70 open bills   ₹2,10,73,297 pending   other -> head
--     SPARE/EN/     3 open bills   ₹      4,976 pending   other -> spare_parts
--     HEAD/M/       1 open bill    ₹  16,52,000 pending   other -> machine
--
-- Not touched by this file, deliberately — each needs a call of its own and none is in the report
-- that raised this:
--     PAPER/   117 bills  ₹1.05 Cr  — 'GST SALES-PAPER'. There is no paper bucket anywhere yet.
--     SER/ SER/N/ RENT/ AMC/ JOB/   — income, but not a product line ('non_product').
--     CN/ DN/ G/SR/                 — credit notes, debit notes, sales returns: adjustments that
--                                     belong to the bill they offset, not to a product line.
--     HAND/ NOTPL/ PM/ MS/H/        — ~₹36 L, no matching voucher anywhere in the mirror.
--       HAND/ is very likely a mis-typed HEAD/ (Ritesh Bhai, 2026-08-21) and stays in Other for
--       now on his call. Deliberately NOT ruled: a rule would make the misspelling permanent and
--       leave the books wrong while the screen looked right. Fix it in Tally instead.
-- Everything else still reading 'other' is genuinely other: advances, on-account, TDS/TCS,
-- journals, round-off.
--
-- ─── HOW TO RUN ────────────────────────────────────────────────────────────────────────────────
--
--   1. Run this file in the ConnectWave SQL editor. It is idempotent (`on conflict do nothing`
--      against the `sale_type_rule_uniq` partial unique index), so re-running is safe.
--   2. Run the first verification block at the foot: it must answer spare_parts, spare_parts, head,
--      machine, other — in that order.
--   3. Rebuild the snapshot so the report picks it up:  select public.collection_refresh();
--      (Skipping this changes nothing on screen — the nightly refresh would apply it next run.)

-- ── The rules ──────────────────────────────────────────────────────────────────────────────────
-- Added for every tenant that already carries the target bucket, exactly like PART 2 of
-- collection_report.sql. Today that is the single tenant 'acct_orange'; the `exists` guard is what
-- keeps the composite FK (tenant_id, sale_type) -> sale_type (tenant_id, code) satisfied.
insert into public.sale_type_rule
  (tenant_id, rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
select st.tenant_id, r.rule_kind, r.match_value, r.sale_type, r.match_mode, r.case_sensitive,
       r.priority, r.notes
from (select distinct tenant_id from public.sale_type) st
cross join (values
  ('voucher_no_prefix', 'SPARE/',    'spare_parts', 'prefix', false, 10,
     'Current spare-parts series (ORANGE O TEC / BRANCH / RELATED) — GST SALES - SPARE PARTS.'),
  ('voucher_no_prefix', 'SPARE/EN/', 'spare_parts', 'prefix', false, 10,
     'Orange Enterprise spare series — GST SALE- SPARE PARTS. Longer than SPARE/, so it wins the tie.'),
  ('voucher_no_prefix', 'HEAD/',     'head',        'prefix', false, 10,
     'Current print-head series — GST SALES - HEAD.'),
  ('voucher_no_prefix', 'HEAD/M/',   'machine',     'prefix', false, 10,
     'HEAD/M/* is GST SALES - HEAD(MACHINE), a machine deal. MUST exist alongside HEAD/ or those bills read as Head.')
) as r(rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
where exists (
  select 1 from public.sale_type s
   where s.tenant_id = st.tenant_id and s.code = r.sale_type and s.is_active
)
on conflict do nothing;

-- ── Verify: the resolver's answer for one real bill of each series ─────────────────────────────
-- Expected, top to bottom: spare_parts, spare_parts, head, machine, other.
-- The last row is the control — 'M/C ADV' is a machine advance with no series and must stay Other.
select v.bill_ref,
       public.resolve_sale_type('acct_orange', '', v.bill_ref) as sale_type
from (values
  ('SPARE/26-27/384'),
  ('SPARE/EN/2627/5'),
  ('HEAD/26-27/40'),
  ('HEAD/M/24-25/11'),
  ('M/C ADV')
) as v(bill_ref);

-- ── Verify: what the next refresh will move ────────────────────────────────────────────────────
-- Run BEFORE `collection_refresh()`. Every row should read sale_type='other' with a non-'other'
-- `resolves_to` — that difference is exactly the correction. ~728 bills, ~₹4.46 Cr.
-- select i.sale_type,
--        public.resolve_sale_type('acct_orange', '', i.bill_ref) as resolves_to,
--        count(*), sum(i.pending)
--   from public.collection_invoice_snapshot i
--  where i.bill_ref ilike any (array['SPARE/%', 'HEAD/%'])
--  group by 1, 2
--  order by 1, 2;

-- ── Rollback ───────────────────────────────────────────────────────────────────────────────────
-- Deactivate rather than delete, so the row keeps its history and the partial unique index frees
-- the (tenant, kind, value) slot for a re-run. Then rebuild.
-- update public.sale_type_rule
--    set is_active = false
--  where tenant_id = 'acct_orange'
--    and rule_kind = 'voucher_no_prefix'
--    and match_value in ('SPARE/', 'SPARE/EN/', 'HEAD/', 'HEAD/M/');
-- select public.collection_refresh();
