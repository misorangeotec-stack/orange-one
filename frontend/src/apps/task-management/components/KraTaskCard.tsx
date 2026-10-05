import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextArea } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { formatDateTime, timeAgo } from "@/shared/lib/time";
import { fetchKras, KRAS_QUERY_KEY } from "@/core/admin/kras";
import { useTaskStore } from "../mock/store";
import { useSession } from "../mock/session";
import { awaitingKraReview, kraScore, pctLabel } from "../lib/kraTasks";
import type { Task } from "../types";

/**
 * Who may see a task's KRA at all: the assignee, and their DIRECT HOD. The client ruled
 * (05-10-2026) that nobody else sees a person's KRAs — not a higher-up HOD, not a
 * colleague tagged on the task. org_kras RLS hides the KRA name from them anyway; this
 * also hides the weight and the score that ride on the task row.
 */
export function useKraTaskAccess(task: Task | undefined) {
  const { user } = useSession();
  const { profileById } = useTaskStore();
  if (!task?.kraId) return { visible: false, isReviewer: false };
  const isReviewer = !!task.assignedTo && !!profileById(task.assignedTo)?.hodIds.includes(user.id);
  return { visible: isReviewer || task.assignedTo === user.id, isReviewer };
}

/** Header badge for a KRA task. Renders nothing for anyone who may not see it. */
export function KraBadge({ task }: { task: Task }) {
  const { visible } = useKraTaskAccess(task);
  if (!visible) return null;
  return (
    <span
      title="KRA task — worth the KRA's weight: half on completion, half from the HOD's 1-10 review."
      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#0f7b6c] bg-[#E3F5F1] rounded-pill px-2 py-1"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
      KRA
    </span>
  );
}

/**
 * The KRA, what the task is worth, what has been earned, and — for the direct HOD once the
 * task is completed — the 1-10 review. Score: W/2 on completion + (rating/10) × W/2.
 */
