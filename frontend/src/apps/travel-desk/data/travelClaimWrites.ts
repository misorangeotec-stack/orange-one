import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { ClaimLineInput, ClaimPreview, ActualTravelInput } from "../types";

/**
 * The expense claim.
 *
 * ⚠ NOTHING IN THIS FILE DECIDES A FIGURE. Every cap, every daily-allowance day
 *   and every disallowance comes from `fms_travel_preview_claim`, which is the
 *   same `fms_travel_check_claim` the submit path runs. This is a deliberate
 *   divergence from the OCPI pattern, where branch rules are enforced in the
 *   form AND in SQL and the two copies are kept in step by hand: money rules
 *   must not have two authors, so the form asks the server what the answer is
 *   rather than working it out and hoping they agree.
 *
 * ⚠ AMOUNTS GO AS TEXT, like everywhere else in this module. The SQL reads them
 *   with `nullif(btrim(...), '')::numeric`, so "", "   " and a missing key all
 *   become NULL. A real JSON number works until somebody clears the box, at
 *   which point 0 and "not answered" arrive identically — and on a claim line
 *   those two mean very different things.
 */

const s = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "" : String(v);

/**
 * Every field the money engine reads, in the shape it reads them.
 *
 * ⚠ THE ID IS PASSED IN, NOT TAKEN FROM THE LINE, because the two callers need
 *   different ones. `check_claim` echoes whatever `id` it is given straight back
 *   as `line_id`, and the form needs that to put each answer against the row it
 *   belongs to — including rows that have never been saved and have no database
 *   id at all. `save_claim_draft`, by contrast, reads `id` as a real row id and
 *   REFUSES one that does not belong to the trip. So the preview sends the
 *   on-screen key and the save sends the stored id or nothing.
 */
const lineJson = (l: ClaimLineInput, id: string | null): Record<string, unknown> => ({
  ...(id ? { id } : {}),
  category_id: s(l.categoryId),
  city_id: s(l.cityId),
  spent_on: s(l.spentOn),
  description: s(l.description),
  amount: s(l.amount),
  gst_amount: s(l.gstAmount),
  vendor: s(l.vendor),
  gstin: s(l.gstin),
  invoice_no: s(l.invoiceNo),
  has_receipt: l.hasReceipt,
  self_declared: l.selfDeclared,
  nights: s(l.nights),
  persons: s(l.persons),
  days: s(l.days),
  km: s(l.km),
  guests: s(l.guests),
  meal_kind: s(l.mealKind),
  vehicle_type: s(l.vehicleType),
  full_day_rental: l.fullDayRental,
  over_cap_evidence: l.overCapEvidence,
  hod_approved: l.hodApproved,
  director_approved: l.directorApproved,
  doc_path: s(l.docPath),
  ...(l.aiExtracted ? { ai_extracted: l.aiExtracted } : {}),
});

/**
 * The live preview.
 *
 * ⚠ IT IS SENT THE LINES ON SCREEN, NOT THE LINES IN THE DATABASE. That is what
 *   makes a cap appear as somebody types rather than after they save. The
 *   engine writes nothing, so asking it about an unsaved line is free.
 *
 * ⚠ `date`, NOT `spent_on`. The preview goes straight to `check_claim`, whose
 *   key for the date a line was spent on is `date`. `save_claim_draft` reads
 *   `spent_on` because that is the column. Two callers, two vocabularies, and
 *   sending the wrong one silently loses the day the line belongs to — which
 *   decides its city, and therefore its tier and its cap.
 */
export async function previewClaim(
  tripId: string,
  lines: ClaimLineInput[],
): Promise<ClaimPreview> {
  const { data, error } = await db.rpc("fms_travel_preview_claim", {
    p_trip: tripId,
    p: lines.map((l) => ({ ...lineJson(l, l.id ?? l.key), date: s(l.spentOn) })),
  });
  if (error) throw new Error(error.message);
  return data as ClaimPreview;
}

/** What actually happened — and the four DA inputs only the traveller knows. */
export async function recordActualTravel(
  tripId: string,
  input: ActualTravelInput,
): Promise<void> {
  const { error } = await db.rpc("fms_travel_record_actual_travel", {
    p_trip: tripId,
    p: {
      actual_departure_date: s(input.actualDepartureDate),
      actual_return_date: s(input.actualReturnDate),
      actual_departure_time: s(input.actualDepartureTime),
      actual_return_time: s(input.actualReturnTime),
      customer_provided: s(input.customerProvided),
      is_company_conference: input.isCompanyConference,
      family_joined_from: s(input.familyJoinedFrom),
      family_joined_to: s(input.familyJoinedTo),
    },
  });
  if (error) throw new Error(error.message);
}

/**
 * Replace the claim lines whole.
 *
 * ⚠ WHOLE, NOT A DIFF — the same reasoning as the passenger list. Sending only
 *   what changed means the client decides what changed, which is how a deleted
 *   row survives. Line ids are sent back so an uploaded receipt is not orphaned
 *   by a re-save.
 */
export async function saveClaimDraft(
  tripId: string,
  lines: ClaimLineInput[],
): Promise<number> {
  const { data, error } = await db.rpc("fms_travel_save_claim_draft", {
    p_trip: tripId,
    p: lines.map((l) => lineJson(l, l.id ?? null)),
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** File the claim. The server re-prices every line; the preview never decides. */
export async function submitClaim(tripId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_submit_claim", { p_trip: tripId });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Nothing to claim.
 *
 * ⚠ IT DOES NOT ALWAYS CLOSE THE TRIP, and the button says so. The daily
 *   allowance needs no receipt and an advance already paid still has to come
 *   back, so this closes the trip outright only when both are zero — otherwise
 *   it files a zero-expense claim that still has to be reviewed and settled.
 */
export async function noClaim(tripId: string, reason?: string | null): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_no_claim", {
    p_trip: tripId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** The reporting manager approves the claim, or sends it back with a reason. */
export async function decideClaim(
  tripId: string,
  decision: "approve" | "return",
  note?: string | null,
): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_decide_claim", {
    p_trip: tripId,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** What the extractor read off a bill. Every field is a SUGGESTION. */
export interface BillReading {
  vendor: string;
  invoiceNo: string;
  date: string;
  city: string;
  amount: number | null;
  gstAmount: number | null;
  gstin: string;
  /** A short free-text guess such as "Hotel" or "Taxi" — a hint, not a decision. */
  category: string;
  description: string;
  /** ⚠ §11.3 excludes foreign currency entirely, so anything but INR is a WARNING. */
  currency: string;
  confidence: "high" | "medium" | "low";
  model?: string;
}
