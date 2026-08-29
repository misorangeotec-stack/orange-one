-- ===========================================================================
-- OCPI-3 · Stage J.1 — reword the PRINT HEAD POLICY PROGRAM clause.
--
-- APPROVED BY THE CLIENT, 29-Aug-2026. The wording was agreed verbatim before
-- this was applied, and is recorded on the "To discuss with Ritesh Bhai" list in
-- WORKLIST.md so it can be confirmed and, if ever queried, quoted exactly.
--
-- WAS: "After that period a New Print Head will be priced at INR
--       {{post_warranty_head_price}} plus GST, on the new machine, first time
--       installed head."
--
-- NOW: "After that period, replacement print heads will be supplied at the
--       prices prevailing at the time of purchase, on the new machine, first
--       time installed head."
--
-- Machines affected: Homer K24, Homer K32, P8D, P8S. All four carried the
-- IDENTICAL sentence - verified before replacing, 4 of 4.
--
-- ⚠ WHY THIS HAD TO COME FIRST, AND WHY IT IS ITS OWN MIGRATION.
--   The client asked for the "head price after the warranty" FIELD to be
--   removed. An unresolved token renders as a ruled blank by design, so deleting
--   the field before rewording would have printed "priced at INR ________ plus
--   GST" on every contract for those four machines in the meantime. The field
--   and its token were removed only AFTER this landed and after the token was
--   confirmed absent from all 82 template sections.
--
-- ⚠ ALREADY-ISSUED PAPERS DO NOT CHANGE. Every revision freezes its own resolved
--   document, so a quotation already with a customer keeps the sentence it was
--   issued under. Only the next generation picks this up - the same freeze rule
--   the rest of the module runs on, and the right one.
--
-- ROLLBACK: run the same replace with the two strings swapped. The old sentence
--   needs the token back in tokensFor as well, or it prints a ruled blank.
-- ===========================================================================

begin;

update public.fms_ocpi_machine_sections
   set body = replace(
         body,
         'After that period a New Print Head will be priced at INR {{post_warranty_head_price}} plus GST, on the new machine, first time installed head.',
         'After that period, replacement print heads will be supplied at the prices prevailing at the time of purchase, on the new machine, first time installed head.'
       )
 where body like '%{{post_warranty_head_price}}%';

commit;
