// Per-step email content for Import FMS notifications.
//
// This is the ONE place the design of every Import email lives. Each builder
// returns a generic payload (subject / eyebrow / headline / rows / items / note /
// CTA) that the send-email edge function renders with the shared branded shell.
// It reuses the app's own formatters (inr / fxMoney / qtyText) and item labels so
// emails read exactly like the screens.
//
// Data source rule: build from what's in scope at the announce moment - method
// inputs for freshly-created docs (submit, PO generate), and the store's existing
// rows for everything already persisted (approval, share, PI, payment, GRN, …).

import { inr, fxMoney, qtyText } from "./format";
import { SHIPMENT_TYPE_LABEL, type ShipmentType } from "../types";
import { formatDate } from "@/shared/lib/time";

// Structural shapes (a subset of the real domain types - the store's typed arrays
// satisfy these, so we avoid coupling to exact type names).
interface Named { id: string; name: string }
interface RequestLike { id: string; requestNo?: string | null; vendorId?: string | null; companyId?: string | null; currency?: string | null; requesterId?: string | null; shipmentType?: string | null }
interface LineLike {
  id: string; requestId: string; itemId: string;
  quantity?: number | null; unit?: string | null;
  finalRate?: number | null; currency?: string | null;
  lineValue?: number | null; lineValueFx?: number | null;
}
interface PoLike {
  id: string; poNo?: string | null; vendorId?: string | null; companyId?: string | null;
  currency?: string | null; totalValue?: number | null; totalValueFx?: number | null;
  dispatchDate?: string | null; paymentTerms?: string | null; documentName?: string | null;
  tallyPoNo?: string | null; shipmentType?: string | null;
}
interface PoItemLike { id: string; poId: string; requestItemId: string; qty?: number | null; rate?: number | null; lineValue?: number | null }

export interface ImportEmailDeps {
  vendors: Named[];
  companies: Named[];
  items: Named[];
  requests: RequestLike[];
  requestItems: LineLike[];
  pos: PoLike[];
  poItems: PoItemLike[];
}

