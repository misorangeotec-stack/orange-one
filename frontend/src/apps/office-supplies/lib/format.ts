import type { RequestStatus, RequestType } from "../types";

export const requestTypeLabel = (t: RequestType): string =>
  t === "services_maintenance" ? "Services / Maintenance" : "New requirement";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending_first_approval: "Awaiting first approval",
  pending_second_approval: "Awaiting second approval",
  pending_handover: "Awaiting handover",
  delivered: "Delivered",
  rejected: "Rejected",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

/** Tailwind text/bg classes per status (mirrors the app's status-pill palette). */
export const STATUS_TONE: Record<RequestStatus, string> = {
  pending_first_approval: "text-orange bg-orange-soft",
  pending_second_approval: "text-orange bg-orange-soft",
  pending_handover: "text-navy bg-navy/[0.06]",
  delivered: "text-ryg-green bg-[#E9F8EF]",
  rejected: "text-ryg-red bg-[#FDECEC]",
  on_hold: "text-grey bg-page",
  cancelled: "text-grey-2 bg-page",
};

/** yyyy-mm-dd → dd-mm-yyyy (numeric, per the portal convention). */
export const dmy = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10).split("-").reverse().join("-") : "—";
