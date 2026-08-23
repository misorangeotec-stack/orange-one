/**
 * GSTIN parsing — format, checksum, PAN and state code.
 *
 * ⚠ THIS IS THE MIRROR, NOT THE AUTHORITY.
 *   public.fms_customer_validate_gstin() in
 *   supabase/migrations/20260802120100_add_fms_customer_requests.sql implements
 *   the identical algorithm, and fms_customer_submit_request re-runs it on every
 *   submission. This copy exists ONLY so the wizard can underline a bad GSTIN
 *   before the user presses Next. A client that skips its check gains nothing.
 *   The two are verified against each other by the fixtures at the bottom.
 *
 * Layout: 2 state + 10 PAN + 1 entity + 1 'Z' + 1 check = 15 characters.
 */
import type { CustomerType, GstState } from "./types";

/**
 * ⚠ THE VALIDATORS, THE LOOKUP TYPES AND lookupGstin NOW LIVE IN shared/lib/gstin.ts.
 *   OCPI needs the same GSTIN handling — mst_parties has no address on any row,
 *   so a lookup is the only way to fill one without typing — and a second copy of
 *   a checksum algorithm that already has a SQL twin was not worth having. They
 *   are re-exported here so this file stays the one import site for onboarding.
 */
export {
  normaliseGstin, isGstinFormatValid, gstinChecksumOk, panFromGstin, stateCodeFromGstin,
  isPanValid, factoryAddressFrom, lookupGstin,
} from "@/shared/lib/gstin";
export type { FiledReturn, GstCompliance, AdditionalPlace, GstinLookup } from "@/shared/lib/gstin";

import {
  normaliseGstin, isGstinFormatValid, gstinChecksumOk, panFromGstin, stateCodeFromGstin,
} from "@/shared/lib/gstin";
import type { GstinLookup, GstCompliance, FiledReturn } from "@/shared/lib/gstin";

export type GstinError = "empty" | "length" | "format" | "checksum" | "unknown_state";

export interface GstinParse {
  ok: boolean;
  gstin: string;
  pan: string | null;
  stateCode: string | null;
  stateName: string | null;
  error: GstinError | null;
  /** Ready to show under the field. */
  message: string | null;
}

/**
 * Everything the wizard derives from a typed GSTIN, in one call.
 * `states` comes from the store (seeded reference data), never a local constant —
 * the submit RPC validates against that same table, so a hard-coded list here
 * would eventually reject a GSTIN the server would happily accept.
 */
export function parseGstin(raw: string, states: GstState[]): GstinParse {
  const g = normaliseGstin(raw);
  const base: GstinParse = {
    ok: false, gstin: g, pan: null, stateCode: null, stateName: null,
    error: null, message: null,
  };

  if (!g) return { ...base, error: "empty", message: null };
  if (g.length !== 15) {
    return {
      ...base,
      error: "length",
      message: `A GSTIN is 15 characters — this one has ${g.length}.`,
    };
  }
  if (!isGstinFormatValid(g)) {
    return {
      ...base,
      error: "format",
      message: "That does not look like a GSTIN. Expected 2 digits, 10 PAN characters, then 3 more.",
    };
  }
  if (!gstinChecksumOk(g)) {
    return {
      ...base,
      error: "checksum",
      message: "This GSTIN fails its check digit — one character is probably mistyped.",
    };
  }

  const stateCode = stateCodeFromGstin(g);
  const state = states.find((s) => s.code === stateCode);
  if (!state) {
    return {
      ...base,
      stateCode,
      error: "unknown_state",
      message: `GST state code ${stateCode} is not recognised. Ask an administrator to add it.`,
    };
  }

  return {
    ok: true,
    gstin: g,
    pan: panFromGstin(g),
    stateCode,
    stateName: state.name,
    error: null,
    message: null,
  };
}

/* ── The API-lookup seam ───────────────────────────────────────────────── */

