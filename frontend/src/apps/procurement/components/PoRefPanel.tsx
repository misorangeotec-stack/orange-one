import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Field, FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { useProcurementStore } from "../store";
import { PiDocLink, TallyDocLink } from "./DocLinks";
import type { Grn, Pi, PurchaseOrder } from "../types";

/**
 * The context block every PO-stage modal opens with: who we are buying FOR, who
 * we are buying FROM, and the paperwork behind the order.
 *
 * It grew out of the QC branch's private `QcRefPanel`, which was the only step
 * form in the app that told you the vendor. Every other step — sharing the PO,
 * paying an advance, chasing a dispatch, booking a receipt — asked someone to
 * act on an order without naming the company or the vendor anywhere on screen.
 * Same tinted card, same `Field` grid; every cell past Company/Vendor is opt-in
 * so a step shows the references it actually needs and nothing else.
 *
 * ── The read-only rule ──
 * `Modal` puts its body inside a disabled `<fieldset>` in read-only mode, which
 * flattens every button inside it: the PI chips stop opening, and the document
 * links — which mint a short-lived signed URL on click, so they cannot be plain
 * anchors — stop working. So in `readOnly` this panel renders the numbers as
 * plain text and the caller passes {@link PoRefDocs} to `Modal`'s
 * `readOnlyHeader`, which sits OUTSIDE the fieldset. `SharePoModal` set that
 * precedent for the PO PDF; this generalises it.
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
  const s = useProcurementStore();
  const pis = showPi ? s.pisForPo(po.id) : [];
  const bookings = !showTallyInvoice
    ? []
    : grn
      ? s.tallyBookings.filter((t) => t.grnId === grn.id)
      : s.tallyForPo(po.id);

  return (
    <div className="rounded-xl border border-line bg-page/50 px-4 py-3.5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Company" value={s.companyLabel(po.companyId)} />
        <Field label="Vendor" value={s.vendorLabel(po.vendorId)} />

        {showPoNo && (
          <Field label="PO No.">
            <Link
              to={`/procurement/pos/${po.id}`}
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
                to={`/procurement/pos/${po.id}`}
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
      </div>
    </div>
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
  const s = useProcurementStore();
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
