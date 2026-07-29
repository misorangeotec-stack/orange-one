/**
 * Customer Creation FMS — display helpers. Pure, no React.
 */
import {
  CONSUMPTION_BAND_OPTIONS, CUSTOMER_TYPE_OPTIONS, PAYMENT_TERMS_OPTIONS,
  PRINTING_APPLICATION_OPTIONS, SECURITY_OFFERED_OPTIONS, CUSTOMER_LIVE_STATUS_OPTIONS,
  type CustomerRequest, type CustomerStatus,
} from "./types";

const labelFrom = <T extends string>(
  opts: readonly { value: T; label: string }[], v: T | null | undefined,
): string => (v ? (opts.find((o) => o.value === v)?.label ?? v) : "—");

export const customerTypeLabel   = (v: CustomerRequest["customerType"]) => labelFrom(CUSTOMER_TYPE_OPTIONS, v);
export const consumptionLabel    = (v: CustomerRequest["monthlyInkConsumption"]) => labelFrom(CONSUMPTION_BAND_OPTIONS, v);
export const paymentTermsLabel   = (v: CustomerRequest["paymentTerms"]) => labelFrom(PAYMENT_TERMS_OPTIONS, v);
export const securityLabel       = (v: CustomerRequest["securityOffered"]) => labelFrom(SECURITY_OFFERED_OPTIONS, v);
export const liveStatusLabel     = (v: CustomerRequest["customerStatus"]) => labelFrom(CUSTOMER_LIVE_STATUS_OPTIONS, v);

export const printingLabel = (v: string) =>
  PRINTING_APPLICATION_OPTIONS.find((o) => o.value === v)?.label ?? v;

export const printingListLabel = (vs: string[]): string =>
  vs.length ? vs.map(printingLabel).join(", ") : "—";

/** dd-mm-yyyy — the house date format across Orange One. */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function dmyTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dmy(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ₹ with Indian digit grouping (1,23,45,678). `numeric` columns arrive from
 * PostgREST as strings, so this accepts either and never trusts the type.
 */
export function inr(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function yesNo(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v ? "Yes" : "No";
}

/** A value for a read-only field, with the house em-dash for blanks. */
/**
 * What each A–E grade actually means.
 *
 * ⚠ THIS LIVES HERE, NOT IN THE PANEL THAT SETS IT. It began as a private const
 *   inside SalesHeadPanel, which meant the ONE screen where the meaning was
 *   already obvious (a dropdown you are actively choosing from) was the only
 *   screen that showed it — while the Director's approval panel, the request
 *   detail and the Excel export all rendered a bare letter to people who had
 *   never seen the list. A grade nobody can read is not a grade.
 */
export const CUSTOMER_CATEGORY_MEANING: Record<string, string> = {
  A: "Key account — highest volume and reliability",
  B: "Strong, regular buyer",
  C: "Steady but modest",
  D: "Occasional or unproven",
  E: "Marginal — watch the exposure",
};

/** Just the meaning, or null when the grade is unset or unrecognised. */
export const customerCategoryMeaning = (c: string | null | undefined): string | null =>
  (c && CUSTOMER_CATEGORY_MEANING[c]) || null;

/** "A — Key account…", for one-line renderings like the Excel export. */
export const customerCategoryLabel = (c: string | null | undefined): string => {
  if (!c) return "";
  const m = CUSTOMER_CATEGORY_MEANING[c];
  return m ? `${c} — ${m}` : c;
};

export const orDash = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "—" : String(v);

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  draft:              "Draft",
  pending_accounts:   "Pending accounts",
  pending_sales_head: "Pending sales head",
  pending_director:   "Pending director",
  pending_tally:      "Pending Tally",
  completed:          "Completed",
  rejected:           "Rejected",
  rework:             "Needs changes",
  on_hold:            "On hold",
  cancelled:          "Cancelled",
};

export const statusLabel = (s: CustomerStatus): string => STATUS_LABEL[s] ?? s;

/** How a request is referred to in prose and page titles. */
export const requestSubject = (r: CustomerRequest): string =>
  r.legalName?.trim() || r.tradeName?.trim() || "(unnamed customer)";

export const requestRef = (r: CustomerRequest): string => r.reqNo ?? "Draft";

/** The stage that bounced or refused a request, in words. */
export const stageLabel = (stage: string | null): string =>
  stage === "accounts"   ? "Accounts"
  : stage === "sales_head" ? "Sales Head"
  : stage === "director"   ? "Director"
  : stage ?? "—";
