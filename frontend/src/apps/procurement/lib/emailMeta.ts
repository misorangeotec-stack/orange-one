// Per-step email content for RM Domestic (procurement) FMS notifications.
//
// This is the ONE place the design of every RM Domestic email lives. Each builder
// returns a generic payload (subject / eyebrow / headline / rows / items / note /
// CTA) that the send-email edge function renders with the shared branded shell.
// It reuses the app's own formatters (inr / qtyText) and item names so emails read
// exactly like the screens.
//
// RM Domestic is DOMESTIC — rupees only, no foreign currency; every amount is a
// single inr(...) value (unlike Import, which also shows a foreign line).
//
// Data source rule: build from what's in scope at the announce moment - method
// inputs for freshly-created docs (submit, sourcing, PO generate), and the store's
// existing rows for everything already persisted (approval, share, PI, GRN, ...).

import { inr, qtyText } from "./format";
import { formatDate } from "@/shared/lib/time";

// Structural shapes (a subset of the real domain types - the store's typed arrays
// satisfy these, so we avoid coupling to exact type names).
interface Named { id: string; name: string }
interface RequestLike { id: string; requestNo?: string | null; companyId?: string | null; categoryId?: string | null; requesterId?: string | null }
interface LineLike {
  id: string; requestId: string; itemId: string;
  quantity?: number | null; unit?: string | null;
  finalRate?: number | null; gstPct?: number | null;
  finalVendorId?: string | null; lineValue?: number | null;
}
interface PoLike {
  id: string; poNo?: string | null; vendorId?: string | null; companyId?: string | null;
  totalValue?: number | null; paymentTerms?: string | null;
  dispatchDate?: string | null; documentName?: string | null;
}
interface PoItemLike { id: string; poId: string; requestItemId: string; qty?: number | null; rate?: number | null; lineValue?: number | null }

export interface ProcurementEmailDeps {
  vendors: Named[];
  companies: Named[];
  categories: Named[];
  items: Named[];
  requests: RequestLike[];
  requestItems: LineLike[];
  pos: PoLike[];
  poItems: PoItemLike[];
}

export interface ProcurementEmailMeta {
  subject: string;
  eyebrow: string;
  headline: string;
  action: string;
  docLabel?: string;
  rows?: Array<{ label: string; value: string; sub?: string }>;
  items?: Array<{ name: string; meta?: string; value?: string; sub?: string }>;
  note?: { label?: string; text: string };
  ctaLabel: string;
  ctaPath: string;
  /** Carried verbatim into email_outbox.payload (jsonb), so it must be an index type. */
  [key: string]: unknown;
}

const B = "/procurement";
const dash = "-";

const PAYMENT_TERMS_LABEL: Record<string, string> = {
  full_advance: "Full advance",
  partial_advance: "Partial advance",
  credit: "Credit",
  on_delivery: "On delivery",
};

/** A sourcing line as typed by the sourcing person (whole-requisition path). */
interface SourcingLineInput { requestItemId: string; qty: number; rate: number; gstPct: number | null }

