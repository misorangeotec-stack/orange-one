import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

/**
 * The travel advance's write layer.
 *
 * ⚠ APPROVE AND DISBURSE ARE TWO CALLS, NOT ONE, because §11.1 gives them
 *   different owners and different deadlines — the HOD agrees the figure within
 *   a working day, Finance moves the money within two. Folding them together
 *   would mean an advance could only be agreed by somebody able to make a
 *   transfer.
 *
 * ⚠ §11.1 AND §11.2 ARE ENFORCED IN THE RPCs, NOT HERE. The 90% ceiling and the
 *   "no second advance while one is unreconciled" refusal both live in SQL. The
 *   screens show the ceiling and warn about an outstanding balance so nobody is
 *   surprised, but a browser that could waive either would make the whole
 *   control decorative.
 */

/** Finance agrees the figure. Returns the approved amount. */
export async function approveAdvance(
  tripId: string,
  amount: number,
  note?: string | null,
): Promise<number> {
  const { data, error } = await db.rpc("fms_travel_approve_advance", {
    p_trip: tripId,
    p_amount: amount,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

/** The money leaves. Returns the trip's new status. */
export async function disburseAdvance(
  tripId: string,
  input: { amount: number; paidOn: string; mode?: string | null; ref?: string | null },
): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_disburse_advance", {
    p_trip: tripId,
    p_amount: input.amount,
    p_paid_on: input.paidOn,
    p_mode: input.mode ?? null,
    p_ref: input.ref ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Money handed back rather than netted against a claim.
 *
 * ⚠ THIS IS WHAT UNBLOCKS A CANCELLED TRIP. The advance left, the trip never
 *   happened, and no claim is coming to net it against — so without a way to
 *   record the repayment §11.2 would bar that person from every future advance
 *   for ever.
 */
export async function recordAdvanceRecovery(
  tripId: string,
  amount: number,
  ref?: string | null,
): Promise<number> {
  const { data, error } = await db.rpc("fms_travel_record_advance_recovery", {
    p_trip: tripId,
    p_amount: amount,
    p_ref: ref ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}
