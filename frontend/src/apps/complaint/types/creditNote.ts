/**
 * Customer Credit Note — the fourth option on "Raise a complaint".
 *
 *   raise → MANAGEMENT APPROVAL (cn_approval)  approve → TALLY (cn_tally) → closed
 *                                               reject  → rejected
 *
 * Its own table (fms_complaint_credit_notes), not a fourth complaint type: a
 * credit note has no LOT, item or invoice, and every complaint screen assumes
 * those exist. See migration 20270201120000.
 */

export type CreditNoteStatus = "awaiting_cn_approval" | "awaiting_cn_tally" | "closed" | "rejected";

export const CREDIT_NOTE_STATUS_LABEL: Record<CreditNoteStatus, string> = {
  awaiting_cn_approval: "Awaiting management approval",
  awaiting_cn_tally: "Waiting for Tally entry",
  closed: "Closed",
  rejected: "Rejected",
};

/** cyan/violet/emerald — `teal` and `blue` are overridden in the Tailwind config and render nothing. */
export const CREDIT_NOTE_STATUS_TONE: Record<CreditNoteStatus, string> = {
  awaiting_cn_approval: "bg-violet-50 text-violet-700",
  awaiting_cn_tally: "bg-amber-50 text-amber-700",
  closed: "bg-grey-1 text-grey-2",
  rejected: "bg-red-50 text-red-700",
};

export interface CreditNote {
  id: string;
  cnNo: string;
  status: CreditNoteStatus;
  currentStep: string | null;
  raisedBy: string | null;
  requesterName: string;
  companyId: string | null;
  partyId: string | null;
  /** FROZEN AT SUBMIT, like a complaint's partyName. */
  partyName: string;
  /** From the Tally salesperson list, or typed. */
  salespersonName: string;
  /** Who agreed to it — one of APPROVED_BY_NAMES, or typed. */
  approvedByName: string;
  reason: string;
  amount: number;
  details: string;
  submittedAt: string;

  aprDecision: "approve" | "reject" | null;
  aprNote: string | null;
  aprAt: string | null;
  aprBy: string | null;

  tallyNo: string | null;
  tallyRemarks: string | null;
  tallyAt: string | null;
  tallyBy: string | null;

  closedAt: string | null;
  createdAt: string;
}

/** 'raise' = supporting papers attached when raising; 'tally' = the posted voucher. */
export type CreditNoteDocSlot = "raise" | "tally";

export interface CreditNoteDoc {
  id: string;
  creditNoteId: string;
  stepKey: string;
  slot: CreditNoteDocSlot;
  /** cn/<credit-note-id>/<slot>/<epoch>-<filename> in fms-complaint-docs. */
  path: string;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
}

/** The names "Approved by" offers. Not a restriction — any typed name is accepted. */
export const APPROVED_BY_NAMES = ["Karan sir", "Ayush sir", "Manmohan sir", "Nakul sir"];

/** ₹ with Indian grouping — 1,25,000.00. */
export const formatCnAmount = (n: number): string =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