export default function KraTaskCard({ task }: { task: Task }) {
  const { visible, isReviewer } = useKraTaskAccess(task);
  const { reviewKraTask, actorById } = useTaskStore();
  const krasQ = useQuery({ queryKey: KRAS_QUERY_KEY, queryFn: fetchKras, enabled: visible });
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const score = kraScore(task);
  if (!visible || !score) return null;

  const kra = krasQ.data?.find((k) => k.id === task.kraId);
  const half = score.max / 2;
  const showReviewForm = isReviewer && task.status === "completed" && (score.stage === "awaiting-review" || editing);
  const preview = rating == null ? null : half + (rating / 10) * half;
  const reviewer = actorById(task.reviewedBy);

  const save = async () => {
    if (rating == null) {
      setErr("Pick a rating from 1 to 10.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await reviewKraTask(task.id, rating, note);
      setEditing(false);
      setRating(null);
      setNote("");
    } catch (e) {
      setErr((e as Error).message || "Couldn't save the review.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-[13px] font-semibold text-navy mb-3">KRA</h3>
      <p className="text-[13.5px] font-medium text-navy">{kra?.name ?? (krasQ.isLoading ? "…" : "KRA")}</p>
      <p className="text-[12px] text-grey mt-0.5">Worth {pctLabel(score.max)} of the employee's KRA score</p>

      <dl className="mt-3.5 space-y-2 text-[12.5px]">
        <ScoreRow label="Completion (50%)" value={score.stage === "open" ? `— of ${pctLabel(half)}` : `${pctLabel(score.completionPart)} of ${pctLabel(half)}`} />
        <ScoreRow
          label="HOD review (50%)"
          value={score.stage === "reviewed" ? `${task.reviewRating}/10 → ${pctLabel(score.reviewPart)} of ${pctLabel(half)}` : `— of ${pctLabel(half)}`}
        />
        <div className="flex items-center justify-between border-t border-line pt-2">
          <dt className="font-semibold text-navy">Achieved</dt>
          <dd className="font-semibold text-navy">
            {pctLabel(score.earned)} <span className="font-normal text-grey">/ {pctLabel(score.max)}</span>
          </dd>
        </div>
      </dl>

      {score.stage === "open" && (
        <p className="mt-3 text-[12px] text-grey">Once completed, this goes to the HOD for a 1–10 review.</p>
      )}
      {score.stage === "awaiting-review" && !isReviewer && (
        <p className="mt-3 rounded-lg bg-[#FFF6E5] px-3 py-2 text-[12px] text-[#9a6200]">Waiting for the HOD's review.</p>
      )}
      {score.stage === "reviewed" && !editing && (
        <p className="mt-3 text-[12px] text-grey">
          Reviewed{reviewer ? ` by ${reviewer.name}` : ""}
          {task.reviewedAt && <span title={formatDateTime(task.reviewedAt)}> · {timeAgo(task.reviewedAt)}</span>}
          {isReviewer && (
            <button className="ml-2 font-medium text-orange hover:underline" onClick={() => { setEditing(true); setRating(task.reviewRating); }}>
              Change
            </button>
          )}
        </p>
      )}

      {showReviewForm && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[12.5px] font-semibold text-navy">Your review</p>
          <p className="text-[11.5px] text-grey mb-2">How much of the second {pctLabel(half)} has this earned?</p>
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setRating(n); setErr(""); }}
                className={cn(
                  "h-8 rounded-lg border text-[13px] font-semibold transition-colors",
                  rating === n ? "border-orange bg-orange text-white" : "border-line text-navy hover:border-orange",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          {preview != null && (
            <p className="mt-2 text-[12px] text-grey">
              {pctLabel(half)} + {rating}/10 × {pctLabel(half)} = <b className="text-navy">{pctLabel(preview)}</b> of {pctLabel(score.max)}
            </p>
          )}
          <TextArea className="mt-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the employee (optional)" />
          {err && <p className="mt-1.5 text-[12px] text-[#d4493f]">{err}</p>}
          <div className="mt-2.5 flex justify-end gap-2">
            {editing && <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setRating(null); setErr(""); }} disabled={busy}>Cancel</Button>}
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save review"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ScoreRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-grey">{label}</dt>
      <dd className="text-navy text-right">{value}</dd>
    </div>
  );
}

/**
 * The direct HOD's queue: KRA tasks their reports have completed and nobody has rated.
 * All-time on purpose — a review owed from last week is still owed. Renders nothing when
 * the queue is empty, so a HOD who never gives KRA tasks never sees it.
 */
export function KraReviewQueue() {
  const { user } = useSession();
  const { tasks, profileById } = useTaskStore();
  const queue = tasks
    .filter((t) => awaitingKraReview(t) && !!t.assignedTo && !!profileById(t.assignedTo)?.hodIds.includes(user.id))
    .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""));
  if (queue.length === 0) return null;
  return (
    <Card className="overflow-hidden border border-[#F5D7A1]">
      <div className="flex items-center justify-between bg-[#FFF6E5] px-5 py-3">
        <h3 className="text-[13.5px] font-semibold text-navy">
          KRA tasks waiting for your review <span className="ml-1 rounded-pill bg-orange px-2 py-0.5 text-[11px] text-white">{queue.length}</span>
        </h3>
        <span className="text-[11.5px] text-grey">Open a task to rate it 1–10</span>
      </div>
      <ul className="divide-y divide-line">
        {queue.map((t) => {
          const who = profileById(t.assignedTo);
          return (
            <li key={t.id}>
              <Link to={`/task-management/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-[#FAFAFB]">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-navy">{t.title}</span>
                  <span className="text-[11.5px] text-grey">
                    {who?.name ?? "—"} · worth {pctLabel(t.kraWeight ?? 0)}
                    {t.completedAt && <> · completed <span title={formatDateTime(t.completedAt)}>{timeAgo(t.completedAt)}</span></>}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-orange">Review →</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
