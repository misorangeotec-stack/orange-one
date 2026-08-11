import { useEffect, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import PillToggle from "@/shared/components/ui/PillToggle";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../store";
import { dmy, SALES_RETURN_MODE_LABEL } from "../lib/format";
import { salesReturnRound } from "../lib/salesReturn";
import StepDocLink from "./StepDocLink";
import type { DispatchOrder, SalesReturnMode } from "../types";

/**
 * Record (or correct) how a cancelled order's already-raised sales bill was
 * unwound in Tally. Saving this is what finally cancels the order.
 *
 * ⚠ THE TWO OUTCOMES ARE A HUMAN'S CHOICE, NOT A CALCULATION. There is no
 *   24-hour timer here, no deadline and no suggested answer: whether the bill
 *   could still be cancelled outright or needed a sales return raised against it
 *   is settled in Tally, by the person doing it, and this form records which.
 *   `PillToggle` rather than a dropdown for exactly that reason — both options
 *   have to be readable without a click, because picking the wrong one writes a
 *   false statement about a tax document.
 *
 * ⚠ THE RECAP IS READ OFF THE ROUND, VIA `sr_round_no`. Before this is recorded
 *   that round is still live (the archive is deferred so the invoice stays
 *   readable); afterwards it is in the archive. `salesReturnRound` spans both.
 *   Reading the order header instead would show nothing once it archives.
 */
export default function SalesReturnModal({
  order,
  open,
  onClose,
  editing = false,
  readOnly = false,
}: {
  order: DispatchOrder | null;
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

  // Re-seed whenever a different order (or a different intent) is opened. The
  // modal is mounted once per page, so stale state would otherwise leak from the
  // last row into the next one.
  useEffect(() => {
    if (!open || !order) return;
    setMode(order.srMode ?? "invoice_cancelled");
    setReference(order.srReferenceNo ?? "");
    setActualDate(order.srActualDate ?? new Date().toISOString().slice(0, 10));
    setRemarks(order.srRemarks ?? "");
    setFile(null);
    setError(null);
    setBusy(false);
  }, [open, order, editing]);

  if (!order) return null;

  const view = salesReturnRound(order);
  const needsReturnDetails = mode === "sales_return";
  const storedDoc = order.srAttachmentPath;

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
        const up = await s.uploadStepDocument(
          order.id,
          "sales_return",
          file,
          order.srRoundNo ?? order.roundNo,
        );
        payload.sr_attachment_path = up.path;
        payload.sr_attachment_name = up.name;
      } else if (!editing) {
        // Recording with no file: send blanks so the RPC stores nulls.
        payload.sr_attachment_path = "";
        payload.sr_attachment_name = "";
      }
      // Editing with no new file: the keys stay OMITTED and the RPC keeps the
      // stored document. Same presence contract as every other step here.
      if (editing) await s.updateSalesReturn(order.id, payload);
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
      {storedDoc && (
        <StepDocLink path={storedDoc} name={order.srAttachmentName ?? "Sales return document"} />
      )}
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
        <Fact label="Invoice no." value={order.srInvoiceNo ?? "—"} />
        <Fact label="Invoice date" value={dmy(order.srInvoiceDate)} />
        <Fact label="Gate pass" value={view?.gpNo ?? "—"} />
        <Fact label="Round" value={order.srRoundNo ? `R${order.srRoundNo}` : "—"} />
      </div>
      <div className="border-t border-line/70 pt-2 text-[12.5px]">
        <span className="text-grey-2">Cancelled by </span>
        <span className="font-semibold text-navy">{s.personName(order.cancelRequestedBy)}</span>
        {order.cancelRequestedAt && (
          <span className="text-grey-2"> · {formatDateTime(order.cancelRequestedAt)}</span>
        )}
        {order.cancelReason && <p className="mt-1 text-grey">{order.cancelReason}</p>}
      </div>
      {order.srEwayExpected && (
        <p className="rounded-lg bg-yellow/10 px-2.5 py-1.5 text-[12.5px] text-navy">
          This consignment carried an <span className="font-semibold">e-way bill</span> — cancel it on
          the portal too. That is a separate system; nothing here does it for you.
        </p>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Correct the sales return" : "Record the sales return"}
      subtitle={`${order.orderNo} · invoice ${order.srInvoiceNo ?? "—"}`}
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
            {busy ? "Saving…" : editing ? "Save changes" : "Record and cancel the order"}
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

        <FieldLabel label="What was done in Tally" required>
          <PillToggle<SalesReturnMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "invoice_cancelled", label: SALES_RETURN_MODE_LABEL.invoice_cancelled },
              { value: "sales_return", label: SALES_RETURN_MODE_LABEL.sales_return },
            ]}
          />
        </FieldLabel>
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
            Saving this cancels order {order.orderNo}. The person who raised it will be told how the
            invoice was dealt with.
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
