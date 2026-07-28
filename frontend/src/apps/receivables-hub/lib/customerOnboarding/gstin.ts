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
import type { GstState } from "./types";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Base-36: the index of a character IS its value. */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Upper-case, and drop the spaces and hyphens people paste in from emails. */
export function normaliseGstin(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[\s-]+/g, "").trim();
}

export function isGstinFormatValid(g: string): boolean {
  return GSTIN_RE.test(g);
}

/**
 * The mod-36 check character.
 *
 * Index each of the first 14 characters in base 36; multiply by an alternating
 * weight of 1, 2, 1, 2…; for each product add floor(p / 36) + (p mod 36); the
 * check character's value is (36 - sum mod 36) mod 36.
 */
export function gstinChecksumOk(g: string): boolean {
  if (g.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = ALPHABET.indexOf(g[i]);
    if (v < 0) return false;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36] === g[14];
}

/**
 * Characters 3–12 of the GSTIN.
 *
 * ⚠ OFF-BY-ONE WARNING. This is slice(2, 12): 0-indexed, end-EXCLUSIVE, so it
 *   yields 10 characters starting at the third. The SQL twin is
 *   `substring(g from 3 for 10)`: 1-indexed and length-based. They agree. Get
 *   either wrong and every PAN in the system is silently one character off — the
 *   kind of bug that surfaces months later during a tax filing.
 */
export function panFromGstin(g: string): string {
  return g.slice(2, 12);
}

export function stateCodeFromGstin(g: string): string {
  return g.slice(0, 2);
}

export function isPanValid(p: string): boolean {
  return PAN_RE.test((p ?? "").toUpperCase().trim());
}

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

export interface GstinLookup {
  legalName: string | null;
  tradeName: string | null;
  registeredAddress: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  /** 'Active' / 'Cancelled' / … as the portal reports it. */
  status: string | null;
  registrationDate: string | null;
  constitution: string | null;
}

/**
 * Ask the GST portal who this GSTIN belongs to.
 *
 * Goes through the `gstin-lookup` Edge Function on the identity project, NOT
 * straight to the provider: the API key is billable, and anything in the
 * frontend bundle is public (VITE_* included), so a browser-side call would
 * publish a key anyone could spend. Same reasoning as analyze-receivables.
 *
 * ⚠ A MISS IS NOT AN ERROR. No key configured, provider down, GSTIN unknown —
 *   all resolve to null, and the wizard treats null exactly like the offline
 *   case: the user types the address themselves. A lookup that could break the
 *   form would be worse than no lookup.
 *
 * ⚠ COST: this is pay-per-call, so callers MUST only invoke it for a GSTIN that
 *   already passed the local format + checksum test, and MUST cache per GSTIN.
 *   GstinField does both. Do not call it on every keystroke.
 */
export async function lookupGstin(gstin: string): Promise<GstinLookup | null> {
  const g = normaliseGstin(gstin);
  if (!isGstinFormatValid(g) || !gstinChecksumOk(g)) return null;

  try {
    const { supabase } = await import("@/core/platform/supabase");
    const { data, error } = await supabase.functions.invoke("gstin-lookup", { body: { gstin: g } });
    if (error) return null;
    const body = data as { ok?: boolean; found?: boolean; data?: GstinLookup } | null;
    if (!body?.ok || !body.found || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
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
