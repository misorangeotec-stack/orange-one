import { todayLocalIso } from "@/shared/lib/dueBuckets";
import type {
  Direction,
  ReceiveVia,
  RequestStatus,
  RequirementType,
  SamplingRequest,
} from "../types";

export const directionLabel = (d: Direction): string => (d === "inward" ? "Inward" : "Outward");

export const receiveViaLabel = (v: ReceiveVia): string => (v === "import" ? "Import" : "Domestic");

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
 * The one date deliberately NOT capped is testing's `tentativeResultDate`, which
 * is a forecast and is supposed to be in the future.
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
