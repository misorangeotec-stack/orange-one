import { FIELD_LABEL, type QuotationDraft } from "./fieldSpec";
import type { QuotationVersion } from "../types";

/**
 * What changed between two quotation revisions.
 *
 * This is the answer to the brief's "whatever edits the salesperson makes, we
 * want to track all those edits". It is computed from the frozen
 * `field_payload` snapshots rather than logged as the user types: a keystroke
 * log answers "what did they do", and nobody wants that. What a reader actually
 * asks, weeks later, is "what is different between the quotation I sent and the
 * one they signed" — which is a comparison of two documents, not a transcript.
 *
 * ⚠ IT READS THE FROZEN PAYLOAD, NOT THE LIVE ROW. Comparing against the current
 *   deal would report changes made after the last generation as though they were
 *   part of it, and would show nothing at all once the deal moved on.
 */

export interface FieldChange {
  key: string;
  label: string;
  before: string;
  after: string;
  kind: "added" | "removed" | "changed";
}

export interface Revision {
  versionNo: number;
  generatedAt: string;
  generatedBy: string | null;
  /** Empty for version 1 — nothing precedes it, so nothing has changed yet. */
  changes: FieldChange[];
  /*
    ⚠ WHAT THIS REVISION WAS PRICED AT, taken from the version row rather than
      the deal. A negotiation that went ₹52L → ₹47L → ₹44L reads as ₹44L three
      times if the deal is consulted, because the deal only ever holds its
      current value.
  */
  dealValueAmount: number | null;
  dealValueCurrency: string | null;
  fxRate: number | null;
  /** The pair of papers frozen at this revision. Detail is null with no template. */
  pdfPath: string | null;
  ocPdfPath: string | null;
}

/** snake_case payload key → the label the form and the PDF use. */
const LABEL_BY_PAYLOAD_KEY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [camel, label] of Object.entries(FIELD_LABEL)) {
    const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[snake] = label;
  }
  return out;
})();

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
};

/**
 * Compare two frozen payloads.
 *
 * ⚠ KEYS ARE UNIONED, NOT TAKEN FROM EITHER SIDE. A field added to the form
 *   after an old version was frozen exists only in the newer payload; reading
 *   keys from the older one would silently hide it, which is precisely the
 *   change a reader most needs to see.
 */
export function diffPayloads(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldChange[] = [];

  for (const key of keys) {
    // Identity, not content: a change of customer is a different quotation, and
    // the id would render as a meaningless uuid in a diff.
    //
    // `salesperson_user_id` joins them for the same reason and one more: it can
    // change on its own, when a name that was typed is later PICKED from the
    // roster. Nothing about the deal changed — the paper still says the same
    // name — so a row reading "Salesperson (user): → 695b41c7-…" would report a
    // change that did not happen.
    if (
      key === "customer_id" ||
      key === "company_id" ||
      key === "location_id" ||
      key === "salesperson_user_id"
    )
      continue;

    const b = show(before[key]);
    const a = show(after[key]);
    if (b === a) continue;

    out.push({
      key,
      label: LABEL_BY_PAYLOAD_KEY[key] ?? key.replace(/_/g, " "),
      before: b,
      after: a,
      kind: b === "" ? "added" : a === "" ? "removed" : "changed",
    });
  }

  // Present in the form's own order, so a reader scanning a diff and a reader
  // scanning the form travel the same path.
  const order = Object.keys(FIELD_LABEL).map((c) => c.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`));
  out.sort((x, y) => {
    const ix = order.indexOf(x.key);
    const iy = order.indexOf(y.key);
    return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
  });
  return out;
}

/** Build the revision history for one deal, oldest first. */
export function revisionsOf(versions: QuotationVersion[]): Revision[] {
  const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  return sorted.map((v, i) => ({
    versionNo: v.versionNo,
    generatedAt: v.generatedAt,
    generatedBy: v.generatedBy,
    changes: i === 0 ? [] : diffPayloads(sorted[i - 1].fieldPayload, v.fieldPayload),
    dealValueAmount: v.dealValueAmount,
    dealValueCurrency: v.dealValueCurrency,
    fxRate: v.fxRate,
    pdfPath: v.pdfPath,
    ocPdfPath: v.ocPdfPath,
  }));
}

/** The payload shape a version freezes. Mirrors `payloadFromDraft`. */
export type FrozenFields = Record<keyof QuotationDraft | string, unknown>;
