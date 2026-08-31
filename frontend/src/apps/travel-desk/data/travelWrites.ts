import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { StepKey } from "../lib/steps";
import type { StepSlaMap } from "../lib/sla";
import type { TravelPolicyConfig } from "../types";

/**
 * Travel Desk write layer.
 *
 * ⚠ THE WORKFLOW WRITES ARE NOT HERE YET. Raising, approving, booking, claiming
 *   and settling all go through SECURITY DEFINER RPCs, and every one of those
 *   arrives with the phase that owns it (3 through 9). `fms_travel_trips`
 *   deliberately carries NO write policy at all, so the RPC is the only write
 *   door and the guard cannot be bypassed from the browser.
 *
 *   What IS here is the configuration surface — step owners, coordinators, due
 *   dates, the policy numbers and a person's own travel defaults. Those are
 *   ordinary table writes because their RLS policies already say exactly who may
 *   make them (`is_admin`, or your own row), and wrapping an admin-only upsert
 *   in a definer function would add a second place for that rule to live.
 */

/** Assign the owners of one workflow step. Admin only, enforced by RLS. */
export async function setStepOwners(
  stepKey: StepKey,
  input: { departmentIds?: string[]; designationId?: string | null; employeeIds: string[] },
): Promise<void> {
  const { error } = await db
    .from("fms_travel_step_owners")
    .upsert(
      {
        step_key: stepKey,
        department_ids: input.departmentIds ?? [],
        designation_id: input.designationId ?? null,
        employee_ids: input.employeeIds,
      },
      { onConflict: "step_key" },
    );
  if (error) throw new Error(error.message);
}

/** Write one config singleton. Admin only, enforced by RLS. */
async function setConfig(key: string, value: unknown): Promise<void> {
  const { error } = await db
    .from("fms_travel_config")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/**
 * The process coordinators — the Travel Desk itself.
 *
 * A coordinator books, uploads tickets, records refunds and may raise a request
 * on behalf of senior management (PRD §3). They can act on any step, so this is
 * a short list of named people, not a department.
 */
export const setCoordinators = (userIds: string[]): Promise<void> =>
  setConfig("process_coordinators", { user_ids: userIds });

/**
 * The per-step due-date map.
 *
 * ⚠ `days` MUST BE >= 0 EVEN FOR A "BEFORE" STEP. The advance is due BEFORE
 *   departure, but the direction lives in code (TRIGGER_STEPS in lib/sla.ts) and
 *   only the magnitude is stored. Store a negative and `resolveStepSla` silently
 *   substitutes the step's default — no error, no clue, just a wrong date. The
 *   Due Dates screen keeps its number input `min={0}` for the same reason.
 */
/** Who may be handed a step. department_ids is a Setup picker filter and grants nothing. */
export async function setReassignPool(input: { departmentIds: string[]; userIds: string[] }): Promise<void> {
  await setConfig("reassign_pool", { department_ids: input.departmentIds, user_ids: input.userIds });
}

/**
 * Reassign ONE step of ONE trip to another person, or pass a null assignee to
 * return it to the step natural owner.
 *
 * ⚠ This NEVER writes fms_travel_trips.approver_manager_ids. That column is a
 *   write-once snapshot taken when the trip was raised, so a re-org cannot
 *   silently re-route a trip somebody is already waiting on; overwriting it
 *   would destroy the record of who the trip was raised against - which is also
 *   where a hand-back returns the step to.
 */
export async function reassignStep(
  tripId: string,
  stepKey: string,
  assignee: string | null,
  note: string | null,
): Promise<void> {
  // `db` is the module-wide `supabase as any` escape hatch at the top of this
  // file: Travel Desk postdates the last database.types.ts generation, so none of
  // its tables or RPCs are in the generated union.
  const { error } = await db.rpc("fms_travel_reassign_step", {
    p_trip: tripId,
    p_step_key: stepKey,
    p_assignee: assignee,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

export async function setStepSla(map: StepSlaMap): Promise<void> {
  const clean: Record<string, { anchor: string; days: number }> = {};
  for (const [step, sla] of Object.entries(map)) {
    clean[step] = { anchor: sla.anchor, days: Math.max(0, Math.floor(sla.days)) };
  }
  await setConfig("step_sla", clean);
}

/** The policy numbers that are not rates (§3.3, §11, §12). */
export async function setPolicy(policy: TravelPolicyConfig): Promise<void> {
  await setConfig("policy", {
    max_passengers: policy.maxPassengers,
    booking_window_days: policy.bookingWindowDays,
    advance_booking_warn_days: policy.advanceBookingWarnDays,
    claim_deadline_days: policy.claimDeadlineDays,
    claim_hard_stop_days: policy.claimHardStopDays,
    advance_max_pct: policy.advanceMaxPct,
    advance_recovery_days: policy.advanceRecoveryDays,
    hod_review_days: policy.hodReviewDays,
    finance_process_days: policy.financeProcessDays,
    credit_days: policy.creditDays,
    dispute_threshold: policy.disputeThreshold,
    hotel_cap_hard_multiple: policy.hotelCapHardMultiple,
    emergency_window_hours: policy.emergencyWindowHours,
  });
}

/** The employer's identity for hotel folios and the ITC register (§7.1, §11.3). */
export const setCompanyIdentity = (v: { legalName: string; gstin: string; address: string }): Promise<void> =>
  setConfig("company_identity", { legal_name: v.legalName, gstin: v.gstin, address: v.address });

/**
 * A person's own standing travel details.
 *
 * Their own row or an admin's, per the RLS policy — a coordinator books for
 * other people but does not get to rewrite where someone is posted. Policy §1.3
 * ties the base city to the appointment letter, which is an HR fact.
 */
export async function saveEmployeeSettings(
  userId: string,
  input: {
    baseCityId?: string | null;
    seatPreference?: string | null;
    mealPreference?: string | null;
    frequentFlyerNo?: string | null;
  },
): Promise<void> {
  const { error } = await db
    .from("fms_travel_employee_settings")
    .upsert(
      {
        user_id: userId,
        base_city_id: input.baseCityId ?? null,
        seat_preference: input.seatPreference ?? null,
        meal_preference: input.mealPreference ?? null,
        frequent_flyer_no: input.frequentFlyerNo ?? null,
      },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);
}

/**
 * Mark bell notifications read.
 *
 * The one direct table write in the module that is not configuration, and it is
 * safe for the same reason it is in every other FMS: the RLS policy restricts it
 * to `user_id = auth.uid()`, so the worst anyone can do is mark their own feed.
 */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await db
    .from("fms_travel_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(error.message);
}
