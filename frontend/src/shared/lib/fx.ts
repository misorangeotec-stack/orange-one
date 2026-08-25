/**
 * Live foreign-exchange rate, shared across FMS modules.
 *
 * Lifted out of `apps/import/data/importWrites.ts` when OCPI needed the same
 * thing — the same move `shared/lib/gstin.ts` made out of receivables-hub. Two
 * copies of a rate fetcher is two answers to "what is a dollar worth", and they
 * would drift the first time one gained a fallback the other did not.
 *
 * The work happens server-side in the `import-fx-rate` Edge Function: it scrapes
 * xe.com (browsers cannot, for CORS) and falls back to two public FX APIs, with
 * a five-minute cache because FX drifts slowly and xe rate-limits scrapers.
 * `verify_jwt` stays ON for it — the caller is always a signed-in portal user.
 *
 * ⚠ THE NAME `import-fx-rate` IS HISTORICAL, not a scope. It is a plain
 *   currency-pair lookup with nothing Import-specific in it; renaming the
 *   deployed function to something neutral would break Import for the length of
 *   a deploy, for no gain. Read it as "the FX function", not "Import's".
 *
 * ⚠ THE RETURNED RATE IS A STARTING POINT, NEVER A LOCK. Every caller must let a
 *   person type over it: deals are negotiated at an agreed rate, and showing the
 *   live one instead would misstate the contract. Record which of the two was
 *   used — Import keeps `fx_rate`, OCPI adds `fx_rate_overridden` beside it.
 *
 * ⚠ AND FREEZE WHAT WAS USED. A rate re-derived at render time silently restates
 *   arithmetic a customer already agreed to. Import learned this by keeping
 *   `fx_rate_at_request` distinct from the payment's own `fx_rate`; OCPI freezes
 *   it onto each quotation version, next to the frozen document.
 */
import { supabase } from "@/core/platform/supabase";

export interface FxRate {
  /** Units of `to` per one unit of `from`. */
  rate: number;
  /** `xe.com` | `er-api` | `frankfurter` | `cache` — shown so a disputed conversion can be traced. */
  source: string;
  /** ISO timestamp, so a reader can see whether the figure is minutes or weeks old. */
  fetchedAt: string;
}

/**
 * Fetch a live `from`→`to` rate. Throws with a readable message on failure —
 * callers should surface it and leave the field editable rather than blocking,
 * since a hand-typed rate is always a legitimate answer.
 */
export async function fetchFxRate(from: string, to = "INR"): Promise<FxRate> {
  const { data, error } = await supabase.functions.invoke("import-fx-rate", { body: { from, to } });
  if (error) throw new Error(error.message);
  const d = data as { rate?: number; source?: string; fetched_at?: string; error?: string };
  if (!d || typeof d.rate !== "number" || d.error) throw new Error(d?.error || "Could not fetch a live rate");
  return { rate: d.rate, source: d.source ?? "unknown", fetchedAt: d.fetched_at ?? new Date().toISOString() };
}
