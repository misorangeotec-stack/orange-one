import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "../RequestMasterModal";
import { useHrStore } from "../../store";

/**
 * The HOD returns their picks — in one action, over the batch HR sent them.
 *
 * Shortlisting needs nothing more than a click. Dropping needs a reason, because
 * that reason is what later tells you *where* the pipeline leaks.
 */
export default function HodDecisionModal({
  ids,
  selected,
  open,
  onClose,
}: {
  ids: string[];
  selected: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [reasonId, setReasonId] = useState("");
  /** Reason not in the master? Raise it for review without losing this form. */
  const [raiseReason, setRaiseReason] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reasons: ComboOption[] = useMemo(
    () => s.disqualificationReasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name })),
    [s.disqualificationReasons],
  );

  const names = ids.map((id) => s.candidateById(id)?.name).filter(Boolean) as string[];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.hodDecide(ids, selected, selected ? null : reasonId || null, note.trim());
      onClose();
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
      title={selected ? `Shortlist ${ids.length}` : `Drop ${ids.length}`}
      subtitle={
        selected
          ? "They go through to Interview Round 1."
          : "They drop out of the pipeline. The reason is what tells you where the pipeline leaks."
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || (!selected && !reasonId)}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="text-[13px] text-navy">{names.join(", ")}</p>

        {!selected && (
          <>
            <FieldLabel label="Reason" required>
              <Combobox
                value={reasonId}
                onChange={setReasonId}
                options={reasons}
                placeholder="Why are they dropping out?"
                onCreate={(name) => setRaiseReason(name)}
                createLabel={(q) => `Request new reason “${q}”`}
              />
              {requested && (
                <span className="mt-1 block text-[11px] text-teal">
                  Requested reason “{requested}” — selectable once the master's owner approves it.
                </span>
              )}
            </FieldLabel>
            <FieldLabel label="Note" hint="optional">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
          </>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the picks intact underneath. */}
      <RequestMasterModal
        stacked
        open={raiseReason !== null}
        onClose={() => setRaiseReason(null)}
        masterType="disqualification_reason"
        lockType
        prefill={{ name: raiseReason ?? "" }}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
    </Modal>
  );
}
