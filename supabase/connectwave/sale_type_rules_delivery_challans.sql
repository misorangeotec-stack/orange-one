-- Sale type — the DELIVERY CHALLAN voucher types, plus three strays.
--
-- ⚠️ APPLY THIS TO THE CONNECTWAVE PROJECT (ieeefdnyhzgrroifiqbb, tenant acct_orange), NOT the
--    Orange One identity project. Runs in the ConnectWave SQL editor.
--
-- ─── WHY ───────────────────────────────────────────────────────────────────────────────────────
--
-- The Daily Report (DR-1) reports a day's outward movement split by product line: ink, print
-- heads, machines, spares. It classifies each `rpt_sales_register` line through the mirror's own
-- ruleset — `sale_type_rule` + `resolve_sale_type()` — rather than pattern-matching voucher names
-- in the browser, so there is one answer and it lives here.
--
-- DELIVERY CHALLANS FALL THROUGH THAT RULESET TODAY. Goods that leave on a challan rather than an
-- invoice carry a voucher type nobody has ruled, and voucher numbers (DC/HG/…, DC/INK/…, OTPL/…)
-- that match no `voucher_no_prefix` rule either. They therefore resolve to **Other**.
--
-- Measured on the live mirror, FY 2026-27, 11-09-2026 — 1,559 register lines across 16 challan
-- voucher types. One of them is visible on the client's own reference sheet: the 08-09-2026 Surat
-- report shows 17 print heads going out, being 16 on a GST SALES - HEAD -HANGLORY invoice and 1 on
-- challan DC/HG/26-27/81 (voucher type 'DELIVERY CHALLAN - HEAD-HANGLORY'). Without a rule that
-- challan is not a print head at all, and the report says 16.
--
-- ─── ⚠ THE STRINGS BELOW WERE READ OFF THE MIRROR ON 11-09-2026. DO NOT RETYPE THEM. ───────────
--
-- Rules are `match_mode = 'exact'` and `case_sensitive = true`. A rule whose match_value is one
-- character off can never fire while reading, in the catalogue, exactly like a rule that works.
-- This has already happened once here: `sale_type_paper_voucher_type_variant.sql` (21-08-2026)
-- recorded that WORKLIST.md's 'GST SALES- PAPER' "does not exist in the mirror" and inserted
-- 'GST SALES - PAPER' instead.
--
--   TODAY, 11-09-2026, THAT IS THE OTHER WAY AROUND. Both `v_voucher_type_nature` and
--   `rpt_sales_register` carry 'GST SALES- PAPER' — one space, AFTER the dash — in all three books
--   that sell paper, and carry NEITHER 'GST SALES-PAPER' (rule 45) NOR 'GST SALES - PAPER'
--   (rule 46). So both existing paper voucher_type rules are dead code and paper sales are being
--   typed solely by the `PAPER/` voucher-no prefix (rule 44), which does still fire.
--
--   Rules 45 and 46 are LEFT IN PLACE rather than deleted: they cost nothing, and if a book is
--   renamed back they simply start working again. Rule 17 below adds the spelling that is actually
--   in the data. Verify 1 is the standing check that no fourth spelling has appeared.
--
-- Two sources had to agree before anything below was written, and they do:
--   · `v_voucher_type_nature` — what `resolve_sale_type()` is asked about, and
--   · `rpt_sales_register.voucher_type` — what the Daily Report actually holds per line.
-- They are NOT guaranteed to agree in general. Check both when adding a rule.
--
-- ─── VOUCHER_TYPE RULES ONLY. NO PREFIX RULES. ─────────────────────────────────────────────────
--
-- Precedence in resolve_sale_type() is voucher_no_prefix (10) → voucher_type (20) → voucher_no
-- (30), so a prefix rule OUTRANKS every type rule. Adding 'DC/INK/' → ink would therefore override
-- the type rules on every voucher in that series — a wider blast radius than the problem.
--
-- And it would be permanently dead code on the path prefixes exist for. `collection_refresh()`
-- types an OPEN bill with the voucher type passed empty, so only prefix rules fire there — but
-- delivery challans RAISE NO BILL (`collection_voucher_class.sql` measured
-- 'DELIVERY CHALLAN-HEAD-HANGLORY' at ₹4.97 Cr with 0 of 172 lines carrying a bill allocation), so
-- the open-bill path never sees one. Type rules are the only ones that can fire, and the sales
-- path always passes a real voucher type.
--
-- ─── WHAT IS DELIBERATELY *NOT* RULED ──────────────────────────────────────────────────────────
--
--   'DELIVERY CHALLAN'                        5 lines   — bare. Could be any product line.
--   'DELIVERY CHALLAN SALES ON APPROVAL'     22 lines   — bare. Goods on approval, of anything.
--   'GST SALES - AMC'                         7 lines   — annual maintenance. Revenue, but not a
--                                                         product line, and not obviously
--                                                         non_product either. The client's call.
--   'GST SALES -  OTHER'                     10 lines   — says Other on the tin (note the double
--                                                         space; that IS the string).
--
-- For these the answer is on the STOCK ITEM, not the voucher type, and a rule here would replace a
-- missing answer with a wrong one. They continue to resolve to 'other' and the Daily Report lists
-- them, by voucher type and party, in a visible "Not yet classified" band — so they announce
-- themselves on the evening they are used instead of at the next audit.
--
-- ─── NO REFRESH NEEDED ─────────────────────────────────────────────────────────────────────────
--
-- `sale_type_rule` is read at page load and applied in the browser; `v_sales_voucher` is a view.
-- This takes effect on the next page load. Do NOT run `collection_refresh()` for it — 2.5 minutes
-- of work for no change, and it cannot alter an open bill for the reason given above.


