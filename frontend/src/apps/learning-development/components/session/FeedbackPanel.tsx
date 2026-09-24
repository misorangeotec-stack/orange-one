import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, Stars, useRun } from "./panelKit";
import type { Nomination, TrainingSession } from "../../types";

/**
 * Step 18 — what the people who came thought.
 *
 * ⚠ WHO CAN SEE THE NAMES IS DECIDED IN RLS, NOT HERE. HR/L&D and the HR Head
 *   always; an INTERNAL trainer on their own sessions; an external trainer never,
 *   because they have no account at all. This panel simply renders what the
 *   reader is allowed to load — so a trainer who should not see names gets rows
 *   that were never sent to the browser, rather than names hidden with CSS.
 *
 * ⚠ THE RESPONSE RATE COUNTS ATTENDEES, NOT NOMINEES. Somebody who did not come
 *   has nothing to give feedback about, and counting them would make every
 *   session look like it had poor feedback uptake.
 */
export default function FeedbackPanel({
  session: x,
  nominations,
  onError,
}: {
  session: TrainingSession;
  nominations: Nomination[];
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { user } = useSession();
  const { busy, run } = useRun(onError);
  const [overall, setOverall] = useState<number | null>(null);
  const [trainer, setTrainer] = useState<number | null>(null);
  const [content, setContent] = useState<number | null>(null);
  const [comment, setComment] = useState("");

  const rows = (s.data?.feedback ?? []).filter((f) => f.sessionId === x.id);
  const mine = rows.find((f) => f.employeeId === user?.id);
  const iAmOnIt = s.isParticipant(x.id);

  const attendance = (s.data?.attendance ?? []).filter((a) => a.sessionId === x.id);
  const attendees = attendance.filter((a) => ["present", "partial"].includes(a.status)).length;
  const avg = rows.length
    ? (rows.reduce((n, f) => n + f.overallRating, 0) / rows.length).toFixed(1)
    : null;

  return (
    <Panel
      title="Feedback"
      hint={
        attendees
          ? `${rows.length} of ${attendees} who attended have answered${avg ? ` · average ${avg} of 5` : ""}`
          : "Nobody attended, so there is no feedback to collect."
      }
    >
      {iAmOnIt && !mine && (
        <div className="rounded-lg border border-orange/40 bg-[#FFF8F4] p-3 space-y-3">
          <p className="text-[13.5px] text-navy">How was it? It takes a moment.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldLabel label="Overall" required>
              <Stars value={overall} onChange={setOverall} disabled={busy} />
            </FieldLabel>
            <FieldLabel label="The trainer">
              <Stars value={trainer} onChange={setTrainer} disabled={busy} />
            </FieldLabel>
            <FieldLabel label="The content">
              <Stars value={content} onChange={setContent} disabled={busy} />
            </FieldLabel>
          </div>
          <FieldLabel label="Anything you'd change?">
            <TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </FieldLabel>
          <Button
            size="sm"
            disabled={busy || overall === null}
            onClick={() =>
              void run(() =>
                s.writes.submitFeedback(x.id, {
                  overallRating: overall as number,
                  trainerRating: trainer,
                  contentRating: content,
                  comment: comment.trim() || null,
                }),
              )
            }
          >
            Send feedback
          </Button>
        </div>
      )}

      {mine && (
        <p className="text-[13px] text-ryg-green">
          You rated this {mine.overallRating} of 5 on {dmy(mine.submittedAt)}. Thank you.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-[13px] text-grey-2">No feedback yet.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((f) => (
            <div key={f.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13.5px] text-navy">{s.personName(f.employeeId)}</span>
                <span className="text-[12.5px] font-semibold text-navy">{f.overallRating} / 5</span>
              </div>
              {f.comment && <p className="mt-1 text-[13px] text-grey">{f.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
