-- OCPI-40 (re-audit, C-2) · The one machine whose billing name can be filled
--                            from evidence rather than invented.
--
-- `KoloRado Alpha 3 - 12 heads` is the only machine in the picker with no
-- "Bills as" line under it, and it is a row real contracts use. Its siblings all
-- carry the same sentence with only the head count changing - verified on the
-- Alpha 3.2 rows (8, 16 and 24 heads) and all three Alpha II rows:
--
--     LARGE FORMAT INKJET PRINTER WITH <n> HEADS WITH STD. ACCESSORIES
--
-- so 12 goes in the slot. The wording is COPIED, not composed: this string
-- prints on a signed contract.
--
-- 🔴 FIVE OTHER ACTIVE MACHINES ARE ALSO BLANK and are deliberately NOT touched:
--    Fab Pro 2I, Fab Pro 3I, JPK, Mini Lario, MP5000. None has a sibling whose
--    wording can be copied, and none has a real paper stating one. They are a
--    Waiting-for on Bushra / Ritesh Bhai, not a gap to fill by inference.
--
--    ⚠ The original audit reported Alpha 3 as "the only machine with no billing
--      name". That was a keyed sweep - `name ilike '%alpha%'` - finding the
--      answer it expected. The unfiltered count is six.
--
-- Additive and idempotent: guarded on the cell being empty, so re-running is a
-- no-op and no existing wording is overwritten.
--
-- Reversal:
--   update public.fms_ocpi_machines set billing_name = null
--    where name = 'KoloRado Alpha 3 — 12 heads';

update public.fms_ocpi_machines
   set billing_name = 'LARGE FORMAT INKJET PRINTER WITH 12 HEADS WITH STD. ACCESSORIES',
       updated_at   = now()
 where name = 'KoloRado Alpha 3 — 12 heads'
   and coalesce(trim(billing_name), '') = '';
