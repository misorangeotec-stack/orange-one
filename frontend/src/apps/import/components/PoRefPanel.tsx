import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Field, FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { useImportStore } from "../store";
import { PiDocLink, TallyDocLink } from "./DocLinks";
import { shipmentLabel } from "../types";
import type { Grn, Pi, PurchaseOrder, PurchaseRequest } from "../types";

/**
 * The tinted card every stage form opens with — one shell, so Sourcing, Approve,
 * Generate PO, PO Details and every PO step name the company and the vendor in
 * exactly the same block. Four copies of this markup had already drifted apart
 * before it was pulled out here; new context cells go through {@link RefPanel},
 * {@link RequestRefPanel} or {@link PoRefPanel}, never a fresh div.
 */
export function RefPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-page/50 px-4 py-3.5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</div>
    </div>
  );
}

/**
 * The same card for the stages that run BEFORE a PO exists — sourcing, approval
 * and PO generation, which are scoped to a requisition rather than an order.
 *
 * The vendor cell is opt-in because these stages are exactly where the vendor is
 * still being decided: Sourcing has none yet, Approve has a recommendation, and
 * Generate PO has one only when every line was sourced to the same vendor.
 */
export function RequestRefPanel({
  request,
  vendorId,
  vendorFieldLabel = "Vendor",
  children,
}: {
  request: PurchaseRequest;
  /** Omitted → no vendor cell. `null` renders the placeholder, i.e. "none yet". */
  vendorId?: string | null;
  vendorFieldLabel?: string;
  /** Extra `<Field>`s appended to the grid. */
  children?: ReactNode;
}) {
  const s = useImportStore();
  return (
    <RefPanel>
      <Field label="Company" value={s.companyLabel(request.companyId)} />
      <Field label="Requisition No." value={request.requestNo} />
      {vendorId !== undefined && <Field label={vendorFieldLabel} value={s.vendorLabel(vendorId)} />}
      {/* Only for requisitions that carry one — an older request has none, and a
          cell reading "—" is noise the approver has to parse past. */}
      {request.shipmentType && <Field label="Shipment" value={shipmentLabel(request.shipmentType)} />}
      {children}
    </RefPanel>
  );
}

/**
 * The context block every PO-stage modal opens with: who we are buying FOR, who
 * we are buying FROM, and the paperwork behind the order.
 *
 * It grew out of the QC branch's private `QcRefPanel`, which was the only step
 * form in the app that told you the vendor. Every other step — sharing the PO,
 * chasing a dispatch, booking a receipt — asked someone to act on an order
 * without naming the company or the vendor anywhere on screen. Same tinted card,
 * same `Field` grid; every cell past Company/Vendor is opt-in so a step shows the
 * references it actually needs and nothing else.
 *
 * Kept structurally identical to the procurement twin — the two purchase apps'
 * step modals are maintained as a matched pair.
 *
 * ── The read-only rule ──
 * `Modal` puts its body inside a disabled `<fieldset>` in read-only mode, which
 * flattens every button inside it: the PI chips stop opening, and the document
 * links — which mint a short-lived signed URL on click, so they cannot be plain
 * anchors — stop working. So in `readOnly` this panel renders the numbers as
 * plain text and the caller passes {@link PoRefDocs} to `Modal`'s
 * `readOnlyHeader`, which sits OUTSIDE the fieldset.
 */
