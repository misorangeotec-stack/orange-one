import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { ApprovalMatrix } from "../types";

/**
 * The approval chain's write layer, and the trip's lifecycle levers.
 *
 * ⚠ EVERY GUARD LIVES IN THE RPC, NOT HERE. The self-approval refusal, the
 *   skipped-step refusal, the "say why" on a rejection and the routing to the
 *   next step are all in `fms_travel_decide`. This file only carries the call.
 *   Screens repeat some of those rules to grey a button out ahead of time —
 *   that is a courtesy so nobody presses something the database will refuse, and
 *   where the two ever disagree the database is right.
 */

export type Decision = "approve" | "reject" | "return";

/**
 * Decide one approval gate.
 *
 * Returns the trip's new STATUS, which is what the calling screen shows —
 * "approved, and now awaiting booking" is a more useful confirmation than
 * "approved", because the next question is always where it went.
 */
export async function decideApproval(
  step: "manager_approval" | "director_approval",
  tripId: string,
  decision: Decision,
  note?: string | null,
): Promise<string> {
  const fn = step === "director_approval" ? "fms_travel_decide_director" : "fms_travel_decide_manager";
  const { data, error } = await db.rpc(fn, {
    p_trip: tripId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Park a trip.
 *
 * ⚠ THE TRAVELLER MAY DO THIS, and that is a deliberate widening. They could
 *   already CANCEL — losing the number, the approvals and the history — so
 *   leaving the safe action harder to reach than the destructive one taught
 *   people to cancel a trip that had merely slipped a fortnight.
 */
export async function holdTrip(tripId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_travel_hold_trip", { p_trip: tripId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/**
 * Take a trip off hold.
 *
 * ⚠ WHERE IT GOES IS THE ROUTER'S ANSWER, NOT THE HELD STATUS REPLAYED.
 *   `fms_travel_next_stop` reads the skip flags and the decision stamps, so a
 *   resumed trip cannot be sent to a step it skipped on the way in — defect (F)
 *   of 20260905120000.
 */
export async function resumeTrip(tripId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_resume_trip", { p_trip: tripId });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Cancel a submitted trip. A draft is thrown away instead — there is no record to keep. */
export async function cancelTrip(tripId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_travel_cancel_trip", { p_trip: tripId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/** The approval matrix (§3.2 / H10). Admin only, enforced by RLS on the config table. */
export async function setApprovalMatrix(m: ApprovalMatrix): Promise<void> {
  const { error } = await db.from("fms_travel_config").upsert(
    {
      key: "approval_matrix",
      value: {
        director_from_band: Math.max(1, Math.min(10, Math.floor(m.directorFromBand))),
        manager_also_for_director_bands: m.managerAlsoForDirectorBands,
      },
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}
