import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { closeTest, FLOW_QUERY, type FlowData, type FlowTest } from "../lib/flow";
import { DocList, fmtStamp, ResultPill, StatusPill, TestFacts, Trail } from "./FlowParts";

/**
 * STEP 3 · MANAGEMENT REVIEW — a REJECTED test (approved ones close themselves). Read the
 * lab's result, remarks and report, then close it — or reassign it to someone to audit.
 * There is no send-back any more (asked 08-10-2026): all follow-up work is done by hand.
 */
export default function ReviewModal({
  test, flow, canAct, onClose, onReassign,
}: {
  test: FlowTest | null;
  flow: FlowData | undefined;
  /** May this user close / reassign THIS test (canReview: assignee first, else review owners). */
  canAct: boolean;
  onClose: () => void;
  onReassign: (t: FlowTest) => void;
}) {
  const qc = useQueryClient();
  const person = useOrgPersonById();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setRemarks(""); setErr(null); }, [test?.key]);

  if (!test || !test.record) return null;
  const rec = test.record;
  const docs = flow?.docs.get(rec.id) ?? [];
  const trail = flow?.activity.get(rec.id) ?? [];
  const reviewable = canAct && test.status === "submitted";

  const close = async () => {
    setErr(null);
    if (!window.confirm("Close this test? It cannot be changed afterwards.")) return;
    setBusy(true);
    try {
      await closeTest(rec.id, remarks.trim());
      await qc.invalidateQueries({ queryKey: FLOW_QUERY });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={`Review · Test ${test.no} · ${test.lot.item}`}
      subtitle={`Lot ${test.lot.lot}${test.lot.company ? ` · ${test.lot.company}` : ""}`}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-[12.5px] text-ryg-red">{err}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{reviewable ? "Cancel" : "Close window"}</Button>
            {reviewable && (
              <>
                <Button variant="outline" onClick={() => onReassign(test)} disabled={busy}>Reassign</Button>
                <Button onClick={close} disabled={busy}>{busy ? "Closing…" : "Review & close"}</Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={test.status} />
          {rec.assignedTo && test.status === "submitted" && (
            <span className="rounded-full bg-orange/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-orange">
              With {person(rec.assignedTo)?.name ?? "someone"} for audit
            </span>
          )}
        </div>
        <TestFacts t={test} />

        <div className="rounded-lg border border-line p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
            Plant remarks · {person(rec.submittedBy)?.name ?? "Someone"} · {fmtStamp(rec.submittedAt)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
            <span>Lab result: <ResultPill result={rec.result} /></span>
            <span>Lab person: <b className="text-ink">{rec.labPerson ?? "—"}</b></span>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{rec.plantRemarks}</div>
        </div>

        {rec.assignedTo && rec.assignNote && test.status === "submitted" && (
          <div className="rounded-lg border border-orange/30 bg-orange/5 p-3 text-[13px]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-orange">
              Reassign note · {person(rec.assignedBy)?.name ?? "Someone"} · {fmtStamp(rec.assignedAt)}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-ink">{rec.assignNote}</div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Attachments</div>
          <DocList docs={docs} />
        </div>

        {reviewable ? (
          <FieldLabel label="Review remarks" hint="Optional.">
            <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Management's comments…" />
          </FieldLabel>
        ) : rec.reviewRemarks && (
          <div className="rounded-lg border border-line p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
              Review · {rec.reviewedBy ? person(rec.reviewedBy)?.name ?? "Someone" : "System"} · {fmtStamp(rec.reviewedAt)}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{rec.reviewRemarks}</div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">History</div>
          <Trail items={trail} />
        </div>
        {!canAct && test.status === "submitted" && (
          <div className="text-[12px] text-grey">
            You can view this test. {rec.assignedTo
              ? `It is with ${person(rec.assignedTo)?.name ?? "someone"} — only they or an admin can close it.`
              : "Only the Management review owners can close it."}
          </div>
        )}
      </div>
    </Modal>
  );
}