-- ─── MEASURED BEFORE APPLYING, 11-09-2026, FY2026-27 ───────────────────────────────────────────
--
-- Only SOME of the rules below change anything today. The rest are backstops: their voucher types
-- already resolve through a voucher_no PREFIX rule, and the type rule only starts mattering if a
-- numbering series changes. Knowing which is which saves the next reader from assuming all
-- seventeen are load-bearing.
--
--   ACTUALLY UNRESOLVED (this file fixes each):
--     DELIVERY CHALLAN - INK(MACHINE)          981 lines    ₹2.48 L
--     DELIVERY CHALLAN - HEAD-HANGLORY         108 lines    ₹0.00
--     DELIVERY CHALLAN-PAPER                    42 lines    ₹1.51 L
--     GST SALES - SERVICE                       15 lines    ₹4.35 L
--     GST SERVICE-JOB WORK                       3 lines   ₹10.03 L
--     DELIVERY CHALLAN - HEAD                    2 lines    ₹0.00
--     DELIVERY CHALLAN - HEAD(M)HANGLORY         2 lines    ₹0.00
--
--   ALREADY RESOLVED by a prefix rule; the type rule is a backstop only:
--     DELIVERY - INK / - HEAD / - SPARE PARTS, DELIVERY CHALLAN - INK,
--     DELIVERY CHALLAN - SPARE PARTS, DELIVERY CHALLAN -  SPARE PARTS (MACHINE),
--     DELIVERY CHALLAN - MACHINE, DELIVERY CHALLAN - PRINT HEAD,
--     DELIVERY CHALLAN SALES ON APPROVAL - MACHINE / - SPARE PARTS, GST SALES- PAPER
--
--   LEFT UNRESOLVED ON PURPOSE — the answer is not in the voucher type:
--     TRANSFER OF OWNER SHIP                     1 line   ₹215.00 L
--     DELIVERY CHALLAN SALES ON APPROVAL BASIS  10 lines   ₹66.06 L
--     GST SALES - AMC                           10 lines   ₹21.20 L
--     DELIVERY CHALLAN SALES ON APPROVAL        16 lines    ₹8.53 L
--     GST SALES -  OTHER                         8 lines    ₹1.59 L
--     DELIVERY CHALLAN                           2 lines    ₹0.05 L
--   plus the credit notes, debit notes and returns, which are not product lines at all and are
--   handled by the document TYPE rather than by sale_type.
--
-- ⚠ THE BLAST RADIUS IS SMALL, BUT IT IS NOT ZERO. sale_type_rule is shared, so anything that
--   reports sales BY TYPE (the Outstanding Dashboard's sales views, v_sales_voucher) will move
--   ₹2.48 L of ink and ₹1.51 L of paper out of Other, and file ₹14.38 L of service income as
--   non_product. Open bills are untouched: that path passes an empty voucher type.

-- ── Verify 1: RUN THIS FIRST, and copy its output into the values list if anything differs ─────
-- Every sales-side row it returns must be covered below or listed as deliberately unruled. A new
-- book, or a rename, can introduce a new spelling at any sync.
--
--   select distinct voucher_type
--     from public.v_voucher_type_nature
--    where voucher_type ilike '%CHALLAN%' or voucher_type ilike '%DELIVERY%'
--       or voucher_type ilike '%PAPER%'   or voucher_type ilike '%SERVICE%'
--    order by 1;
--
-- And the same question of the table the Daily Report actually reads, which is the one that
-- matters and is NOT the same relation:
--
--   select voucher_type, count(*)
--     from public.rpt_sales_register
--    where fy = '2026-27'
--    group by 1 order by 1;


-- ── The rules ──────────────────────────────────────────────────────────────────────────────────
-- Added for every tenant already carrying the target bucket, which is what keeps the composite FK
-- (tenant_id, sale_type) -> sale_type (tenant_id, code) satisfied. `on conflict do nothing`, so
-- re-running is a no-op.
insert into public.sale_type_rule
  (tenant_id, rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
select st.tenant_id, r.rule_kind, r.match_value, r.sale_type, r.match_mode, r.case_sensitive,
       r.priority, r.notes
from (select distinct tenant_id from public.sale_type) st
cross join (values
  -- ── print heads ──────────────────────────────────────────────────────────────────────────────
  ('voucher_type', 'DELIVERY - HEAD', 'head', 'exact', true, 20,
     'Print heads despatched on a delivery note. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN - HEAD', 'head', 'exact', true, 20,
     'Print heads on a challan. Five books use this spelling. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN - HEAD-HANGLORY', 'head', 'exact', true, 20,
     'Hanglory print heads on a challan. This is the rule the client reference sheet turns on: the 08-09-2026 Surat report counts DC/HG/26-27/81 among its 17 heads. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN - PRINT HEAD', 'head', 'exact', true, 20,
     'Third spelling of the print-head challan. DR-1, 11-09-2026.'),
  -- ⚠ (M) MEANS MACHINE, one line below two rules that say head. Same convention
  --   as 'GST SALES - HEAD -HANGLORY(MACHINE)' (rule 27): a Hanglory head that
  --   is part of a machine deal is a MACHINE. Found only by reading the live
  --   unresolved list - it is not in any sample and carries no revenue, so it
  --   would have gone on reading as unclassified indefinitely.
  ('voucher_type', 'DELIVERY CHALLAN - HEAD(M)HANGLORY', 'machine', 'exact', true, 20,
     'A Hanglory head going out on a challan as part of a MACHINE deal - the (M) is the marker, matching rule 27. Not head. DR-1, 11-09-2026.'),

  -- ── ink ──────────────────────────────────────────────────────────────────────────────────────
  ('voucher_type', 'DELIVERY - INK', 'ink', 'exact', true, 20,
     'Ink despatched on a delivery note. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN - INK', 'ink', 'exact', true, 20,
     'Ink on a challan, usually free of charge with a machine. DR-1, 11-09-2026.'),
  -- ⚠ INK, NOT MACHINE — and it sits one line from a rule that says the opposite.
  --   'GST SALES - HEAD -HANGLORY(MACHINE)' is a MACHINE deal (rule 27). This one is the INK that
  --   goes out WITH a machine, and the client counts it as ink: the 08-09-2026 sheet lists the
  --   ARTISAN VENTURES 30 kg from DC/INK/2627/103 in its ink table, marked FOC. The '(MACHINE)'
  --   suffix describes what the goods are for, and is not a bucket.
  ('voucher_type', 'DELIVERY CHALLAN - INK(MACHINE)', 'ink', 'exact', true, 20,
     'Ink supplied WITH a machine, on a challan. Counted as INK, not machine - the client reference sheet of 08-09-2026 lists these in its ink table as FOC. The (MACHINE) suffix says what the ink is for. DR-1, 11-09-2026.'),

  -- ── machines ─────────────────────────────────────────────────────────────────────────────────
  ('voucher_type', 'DELIVERY CHALLAN - MACHINE', 'machine', 'exact', true, 20,
     'A machine leaving on a challan. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN SALES ON APPROVAL - MACHINE', 'machine', 'exact', true, 20,
     'A machine out on approval. Still typed as machine; whether an approval counts as a sale is a question for the report, not for the bucket. DR-1, 11-09-2026.'),

  -- ── spare parts ──────────────────────────────────────────────────────────────────────────────
  ('voucher_type', 'DELIVERY - SPARE PARTS', 'spare_parts', 'exact', true, 20,
     'Spares on a delivery note. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN - SPARE PARTS', 'spare_parts', 'exact', true, 20,
     'Spares on a challan. DR-1, 11-09-2026.'),
  -- ⚠ TWO SPACES AFTER THE DASH. That is the string in the mirror, in both relations. Copied,
  --   not retyped - an exact, case-sensitive rule with one space can never fire.
  ('voucher_type', 'DELIVERY CHALLAN -  SPARE PARTS (MACHINE)', 'spare_parts', 'exact', true, 20,
     'Spares supplied with a machine, on a challan. NOTE THE DOUBLE SPACE after the dash - that is the literal string in v_voucher_type_nature and rpt_sales_register. 161 lines in FY2026-27. DR-1, 11-09-2026.'),
  ('voucher_type', 'DELIVERY CHALLAN SALES ON APPROVAL - SPARE PARTS', 'spare_parts', 'exact', true, 20,
     'Spares out on approval. 113 lines, the largest approval series. DR-1, 11-09-2026.'),

  -- ── paper ────────────────────────────────────────────────────────────────────────────────────
  ('voucher_type', 'DELIVERY CHALLAN-PAPER', 'paper', 'exact', true, 20,
     'Paper on a challan. Its voucher numbers are OTPL/nnn, which match no prefix rule, so without this it is Other. DR-1, 11-09-2026.'),
  -- The spelling that is ACTUALLY in the mirror today. Rules 45 and 46 carry the other two
  -- spellings and currently match nothing; see the header.
  ('voucher_type', 'GST SALES- PAPER', 'paper', 'exact', true, 20,
     'The paper SALES voucher as every book spells it on 11-09-2026 - one space, after the dash. Rules 45 (GST SALES-PAPER) and 46 (GST SALES - PAPER) match no row in the mirror today; paper sales are currently typed only by the PAPER/ prefix (rule 44). Left in place in case a book is renamed back. DR-1, 11-09-2026.'),

  -- ── service income, which is not a product line ───────────────────────────────────────────────
  -- Companions to rules 31-33 (GST SERVICE, RENT INCOME, GST SALES-ISD). Excluded from the
  -- product sections for the same reason those are.
  ('voucher_type', 'GST SALES - SERVICE', 'non_product', 'exact', true, 20,
     'Service income, not a product sale. Companion to rule 31 (GST SERVICE). DR-1, 11-09-2026.'),
  ('voucher_type', 'GST SERVICE-JOB WORK', 'non_product', 'exact', true, 20,
     'Job-work income, not a product sale. Companion to rule 31. DR-1, 11-09-2026.')
) as r(rule_kind, match_value, sale_type, match_mode, case_sensitive, priority, notes)
where exists (
  select 1 from public.sale_type s
   where s.tenant_id = st.tenant_id and s.code = r.sale_type and s.is_active
)
on conflict do nothing;


-- ── Verify 2: the resolver's answer, with the controls that must NOT move ──────────────────────
-- Expected, top to bottom:
--   head, head, ink, ink, machine, spare_parts, spare_parts, paper, paper, non_product,
--   other, other, machine, spare_parts
-- The last four are the controls. Rows 11-12 are the two bare challan types, which must stay
-- 'other' - ruling them would be guessing. Row 13 proves the H/ prefix still outranks everything
-- (a high-seas machine deal), and row 14 that SP/ still types a spare-parts bill.
select v.voucher_type, v.voucher_no,
       public.resolve_sale_type('acct_orange', v.voucher_type, v.voucher_no) as sale_type
from (values
  ('DELIVERY CHALLAN - HEAD-HANGLORY',                 'DC/HG/26-27/81'),
  ('DELIVERY CHALLAN - PRINT HEAD',                    'DC/PH/1'),
  ('DELIVERY CHALLAN - INK(MACHINE)',                  'DC/INK/2627/103'),
  ('DELIVERY CHALLAN - INK',                           'INK/DC/2526/14'),
  ('DELIVERY CHALLAN SALES ON APPROVAL - MACHINE',     'DC/SOA/1'),
  ('DELIVERY CHALLAN -  SPARE PARTS (MACHINE)',        'DC/SP/1'),
  ('DELIVERY CHALLAN SALES ON APPROVAL - SPARE PARTS', 'SP/SOA/2627/199'),
  ('DELIVERY CHALLAN-PAPER',                           'OTPL/001'),
  ('GST SALES- PAPER',                                 'PAPER/006/26-27'),
  ('GST SALES - SERVICE',                              'SRV/1'),
  ('DELIVERY CHALLAN',                                 'XYZ/1'),
  ('DELIVERY CHALLAN SALES ON APPROVAL',               'DC/SOA/2627/6'),
  ('Sales Accounts-HSS',                               'H/26-27/3'),
  ('GST SALES - SPARE PARTS',                          'SPARE/26-27/9')
) as v(voucher_type, voucher_no);


-- ── Verify 3: open bills did not move ──────────────────────────────────────────────────────────
-- The open-bill path passes an EMPTY voucher type, so nothing above can reach it. Expected:
-- ink, head, machine, spare_parts, paper, other - identical before and after this file.
select v.bill_ref,
       public.resolve_sale_type('acct_orange', '', v.bill_ref) as sale_type
from (values ('INK/26-27/2498'), ('HEAD/26-27/129'), ('HEAD/M/24-25/11'),
             ('SPARE/26-27/9'), ('PAPER/006/26-27'), ('OTPL/001')) as v(bill_ref);


-- ── Verify 4: what is STILL unclassified on the sales side ─────────────────────────────────────
-- Expected after this file, for FY2026-27: 'DELIVERY CHALLAN', 'DELIVERY CHALLAN SALES ON
-- APPROVAL', 'GST SALES - AMC', 'GST SALES -  OTHER' - the four listed as deliberately unruled.
-- Anything ELSE here is a rule that is missing or that cannot fire.
select r.voucher_type, count(*) as lines, round(sum(r.revenue) / 100000.0, 2) as revenue_lacs
  from public.rpt_sales_register r
 where r.fy = '2026-27'
   and public.resolve_sale_type('acct_orange', r.voucher_type, r.voucher_no) = 'other'
 group by 1
 order by 3 desc nulls last;


-- ── Rollback ───────────────────────────────────────────────────────────────────────────────────
-- Deactivate rather than delete, matching how every other rule here rolls back. Challans fall back
-- to 'other', which is where they are today, and the Daily Report lists them in its "Not yet
-- classified" band rather than dropping them.
--
--   update public.sale_type_rule set is_active = false
--    where tenant_id = 'acct_orange'
--      and rule_kind = 'voucher_type'
--      and match_value in (
--        'DELIVERY - HEAD', 'DELIVERY CHALLAN - HEAD', 'DELIVERY CHALLAN - HEAD-HANGLORY',
--        'DELIVERY CHALLAN - PRINT HEAD', 'DELIVERY - INK', 'DELIVERY CHALLAN - INK',
--        'DELIVERY CHALLAN - INK(MACHINE)', 'DELIVERY CHALLAN - MACHINE',
--        'DELIVERY CHALLAN SALES ON APPROVAL - MACHINE', 'DELIVERY - SPARE PARTS',
--        'DELIVERY CHALLAN - SPARE PARTS', 'DELIVERY CHALLAN -  SPARE PARTS (MACHINE)',
--        'DELIVERY CHALLAN SALES ON APPROVAL - SPARE PARTS', 'DELIVERY CHALLAN-PAPER',
--        'DELIVERY CHALLAN - HEAD(M)HANGLORY', 'GST SALES- PAPER', 'GST SALES - SERVICE', 'GST SERVICE-JOB WORK');
--
-- The frontend needs no matching rollback: every bucket above already exists and stays populated
-- from the invoice-side rules either way.
