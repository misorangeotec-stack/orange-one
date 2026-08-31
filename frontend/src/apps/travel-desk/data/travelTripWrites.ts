import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { JourneyType, TimeSlot, TripPassenger } from "../types";

/**
 * The trip write layer — phase 3's four doors.
 *
 * ⚠ EVERY ONE OF THESE IS AN RPC, NOT A TABLE WRITE. `fms_travel_trips` and
 *   `fms_travel_passengers` carry NO write policy at all, so a `.from(...)
 *   .update(...)` from the browser is refused by the database rather than
 *   half-applied. That is deliberate: the trip is the row that decides what the
 *   company pays somebody, and every guard on it — who owns the draft, whether
 *   the departure is inside the booking window, which rate card freezes onto it
 *   — lives in one place where it cannot be skipped by calling a different
 *   screen's code path.
 *
 * ⚠ THE SNAPSHOT IS NOT SENT FROM HERE, AND THAT IS THE POINT. The band, the
 *   travel category, the rate card and the approvers are resolved server-side by
 *   `fms_travel_submit_trip`. A browser that could name its own travel category
 *   could name TC-A, and the whole entitlement system would be advisory.
 */

/** What the request form owns. Everything else on the trip belongs to a step. */
export interface TripDraftInput {
  travellerId: string | null;
  travellerName: string;
  travellerEmployeeCode: string | null;
  purposeId: string | null;
  purposeOtherRemarks: string | null;
  destinationCityId: string | null;
  journeyType: JourneyType | null;
  preferredSlot: TimeSlot | null;
  plannedDepartureDate: string | null;
  plannedReturnDate: string | null;
  accommodationRequired: boolean;
  estimatedCost: number | null;
  isEmergency: boolean;
  emergencyReason: string | null;
  advanceRequested: boolean;
  advanceRequestedAmount: number | null;
}

/**
 * snake_case for the RPC, with every value as a STRING or a BOOLEAN.
 *
 * ⚠ NUMBERS AND DATES GO ACROSS AS TEXT ON PURPOSE. The SQL side reads them with
 *   `nullif(btrim(coalesce(p->>'x','')), '')::numeric` — a shape that turns "",
 *   "   " and a missing key all into NULL. Sending a real JSON number would work
 *   until somebody clears the field, at which point `0` and "not answered" would
 *   arrive identically. On `estimated_cost`, which §11.1 caps the advance
 *   against, those two are very different answers.
 */
const payload = (v: TripDraftInput): Record<string, unknown> => ({
  traveller_id: v.travellerId ?? "",
  traveller_name: v.travellerName ?? "",
  traveller_employee_code: v.travellerEmployeeCode ?? "",
  purpose_id: v.purposeId ?? "",
  purpose_other_remarks: v.purposeOtherRemarks ?? "",
  destination_city_id: v.destinationCityId ?? "",
  journey_type: v.journeyType ?? "",
  preferred_slot: v.preferredSlot ?? "",
  planned_departure_date: v.plannedDepartureDate ?? "",
  planned_return_date: v.plannedReturnDate ?? "",
  accommodation_required: v.accommodationRequired,
  estimated_cost: v.estimatedCost === null || v.estimatedCost === undefined ? "" : String(v.estimatedCost),
  is_emergency: v.isEmergency,
  emergency_reason: v.emergencyReason ?? "",
  advance_requested: v.advanceRequested,
  advance_requested_amount:
    v.advanceRequestedAmount === null || v.advanceRequestedAmount === undefined
      ? ""
      : String(v.advanceRequestedAmount),
});

/**
 * Create or update a draft, returning its id.
 *
 * ⚠ THE DRAFT LIVES ON THE SERVER, NOT IN localStorage. Other FMS forms keep a
 *   local draft (`shared/lib/draftStore.ts`) because their entities are short.
 *   A trip request is filled in over a day — you start it, you go and ask what
 *   the customer's dates are, you finish it on a phone — and a draft that only
 *   exists in one browser is a draft lost to a cleared cache or a second device.
 */
export async function saveTripDraft(input: TripDraftInput, tripId?: string | null): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_save_draft", {
    p: payload(input),
    p_trip: tripId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Throw a draft away. Only a draft — a submitted trip is cancelled, not deleted. */
export async function deleteTripDraft(tripId: string): Promise<void> {
  const { error } = await db.rpc("fms_travel_delete_draft", { p_trip: tripId });
  if (error) throw new Error(error.message);
}

/**
 * Submit: freeze the snapshot, mint the number, send it for approval.
 *
 * Returns the trip number, which is what the screen shows in its confirmation —
 * "TRV-2627-0007 has gone to your manager" tells somebody the thing exists and
 * what to quote when they chase it.
 */
export async function submitTrip(tripId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_submit_trip", { p_trip: tripId });
  if (error) throw new Error(error.message);
  return data as string;
}

export type PassengerInput = Pick<
  TripPassenger,
  "employeeId" | "fullName" | "gender" | "dateOfBirth" | "mobile" | "email" | "isPrimary"
>;

/**
 * Replace a trip's passenger list whole.
 *
 * ⚠ THE WHOLE LIST, EVERY TIME. The RPC deletes and re-inserts inside one
 *   transaction, so a passenger dropped from the form is dropped from the
 *   booking. Sending a partial list would silently keep whoever was removed.
 */
export async function setPassengers(tripId: string, rows: PassengerInput[]): Promise<void> {
  const { error } = await db.rpc("fms_travel_set_passengers", {
    p_trip: tripId,
    p: rows.map((r) => ({
      employee_id: r.employeeId ?? "",
      full_name: r.fullName ?? "",
      gender: r.gender ?? "",
      date_of_birth: r.dateOfBirth ?? "",
      mobile: r.mobile ?? "",
      email: r.email ?? "",
      is_primary: r.isPrimary,
    })),
  });
  if (error) throw new Error(error.message);
}
