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
import { formatDate } from "@/shared/lib/time";

// Structural shapes (a subset of the real domain types - the store's typed arrays
// satisfy these, so we avoid coupling to exact type names).
interface Named { id: string; name: string }
interface RequestLike { id: string; requestNo?: string | null; vendorId?: string | null; companyId?: string | null; currency?: string | null; requesterId?: string | null }
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

  return {
    // 1. Requisition raised → approver
    submitted(input: { vendorId: string; companyId: string; currency: string; fxRate: number; items: Array<{ itemId: string; quantity: number; unit: string; rate: number }> }): ImportEmailMeta {
      const lines: LineLike[] = input.items.map((l, idx) => ({
        id: String(idx), requestId: "", itemId: l.itemId, quantity: l.quantity, unit: l.unit,
        finalRate: l.rate, currency: input.currency,
        lineValueFx: Math.round(l.quantity * l.rate * 100) / 100,
        lineValue: Math.round(l.quantity * l.rate * input.fxRate * 100) / 100,
      }));
      const t = totalsOf(lines, input.currency);
      return {
        subject: `New import requisition - ${vName(input.vendorId)}`,
        eyebrow: "New requisition", headline: "A purchase requisition needs your approval",
        action: "raised an import requisition",
        rows: [{ label: "Vendor", value: vName(input.vendorId) }, { label: "Company", value: cName(input.companyId) }, t.row, t.itemsRow],
        items: lines.map(lineItem),
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
        rows: [{ label: "Vendor", value: vName(req?.vendorId) }, t.row, t.itemsRow],
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
        ctaLabel: "Open my requests", ctaPath: `${B}/requests`,
      };
    },

    // 3. PO generated → Share-PO owner
    poGenerated(input: { poId: string; vendorId: string; companyId: string; requestItemIds: string[]; poNo?: string | null }): ImportEmailMeta {
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

    // 4. PO shared → Collect-PI owner
    poShared(poId: string, input?: { dispatchDate?: string | null; paymentTerms?: string | null; remarks?: string | null; name?: string | null }): ImportEmailMeta {
      const po = poOf(poId);
      return {
        subject: `PO shared - collect the PI${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "PO shared", headline: "PO shared with the vendor - collect the PI(s)",
        action: "shared the PO with the vendor",
        docLabel: po?.poNo ? `PO #${po.poNo}` : undefined,
        rows: [
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "Total", value: inr(po?.totalValue ?? null), sub: po?.totalValueFx != null ? fxMoney(po.totalValueFx, po.currency ?? "") : undefined },
          ...(input?.dispatchDate ? [{ label: "Expected dispatch", value: formatDate(input.dispatchDate) }] : []),
          ...(input?.name ? [{ label: "PO document", value: input.name }] : []),
        ],
        note: reasonNote("Remarks", input?.remarks),
        ctaLabel: "Open Collect-PI queue", ctaPath: `${B}/queues/collect-pi`,
      };
    },

    // 5. PI added → Payment owner
    piAdded(input: { poId: string; vendorPiNo: string; piValue: number; items: Array<{ poItemId: string; qty: number }>; documentName?: string | null }): ImportEmailMeta {
      const po = poOf(input.poId);
      return {
        subject: `PI collected - advance may be due${po?.poNo ? ` (PO #${po.poNo})` : ""}`,
        eyebrow: "PI collected", headline: "A PI was added - advance payment may be due",
        action: "recorded a PI",
        docLabel: `PI #${input.vendorPiNo}`,
        rows: [
          ...(po?.poNo ? [{ label: "PO", value: `#${po.poNo}` }] : []),
          { label: "Vendor", value: vName(po?.vendorId) },
          { label: "PI value", value: fxMoney(input.piValue, po?.currency ?? "") },
          ...(input.documentName ? [{ label: "PI document", value: input.documentName }] : []),
        ],
        items: input.items.map((it) => ({ name: nameForPoItem(it.poItemId), meta: `${it.qty}` })),
        ctaLabel: "Open Payment queue", ctaPath: `${B}/queues/advance`,
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
        ctaLabel: "Open my requests", ctaPath: `${B}/requests`,
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
