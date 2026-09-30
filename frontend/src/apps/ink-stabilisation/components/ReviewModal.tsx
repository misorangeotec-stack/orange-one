import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { FLOW_QUERY, reviewTest, type FlowData, type FlowTest } from "../lib/flow";
import { DocList, fmtStamp, ResultPill, StatusPill, TestFacts, Trail } from "./FlowParts";

/**
 * STEP 3 · MANAGEMENT REVIEW — read the Plant's remarks and report, then close the test
 * or send it back. Sending back needs a reason; closing is final.
 */
export default function ReviewModal({
  test, flow, canAct, onClose,
}: {
  test: FlowTest | null;
  flow: FlowData | undefined;
  canAct: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const person = useOrgPersonById();
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"close" | "return" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setRemarks(""); setErr(null); }, [test?.key]);

  if (!test || !test.record) return null;
  const rec = test.record;
  const docs = flow?.docs.get(rec.id) ?? [];
  const trail = flow?.activity.get(rec.id) ?? [];
  const reviewable = canAct && test.status === "submitted";

  const act = async (action: "close" | "return") => {
    setErr(null);
    if (action === "return" && !remarks.trim()) return setErr("Say why it is being sent back.");
    if (action === "close" && !window.confirm("Close this test? It cannot be changed afterwards.")) return;
    setBusy(action);
    try {
      await reviewTest(rec.id, action, remarks.trim());
      await qc.invalidateQueries({ queryKey: FLOW_QUERY });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={`Review · Test ${test.no} · ${test.lot.item}`}
      subtitle={`Lot ${test.lot.lot}`}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-[12.5px] text-ryg-red">{err}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{reviewable ? "Cancel" : "Close window"}</Button>
            {reviewable && (
              <>
                <Button variant="outline" onClick={() => act("return")} disabled={busy !== null}>
                  {busy === "return" ? "Sending back…" : "Send back to Plant"}
                </Button>
                <Button onClick={() => act("close")} disabled={busy !== null}>
                  {busy === "close" ? "Closing…" : "Review & close"}
                </Button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2"><StatusPill status={test.status} /></div>
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

        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Attachments</div>
          <DocList docs={docs} />
        </div>

        {reviewable ? (
          <FieldLabel label="Review remarks" hint="Required to send back; optional to close.">
            <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Management's comments…" />
          </FieldLabel>
        ) : rec.reviewRemarks && (
          <div className="rounded-lg border border-line p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
              Review · {person(rec.reviewedBy)?.name ?? "Someone"} · {fmtStamp(rec.reviewedAt)}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-[13px] text-ink">{rec.reviewRemarks}</div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink">History</div>
          <Trail items={trail} />
        </div>
        {!canAct && test.status === "submitted" && (
          <div className="text-[12px] text-grey">You can view this test. Only the Management review owners can close it.</div>
        )}
      </div>
    </Modal>
  );
}