/** One filed GST return. `period` is the tax period covered, not the filing date. */
/**
 * A lookup frozen onto the request, so approvers days later read the same
 * evidence Sales saw — without spending another paid call per visit.
 *
 * ⚠ `gstin` IS LOAD-BEARING, not decoration: fms_customer_write_form nulls the
 *   whole snapshot when it stops matching the request's gst_number. A snapshot
 *   describing a different taxpayer is worse than none, because it still renders
 *   as fact.
 */
export interface GstinSnapshot extends GstinLookup {
  gstin: string;
  /** ISO instant the lookup ran — distinct from compliance.syncedOn, which is
   *  when the PROVIDER last refreshed its cache. Both matter, for different
   *  reasons, so both are kept. */
  lookedUpAt: string;
}

export function toSnapshot(gstin: string, d: GstinLookup): GstinSnapshot {
  return { ...d, gstin: normaliseGstin(gstin), lookedUpAt: new Date().toISOString() };
}

/**
 * Customer type from the portal's nature-of-business list — WHEN IT IS CERTAIN.
 *
 * ⚠ ONLY TWO OF THE SIX TYPES ARE GST FACTS. "Factory / Manufacturing" means
 *   manufacturer and "Export" means exporter. The other four — dealer,
 *   distributor, trader, end user — are COMMERCIAL RELATIONSHIPS that GST does
 *   not model at all: the portal knows only "Wholesale Business" and "Retail
 *   Business", and cannot possibly know whether a wholesaler is our distributor
 *   or a dealer. Guessing between them would silently prefill a required field
 *   that feeds the credit decision. Deliberately unmapped — the rep decides,
 *   with the portal's wording shown next to the box as a hint.
 *
 * ⚠ AMBIGUITY YIELDS NULL, NOT A PREFERENCE. A manufacturer who also exports
 *   matches both rules, and there is no principled winner — so nothing is
 *   selected and the rep picks. Same rule as factoryAddressFrom.
 */
export function customerTypeFrom(nba: string[] | undefined | null): CustomerType | null {
  if (!nba?.length) return null;
  const hits = new Set<CustomerType>();
  for (const n of nba) {
    if (/factory|manufactur/i.test(n)) hits.add("manufacturer");
    if (/export/i.test(n)) hits.add("exporter");
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** The portal's own wording, for showing beside a field we would not auto-fill. */
export function natureOfBusinessHint(c: GstCompliance | null | undefined): string | null {
  const nba = c?.natureOfBusiness;
  return nba?.length ? nba.join(", ") : null;
}

/** True when the portal reports anything other than an active registration. */
export function isInactiveStatus(status: string | null | undefined): boolean {
  return Boolean(status) && !/^active$/i.test(String(status).trim());
}

/** The most recent return of a given type, or null. Returns arrive newest-first. */
export function latestReturn(c: GstCompliance | null, type: string): FiledReturn | null {
  if (!c) return null;
  return c.returns.find((r) => r.type.toUpperCase() === type.toUpperCase()) ?? null;
}

/* ── Fixtures ──────────────────────────────────────────────────────────────
 * Verified byte-for-byte against public.fms_customer_validate_gstin() and an
 * independent implementation. If you change the algorithm, these must still
 * hold on BOTH sides.
 *
 *   VALID
 *     27AAPFU0939F1ZV   Maharashtra    PAN AAPFU0939F
 *     24AAACC1206D1ZM   Gujarat        PAN AAACC1206D
 *     22AAAAA0000A1ZC   Chhattisgarh   (the doc example — note the check char is C, not 5)
 *     07AAACG2115R1ZJ   Delhi
 *     33AABCT1234C1Z3   Tamil Nadu
 *     29AAGCB7383J1Z4   Karnataka
 *     19AAACI1195H1ZJ   West Bengal
 *     06AABCS1429B1ZY   Haryana
 *
 *   INVALID
 *     27AAPFU0939F1ZX   check digit wrong
 *     27AAPFU0939F1AV   position 14 is not 'Z'
 *     27AAPFU0939F1Z    too short
 *     AA27APFU0939F1ZV  state code is not numeric
 * ---------------------------------------------------------------------- */
