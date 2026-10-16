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
import Combobox from "@/shared/components/ui/Combobox";
import { awaitingKraReview, hodMayChangeKra, isKraReviewerOf, isKraTask, kraScore, kraToPick, pctLabel } from "../lib/kraTasks";
import type { Task } from "../types";

/**
 * Who may see a task's KRA at all: the assignee, their DIRECT HOD, and the Director who
 * reviews it (a Director's KRA task given to a HOD / Sub-HOD). The client ruled
 * (05-10-2026) that nobody else sees a person's KRAs — not a higher-up HOD, not a
 * colleague tagged on the task. org_kras RLS hides the KRA name from them anyway; this
 * also hides the weight and the score that ride on the task row.
 *
 * `isReviewer` = gives the 1-10 review (and, on the employee path, picks the KRA).
 */
export function useKraTaskAccess(task: Task | undefined) {
  const { user } = useSession();
  const { profileById } = useTaskStore();
  if (!task || !isKraTask(task)) return { visible: false, isReviewer: false };
  const isReviewer = isKraReviewerOf(task, user.id, (id) => profileById(id)?.hodIds);
  const isDirectHod = !!task.assignedTo && !!profileById(task.assignedTo)?.hodIds.includes(user.id);
  return { visible: isReviewer || isDirectHod || task.assignedTo === user.id, isReviewer };
}

/** Header badge for a KRA task. Renders nothing for anyone who may not see it. */
export function KraBadge({ task }: { task: Task }) {
  const { visible } = useKraTaskAccess(task);
  if (!visible) return null;
  return (
    <span
      title="KRA task — worth the KRA's weight: part on completion, the rest from the HOD's 1-10 review."
      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#0f7b6c] bg-[#E3F5F1] rounded-pill px-2 py-1"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
      KRA
    </span>
  );
}

/**
 * The KRA, what the task is worth, what has been earned, and — for the reviewer once the
 * task is completed — the 1-10 review (on a Director's employee-path task the HOD picks
 * the KRA in the same form). Score: C on completion + (rating/10) × (W − C).
 */
