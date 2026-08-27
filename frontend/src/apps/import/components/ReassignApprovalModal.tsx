import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useImportStore } from "../store";
import type { PurchaseRequest } from "../types";

/**
 * Hand ONE requisition awaiting approval to somebody else.
 *
 * The handover MOVES the work: the requisition leaves the approvers' queue and
 * appears in the receiver's, and from then on only they (or an admin) may decide
 * it. That is the whole difference between this and simply adding a second
 * approver in Setup, which would share every requisition rather than pass one.
 *
 * Two things are deliberate here, both learned from the version of this feature
 * that was removed in 20260806123000_fms_import_remove_reassign.sql:
 *
 *   1. The picker offers ONLY the people an admin named in Setup (plus the other
 *      approvers, so it can be handed back). The removed version listed every
 *      profile in the company, which is precisely why it was dropped.
 *   2. Who holds it now is shown, not assumed. A handover you cannot see the
 *      start of is just a second booking — the same reasoning as HR's
 *      ReassignInterviewModal, which this is modelled on.
 */
export default function ReassignApprovalModal({
  request,
  open,
  onClose,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useImportStore();
  const [approverId, setApproverId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requestId = request?.id ?? null;
  const holder = request ? s.holderOfRequest(request) : null;

  const options: ComboOption[] = useMemo(
    () => s.reassignCandidates().map((c) => ({ value: c.id, label: c.name })),
    [s]
  );

  useEffect(() => {
    if (!open) return;
    setApproverId("");
    setNote("");
    setErr(null);
  }, [open, requestId]);

  if (!request) return null;

  const run = async (target: string | null) => {
    setErr(null);
    setBusy(true);
    try {
      await s.reassignApprovalRequest({
        requestId: request.id,
        approverId: target,
        note: note.trim() || null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const empty = options.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reassign approval — ${request.requestNo}`}
      subtitle="It leaves your queue and appears in theirs. Only they can decide it after that."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/* Only offered when there is something to undo, so the dialog never
              shows a control that would be a no-op. */}
          {holder && (
            <Button variant="ghost" size="sm" onClick={() => run(null)} disabled={busy}>
              Return to the approvers
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => (approverId ? run(approverId) : setErr("Pick who should approve it."))}
            disabled={busy || empty}
          >
            {busy ? "Saving…" : "Reassign"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="rounded-xl bg-page px-3.5 py-2.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
            Currently with
          </span>
          <p className="text-[13px] font-semibold text-navy">
            {holder ? s.personName(holder) : "The approvers set up for this module"}
          </p>
        </div>

        {empty ? (
          <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] leading-snug text-[#946200]">
            Nobody has been set up to receive an approval yet. An admin can name them in{" "}
            <Link to="/import/settings" className="font-semibold underline">
              Setup &rarr; Approvers
            </Link>
            .
          </p>
        ) : (
          <FieldLabel label="Hand it to" required>
            <Combobox
              value={approverId}
              onChange={setApproverId}
              options={options}
              placeholder="Select who should approve it"
              autoAdvance
            />
          </FieldLabel>
        )}

        <FieldLabel label="Why the change?" hint="optional">
          <TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="They will see this with the request…"
          />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
