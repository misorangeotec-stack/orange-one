import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { dmy, inr } from "../../lib/format";
import { Panel, NotYours, useRun } from "./panelKit";
import type { TrainingSession } from "../../types";

/**
 * Step 19 — HR's read of how the session went, and what it actually cost.
 *
 * The figures above the form are assembled rather than typed, so the reviewer is
 * looking at the same numbers the KPI will later be computed from instead of
 * their own recollection.
 */
export default function ReviewPanel({
  session: x,
  onError,
}: {
  session: TrainingSession;
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { busy, run } = useRun(onError);
  const [note, setNote] = useState(x.reviewNote ?? "");
  const [actions, setActions] = useState(x.reviewActionPoints ?? "");
  const [cost, setCost] = useState(x.actualCost != null ? String(x.actualCost) : "");

  const mayAct = s.canActOnSession("session_review", x.id);
  const d = s.data;
  const noms = (d?.nominations ?? []).filter((n) => n.sessionId === x.id && n.status === "approved");
  const att = (d?.attendance ?? []).filter((a) => a.sessionId === x.id);
  const attended = att.filter((a) => ["present", "partial"].includes(a.status)).length;
  const fb = (d?.feedback ?? []).filter((f) => f.sessionId === x.id);
  const assignment = (d?.assignments ?? []).find((a) => a.sessionId === x.id);
  const subs = (d?.submissions ?? []).filter((v) => v.assignmentId === assignment?.id);
  const req = x.requestId ? s.requestById(x.requestId) : undefined;
  const perHead = attended > 0 && x.actualCost != null ? x.actualCost / attended : null;

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-lg bg-[#F8FAFD] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-grey-2">{label}</div>
      <div className="text-[14px] font-semibold text-navy">{value}</div>
    </div>
  );

  return (
    <Panel
      title="HR review of the session"
      hint={x.reviewedAt ? `Reviewed ${dmy(x.reviewedAt)}` : "Attendance, feedback, the assignment and the money, in one place."}
    >
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Attended" value={`${attended} of ${noms.length}`} />
        <Stat
          label="Feedback"
          value={fb.length ? `${(fb.reduce((n, f) => n + f.overallRating, 0) / fb.length).toFixed(1)} / 5` : "—"}
        />
        <Stat
          label="Assignment"
          value={assignment ? `${subs.filter((v) => v.submittedAt).length} of ${subs.length}` : "None"}
        />
        <Stat label="Approved" value={inr(req?.approvedBudget ?? null)} />
        <Stat label="Per head" value={perHead != null ? inr(perHead) : "—"} />
      </div>

      {x.reviewedAt && !mayAct ? (
        <>
          {x.reviewNote && <p className="text-[13.5px] text-navy">{x.reviewNote}</p>}
          {x.reviewActionPoints && (
            <p className="text-[13px] text-grey">Actions: {x.reviewActionPoints}</p>
          )}
        </>
      ) : mayAct ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="How did it go?">
              <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Action points">
              <TextArea rows={2} value={actions} onChange={(e) => setActions(e.target.value)} />
            </FieldLabel>
          </div>
          <FieldLabel label="What it actually cost" hint="Used for cost per participant.">
            <TextInput
              type="number"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder={req?.approvedBudget != null ? String(req.approvedBudget) : "0"}
            />
          </FieldLabel>
          <Button
            disabled={busy}
            onClick={() =>
              void run(() =>
                s.writes.reviewSession(x.id, {
                  reviewNote: note.trim() || null,
                  actionPoints: actions.trim() || null,
                  actualCost: cost === "" ? null : Number(cost),
                }),
              )
            }
          >
            {x.reviewedAt ? "Update the review" : "Record the review"}
          </Button>
        </>
      ) : (
        <NotYours stepKey="session_review" what="Reviewing the session" />
      )}
    </Panel>
  );
}