export default function KraTaskCard({ task }: { task: Task }) {
  const { visible, isReviewer } = useKraTaskAccess(task);
  const { reviewKraTask, actorById } = useTaskStore();
  const krasQ = useQuery({ queryKey: KRAS_QUERY_KEY, queryFn: fetchKras, enabled: visible });
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [pickKraId, setPickKraId] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!visible) return null;

  // A Director's KRA task whose KRA is still to be picked (20270130120000).
  const toPick = kraToPick(task);
  const awaiting = task.status === "completed" && task.reviewRating == null;
  const showReviewForm = isReviewer && task.status === "completed" && (awaiting || editing);
  // Employee path: the HOD sees the KRA the employee picked and may change it in the review.
  const hodChanges = showReviewForm && hodMayChangeKra(task);
  const assigneeKras = (krasQ.data ?? []).filter((k) => k.profileId === task.assignedTo && k.active).sort((a, b) => a.sortOrder - b.sortOrder);
  // The KRA the review will save: the HOD's choice, else what the employee picked.
  const reviewKraId = hodChanges ? pickKraId || task.kraId || "" : "";
  const changedKra = hodChanges && reviewKraId !== task.kraId ? assigneeKras.find((k) => k.id === reviewKraId) : undefined;

  // The score: the task's own snapshot, or — when the HOD switches the KRA — the new one.
  const score = changedKra
    ? kraScore({ ...task, kraId: changedKra.id, kraWeight: changedKra.weight, kraCompletionWeight: changedKra.completionWeight })
    : kraScore(task);

  const kra = krasQ.data?.find((k) => k.id === task.kraId);
  const preview = rating == null || !score ? null : score.completionMax + (rating / 10) * score.reviewMax;
  const reviewer = actorById(task.reviewedBy);
  // Who reviews: the Director named on the task, otherwise "the HOD".
  const reviewerLabel = task.kraReviewerId ? actorById(task.kraReviewerId)?.name ?? "the Director" : "the HOD";
  const assigneeName = actorById(task.assignedTo)?.name;

  const save = async () => {
    if (hodChanges && !reviewKraId) {
      setErr("Pick which KRA this task belongs to.");
      return;
    }
    if (rating == null) {
      setErr("Pick a rating from 1 to 10.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // The KRA rides on the save only when the HOD changed (or first set) it.
      await reviewKraTask(task.id, rating, note, hodChanges && reviewKraId !== task.kraId ? reviewKraId : undefined);
      setEditing(false);
      setRating(null);
      setNote("");
      setPickKraId("");
    } catch (e) {
      setErr((e as Error).message || "Couldn't save the review.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-[13px] font-semibold text-navy mb-3">KRA</h3>
      {toPick && !changedKra ? (
        <>
          <p className="text-[13.5px] font-medium text-navy">KRA to be picked</p>
          <p className="text-[12px] text-grey mt-0.5">
            Given as a KRA task by {actorById(task.createdBy)?.name ?? "a Director"}.{" "}
            {assigneeName ?? "The assignee"} picks which of their KRAs it belongs to when marking it complete; {reviewerLabel} then reviews it 1–10
            {hodMayChangeKra(task) ? " and may change the KRA." : "."}
          </p>
        </>
      ) : (
        <>
          <p className="text-[13.5px] font-medium text-navy">{changedKra?.name ?? kra?.name ?? (krasQ.isLoading ? "…" : "KRA")}</p>
          {task.kraOpen && !changedKra && (
            <p className="text-[11.5px] text-grey-2">Picked by {assigneeName ?? "the assignee"}</p>
          )}
          {score && <p className="text-[12px] text-grey mt-0.5">Worth {pctLabel(score.max)} of the employee's KRA score</p>}
        </>
      )}

      {score && (
        <dl className="mt-3.5 space-y-2 text-[12.5px]">
          <ScoreRow
            label="On completion"
            value={score.stage === "open" ? `— of ${pctLabel(score.completionMax)}` : `${pctLabel(score.completionPart)} of ${pctLabel(score.completionMax)}`}
          />
          <ScoreRow
            label="On review"
            value={score.stage === "reviewed" ? `${task.reviewRating}/10 → ${pctLabel(score.reviewPart)} of ${pctLabel(score.reviewMax)}` : `— of ${pctLabel(score.reviewMax)}`}
          />
          <div className="flex items-center justify-between border-t border-line pt-2">
            <dt className="font-semibold text-navy">Achieved</dt>
            <dd className="font-semibold text-navy">
              {pctLabel(score.earned)} <span className="font-normal text-grey">/ {pctLabel(score.max)}</span>
            </dd>
          </div>
        </dl>
      )}

      {!toPick && task.status !== "completed" && (
        <p className="mt-3 text-[12px] text-grey">Once completed, this goes to {reviewerLabel} for a 1–10 review.</p>
      )}
      {awaiting && !isReviewer && (
        <p className="mt-3 rounded-lg bg-[#FFF6E5] px-3 py-2 text-[12px] text-[#9a6200]">Waiting for {reviewerLabel}'s review.</p>
      )}
      {task.reviewRating != null && !editing && (
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
          {hodChanges && (
            <div className="mt-1.5 mb-3">
              <p className="text-[11.5px] text-grey mb-1">
                KRA {task.kraId ? `${assigneeName ?? "the employee"} picked — change it if it belongs to another` : "this task belongs to"}
              </p>
              <Combobox
                value={reviewKraId}
                onChange={(v) => { setPickKraId(v); setErr(""); }}
                placeholder={krasQ.isLoading ? "Loading…" : assigneeKras.length ? "Pick the KRA" : "No KRAs set for this person yet"}
                options={assigneeKras.map((k) => ({ value: k.id, label: k.name, sublabel: `KRA · Wt ${pctLabel(k.weight)}` }))}
              />
            </div>
          )}
          {score && <p className="text-[11.5px] text-grey mb-2">How much of the review's {pctLabel(score.reviewMax)} has this earned?</p>}
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
          {preview != null && score && (
            <p className="mt-2 text-[12px] text-grey">
              {pctLabel(score.completionMax)} + {rating}/10 × {pctLabel(score.reviewMax)} = <b className="text-navy">{pctLabel(preview)}</b> of {pctLabel(score.max)}
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
 * The reviewer's queue: completed KRA tasks nobody has rated, that THIS user reviews —
 * a direct HOD for their reports, a Director for the HOD / Sub-HOD tasks they gave.
 * All-time on purpose — a review owed from last week is still owed. Renders nothing when
 * the queue is empty, so a HOD who never gives KRA tasks never sees it.
 */
export function KraReviewQueue() {
  const { user } = useSession();
  const { tasks, profileById, actorById } = useTaskStore();
  const queue = tasks
    .filter((t) => awaitingKraReview(t) && isKraReviewerOf(t, user.id, (id) => profileById(id)?.hodIds))
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
          const who = actorById(t.assignedTo);
          return (
            <li key={t.id}>
              <Link to={`/task-management/tasks/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-[#FAFAFB]">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-navy">{t.title}</span>
                  <span className="text-[11.5px] text-grey">
                    {who?.name ?? "—"} · {t.kraId ? `worth ${pctLabel(t.kraWeight ?? 0)}` : "KRA to be picked"}
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
