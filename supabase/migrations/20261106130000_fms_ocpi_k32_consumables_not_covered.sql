-- OCPI-37 · Homer K32 — the consumables list the real contract excludes from warranty
--
-- WHAT THIS FIXES
--   `HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER UNDER WARRANTY` is on FOUR
--   real order confirmations — folders 78 (Jay Chemical), 82 and 83 (Monalissa) —
--   and in ZERO templates. It names eleven parts plus two notes, and it LIMITS
--   what Orange O Tec must replace free of charge. Every K32 contract the module
--   has produced therefore gives away eleven consumables the paper contract
--   excludes.
--
--   Settled with Ritesh Bhai 02-09-2026: "Yes, add it."
--
-- WHERE IT GOES, AND WHY 100 RATHER THAN THE 75 THE WORK LIST GUESSED
--   The work list proposed a sort_order between PRINT HEAD POLICY PROGRAM (70) and
--   WORKS AT CUSTOMER'S CARE AND EXCLUSIONS (80), and asked for that to be checked
--   against a rendered contract before choosing. Checked on all three: the clause
--   is the LAST thing on the page before the signature block, after CANCELLATION.
--   K32's cancellation clause is sort_order 90, so this is 100.
--
-- WHERE THE TEXT CAME FROM
--   Transcribed from the RENDERED pages, never from `k32.pptx`. Four of the nine
--   source decks fuse words in OOXML — `THEMACHINEISCOMPOSEDASFOLLOWS` — and the
--   fused text reads as prose with typos rather than as corruption, so it
--   transcribes into a customer contract without anything failing. All three
--   rendered copies are character-identical; the text below is what they say,
--   including `SQUEZEE` and `INK MAIL CONNECTOR`, which are the contract's own
--   spellings and are deliberately not corrected here.
--
-- SAFETY
--   * ADDITIVE. One INSERT. No existing row is edited, no column is dropped.
--   * IDEMPOTENT. `where not exists` on (machine, key), so a re-run is a no-op.
--   * FROZEN REVISIONS ARE UNTOUCHED. An issued contract prints from the snapshot
--     in `fms_ocpi_deals.oc_document_payload`, not from this table, so no contract
--     that has already gone out changes. Verified after applying: QT-M0031 (the
--     only K32 deal with a frozen payload) still carries nine sections.
--   * ⚠ ONE LIVE K32 DEAL IS MID-FLIGHT AND WILL GAIN THIS CLAUSE — QT-M0037,
--     AARNAV FASHIONS LIMITED-Machine, sitting at `quotation_approval` with no
--     frozen payload. That is the correct outcome, and Ritesh Bhai has been told
--     rather than left to discover it.
--   * NO `[[if …]]` MARKERS. The deployed frontend is behind the database on
--     `lib/conditions.ts`; a clause carrying markers would print them literally on
--     a customer's contract. This one is plain text and renders correctly on the
--     deployed build as well as on the working tree.
--
-- ⚠ STILL OPEN, AND NOT SETTLED BY THIS: whether the other machines need an
--   equivalent list. K32 may simply be the only one where somebody wrote it down —
--   in which case every K24, K64, P8S and Alpha contract has the same hole. It is
--   a question for Bushra, on the Waiting-for list, and NO list is invented here
--   for any other machine.

insert into fms_ocpi_machine_sections (machine_id, key, title, body, sort_order, active)
select
  m.id,
  'consumables_excluded',
  'HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER UNDER WARRANTY',
  E'1. SPONGE ROLL COVER
2. WASHING BRUSH
3. SQUEZEE RUBBER
4. HEAD WIPER
5. WASHING BRUSH BEARING
6. INK FILTER
7. DEGASSING
8. SPONGE ROLL BEARING
9. INK MAIL CONNECTOR
10. INK FEMALE CONNECTOR
11. INK PIPE

Notes :
1) PHYSICALLY DAMAGED PARTS ARE NOT COVER UNDER WARRANTY PERIOD.
2) ANY AIR PRESSURE-RELATED PART DAMAGED DUE TO THE WATER ENTERING THE AIR PIPE WILL NOT BE COVERED UNDER WARRANTY PERIOD.',
  100,
  true
from fms_ocpi_machines m
where m.name = 'Homer K32'
  and not exists (
    select 1 from fms_ocpi_machine_sections s
    where s.machine_id = m.id and s.key = 'consumables_excluded'
  );