export default function PoRefPanel({
  po,
  grn,
  readOnly = false,
  showPoNo = false,
  showTallyPoNo = false,
  showPi = false,
  showTallyInvoice = false,
  onViewPi,
  children,
}: {
  po: PurchaseOrder;
  /** Narrows the Tally-invoice cell to the booking for THIS receipt. Omitted → every booking on the PO. */
  grn?: Grn;
  readOnly?: boolean;
  showPoNo?: boolean;
  showTallyPoNo?: boolean;
  showPi?: boolean;
  showTallyInvoice?: boolean;
  /** Makes each PI number a button that opens it. Omitted → the numbers are plain text. */
  onViewPi?: (pi: Pi) => void;
  /** Extra `<Field>`s appended to the grid. */
  children?: ReactNode;
}) {
  const s = useImportStore();
  const pis = showPi ? s.pisForPo(po.id) : [];
  const bookings = !showTallyInvoice
    ? []
    : grn
      ? s.tallyBookings.filter((t) => t.grnId === grn.id)
      : s.tallyForPo(po.id);

  return (
    <RefPanel>
      <Field label="Company" value={s.companyLabel(po.companyId)} />
      <Field label="Vendor" value={s.vendorLabel(po.vendorId)} />
      {/* Not opt-in: how a consignment travels changes what every PO-side step
          expects — lead time, paperwork, who to chase — so it belongs in the
          context block of all of them. Hidden only when the order predates it. */}
      {po.shipmentType && <Field label="Shipment" value={shipmentLabel(po.shipmentType)} />}

      {showPoNo && (
        <Field label="PO No.">
          <Link
            to={`/import/pos/${po.id}`}
            target="_blank"
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
            {po.poNo}
          </Link>
        </Field>
      )}
      {showTallyPoNo && (
        <Field label="Tally PO No.">
          {po.tallyPoNo ? (
            <Link
              to={`/import/pos/${po.id}`}
              target="_blank"
              className="font-semibold text-navy hover:text-orange hover:underline"
            >
              {po.tallyPoNo}
            </Link>
          ) : undefined}
        </Field>
      )}

      {showPi && (
        <Field label="Vendor PI No.">
          {pis.length > 0 ? (
            <span className="flex flex-col gap-0.5">
              {pis.map((pi) => (
                <span key={pi.id} className="flex min-w-0 items-center gap-2">
                  {onViewPi && !readOnly ? (
                    <button
                      type="button"
                      onClick={() => onViewPi(pi)}
                      className="font-semibold text-navy hover:text-orange hover:underline"
                    >
                      {pi.vendorPiNo}
                    </button>
                  ) : (
                    <span>{pi.vendorPiNo}</span>
                  )}
                  {!readOnly && pi.documentPath && <PiDocLink pi={pi} />}
                </span>
              ))}
            </span>
          ) : undefined}
        </Field>
      )}

      {showTallyInvoice && (
        <Field label={bookings.length > 1 ? "Tally Invoices" : "Tally Invoice"}>
          {bookings.length > 0 ? (
            <span className="flex flex-col gap-0.5">
              {bookings.map((b) => (
                <span key={b.id} className="flex min-w-0 items-center gap-2">
                  <span>{b.tallyPiNo}</span>
                  {!readOnly && b.documentPath && <TallyDocLink booking={b} />}
                </span>
              ))}
            </span>
          ) : undefined}
        </Field>
      )}

      {children}
    </RefPanel>
  );
}

/**
 * The panel's attachments alone, for `Modal`'s `readOnlyHeader` slot — see the
 * read-only rule above. Renders nothing when there is no stored file to open, so
 * a caller can pass it unconditionally.
 */
export function PoRefDocs({
  po,
  grn,
  showPi = false,
  showTallyInvoice = false,
}: {
  po: PurchaseOrder;
  grn?: Grn;
  showPi?: boolean;
  showTallyInvoice?: boolean;
}) {
  const s = useImportStore();
  const pis = (showPi ? s.pisForPo(po.id) : []).filter((p) => p.documentPath);
  const bookings = (
    !showTallyInvoice ? [] : grn ? s.tallyBookings.filter((t) => t.grnId === grn.id) : s.tallyForPo(po.id)
  ).filter((b) => b.documentPath);

  if (pis.length === 0 && bookings.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {pis.map((pi) => (
        <span key={pi.id} className="flex min-w-0 items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>PI {pi.vendorPiNo}</span>
          <PiDocLink pi={pi} />
        </span>
      ))}
      {bookings.map((b) => (
        <span key={b.id} className="flex min-w-0 items-center gap-1.5">
          <span className={FIELD_LABEL_CLASS}>Invoice {b.tallyPiNo}</span>
          <TallyDocLink booking={b} />
        </span>
      ))}
    </div>
  );
}
