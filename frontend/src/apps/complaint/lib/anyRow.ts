/**
 * ONE ROW SHAPE FOR COMPLAINTS AND CUSTOMER COMPENSATIONS.
 *
 * The user wants a compensation to sit beside every other complaint: in All
 * Complaints / My Complaints, and in Management Approval's Pending and
 * Completed tabs (and their Excel export). A compensation is its own table, so
 * the lists carry this union and read every cell through the getters below —
 * one place that knows how each kind answers "number", "party", "status"…
 */
import type { ComplaintRequest } from "../types";
import { COMPLAINT_TYPE_LABEL } from "../types";
import {
  CREDIT_NOTE_STATUS_LABEL,
  CREDIT_NOTE_STATUS_TONE,
  cnProductText,
  type CreditNote,
} from "../types/creditNote";
import { COMPLAINT_TYPE_TONE, STATUS_LABEL, STATUS_TONE, ageDays } from "./format";
import type { StepKey } from "./steps";

export type AnyRow =
  | { key: string; kind: "complaint"; r: ComplaintRequest; step?: StepKey }
  | { key: string; kind: "cn"; c: CreditNote };

export const COMPENSATION_LABEL = "Customer Compensation";
/** Orange: `teal` / `blue` are overridden in the Tailwind config and render nothing. */
const COMPENSATION_TONE = "bg-orange/10 text-orange";

export const complaintRow = (r: ComplaintRequest, step?: StepKey): AnyRow => ({
  key: step ? `${step}:${r.id}` : r.id,
  kind: "complaint",
  r,
  step,
});
export const cnRow = (c: CreditNote): AnyRow => ({ key: `cn:${c.id}`, kind: "cn", c });

export const rowNo = (x: AnyRow) => (x.kind === "cn" ? x.c.cnNo : x.r.complaintNo);
export const rowTypeLabel = (x: AnyRow) =>
  x.kind === "cn" ? COMPENSATION_LABEL : COMPLAINT_TYPE_LABEL[x.r.complaintType];
export const rowTypeTone = (x: AnyRow) =>
  x.kind === "cn" ? COMPENSATION_TONE : COMPLAINT_TYPE_TONE[x.r.complaintType];
export const rowParty = (x: AnyRow) => (x.kind === "cn" ? x.c.partyName : (x.r.partyName ?? "—"));
export const rowCompanyId = (x: AnyRow) => (x.kind === "cn" ? x.c.companyId : x.r.companyId);
/** The item a complaint is about, or the product a compensation is for. */
export const rowItem = (x: AnyRow) => (x.kind === "cn" ? cnProductText(x.c) : (x.r.itemName ?? "—"));
export const rowLot = (x: AnyRow) => (x.kind === "cn" ? "—" : (x.r.lotNo ?? "—"));
export const rowInvoice = (x: AnyRow) => (x.kind === "cn" ? "—" : (x.r.invoiceNo ?? "—"));
export const rowStatusLabel = (x: AnyRow) =>
  x.kind === "cn" ? CREDIT_NOTE_STATUS_LABEL[x.c.status] : STATUS_LABEL[x.r.status];
export const rowStatusTone = (x: AnyRow) =>
  x.kind === "cn" ? CREDIT_NOTE_STATUS_TONE[x.c.status] : STATUS_TONE[x.r.status];
export const rowRaisedAt = (x: AnyRow) => (x.kind === "cn" ? x.c.submittedAt : x.r.submittedAt);
export const rowRaisedBy = (x: AnyRow) => (x.kind === "cn" ? x.c.raisedBy : x.r.raisedBy);
/** A complaint ages from when the issue was noticed; a compensation from when it was raised. */
export const rowAgeDays = (x: AnyRow) =>
  x.kind === "cn" ? ageDays(x.c.submittedAt) : ageDays(x.r.issueIdentifiedAt);