export interface ImportEmailMeta {
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

const B = "/import";
const dash = "-";

export function makeImportEmail(deps: ImportEmailDeps) {
  const { vendors, companies, items, requests, requestItems, pos, poItems } = deps;

  const vName = (id?: string | null) => (id ? vendors.find((v) => v.id === id)?.name ?? dash : dash);
  const cName = (id?: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? dash : dash);
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

  /** One item row from a request line (foreign + INR). */
  const lineItem = (l: LineLike) => ({
    name: iName(l.itemId),
    meta: `${qtyText([{ qty: l.quantity ?? 0, unit: l.unit ?? "" }])}${l.finalRate != null ? ` @ ${fxMoney(l.finalRate, l.currency ?? "")}` : ""}`,
    value: inr(l.lineValue ?? null),
    sub: l.lineValueFx != null ? fxMoney(l.lineValueFx, l.currency ?? "") : undefined,
  });

  /** Totals across a set of lines. */
  const totalsOf = (lines: LineLike[], currency?: string | null) => {
    const inrTotal = lines.reduce((s, l) => s + (l.lineValue ?? 0), 0);
    const fxTotal = lines.reduce((s, l) => s + (l.lineValueFx ?? 0), 0);
    const cur = currency ?? lines.find((l) => l.currency)?.currency ?? "";
    return {
      row: { label: "Total", value: inr(inrTotal), sub: cur ? fxMoney(fxTotal, cur) : undefined },
      itemsRow: { label: "Items", value: `${lines.length} item${lines.length === 1 ? "" : "s"} · ${qtyText(lines.map((l) => ({ qty: l.quantity ?? 0, unit: l.unit ?? "" })))}` },
    };
  };

  const reasonNote = (label: string, reason?: string | null) =>
    reason && reason.trim() ? { label, text: reason.trim() } : undefined;

  /**
   * The "How it ships" row, spread into a `rows` array. Returns an EMPTY array
   * when the order predates the field, so an old requisition shows nothing here
   * rather than a row reading "—".
   */
  const shipmentRow = (t?: string | null) =>
    t ? [{ label: "Shipment", value: SHIPMENT_TYPE_LABEL[t as ShipmentType] ?? t }] : [];

  return {
    // 1. Requisition raised → approver. Import is a pure quantity requisition:
    // no rate, no value — the email lists items and quantities only.
    submitted(input: { vendorId: string; companyId: string; shipmentType?: string | null; currency: string; items: Array<{ itemId: string; quantity: number; unit: string }> }): ImportEmailMeta {
      const lines = input.items;
      const itemsRow = {
        label: "Items",
        value: `${lines.length} item${lines.length === 1 ? "" : "s"} · ${qtyText(lines.map((l) => ({ qty: l.quantity, unit: l.unit })))}`,
      };
      return {
        subject: `New import requisition - ${vName(input.vendorId)}`,
        eyebrow: "New requisition", headline: "A purchase requisition needs your approval",
        action: "raised an import requisition",
        rows: [{ label: "Vendor", value: vName(input.vendorId) }, { label: "Company", value: cName(input.companyId) }, ...shipmentRow(input.shipmentType), itemsRow],
        items: lines.map((l) => ({ name: iName(l.itemId), meta: qtyText([{ qty: l.quantity, unit: l.unit }]) })),
        ctaLabel: "Open Approvals", ctaPath: `${B}/queues/approvals`,
      };
    },

    // 2a. Line/requisition approved → PO owner
    approved(entity: { kind: "line"; requestItemId: string } | { kind: "request"; requestId: string }, overrideReason?: string | null): ImportEmailMeta {
      const lines = entity.kind === "line" ? [lineOf(entity.requestItemId)].filter(Boolean) as LineLike[] : linesOfRequest(entity.requestId);
      const req = entity.kind === "request" ? reqOf(entity.requestId) : reqOf(lines[0]?.requestId ?? "");
      const t = totalsOf(lines, req?.currency);
      return {
        subject: `Approved - ready for PO${req?.requestNo ? ` (Req #${req.requestNo})` : ""}`,
        eyebrow: "Approved", headline: "An approved requisition is ready for PO generation",
        action: "approved a requisition",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(req?.vendorId) }, ...shipmentRow(req?.shipmentType), t.row, t.itemsRow],
        items: lines.map(lineItem),
        note: reasonNote("Vendor overridden", overrideReason),
        ctaLabel: "Open PO desk", ctaPath: `${B}/po/workbench`,
      };
    },

    // 2b. Line/requisition rejected or held → requester
    declined(entity: { kind: "line"; requestItemId: string } | { kind: "request"; requestId: string }, decision: "rejected" | "on_hold", reason?: string | null): ImportEmailMeta {
      const lines = entity.kind === "line" ? [lineOf(entity.requestItemId)].filter(Boolean) as LineLike[] : linesOfRequest(entity.requestId);
      const req = entity.kind === "request" ? reqOf(entity.requestId) : reqOf(lines[0]?.requestId ?? "");
      const held = decision === "on_hold";
      return {
        subject: held ? "Your requisition was put on hold" : "Your requisition was rejected",
        eyebrow: held ? "On hold" : "Rejected",
        headline: held ? "A requisition line was put on hold" : "A requisition line was rejected",
        action: held ? "put a requisition on hold" : "rejected a requisition",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(req?.vendorId) }, ...(lines[0] ? [{ label: "Item", value: iName(lines[0].itemId) }] : [])],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open my requests", ctaPath: `${B}/my-requests`,
      };
    },

    // 2c. Requisition handed over → whoever now holds it (or, on a hand-back,
    // the configured approvers). Reassign writes no activity row of its own
    // server-side, so this meta is the only thing that makes the mail readable.
    reassigned(input: { requestId: string; returned?: boolean; note?: string | null }): ImportEmailMeta {
      const lines = linesOfRequest(input.requestId);
      const req = reqOf(input.requestId);
      const t = totalsOf(lines, req?.currency);
      const back = !!input.returned;
      return {
        subject: back
          ? `Approval returned to the approvers${req?.requestNo ? ` (Req #${req.requestNo})` : ""}`
          : `Approval reassigned to you${req?.requestNo ? ` (Req #${req.requestNo})` : ""}`,
        eyebrow: back ? "Returned" : "Reassigned",
        headline: back
          ? "A requisition has come back to the approvers"
          : "A requisition has been handed to you for approval",
        action: back ? "returned a requisition to the approvers" : "reassigned a requisition for approval",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(req?.vendorId) }, ...shipmentRow(req?.shipmentType), t.row, t.itemsRow],
        items: lines.map(lineItem),
        note: reasonNote("Why the change", input.note),
        ctaLabel: "Open Approvals", ctaPath: `${B}/queues/approvals`,
      };
    },

    // 3. PO generated → Share-PO owner
    //
    // The Tally PO number and the document name come in as INPUTS, not off a PO
    // row: this is built the instant the PO is created, before the store has
    // refetched, so `poOf(poId)` would find nothing (see the data-source rule at
    // the top of this file). Carrying them means the sharer learns both from the
    // notification instead of having to open the PO.
    poGenerated(input: { poId: string; vendorId: string; companyId: string; requestItemIds: string[]; poNo?: string | null; tallyPoNo?: string | null; documentName?: string | null }): ImportEmailMeta {
      const lines = input.requestItemIds.map(lineOf).filter(Boolean) as LineLike[];
      const t = totalsOf(lines);
      // Off the SOURCE requisition, not the PO: this is built the instant the PO
      // is created, before the store has refetched the row generate_po stamped.
      const ship = reqOf(lines[0]?.requestId ?? "")?.shipmentType;
      return {
        subject: `PO ready to share${input.poNo ? ` - PO #${input.poNo}` : ""} (${vName(input.vendorId)})`,
        eyebrow: "PO generated", headline: "A new PO is ready to share with the vendor",
        action: "generated a PO",
        docLabel: input.poNo ? `PO #${input.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(input.vendorId) },
          { label: "Company", value: cName(input.companyId) },
          ...shipmentRow(ship),
          ...(input.tallyPoNo ? [{ label: "Tally PO No.", value: input.tallyPoNo }] : []),
          ...(input.documentName ? [{ label: "PO document", value: input.documentName }] : []),
          t.row, t.itemsRow,
        ],
        items: lines.map(lineItem),
        ctaLabel: "Open Share-PO queue", ctaPath: `${B}/queues/share`,
      };
    },

    // 4. PO shared → Collect PI owner (the stage share_po actually parks it on)
    //
    // The Tally PO number and the document name are read off the STORE row, not
    // passed in: they belong to the PO stage and were set when the PO was
    // generated, so the pre-share snapshot this is built from already has both.
    poShared(poId: string, input?: { dispatchDate?: string | null; paymentTerms?: string | null; remarks?: string | null }): ImportEmailMeta {
      const po = poOf(poId);
      return {
        subject: `PO shared - collect the vendor's PI${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "PO shared", headline: "PO shared with the vendor - collect their PI",
        action: "shared the PO with the vendor",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Company", value: cName(po?.companyId) },
          ...shipmentRow(po?.shipmentType),
          ...(po?.tallyPoNo ? [{ label: "Tally PO No.", value: po.tallyPoNo }] : []),
          ...(input?.dispatchDate ? [{ label: "Expected dispatch", value: formatDate(input.dispatchDate) }] : []),
          ...(po?.documentName ? [{ label: "PO document", value: po.documentName }] : []),
        ],
        note: reasonNote("Remarks", input?.remarks),
        ctaLabel: "Open Collect PI queue", ctaPath: `${B}/queues/collect-pi`,
      };
    },

    // 5. PI collected → Follow-up owner.
    //
    // No PI value and no covered lines: the Collect PI step captures the number,
    // the document and a remark, nothing else (see fms_import_collect_pi). The
    // PO's own items are listed instead, so the follow-up owner sees what the
    // vendor is now expected to ship.
    piCollected(input: { poId: string; vendorPiNo: string; documentName?: string | null; remarks?: string | null }): ImportEmailMeta {
      const po = poOf(input.poId);
      const lines = poItems
        .filter((pi) => pi.poId === input.poId)
        .map((pi) => ({ pi, line: requestItems.find((l) => l.id === pi.requestItemId) }));
      return {
        subject: `PI collected - follow up on dispatch${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "PI collected", headline: "The vendor's PI was collected - follow up on dispatch",
        action: "collected the vendor's PI",
        docLabel: `PI #${input.vendorPiNo}`,
        rows: [
          ...(po?.poNo ? [{ label: "PO", value: `#${po.poNo}` }] : []),
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Company", value: cName(po?.companyId) },
          ...shipmentRow(po?.shipmentType),
          ...(po?.tallyPoNo ? [{ label: "Tally PO No.", value: po.tallyPoNo }] : []),
          ...(po?.dispatchDate ? [{ label: "Expected dispatch", value: formatDate(po.dispatchDate) }] : []),
          ...(input.documentName ? [{ label: "PI document", value: input.documentName }] : []),
        ],
        items: lines.map(({ pi, line }) => ({
          name: line ? iName(line.itemId) : nameForPoItem(pi.id),
          meta: qtyText([{ qty: pi.qty ?? 0, unit: line?.unit ?? "" }]),
        })),
        note: reasonNote("Remarks", input.remarks),
        ctaLabel: "Open Follow-up queue", ctaPath: `${B}/queues/follow-up`,
      };
    },

    // 6. Advance paid → Follow-up owner
    advancePaid(input: { poId: string; amount: number; amountFx?: number | null; currency?: string | null; paidOn: string | null; utrRef: string | null; details?: string | null }): ImportEmailMeta {
      const po = poOf(input.poId);
      const cur = input.currency ?? po?.currency ?? "";
      return {
        subject: `Advance paid - follow up on dispatch${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Advance paid", headline: "Advance paid - follow up on dispatch",
        action: "recorded the advance payment",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Amount paid", value: inr(input.amount), sub: input.amountFx != null ? fxMoney(input.amountFx, cur) : undefined },
          ...(input.paidOn ? [{ label: "Paid on", value: formatDate(input.paidOn) }] : []),
          ...(input.utrRef ? [{ label: "UTR / ref", value: input.utrRef }] : []),
          ...(input.details ? [{ label: "Mode", value: input.details }] : []),
        ],
        ctaLabel: "Open Follow-up queue", ctaPath: `${B}/queues/follow-up`,
      };
    },

    // 7. Dispatched → Inward owner
    dispatched(input: { poId: string; actualDispatchDate: string | null; revisedDispatchDate: string | null; lrNo: string | null; transportDetails: string | null; remarks: string | null }): ImportEmailMeta {
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

    // 8. GRN recorded → Tally owner
    grnRecorded(input: { poId: string; poRef?: string | null; piRef?: string | null; gateRegisterNo: string | null; condition: string; note: string | null; items: Array<{ poItemId: string; receivedQty: number; condition: string }> }): ImportEmailMeta {
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

    // 9. Line cancelled → requester
    lineCancelled(requestItemId: string, reason?: string | null): ImportEmailMeta {
      const line = lineOf(requestItemId);
      const req = line ? reqOf(line.requestId) : undefined;
      return {
        subject: "A requisition line was cancelled",
        eyebrow: "Cancelled", headline: "A requested line was cancelled",
        action: "cancelled a requisition line",
        docLabel: req?.requestNo ? `Requisition #${req.requestNo}` : undefined,
        rows: line ? [{ label: "Item", value: iName(line.itemId) }, { label: "Vendor", value: vName(req?.vendorId) }] : [],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open my requests", ctaPath: `${B}/my-requests`,
      };
    },

    // PO cancellation family
    cancelRequested(poId: string, reason: string): ImportEmailMeta {
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
    poCancelled(poId: string, reason: string): ImportEmailMeta {
      const po = poOf(poId);
      return {
        subject: `PO cancelled${po?.poNo ? ` - PO #${po.poNo}` : ""}`,
        eyebrow: "PO cancelled", headline: "This PO was cancelled",
        action: "cancelled a PO",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [{ label: "Vendor", value: vName(po?.vendorId) }],
        note: reasonNote("Reason", reason),
        ctaLabel: "Open Import", ctaPath: `${B}/requests`,
      };
    },
    cancelDeclined(poId: string, note?: string | null): ImportEmailMeta {
      const po = poOf(poId);
      return {
        subject: "PO cancellation request declined",
        eyebrow: "Cancellation declined", headline: "A PO cancellation request was declined",
        action: "declined a cancellation request",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        note: reasonNote("Note", note),
        ctaLabel: "Open Import", ctaPath: `${B}/requests`,
      };
    },

    // Master-data governance
    masterRequested(label: string, name: string): ImportEmailMeta {
      return {
        subject: `New ${label} requested - "${name}"`,
        eyebrow: "Master request", headline: `A new ${label} was requested`,
        action: `requested a new ${label}`,
        rows: [{ label: "Name", value: name }],
        ctaLabel: "Review master requests", ctaPath: `${B}/master-requests`,
      };
    },
    masterResolved(label: string, name: string, approved: boolean, note?: string | null): ImportEmailMeta {
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

    // QC inspection + the purchase-return branch
    tallyBooked(input: { poId: string; tallyPiNo: string }): ImportEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `Ready for QC inspection${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Booked in Tally", headline: "Booked in Tally - the receipt is ready for QC inspection",
        action: "booked the receipt in Tally",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Tally invoice", value: input.tallyPiNo },
        ],
        ctaLabel: "Open QC queue", ctaPath: `${B}/queues/qc`,
      };
    },
    qcRecorded(input: { poId: string; rejectedCount: number; remarks: string | null }): ImportEmailMeta {
      const po = poOf(input.poId);
      const rejected = input.rejectedCount > 0;
      return {
        subject: rejected
          ? `QC REJECTED - raise the purchase return${po?.poNo ? ` (PO #${po.poNo})` : ""}`
          : `QC approved - process closed${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: rejected ? "QC rejected" : "QC approved",
        headline: rejected
          ? "QC rejected material - book the purchase return in Tally"
          : "QC approved - the purchase order is closed",
        action: rejected ? "rejected material at QC" : "approved the QC inspection",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          ...(rejected ? [{ label: "Items rejected", value: String(input.rejectedCount) }] : []),
        ],
        note: reasonNote("QC remarks", input.remarks),
        ctaLabel: rejected ? "Open purchase-return queue" : "Open the PO",
        ctaPath: rejected ? `${B}/queues/purchase-return` : `${B}/pos/${input.poId}`,
      };
    },
    purchaseReturnEntered(input: { poId: string; tallyRef: string }): ImportEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `Purchase return booked - gate the material out${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Purchase return", headline: "Purchase return booked in Tally - gate the material out",
        action: "booked the purchase return in Tally",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Tally reference", value: input.tallyRef },
        ],
        ctaLabel: "Open gate outward queue", ctaPath: `${B}/queues/gate-outward`,
      };
    },
    gateOutwardRecorded(input: { poId: string; gateRegisterNo: string }): ImportEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `Rejected material gated out - process closed${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "Gate outward", headline: "Rejected material gated out - the purchase order is closed",
        action: "recorded the gate register outward",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Gate register", value: input.gateRegisterNo },
        ],
        ctaLabel: "Open the PO", ctaPath: `${B}/pos/${input.poId}`,
      };
    },

    // Manual reminders
    reminder(kind: "nudge" | "escalate", label: string): ImportEmailMeta {
      const esc = kind === "escalate";
      return {
        subject: esc ? `Escalated: ${label}` : `Reminder: ${label}`,
        eyebrow: esc ? "Escalated" : "Reminder",
        headline: esc ? `${label} is stuck and needs attention` : `${label} is waiting on you`,
        action: esc ? "escalated a stuck item" : "sent a reminder",
        ctaLabel: "Open Import", ctaPath: B,
      };
    },
  };
}

export type ImportEmailBuilder = ReturnType<typeof makeImportEmail>;
