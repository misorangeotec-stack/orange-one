import { useEffect, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import PillToggle from "@/shared/components/ui/PillToggle";
import { FieldHeading, FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../store";
import { dmy, ROUND_RETURN_ORIGIN_LABEL, SALES_RETURN_MODE_LABEL } from "../lib/format";
import { roundViewNo } from "../lib/rounds";
import { salesReturnRound } from "../lib/salesReturn";
import StepDocLink from "./StepDocLink";
import ReturnLines from "./ReturnLines";
import type { DispatchOrder, RoundReturn, SalesReturnMode } from "../types";

/**
 * Record (or correct) how an already-raised sales bill was unwound in Tally.
 *
 * ONE FORM, TWO KINDS OF WORK:
 *   · no `roundReturn` — the CANCELLATION kind: an order cancelled while its
 *     billed goods were still in the plant. Saving this is what finally cancels
 *     the order. Reads and writes the `sr` block on the order.
 *   · with `roundReturn` — a return against a FINISHED round's invoice, usually
 *     on a closed order (migration 20261230120000). Paperwork only: saving it
 *     leaves the order exactly as it is.
 * The Tally side is the same job either way, so the same two outcomes and the
 * same rules apply, and the form is shared rather than copied.
 *
 * ⚠ THE TWO OUTCOMES ARE A HUMAN'S CHOICE, NOT A CALCULATION. There is no
 *   24-hour timer here, no deadline and no suggested answer: whether the bill
 *   could still be cancelled outright or needed a sales return raised against it
 *   is settled in Tally, by the person doing it, and this form records which.
 *   `PillToggle` rather than a dropdown for exactly that reason — both options
 *   have to be readable without a click, because picking the wrong one writes a
 *   false statement about a tax document.
 *
 * ⚠ THE RECAP IS READ OFF THE ROUND. For a cancellation that is `sr_round_no`,
 *   which is still LIVE until this is recorded (the archive is deferred so the
 *   invoice stays readable); `salesReturnRound` spans both. A round return always
 *   points at an archived round.
 */
export default function SalesReturnModal({
  order,
  roundReturn = null,
  open,
  onClose,
  editing = false,
  readOnly = false,
}: {
  order: DispatchOrder | null;
  /** Set ⇒ this is a return against a finished invoice, not a cancellation. */
  roundReturn?: RoundReturn | null;
  open: boolean;
  onClose: () => void;
  /** Correcting an entry already recorded, rather than making it. */
  editing?: boolean;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();

  const [mode, setMode] = useState<SalesReturnMode>("invoice_cancelled");
  const [reference, setReference] = useState("");
  const [actualDate, setActualDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rr = roundReturn;

  // Re-seed whenever a different order (or a different intent) is opened. The
  // modal is mounted once per page, so stale state would otherwise leak from the
  // last row into the next one.
  useEffect(() => {
    if (!open || !order) return;
    setMode((rr ? rr.srMode : order.srMode) ?? "invoice_cancelled");
    setReference((rr ? rr.referenceNo : order.srReferenceNo) ?? "");
    setActualDate((rr ? rr.actualDate : order.srActualDate) ?? new Date().toISOString().slice(0, 10));
    setRemarks((rr ? rr.remarks : order.srRemarks) ?? "");
    setFile(null);
    setError(null);
    setBusy(false);
  }, [open, order, rr, editing]);

  if (!order) return null;

  // Everything below reads through these, so the two kinds render one way.
  const invoiceNo = rr ? rr.invoiceNo : order.srInvoiceNo;
  const invoiceDate = rr ? rr.invoiceDate : order.srInvoiceDate;
  const roundNo = rr ? rr.roundNo : order.srRoundNo;
  const ewayExpected = rr ? rr.ewayExpected : order.srEwayExpected;
  const storedDoc = rr ? rr.attachmentPath : order.srAttachmentPath;
  const storedDocName = rr ? rr.attachmentName : order.srAttachmentName;
  const view = rr ? roundViewNo(order, rr.roundNo) : salesReturnRound(order);
  const needsReturnDetails = mode === "sales_return";

  const save = async () => {
    if (needsReturnDetails && !reference.trim()) {
      setError("Enter the sales return / credit note number.");
      return;
    }
    if (needsReturnDetails && !file && !storedDoc) {
      setError("Attach the sales return / credit note.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        sr_mode: mode,
        sr_reference_no: reference.trim(),
        sr_actual_date: actualDate,
        sr_remarks: remarks.trim(),
      };
      if (file) {
        // The round number is what puts the file beside that consignment's other
        // documents in the bucket.
        const up = await s.uploadStepDocument(order.id, "sales_return", file, roundNo ?? order.roundNo);
        payload.sr_attachment_path = up.path;
        payload.sr_attachment_name = up.name;
      } else if (!editing) {
        // Recording with no file: send blanks so the RPC stores nulls.
        payload.sr_attachment_path = "";
        payload.sr_attachment_name = "";
      }
      // Editing with no new file: the keys stay OMITTED and the RPC keeps the
      // stored document. Same presence contract as every other step here.
      if (rr) {
        if (editing) await s.updateRoundReturn(rr.id, payload);
        else await s.recordRoundReturn(rr.id, payload);
      } else if (editing) await s.updateSalesReturn(order.id, payload);
      else await s.recordSalesReturn(order.id, payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  const docs = (
    <div className="flex flex-wrap items-center gap-3">
      {view?.sbAttachmentPath && (
        <StepDocLink path={view.sbAttachmentPath} name={view.sbAttachmentName ?? "Sales invoice"} />
      )}
      {view?.sbEwayPath && <StepDocLink path={view.sbEwayPath} name={view.sbEwayName ?? "E-way bill"} />}
      {storedDoc && <StepDocLink path={storedDoc} name={storedDocName ?? "Sales return document"} />}
      {!view?.sbAttachmentPath && !view?.sbEwayPath && !storedDoc && (
        <span className="text-[12.5px] text-grey-2">No documents attached.</span>
      )}
    </div>
  );

  const recap = (
    <div className="rounded-card border border-line bg-page/60 p-3.5 space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-3">
        <Fact label="Order" value={order.orderNo} />
        <Fact label="Customer" value={s.customerName(order.customerId)} />
        <Fact label="Invoice no." value={invoiceNo ?? "—"} />
        <Fact label="Invoice date" value={dmy(invoiceDate)} />
        <Fact label="Gate pass" value={view?.gpNo ?? "—"} />
        <Fact label="Round" value={roundNo ? `R${roundNo}` : "—"} />
      </div>
      <div className="border-t border-line/70 pt-2 text-[12.5px]">
        {rr ? (
          <>
            <span className="font-semibold text-navy">{ROUND_RETURN_ORIGIN_LABEL[rr.origin]}</span>
            <span className="text-grey-2">
              {" "}· {rr.scope === "partial" ? "part of the invoice" : "the whole invoice"} · raised by{" "}
            </span>
            <span className="font-semibold text-navy">{s.personName(rr.requestedBy)}</span>
            <span className="text-grey-2"> · {formatDateTime(rr.requestedAt)}</span>
            {rr.reason && <p className="mt-1 text-grey">{rr.reason}</p>}
            {rr.lines.length > 0 && (
              <div className="mt-2">
                <p className="text-grey-2">Coming back</p>
                <ReturnLines ret={rr} />
              </div>
            )}
          </>
        ) : (
          <>
            <span className="text-grey-2">Cancelled by </span>
            <span className="font-semibold text-navy">{s.personName(order.cancelRequestedBy)}</span>
            {order.cancelRequestedAt && (
              <span className="text-grey-2"> · {formatDateTime(order.cancelRequestedAt)}</span>
            )}
            {order.cancelReason && <p className="mt-1 text-grey">{order.cancelReason}</p>}
          </>
        )}
      </div>
      {ewayExpected && (
        <p className="rounded-lg bg-yellow/10 px-2.5 py-1.5 text-[12.5px] text-navy">
          This consignment carried an <span className="font-semibold">e-way bill</span> —{" "}
          {rr ? "check whether the portal needs anything too" : "cancel it on the portal too"}. That is a
          separate system; nothing here does it for you.
        </p>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Correct the sales return" : "Record the sales return"}
      subtitle={`${order.orderNo} · invoice ${invoiceNo ?? "—"}`}
      size="lg"
      readOnly={readOnly}
      readOnlyHeader={
        <div className="space-y-3">
          {recap}
          {docs}
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy
              ? "Saving…"
              : editing
                ? "Save changes"
                : rr
                  ? "Record sales return"
                  : "Record and cancel the order"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {!readOnly && (
          <>
            {recap}
            {docs}
          </>
        )}

        {/* A heading DIV, not FieldLabel: a <label> forwards a click on its text to the first
            pill, so clicking the question silently recorded "Invoice cancelled". */}
        <div>
          <FieldHeading label="What was done in Tally" required />
          <PillToggle<SalesReturnMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "invoice_cancelled", label: SALES_RETURN_MODE_LABEL.invoice_cancelled },
              { value: "sales_return", label: SALES_RETURN_MODE_LABEL.sales_return },
            ]}
          />
        </div>
        <p className="text-[12.5px] text-grey-2">
          {needsReturnDetails
            ? "The invoice stays on record and a sales return is booked against it. Enter its number and attach the document."
            : "The invoice itself was cancelled in Tally, so nothing is booked against it."}
        </p>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <FieldLabel label="Sales return / credit note no." required={needsReturnDetails}>
            <TextInput
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={needsReturnDetails ? "as generated in Tally" : "optional"}
            />
          </FieldLabel>
          <FieldLabel label="Date">
            <TextInput type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} />
          </FieldLabel>
        </div>

        <FieldLabel
          label="Sales return document"
          required={needsReturnDetails}
          hint={storedDoc ? "A file is already attached — pick another only to replace it." : undefined}
        >
          <input
            type="file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-[#F1F4F9] file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy"
          />
        </FieldLabel>

        <FieldLabel label="Remarks">
          <TextArea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
        </FieldLabel>

        {!editing && (
          <p className="text-[12.5px] text-grey-2">
            {rr
              ? `This records the Tally entry only — order ${order.orderNo} stays as it is. Whoever raised the return will be told how the invoice was dealt with.`
              : `Saving this cancels order ${order.orderNo}. The person who raised it will be told how the invoice was dealt with.`}
          </p>
        )}

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-grey-2">{label}</p>
      <p className="font-semibold text-navy">{value}</p>
    </div>
  );
}
