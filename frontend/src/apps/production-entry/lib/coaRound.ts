import type { ProductionRequest } from "../types";

/**
 * WHICH TEST ROUND A CERTIFICATE BELONGS TO — the rule, stated once.
 *
 * ⚠ THIS MIRRORS THE SERVER and must keep mirroring it. `fms_production_save_coa`
 *   stamps the round itself (a client that could choose one could make two
 *   certificates claim the same test); this is only what the SCREENS use to know
 *   which certificate to show and which to open. If one changes, both change —
 *   see supabase/migrations/20260902120000_fms_production_coa_per_round.sql.
 *
 * A COA belongs to the round CURRENTLY BEING TESTED, or to the last one tested:
 *
 *   at quality checking  ->  rounds recorded + 1   (the test underway)
 *   anywhere else        ->  max(rounds recorded, 1)  (the last test)
 *
 * ⚠ IT KEYS ON `currentStep`, NOT `status`. A held card carries
 *   status = "on_hold" while currentStep stays where it was, and the two are set
 *   together at every other transition — so the hold is the only case where they
 *   disagree, and it is exactly the case this survives.
 *
 * It lands right at every point of the loop:
 *   · fresh Test 1 (0 recorded, at quality)                    -> 1
 *   · rejected, mid-Additional-Issue-Slip (1 recorded)         -> 1, the test that failed
 *   · back at quality for the re-test (1 recorded)             -> 2
 *   · approved and moved on (1 recorded, at the log book)      -> 1, the test that passed
 */
export const currentCoaRound = (r: ProductionRequest): number =>
  r.currentStep === "quality_check" ? r.qcRounds.length + 1 : Math.max(r.qcRounds.length, 1);

/**
 * Has this card reached quality checking at all?
 *
 * The gate that replaced "the quality check is approved" on every COA surface: a
 * REJECTED round now gets a certificate too (it is the record of a real test),
 * but a lot nobody has tested yet has nothing to certify. The server refuses the
 * same case independently.
 *
 * ⚠ A repackaging card bypasses Quality Check entirely, so it never passes this.
 */
export const hasReachedQuality = (r: ProductionRequest): boolean =>
  r.qcRounds.length > 0 || r.currentStep === "quality_check";

