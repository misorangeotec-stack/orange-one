/**
 * GSTIN parsing and lookup — the PORTABLE half.
 *
 * WHY THIS LIVES IN shared/
 *   It was written for Customer Onboarding and sat under
 *   `apps/receivables-hub/lib/customerOnboarding/gstin.ts`. OCPI needs the same
 *   thing for the identical reason: mst_parties carries no address, no email and
 *   no phone on ANY of its 7,863 rows, so a GSTIN lookup is the only way to fill
 *   a customer's registered address without typing it.
 *
 *   Rather than copy the checksum algorithm — which would be a third
 *   implementation of it, after this and the SQL twin — the portable pieces moved
 *   here and the hub file now re-exports them. Its four consumers still import
 *   from `@hub/lib/customerOnboarding/gstin` and did not change.
 *
 * WHAT STAYED BEHIND: `parseGstin`, `toSnapshot`, `customerTypeFrom` and the
 * other helpers that depend on the hub's own `GstState` / `CustomerType` types.
 * They are onboarding-specific and dragging their types along would have made
 * this file import from an app, which is exactly backwards.
 *
 * ⚠ THIS IS THE MIRROR, NOT THE AUTHORITY.
 *   public.fms_customer_validate_gstin() in
 *   supabase/migrations/20260802120100_add_fms_customer_requests.sql implements
 *   the identical algorithm and re-runs it on every submission. This copy exists
 *   ONLY so a form can underline a bad GSTIN before the user presses Save.
 *
 * Layout: 2 state + 10 PAN + 1 entity + 1 'Z' + 1 check = 15 characters.
 */

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

export interface FiledReturn {
  type: string;
  fy: string;
  period: string;
  filedOn: string | null;
}

/**
 * The credit-relevant half of a lookup, from jamku.
 *
 * ⚠ NULLABLE, AND IT WILL BE NULL IN PRODUCTION SOMETIMES. It comes from the
 *   free tier (1000/day, 20/min); a 429 or a missing key yields null and the
 *   identity half still arrives. Every consumer must render without it.
 *
 * ⚠ CACHED. `syncedOn` is the date the provider last refreshed this record, and
 *   it can be months old. Never show a filing claim without showing that date.
 */
export interface GstCompliance {
  category: string | null;
  aggregateTurnover: string | null;
  aggregateTurnoverFy: string | null;
  filingFrequency: Record<string, string> | null;
  latestGstr1: string | null;
  latestGstr3b: string | null;
  eInvoiceMandated: string | null;
  /** Enabled to issue e-invoices — distinct from being mandated to. */
  eInvoiceEnabled: string | null;
  hsn: string[];
  natureOfBusiness: string[];
  centreJurisdiction: string | null;
  stateJurisdiction: string | null;
  returns: FiledReturn[];
  syncedOn: string | null;
  returnsSyncedOn: string | null;
}

/**
 * An additional place of business declared on the GSTIN.
 *
 * `nature` is the portal's own label for the premises — "Factory / Manufacturing",
 * "Warehouse / Depot", "Retail Business".
 */
export interface AdditionalPlace {
  address: string;
  nature: string | null;
}

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
  cancellationDate: string | null;
  constitution: string | null;
  /** Regular | Composition | … — a Composition dealer cannot pass on ITC. */
  taxpayerType: string | null;
  /** Appyflow only. Empty when it did not answer, or the GSTIN declares none. */
  additionalPlaces: AdditionalPlace[];
  compliance: GstCompliance | null;
  /** Which providers answered: ["appyflow", "jamku"]. */
  sources: string[];
}

/**
 * Which additional place is the FACTORY.
 *
 * ⚠ ONLY EVER RETURNS A LABELLED MATCH — never "the first one". A customer can
 *   declare a warehouse, a branch office and a godown; filling a factory field
 *   with a warehouse produces a confidently wrong address, which is worse than
 *   the blank box a rep would have filled correctly.
 */
export function factoryAddressFrom(places: AdditionalPlace[] | undefined | null): string | null {
  if (!places?.length) return null;
  const hit = places.find((p) => /factory|manufactur/i.test(p.nature ?? ""));
  return hit?.address || null;
}

/**
 * Ask the GST portal who this GSTIN belongs to.
 *
 * Goes through the `gstin-lookup` Edge Function on the identity project, NOT
 * straight to the provider: the API key is billable, and anything in the
 * frontend bundle is public (VITE_* included), so a browser-side call would
 * publish a key anyone could spend.
 *
 * ⚠ A MISS IS NOT AN ERROR. No key configured, provider down, GSTIN unknown —
 *   all resolve to null, and a caller must treat null exactly like the offline
 *   case: the user types the address themselves. A lookup that could break the
 *   form would be worse than no lookup.
 *
 * ⚠ COST: this is pay-per-call, so callers MUST only invoke it for a GSTIN that
 *   already passed the local format + checksum test, and MUST cache per GSTIN.
 *   Do not call it on every keystroke.
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
 *     22AAAAA0000A1ZC   Chhattisgarh   (the doc example — check char is C, not 5)
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
