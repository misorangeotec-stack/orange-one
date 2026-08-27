import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";

/**
 * Hand ONE piece of work awaiting approval to somebody else — the dialog half of
 * the FMS approval handover, shared by every module that has one.
 *
 * ⚠ THIS COMPONENT KNOWS NOTHING ABOUT ANY MODULE'S STORE, AND MUST NOT.
 *   Every module answers "who may receive this?" differently — Import asks a flat
 *   approver list, Purchase asks the requisition's own AMOUNT BAND, Office
 *   Supplies asks the request's department HOD — so the caller resolves the
 *   candidates and passes them in. Pulling a store in here would force one of
 *   those three rules onto the other two.
 *
 * It was extracted at the third instance, not the second: Import and Purchase
 * shipped their own copies first, and only once Office Supplies needed a
 * near-identical third did the shape stop being a coincidence.
 *
 * The handover MOVES the work: it leaves the current owner's queue and appears in
 * the receiver's, and from then on only they (or an admin) may decide it. That is
 * the whole difference between this and adding a second approver in Setup, which
 * would SHARE every item rather than pass one.
 *
 * Two things are deliberate, both learned from the version of this feature that
 * was removed in 20260806123000_fms_import_remove_reassign.sql:
 *
 *   1. The picker offers ONLY people the caller resolved from a configured pool.
 *      The removed version listed every profile in the company, which is exactly
 *      why it was dropped — an approval could be handed to someone with no
 *      authority at all.
 *   2. Who holds it now is SHOWN, not assumed. A handover you cannot see the
 *      start of is just a second booking — the same reasoning as HR's
 *      ReassignInterviewModal, which the first version of this was modelled on.
 */
export interface ReassignCandidate {
  id: string;
  name: string;
}

export default function ReassignModal({
  open,
  onClose,
  /**
   * Appears in the title after "Reassign approval — ". Usually the doc number.
   *
   * ⚠ NOT called `ref`. React treats `ref` as a reserved prop and strips it before
   *   the component ever sees it, so the first version of this file rendered
   *   "Reassign approval — undefined" and threw "Function components cannot have
   *   string refs" into the console. tsc accepted it; the browser found it.
   */
  docRef,
  /** Changing this resets the form; pass the entity's id. */
  resetKey,
  candidates,
  /** Display name of whoever holds it, or null when it still sits with the default owner. */
  currentHolderName,
  /** What to call the default owner in the readout when nobody holds it. */
  defaultOwnerLabel,
  /** Where an admin configures the pool, for the empty-state link. */
  setupHref,
  setupLabel,
  /** Target id, or null to hand it back. Should throw on failure. */
  onReassign,
  /** Wording for the hand-back button, e.g. "Return to the approvers". */
  returnLabel,
  subtitle = "It leaves your queue and appears in theirs. Only they can decide it after that.",
}: {
  open: boolean;
  onClose: () => void;
  docRef: string;
  resetKey: string | null;
  candidates: ReassignCandidate[];
  currentHolderName: string | null;
  defaultOwnerLabel: string;
  setupHref: string;
  setupLabel: string;
  onReassign: (target: string | null, note: string | null) => Promise<void>;
  returnLabel: string;
  subtitle?: string;
}) {
  const [approverId, setApproverId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options: ComboOption[] = useMemo(
    () => candidates.map((c) => ({ value: c.id, label: c.name })),
    [candidates]
  );

  useEffect(() => {
    if (!open) return;
    setApproverId("");
    setNote("");
    setErr(null);
  }, [open, resetKey]);

  const run = async (target: string | null) => {
    setErr(null);
    setBusy(true);
    try {
      await onReassign(target, note.trim() || null);
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
      title={`Reassign approval — ${docRef}`}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/* Only offered when there is something to undo, so the dialog never
              shows a control that would be a no-op. */}
          {currentHolderName && (
            <Button variant="ghost" size="sm" onClick={() => run(null)} disabled={busy}>
              {returnLabel}
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
            {currentHolderName ?? defaultOwnerLabel}
          </p>
        </div>

        {empty ? (
          <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] leading-snug text-[#946200]">
            Nobody has been set up to receive an approval yet. An admin can name them in{" "}
            <Link to={setupHref} className="font-semibold underline">
              {setupLabel}
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
