import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextArea } from "@/shared/components/ui/Form";
import { formatDateTime, timeAgo } from "@/shared/lib/time";
import { useTaskStore } from "../mock/store";
import { useSession } from "../mock/session";
import { awaitingPeerReview, isPeerReviewerOf } from "../lib/peerReview";
import type { Task } from "../types";

/**
 * Peer task review (lib/peerReview.ts). Shows where the review stands, and — for the
 * person who gave the task, once it is completed — Close or Reopen. Reopen needs a
 * reason: it is the only thing telling the assignee what to recheck.
 */
export default function PeerReviewCard({ task }: { task: Task }) {
  const { user, isAdmin } = useSession();
  const { closePeerTask, reopenPeerTask, actorById, canStatusActions } = useTaskStore();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"close" | "reopen" | null>(null);
  const [err, setErr] = useState("");

  if (!task.isPeerAssignment) return null;

  const awaiting = awaitingPeerReview(task);
  const isReviewer = isPeerReviewerOf(task, user.id, isAdmin) && canStatusActions;
  const giver = actorById(task.createdBy)?.name ?? "the person who gave it";
  const assignee = actorById(task.assignedTo)?.name ?? "the assignee";
  const closer = actorById(task.peerClosedBy);

  const run = async (kind: "close" | "reopen") => {
    if (kind === "reopen" && !note.trim()) {
      setErr("Write what needs to change before re-opening.");
      return;
    }
    setBusy(kind);
    setErr("");
    try {
      if (kind === "close") await closePeerTask(task.id, note);
      else await reopenPeerTask(task.id, note);
      setNote("");
    } catch (e) {
      setErr((e as Error).message || "Couldn't save the review.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-[13px] font-semibold text-navy mb-2">Peer review</h3>

      {task.status !== "completed" && (
        <p className="text-[12px] text-grey">
          {task.peerReopenCount > 0 && <b className="text-[#c0392b]">Re-opened{task.peerReopenCount > 1 ? ` ${task.peerReopenCount} times` : ""}. </b>}
          When {task.assignedTo === user.id ? "you mark" : `${assignee} marks`} it complete, it goes to {task.createdBy === user.id ? "you" : giver} for review. It is completed only when {task.createdBy === user.id ? "you mark" : `${giver} marks`} it as completed.
        </p>
      )}

      {awaiting && !isReviewer && (
        <p className="rounded-lg bg-[#FFF6E5] px-3 py-2 text-[12px] text-[#9a6200]">In review — waiting for {giver} to mark it as completed or re-open it.</p>
      )}

      {task.status === "completed" && task.peerClosedAt && (
        <p className="text-[12px] text-grey">
          {closer ? `Reviewed and marked as completed by ${closer.name}` : "Completed"}
          <span title={formatDateTime(task.peerClosedAt)}> · {timeAgo(task.peerClosedAt)}</span>
        </p>
      )}

      {awaiting && isReviewer && (
        <div>
          <p className="rounded-lg bg-[#FFF6E5] px-3 py-2 text-[12px] text-[#9a6200]">
            {assignee} has finished this. Check the work: mark it as completed, or re-open it and it goes back to {assignee}.
          </p>
          <TextArea
            className="mt-2.5"
            rows={2}
            value={note}
            onChange={(e) => { setNote(e.target.value); setErr(""); }}
            placeholder="Note — optional to complete, required to re-open (what to change)"
          />
          {err && <p className="mt-1.5 text-[12px] text-[#d4493f]">{err}</p>}
          <div className="mt-2.5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => run("reopen")} disabled={!!busy}>
              {busy === "reopen" ? "Re-opening…" : "Re-open"}
            </Button>
            <Button size="sm" onClick={() => run("close")} disabled={!!busy}>
              {busy === "close" ? "Saving…" : "Mark as completed"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
