import { supabase } from "@/core/platform/supabase";
const db = supabase as any;

import type { LegKind, TripLegInput } from "../types";

/**
 * Booking: the legs, the documents, and the extractor.
 *
 * ⚠ THE EXTRACTOR FILLS A FORM; IT NEVER WRITES A ROW. `extractTravelDoc` takes
 *   a File and returns fields. It is given no trip id and it has no way to save
 *   anything — the screen puts what comes back into inputs, and a human presses
 *   Save. That is the `extract-card` contract, and it is what keeps an OCR
 *   misread out of a reimbursement: a fare read as 45,000 instead of 4,500 is a
 *   typo somebody catches, but the same number written straight into
 *   `ticket_cost` is a figure nobody looks at again.
 */

export const TRAVEL_DOCS_BUCKET = "fms-travel-docs";

/**
 * The slots the storage policy knows.
 *
 * ⚠ THIS LIST IS MIRRORED IN SQL by `fms_travel_doc_slot`, and a path naming
 *   anything else is refused outright rather than silently accepted. Adding a
 *   slot here alone would produce uploads that fail with a permission error
 *   nobody can explain.
 */
export type DocSlot = "ticket" | "hotel" | "receipt" | "approval" | "cancellation" | "mileage-log";

/**
 * Where a document lives: `<trip-id>/<slot>/<epoch>-<name>`.
 *
 * ⚠ THE FIRST SEGMENT IS LOAD-BEARING. The four storage policies derive the
 *   owning trip from it and reuse `fms_travel_can_see_trip`, so a file always
 *   names its own trip. One rule, two surfaces.
 */
export function travelDocPath(tripId: string, slot: DocSlot, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `${tripId}/${slot}/${Date.now()}-${safe}`;
}

/** Upload a document and return its path. Overwrites on the same path. */
export async function uploadTravelDoc(
  tripId: string,
  slot: DocSlot,
  file: File,
): Promise<string> {
  const path = travelDocPath(tripId, slot, file.name);
  const { error } = await supabase.storage
    .from(TRAVEL_DOCS_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

/** A short-lived link to a stored document. */
export async function travelDocUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(TRAVEL_DOCS_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** What the extractor read. Every field is a SUGGESTION for a human to confirm. */
export interface TicketReading {
  kind: LegKind | "";
  carrier: string;
  bookingRef: string;
  travelClass: string;
  fromCity: string;
  toCity: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  ticketCost: number | null;
  otherCharges: number | null;
  /** ⚠ §11.3 excludes foreign currency entirely, so anything but INR is a WARNING. */
  currency: string;
  passengers: string[];
  confidence: "high" | "medium" | "low";
  model?: string;
}

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });

/**
 * Read a ticket.
 *
 * ⚠ A FAILURE HERE IS NEVER FATAL. 415 (a file type Claude cannot read), 413
 *   (too big) and 422 (both models down) all come back as a thrown message the
 *   screen shows beside a form that still works. Reading a document is a
 *   convenience; typing it in is always available, and an extractor that blocked
 *   the booking when it was unavailable would be worse than no extractor.
 */
export async function extractTravelDoc(file: File, mode: "ticket" | "bill" = "ticket"): Promise<TicketReading> {
  const data = await toBase64(file);
  const { data: out, error } = await supabase.functions.invoke("extract-travel-doc", {
    body: { mode, file: { media_type: file.type || "application/pdf", data } },
  });
  if (error) {
    // The function's own message is far more useful than "Edge Function returned
    // a non-2xx status code", so dig it out of the response when there is one.
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        detail = body?.message || body?.error || detail;
      } catch {
        /* keep the original */
      }
    }
    throw new Error(detail);
  }
  if (out?.error) throw new Error(out.message || out.error);
  return out as TicketReading;
}

/** Create or update one booked leg. Returns its id. */
export async function saveLeg(
  tripId: string,
  input: TripLegInput,
  legId?: string | null,
): Promise<string> {
  const s = (v: unknown): string =>
    v === null || v === undefined || v === "" ? "" : String(v);

  const { data, error } = await db.rpc("fms_travel_save_leg", {
    p_trip: tripId,
    p_leg: legId ?? null,
    p: {
      kind: input.kind,
      direction: input.direction,
      from_city_id: s(input.fromCityId),
      to_city_id: s(input.toCityId),
      start_on: s(input.startOn),
      start_time: s(input.startTime),
      end_on: s(input.endOn),
      end_time: s(input.endTime),
      airline_id: s(input.airlineId),
      hotel_id: s(input.hotelId),
      bus_operator_id: s(input.busOperatorId),
      carrier_other: s(input.carrierOther),
      booking_ref: s(input.bookingRef),
      travel_class: s(input.travelClass),
      // ⚠ As TEXT, like every other money field in this module: the SQL reads
      //   them with `nullif(btrim(...), '')::numeric`, so "" and "   " and a
      //   missing key all become NULL. A real JSON number would work until
      //   somebody cleared the box, at which point 0 and "not answered" would
      //   arrive identically.
      ticket_cost: s(input.ticketCost),
      other_charges: s(input.otherCharges),
      refund_amount: s(input.refundAmount),
      doc_path: s(input.docPath),
      notes: s(input.notes),
      ...(input.aiExtracted ? { ai_extracted: input.aiExtracted } : {}),
    },
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function removeLeg(legId: string): Promise<void> {
  const { error } = await db.rpc("fms_travel_remove_leg", { p_leg: legId });
  if (error) throw new Error(error.message);
}

/** Close the booking step. Refuses a trip with nothing recorded on it. */
export async function completeBooking(tripId: string): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_complete_booking", { p_trip: tripId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function requestCancellation(tripId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("fms_travel_request_cancellation", {
    p_trip: tripId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * The desk cancels and the trip is routed by what is left to settle.
 *
 * ⚠ `kind` IS NOT COSMETIC. §4.1 makes a cancellation charge reimbursable when
 *   the reason is BUSINESS and not when it is personal, and phase 8 reads it to
 *   decide whether the charge may be claimed at all.
 */
export async function processCancellation(
  tripId: string,
  decision: "cancel" | "refuse",
  kind?: "business" | "personal" | null,
  note?: string | null,
): Promise<string> {
  const { data, error } = await db.rpc("fms_travel_process_cancellation", {
    p_trip: tripId,
    p_decision: decision,
    p_kind: kind ?? null,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