export function makeProcurementEmail(deps: ProcurementEmailDeps) {
  const { vendors, companies, categories, items, requests, requestItems, pos, poItems } = deps;

  const vName = (id?: string | null) => (id ? vendors.find((v) => v.id === id)?.name ?? dash : dash);
  const cName = (id?: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? dash : dash);
  const catName = (id?: string | null) => (id ? categories.find((c) => c.id === id)?.name ?? dash : dash);
  const iName = (id: string) => items.find((i) => i.id === id)?.name ?? "Unknown item";
  const lineOf = (id: string) => requestItems.find((l) => l.id === id);
  const poOf = (id: string) => pos.find((p) => p.id === id);
  const reqOf = (id: string) => requests.find((r) => r.id === id);
  const linesOfRequest = (requestId: string) => requestItems.filter((l) => l.requestId === requestId);
  const nameForPoItem = (poItemId: string) => {
    const pi = poItems.find((p) => p.id === poItemId);
    const line = pi ? requestItems.find((l) => l.id === pi.requestItemId) : undefined;
    return line ? iName(line.itemId) : "Item";
  };
  const vendorOfLines = (lines: LineLike[]) => vName(lines.find((l) => l.finalVendorId)?.finalVendorId);

  /** One item row from a request line (INR only). */
  const lineItem = (l: LineLike) => ({
    name: iName(l.itemId),
    meta: `${qtyText([{ qty: l.quantity ?? 0, unit: l.unit ?? "" }])}${l.finalRate != null ? ` @ ${inr(l.finalRate)}` : ""}${l.gstPct ? ` +${l.gstPct}% GST` : ""}`,
    value: inr(l.lineValue ?? null),
  });

  /** Totals across a set of request lines (INR only). */
  const totalsOf = (lines: LineLike[]) => {
    const inrTotal = lines.reduce((s, l) => s + (l.lineValue ?? 0), 0);
    return {
      row: { label: "Total", value: inr(inrTotal) },
      itemsRow: { label: "Items", value: `${lines.length} item${lines.length === 1 ? "" : "s"} · ${qtyText(lines.map((l) => ({ qty: l.quantity ?? 0, unit: l.unit ?? "" })))}` },
    };
  };

  const reasonNote = (label: string, reason?: string | null) =>
    reason && reason.trim() ? { label, text: reason.trim() } : undefined;

  return {
    // 1. Requisition raised → Sourcing team (no vendor/rate chosen yet)
    submitted(input: { companyId: string; categoryId: string | null; note: string | null; items: Array<{ itemId: string; quantity: number; unit: string; categoryId?: string | null }> }): ProcurementEmailMeta {
      const cat = input.categoryId ?? input.items[0]?.categoryId ?? null;
      return {
        subject: `New RM Domestic requisition - ${cName(input.companyId)}`,
        eyebrow: "New requisition", headline: "A purchase requisition needs sourcing",
        action: "raised a purchase requisition",
        rows: [
          { label: "Company", value: cName(input.companyId) },
          { label: "Category", value: catName(cat) },
          { label: "Items", value: `${input.items.length} item${input.items.length === 1 ? "" : "s"} · ${qtyText(input.items.map((l) => ({ qty: l.quantity, unit: l.unit })))}` },
        ],
        items: input.items.map((l) => ({ name: iName(l.itemId), meta: qtyText([{ qty: l.quantity, unit: l.unit }]) })),
        note: reasonNote("Note", input.note),
        ctaLabel: "Open Sourcing", ctaPath: `${B}/queues/sourcing`,
      };
    },

    // 2. Sourcing done → Approver(s). Whole-requisition path (saveSourcingRequest).
    sourced(input: { requestId: string; recommendedVendorId: string; vendorCount: number; lines: SourcingLineInput[] }): ProcurementEmailMeta {
      const req = reqOf(input.requestId);
      const rowItems = input.lines.map((l) => {
        const line = lineOf(l.requestItemId);
        const unit = line?.unit ?? "";
        const value = Math.round(l.qty * l.rate * (1 + (l.gstPct ?? 0) / 100) * 100) / 100;
        return {
          name: line ? iName(line.itemId) : "Item",
          meta: `${l.qty} ${unit}`.trim() + ` @ ${inr(l.rate)}${l.gstPct ? ` +${l.gstPct}% GST` : ""}`,
          value: inr(value),
          _v: value,
        };
      });
      const total = rowItems.reduce((s, r) => s + r._v, 0);
      return {
        subject: `Sourced - ready for approval${req?.requestNo ? ` (Req #${req.requestNo})` : ""}`,
        eyebrow: "Sourced", headline: "A sourced requisition needs your approval",
        action: "completed sourcing",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [
          { label: "Recommended vendor", value: vName(input.recommendedVendorId) },
          { label: "Quotes", value: `${input.vendorCount} vendor${input.vendorCount === 1 ? "" : "s"}` },
          { label: "Total", value: inr(total) },
          { label: "Items", value: `${input.lines.length} item${input.lines.length === 1 ? "" : "s"}` },
        ],
        items: rowItems.map(({ name, meta, value }) => ({ name, meta, value })),
        ctaLabel: "Open Approvals", ctaPath: `${B}/queues/approvals`,
      };
    },

    // 2b. Sourcing done → Approver(s). Legacy per-line path (saveSourcing).
    sourcedLine(input: { requestItemId: string; finalQty: number; finalRate: number; gstPct: number | null }): ProcurementEmailMeta {
      const line = lineOf(input.requestItemId);
      const req = line ? reqOf(line.requestId) : undefined;
      const value = Math.round(input.finalQty * input.finalRate * (1 + (input.gstPct ?? 0) / 100) * 100) / 100;
      return {
        subject: `Sourced - ready for approval${req?.requestNo ? ` (Req #${req.requestNo})` : ""}`,
        eyebrow: "Sourced", headline: "A sourced line needs your approval",
        action: "completed sourcing",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [
          ...(line ? [{ label: "Item", value: iName(line.itemId) }] : []),
          { label: "Total", value: inr(value) },
        ],
        items: line ? [{ name: iName(line.itemId), meta: `${input.finalQty} ${line.unit ?? ""}`.trim() + ` @ ${inr(input.finalRate)}${input.gstPct ? ` +${input.gstPct}% GST` : ""}`, value: inr(value) }] : [],
        ctaLabel: "Open Approvals", ctaPath: `${B}/queues/approvals`,
      };
    },

    // 3. Requisition/line approved → PO owner
    approved(entity: { kind: "line"; requestItemId: string } | { kind: "request"; requestId: string }, overrideReason?: string | null): ProcurementEmailMeta {
      const lines = entity.kind === "line" ? [lineOf(entity.requestItemId)].filter(Boolean) as LineLike[] : linesOfRequest(entity.requestId);
      const req = entity.kind === "request" ? reqOf(entity.requestId) : reqOf(lines[0]?.requestId ?? "");
      const t = totalsOf(lines);
      return {
        subject: `Approved - ready for PO${req?.requestNo ? ` (Req #${req.requestNo})` : ""}`,
        eyebrow: "Approved", headline: "An approved requisition is ready for PO generation",
        action: "approved a requisition",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [{ label: "Vendor", value: vendorOfLines(lines) }, t.row, t.itemsRow],
        items: lines.map(lineItem),
        note: reasonNote("Vendor overridden", overrideReason),
        ctaLabel: "Open PO desk", ctaPath: `${B}/po/workbench`,
      };
    },

    // 3b. Requisition/line rejected or held → requester
    declined(entity: { kind: "line"; requestItemId: string } | { kind: "request"; requestId: string }, decision: "rejected" | "on_hold", reason?: string | null): ProcurementEmailMeta {
      const lines = entity.kind === "line" ? [lineOf(entity.requestItemId)].filter(Boolean) as LineLike[] : linesOfRequest(entity.requestId);
      const req = entity.kind === "request" ? reqOf(entity.requestId) : reqOf(lines[0]?.requestId ?? "");
      const held = decision === "on_hold";
      return {
        subject: held ? "Your requisition was put on hold" : "Your requisition was rejected",
        eyebrow: held ? "On hold" : "Rejected",
        headline: held ? "A requisition was put on hold" : "A requisition was rejected",
        action: held ? "put a requisition on hold" : "rejected a requisition",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [{ label: "Vendor", value: vendorOfLines(lines) }, ...(lines[0] ? [{ label: "Item", value: iName(lines[0].itemId) }] : [])],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open my requests", ctaPath: `${B}/requests`,
      };
    },

    // 4. PO generated → Share-PO owner
    poGenerated(input: { poId: string; vendorId: string; companyId: string; requestItemIds: string[]; poNo?: string | null }): ProcurementEmailMeta {
      const lines = input.requestItemIds.map(lineOf).filter(Boolean) as LineLike[];
      const t = totalsOf(lines);
      return {
        subject: `PO ready to share${input.poNo ? ` - PO #${input.poNo}` : ""} (${vName(input.vendorId)})`,
        eyebrow: "PO generated", headline: "A new PO is ready to share with the vendor",
        action: "generated a PO",
        docLabel: input.poNo ? `PO #${input.poNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(input.vendorId) }, { label: "Company", value: cName(input.companyId) }, t.row, t.itemsRow],
        items: lines.map(lineItem),
        ctaLabel: "Open Share-PO queue", ctaPath: `${B}/queues/share`,
      };
    },

    // 5. PO shared → Collect-PI owner
    poShared(poId: string, input?: { dispatchDate?: string | null; paymentTerms?: string | null; remarks?: string | null; name?: string | null }): ProcurementEmailMeta {
      const po = poOf(poId);
      const terms = input?.paymentTerms ?? po?.paymentTerms ?? null;
      const dispatch = input?.dispatchDate ?? po?.dispatchDate ?? null;
      return {
        subject: `PO shared - collect the PI${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "PO shared", headline: "PO shared with the vendor - collect the PI(s)",
        action: "shared the PO with the vendor",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Total", value: inr(po?.totalValue ?? null) },
          ...(dispatch ? [{ label: "Expected dispatch", value: formatDate(dispatch) }] : []),
          ...(terms ? [{ label: "Payment terms", value: PAYMENT_TERMS_LABEL[terms] ?? terms }] : []),
          ...(input?.name ? [{ label: "PO document", value: input.name }] : []),
        ],
        note: reasonNote("Remarks", input?.remarks),
        ctaLabel: "Open Collect-PI queue", ctaPath: `${B}/queues/collect-pi`,
      };
    },

    // 6. PI added → Payment owner
    piAdded(input: { poId: string; vendorPiNo: string; piValue: number; items: Array<{ poItemId: string; qty: number }>; documentName?: string | null }): ProcurementEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `PI collected - advance may be due${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "PI collected", headline: "A PI was added - advance payment may be due",
        action: "recorded a PI",
        docLabel: `PI #${input.vendorPiNo}`,
        rows: [
          ...(po?.poNo ? [{ label: "PO", value: `#${po.poNo}` }] : []),
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "PI value", value: inr(input.piValue) },
          ...(input.documentName ? [{ label: "PI document", value: input.documentName }] : []),
        ],
        items: input.items.map((it) => ({ name: nameForPoItem(it.poItemId), meta: `${it.qty}` })),
        ctaLabel: "Open Payment queue", ctaPath: `${B}/queues/advance`,
      };
    },

    // 7. Advance paid → Follow-up owner
    advancePaid(input: { poId: string; amount: number; paidOn: string | null; utrRef: string | null; piRemarks?: string | null }): ProcurementEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `Advance paid - follow up on dispatch${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Advance paid", headline: "Advance paid - follow up on dispatch",
        action: "recorded the advance payment",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Amount paid", value: inr(input.amount) },
          ...(input.paidOn ? [{ label: "Paid on", value: formatDate(input.paidOn) }] : []),
          ...(input.utrRef ? [{ label: "UTR / ref", value: input.utrRef }] : []),
        ],
        note: reasonNote("Remarks", input.piRemarks),
        ctaLabel: "Open Follow-up queue", ctaPath: `${B}/queues/follow-up`,
      };
    },

    // 8. Dispatched → Inward owner
    dispatched(input: { poId: string; actualDispatchDate: string | null; revisedDispatchDate: string | null; lrNo: string | null; transportDetails: string | null; remarks: string | null }): ProcurementEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `Goods dispatched - expect inward${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Dispatched", headline: "Goods dispatched - expect inward (GRN)",
        action: "logged a dispatch update",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          ...(input.actualDispatchDate ? [{ label: "Dispatched on", value: formatDate(input.actualDispatchDate) }] : []),
          ...(input.revisedDispatchDate ? [{ label: "Revised dispatch", value: formatDate(input.revisedDispatchDate) }] : []),
          ...(input.lrNo ? [{ label: "LR no.", value: input.lrNo }] : []),
          ...(input.transportDetails ? [{ label: "Transport", value: input.transportDetails }] : []),
        ],
        note: reasonNote("Remarks", input.remarks),
        ctaLabel: "Open Inward queue", ctaPath: `${B}/queues/inward`,
      };
    },

    // 9. GRN recorded → Tally owner
    grnRecorded(input: { poId: string; poRef?: string | null; piRef?: string | null; gateRegisterNo: string | null; condition: string; note: string | null; items: Array<{ poItemId: string; receivedQty: number; condition: string }> }): ProcurementEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `Goods received (GRN) - book in Tally${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Goods received", headline: "Goods received (GRN) - book the entry in Tally",
        action: "recorded goods receipt (GRN)",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Condition", value: input.condition },
          ...(input.gateRegisterNo ? [{ label: "Gate register", value: input.gateRegisterNo }] : []),
          ...(input.piRef ? [{ label: "PI ref", value: input.piRef }] : []),
        ],
        items: input.items.map((it) => ({ name: nameForPoItem(it.poItemId), meta: `received ${it.receivedQty}${it.condition && it.condition !== "good" ? ` · ${it.condition}` : ""}` })),
        note: reasonNote("Note", input.note),
        ctaLabel: "Open Tally queue", ctaPath: `${B}/queues/tally`,
      };
    },

    // 10. Line cancelled → requester
    lineCancelled(requestItemId: string, reason?: string | null): ProcurementEmailMeta {
      const line = lineOf(requestItemId);
      const req = line ? reqOf(line.requestId) : undefined;
      return {
        subject: "A requisition line was cancelled",
        eyebrow: "Cancelled", headline: "A requested line was cancelled",
        action: "cancelled a requisition line",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: line ? [{ label: "Item", value: iName(line.itemId) }, { label: "Vendor", value: vName(line.finalVendorId) }] : [],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open my requests", ctaPath: `${B}/requests`,
      };
    },

    // 10b. Whole requisition cancelled → Sourcing owners
    requestCancelled(requestId: string, reason?: string | null): ProcurementEmailMeta {
      const req = reqOf(requestId);
      const lines = linesOfRequest(requestId);
      return {
        subject: "A requisition was cancelled",
        eyebrow: "Cancelled", headline: "A purchase requisition was cancelled",
        action: "cancelled a requisition",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [
          { label: "Company", value: cName(req?.companyId) },
          ...(lines.length ? [{ label: "Items", value: `${lines.length} item${lines.length === 1 ? "" : "s"}` }] : []),
        ],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open Sourcing", ctaPath: `${B}/queues/sourcing`,
      };
    },

    // PO cancellation family
    cancelRequested(poId: string, reason: string): ProcurementEmailMeta {
      const po = poOf(poId);
      return {
        subject: `Vendor cancellation requested${po?.poNo ? ` - PO #${po.poNo}` : ""}`,
        eyebrow: "Cancellation requested", headline: "Vendor cancellation requested for this PO",
        action: "requested a PO cancellation",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(po?.vendorId) }],
        note: reasonNote("Reason", reason),
        ctaLabel: "Review the PO", ctaPath: `${B}/pos`,
      };
    },
    poCancelled(poId: string, reason: string): ProcurementEmailMeta {
      const po = poOf(poId);
      return {
        subject: `PO cancelled${po?.poNo ? ` - PO #${po.poNo}` : ""}`,
        eyebrow: "PO cancelled", headline: "This PO was cancelled",
        action: "cancelled a PO",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(po?.vendorId) }],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open RM Domestic", ctaPath: `${B}/requests`,
      };
    },
    cancelDeclined(poId: string, note?: string | null): ProcurementEmailMeta {
      const po = poOf(poId);
      return {
        subject: "PO cancellation request declined",
        eyebrow: "Cancellation declined", headline: "A PO cancellation request was declined",
        action: "declined a cancellation request",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        note: reasonNote("Note", note),
        ctaLabel: "Open RM Domestic", ctaPath: `${B}/requests`,
      };
    },

    // Master-data governance
    masterRequested(label: string, name: string): ProcurementEmailMeta {
      return {
        subject: `New ${label} requested - "${name}"`,
        eyebrow: "Master request", headline: `A new ${label} was requested`,
        action: `requested a new ${label}`,
        rows: [{ label: "Name", value: name }],
        ctaLabel: "Review master requests", ctaPath: `${B}/master-requests`,
      };
    },
    masterResolved(label: string, name: string, approved: boolean, note?: string | null): ProcurementEmailMeta {
      return {
        subject: approved ? `Your ${label} was approved - "${name}"` : `Your ${label} request was rejected`,
        eyebrow: approved ? "Master approved" : "Master rejected",
        headline: approved ? `Your new ${label} was approved` : `Your ${label} request was rejected`,
        action: approved ? `approved a ${label}` : `rejected a ${label}`,
        rows: [{ label: "Name", value: name }],
        note: reasonNote("Note", note),
        ctaLabel: "Open masters", ctaPath: `${B}/master-requests`,
      };
    },

    // Manual reminders
    reminder(kind: "nudge" | "escalate", label: string): ProcurementEmailMeta {
      const esc = kind === "escalate";
      return {
        subject: esc ? `Escalated: ${label}` : `Reminder: ${label}`,
        eyebrow: esc ? "Escalated" : "Reminder",
        headline: esc ? `${label} is stuck and needs attention` : `${label} is waiting on you`,
        action: esc ? "escalated a stuck item" : "sent a reminder",
        ctaLabel: "Open RM Domestic", ctaPath: B,
      };
    },
  };
}

export type ProcurementEmailBuilder = ReturnType<typeof makeProcurementEmail>;
