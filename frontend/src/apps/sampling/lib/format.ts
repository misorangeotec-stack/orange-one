import { todayLocalIso } from "@/shared/lib/dueBuckets";
import type {
  ConfirmerSource,
  Direction,
  ReceiveVia,
  RequestStatus,
  RequirementType,
  SamplingRequest,
  SamplingSource,
} from "../types";

export const directionLabel = (d: Direction): string => (d === "inward" ? "Inward" : "Outward");

/**
 * A RECORD, not a ternary: this is the one place the source is turned into words,
 * and it feeds the detail page, the Requests-list column AND that column's select
 * filter. A ternary silently mislabels any member it doesn't name (an Export
 * sample read as "Domestic"); the record makes the compiler demand every one.
 */
const RECEIVE_VIA_LABEL: Record<ReceiveVia, string> = {
  import: "Import",
  domestic: "Domestic",
  export: "Export",
};
export const receiveViaLabel = (v: ReceiveVia): string => RECEIVE_VIA_LABEL[v] ?? "—";

/**
 * Which SOURCE BUCKET a request falls in. MIRRORS the SQL function
 * `fms_sampling_outward_source(text)` — export → export, ANYTHING ELSE →
 * domestic. That default is deliberate: outward rows raised before Export
 * existed carry 'import' and are domestic dispatches in practice. Change this
 * and you must change the SQL in the same commit, or the UI will offer an
 * action the server then refuses.
 *
 * TWO things read it: the receipt-confirmer master, and the per-source step
 * owners for send_sample / confirm_receipt / result.
 */
export const outwardSourceOf = (v: ReceiveVia): SamplingSource => (v === "export" ? "export" : "domestic");

/** The confirmer master's own name for the same rule (SQL twin: `fms_sampling_confirmer_source`). */
export const confirmerSourceOf: (v: ReceiveVia) => ConfirmerSource = outwardSourceOf;

export const requirementTypeLabel = (t: RequirementType | null): string =>
  t === "competitor" ? "Competitor Sample Testing" : t === "new_product" ? "New Supplier / Product Testing" : "—";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  awaiting_receipt: "Awaiting sample receipt",
  awaiting_send: "Awaiting sample dispatch",
  awaiting_confirm: "Awaiting receipt confirmation",
  awaiting_testing: "Awaiting testing",
  awaiting_result: "Awaiting result",
  awaiting_handover: "Awaiting result handover",
  awaiting_collect: "Awaiting sample collection",
  awaiting_sample_received: "Awaiting sample receipt",
  awaiting_sample_to_lab: "Awaiting receipt & send to lab",
  awaiting_lab_process: "With the lab",
  awaiting_result_received: "Awaiting result receipt",
  closed: "Closed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** Tailwind text/bg classes per status (mirrors the app's status-pill palette). */
export const STATUS_TONE: Record<RequestStatus, string> = {
  awaiting_receipt: "text-orange bg-orange-soft",
  awaiting_send: "text-orange bg-orange-soft",
  awaiting_confirm: "text-orange bg-orange-soft",
  awaiting_testing: "text-navy bg-navy/[0.06]",
  awaiting_result: "text-navy bg-navy/[0.06]",
  awaiting_handover: "text-orange bg-orange-soft",
  awaiting_collect: "text-orange bg-orange-soft",
  awaiting_sample_received: "text-orange bg-orange-soft",
  awaiting_sample_to_lab: "text-orange bg-orange-soft",
  // Navy, like `awaiting_testing`: work is under way elsewhere, not waiting on a hand-off.
  awaiting_lab_process: "text-navy bg-navy/[0.06]",
  awaiting_result_received: "text-orange bg-orange-soft",
  closed: "text-ryg-green bg-[#E9F8EF]",
  on_hold: "text-grey bg-page",
  cancelled: "text-grey-2 bg-page",
};

