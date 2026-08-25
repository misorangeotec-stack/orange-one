import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { useProcurementStore } from "../store";
import { inr, lineBadge, LINE_STATUS_LABEL } from "../lib/format";
import { RequestRefPanel } from "./PoRefPanel";
import type { CancelLinesResult, PurchaseRequest, RequestItem } from "../types";

/**
 * Cancel one or more of a requisition's still-open lines.
 *
 * A HEADER verb, not a per-row one. Every requisition-level action in this app —
 * Source, Approve, Generate PO, Cancel request — is a header button opening a
 * modal that shows the lines it will touch, and this is the same shape. The
 * per-line Cancel that used to sit in an Actions column was removed in d6c9f65
 * for being the column's last inhabitant; putting it back there would undo a
 * deliberate cleanup, and leaves the requisition with no single place to cancel
 * several lines under one reason.
 *
 * SCOPE. Offered for every status `fms_purchase_cancel_line` accepts — sourcing,
 * approval, on_hold and approved_pending_po — which is wider than the control it
 * replaces (approved_pending_po only). A line already on a PO is NOT here: Cancel
 * PO on the PO itself is that path, and the RPC refuses it anyway.
 *
 * ⚠ THE BATCH IS A LOOP, NOT A TRANSACTION. The RPC is per line and has no bulk
 * variant, so a refusal midway leaves the earlier lines legitimately cancelled.
 * That is reported, never hidden and never "rolled back" — see `CancelLinesResult`.
 */
export default function CancelLinesModal({
  request,
  lines,
  open,
  onClose,
}: {
  request: PurchaseRequest;
  /** The cancellable set, computed by the CALLER, so the button that opens this
   *  modal and the modal's own list can never disagree about what is on offer. */
  lines: RequestItem[];
  open: boolean;
  onClose: () => void;
}) {
  const s = useProcurementStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CancelLinesResult | null>(null);

  useEffect(() => {
    if (!open) return;
    // One line → pre-ticked, since there is nothing to choose between. Several →
    // nothing ticked: picking is then a deliberate act, and a stray Confirm
    // cannot take out the whole requisition.
    setSelected(new Set(lines.length === 1 ? lines.map((l) => l.id) : []));
    setReason("");
    setErr(null);
    setResult(null);
    // `lines` is rebuilt on every store read, so depending on it would reset the
    // ticks under the user's fingers. The requisition is the real identity here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request.id]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const picked = lines.filter((l) => selected.has(l.id));
  const allPicked = lines.length > 0 && picked.length === lines.length;
  const canConfirm = picked.length > 0 && reason.trim().length > 0;

  // "Live" is NOT the same as "cancellable": a line already on a PO is live but
  // cannot be cancelled here. Comparing against the live set is what makes this
  // warning true — comparing against `lines` would claim every pool-only
  // requisition was about to die while its PO lines carried on.
  const live = s.itemsForRequest(request.id).filter((l) => l.status !== "cancelled" && l.status !== "rejected");
  const cancelsWholeRequest = picked.length > 0 && picked.length === live.length;

  const submit = async () => {
    if (picked.length === 0) return setErr("Tick at least one line to cancel.");
    if (!reason.trim()) return setErr("A reason is required.");
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await s.cancelLines(picked.map((l) => l.id), reason.trim());
      if (r.failed.length === 0) return onClose();
      // Partial — stay open on exactly what did not go through, so the retry is
      // one click and nothing is silently half-done. The successes are already
      // visible in the table behind this dialog.
      setResult(r);
      setSelected(new Set(r.failed.map((f) => f.requestItemId)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={lines.length === 1 ? "Cancel line" : "Cancel lines"}
      subtitle={`${request.requestNo} · a cancelled line stays on record and drops out of every queue. This can't be undone.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="!text-ryg-red hover:!border-ryg-red"
            onClick={submit}
            disabled={busy || !canConfirm}
          >
            {busy ? "Cancelling…" : picked.length <= 1 ? "Cancel line" : `Cancel ${picked.length} lines`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <RequestRefPanel request={request} />

        {lines.length === 0 ? (
          <p className="text-[13px] text-grey-2">Nothing on this requisition can be cancelled any more.</p>
        ) : (
          <div>
            <div className={`${SECTION_HEADING_CLASS} mb-1.5 flex items-center justify-between gap-3`}>
              <span>Lines that can still be cancelled</span>
              <div className="flex items-center gap-2.5 text-[11.5px] font-semibold normal-case tracking-normal">
                <span className="text-grey-2">
                  {picked.length} of {lines.length} ticked
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(new Set(lines.map((l) => l.id)))}
                  disabled={allPicked}
                  className="text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={picked.length === 0}
                  className="text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
                >
                  Clear all
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="bg-page text-left text-[11.5px] uppercase tracking-wide text-grey-2">
                    <th className="w-9 px-3 py-2">
                      <input
                        type="checkbox"
                        className="accent-orange"
                        aria-label="Tick every line"
                        checked={allPicked}
                        ref={(el) => {
                          if (el) el.indeterminate = picked.length > 0 && !allPicked;
                        }}
                        onChange={(e) => setSelected(e.target.checked ? new Set(lines.map((l) => l.id)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="w-28 px-2 py-2 font-semibold">Qty</th>
                    <th className="w-40 px-2 py-2 font-semibold">Status</th>
                    <th className="w-32 px-3 py-2 text-right font-semibold">Line Value</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const on = selected.has(l.id);
                    const fail = result?.failed.find((f) => f.requestItemId === l.id);
                    return (
                      <tr key={l.id} className={`border-t border-line ${on ? "" : "opacity-45"}`}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="accent-orange"
                            checked={on}
                            onChange={() => toggle(l.id)}
                            aria-label={`Cancel ${s.itemLabel(l.itemId)}`}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium text-navy">
                          {s.itemLabel(l.itemId)}
                          {fail && (
                            <span className="ml-2 text-[11.5px] font-normal text-ryg-red">{fail.message}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          {l.finalQty ?? l.quantity} {l.unit}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={lineBadge(l.status)}>{LINE_STATUS_LABEL[l.status]}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-navy">
                          {inr(l.lineValue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {cancelsWholeRequest && (
          <p className="rounded-xl border border-ryg-red/30 bg-ryg-red/5 px-3 py-2 text-[12.5px] text-ryg-red">
            {picked.length === 1
              ? `This is the last live line on ${request.requestNo} — cancelling it cancels the whole requisition.`
              : `These are the last live lines on ${request.requestNo} — cancelling them cancels the whole requisition.`}
          </p>
        )}

        <FieldLabel
          label="Reason"
          required
          hint="recorded on every ticked line, and sent to the requester and the approver"
        >
          <TextArea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are these lines being cancelled?"
          />
        </FieldLabel>

        {result && result.failed.length > 0 && (
          <p className="text-[12.5px] text-ryg-red">
            {result.cancelled.length} of {result.cancelled.length + result.failed.length} lines cancelled. The rest
            are still ticked with the reason on their row — retry, or close and re-check the requisition.
          </p>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
