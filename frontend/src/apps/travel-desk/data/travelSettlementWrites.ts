import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { SettlementInput } from "../types";

/**
 * Finance verification and settlement.
 *
 * ⚠ NOTHING HERE RE-DERIVES A CAP. Finance's job at this step is the judgement
 *   the engine cannot make, not a second opinion on §7.2. Every RPC below
 *   returns the server's re-priced totals rather than letting the screen add
 *   anything up.
 *
 * ⚠ `allowed_amount` IS NEVER TOUCHED. Finance's figure lands in
 *   `finance_amount` beside it, and the gap between the two IS the Policy
 *   Exceptions report. Overwriting the engine's answer would destroy the only
 *   evidence that an exception was ever made.
 */

const s = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "" : String(v);

/**
 * Finance settles one line at its own figure, in either direction.
 *
 * Pass `null` to clear it and let the engine's answer stand again — which is a
 * different thing from settling at zero, and the RPC treats them differently:
 * zero is a decision and needs a reason, null is undoing one.
 */
export async function setLineSettlement(
  lineId: string,
  amount: number | null,
  reason: string | null,
): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("fms_travel_set_line_settlement", {
    p_line: lineId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, number>;
}

/** Finance overrules one day of the daily allowance. Returns the new DA total. */
export async function overrideDaDay(
  dayId: string,
  amount: number | null,
  reason: string | null,
): Promise<number> {
  const { data, error } = await db.rpc("fms_travel_override_da_day", {
    p_day: dayId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Close the Finance step. Re-prices first, so settlement reads a current figure. */
export async function completeFinanceReview(
  tripId: string,
  note?: string | null,
): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_complete_finance_review", {
    p_trip: tripId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Record what actually moved, and close the trip.
 *
 * ⚠ THE AMOUNT IS ALWAYS POSITIVE. Whether this is a payment or a recovery is
 *   decided by the claim, not by a minus sign the user types — the RPC refuses a
 *   negative figure outright and picks the branch from `net_payable`. A payment
 *   recorded as −4,390 is a row nobody can tie to a bank statement.
 */
export async function settleTrip(
  tripId: string,
  input: SettlementInput,
): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_settle", {
    p_trip: tripId,
    p: {
      amount: s(input.amount),
      paid_on: s(input.paidOn),
      mode: s(input.mode),
      reference: s(input.reference),
      note: s(input.note),
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}