/** Human label for the lab-testing decision (inward only). */
export const labTestingLabel = (v: boolean | null): string =>
  v === true ? "Required" : v === false ? "Not required" : "—";

/* ------------------------------- step dates -------------------------------- */

/**
 * Every step date records something that ALREADY happened, so it opens on today
 * and caps there — backdating is fine, post-dating is not. These two are the one
 * place that rule is written; each step modal pre-fills with `stepDateDefault`,
 * puts `todayIso()` in the input's `max`, and re-checks with `futureDateError`
 * before saving (a typed date bypasses `max` in several browsers).
 *
 * THE FORECAST DATES ARE THE EXCEPTION and are deliberately NOT capped, because
 * they are supposed to be in the future: legacy testing's `tentativeResultDate`,
 * lab_process's `labTentativeDate`, and confirm_receipt's `partyTestingDate`
 * (when the party expects to test what we sent). None of them goes through
 * `futureDateError`, and none of their inputs carries a `max`.
 */
export const todayIso = todayLocalIso;

/** The stored date if there is one, else today — never blank. */
export const stepDateDefault = (stored: string | null): string => stored ?? todayLocalIso();

export const futureDateError = (iso: string, label: string): string | null =>
  iso && iso > todayLocalIso() ? `${label} cannot be in the future.` : null;

/** yyyy-mm-dd → dd-mm-yyyy (numeric, per the portal convention). */
export const dmy = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10).split("-").reverse().join("-") : "—";

/** A short one-line label for the request's product / party, for tables. */
export const requestSubject = (r: SamplingRequest): string => r.productDesc ?? r.partyName ?? "—";

/* ----------------------------- total quantity ------------------------------ */

export interface QtySum {
  /** The total, ready to print ("1,000 ml + 2 kg"). Empty when nothing could be added. */
  text: string;
  /** The raw lines that carried no leading number, so a caller can say they were left out. */
  skipped: string[];
}

/**
 * THE one place a request's sample quantities are added up.
 *
 * `SampleItem.quantity` is FREE TEXT ("500 ml", "2 kg", "500"), so this parses a
 * leading number and treats the rest as the unit, then GROUPS BY UNIT: 500 ml +
 * 500 ml + 2 kg reads "1,000 ml + 2 kg", never a meaningless bare 1002. That is
 * why this does not reuse the Import/Procurement `sumQty` — that one takes a
 * number and a unit off separate columns and collapses mixed units to "mixed",
 * which it can afford because a requisition line has a real unit column.
 *
 * A line with no leading number CANNOT be added; it lands in `skipped` so the
 * caller can say so, rather than silently under-reporting the total.
 *
 * Falls back to the legacy single `colourQty` string for rows raised before the
 * sample_items grid existed, so an old outward request still totals.
 */
export const totalSampleQty = (r: SamplingRequest): QtySum => {
  const values = r.sampleItems.length > 0 ? r.sampleItems.map((it) => it.quantity) : [r.colourQty ?? ""];

  // Insertion-ordered, so the total reads in the order the lines were entered.
  const groups = new Map<string, { unit: string; total: number }>();
  const skipped: string[] = [];

  for (const raw of values) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    // Thousands separators first — "1,000 ml" is one number, not "1".
    const m = /^([0-9]*\.?[0-9]+)\s*(.*)$/.exec(value.replace(/,/g, ""));
    if (!m) {
      skipped.push(value);
      continue;
    }
    const unit = m[2].trim();
    const key = unit.toLowerCase();
    const at = groups.get(key);
    if (at) at.total += Number(m[1]);
    else groups.set(key, { unit, total: Number(m[1]) });
  }

  const text = [...groups.values()]
    .map((g) => {
      // 3 dp, like the Import convention: fractional quantities without float noise.
      const n = Math.round(g.total * 1000) / 1000;
      const num = n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
      return g.unit ? `${num} ${g.unit}` : num;
    })
    .join(" + ");

  return { text, skipped };
};
