-- OCPI-39b · Position Printer's manufacturer — the second half-state left by
-- `20261107130000`, and the one a string-matched sweep could not see.
--
-- 🔴 THE FIRST SWEEP KEYED ON THE HEADING TEXT AND MISSED THIS. It searched for
--    `MFG *:`, which is how folder 120 writes it, and reported "no other machine
--    is half-filled". Folder 106 writes the same fact as a TERM BULLET under a
--    different spelling —
--
--        Manufacture : Xiamen Hanin Co., Ltd.
--
--    — so the Position Printer looked complete while its `manufacturer` sat
--    null against a paper that states one. Re-swept on the CONCEPT
--    (/manufactur\w*|mfg|mfr|made in|country of origin/) across both years, and
--    that is the whole population: three papers, three spellings.
--
--    ⚠ THIS IS OCPI-36'S OWN WARNING RECURRING — do not key an extraction on
--      the heading text these decks happen to use. Each paper is typed by hand,
--      so the label varies while the fact does not.
--
-- ⚠ MANUFACTURER ONLY. Folder 106 carries no country-of-origin line at all, so
--   `country_of_origin` stays null and the renderer omits it. That blank is the
--   paper's own silence, not a gap.
--
-- The complete picture after this, every value read off a rendered real paper:
--
--   K64               model · hsn · mfg · origin      (from 120)
--   Rocket            model · hsn ·     · origin      (121, no MFG line)
--   Position Printer  model · hsn · mfg               (106, no origin line)
--   Homer K32         model · hsn                     (119, no MFG or origin)
--
-- ⚠ K64's TWO PAPERS DISAGREE ON THREE OF THE FOUR, and the master carries
--   120's. 109 states the SAME HSN (84433910) but a DIFFERENT model
--   (`HM3200B-TK64-A1` against 120's `HM1800B-TK64-A1`, reading as two build
--   widths under one row) and carries neither MFG nor origin. So a 109-shaped
--   K64 now prints two lines its own paper never had, under the other paper's
--   model number. That is the standing Waiting-for on Bushra, not something to
--   resolve by picking one.
--
-- ⚠ ADDITIVE AND IDEMPOTENT, guarded on the cell being empty. Frozen revisions
--   print from their stored payload and are unaffected.

update fms_ocpi_machines
   set manufacturer = 'Xiamen Hanin Co., Ltd.', updated_at = now()
 where name = 'Position Printer'
   and coalesce(trim(manufacturer), '') = '';
