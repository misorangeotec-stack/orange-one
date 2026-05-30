import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import { dateLabel, timeAgo } from "@/shared/lib/time";
import { useTaskStore } from "../mock/store";
import { departmentById, profileById } from "../mock/data";
import type { ActivityType } from "../types";
import StatusChip from "../components/StatusChip";
import RemarkComposer from "../components/RemarkComposer";
import ReviseModal from "../components/ReviseModal";
import ShiftModal from "../components/ShiftModal";
import CompleteModal from "../components/CompleteModal";

type ModalKind = "revise" | "shift" | "complete" | null;

export default function TaskDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getTask, activityFor, revisionInfo, startTask } = useTaskStore();
  const [modal, setModal] = useState<ModalKind>(null);

  const task = getTask(id);
  if (!task) {
    return <EmptyState title="Task not found" message="It may have been removed." actionLabel="Back to My Tasks" actionTo="/task-management/tasks" />;
  }

  const owner = profileById(task.assignedTo);
  const creator = profileById(task.createdBy);
  const dept = departmentById(task.departmentId);
  const info = revisionInfo(task);
  const closed = task.status === "completed" || task.status === "shifted";
  const acts = activityFor(task.id);

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="text-[13px] text-grey hover:text-orange font-medium inline-flex items-center gap-1">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back
      </button>

      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[22px] font-bold text-navy">{task.title}</h2>
            <StatusChip status={task.status} />
          </div>
          <p className="text-grey text-[13px] mt-1">
            {dept?.name ?? "No department"} · Created {timeAgo(task.createdAt)}
            {creator ? ` by ${creator.name}` : ""}
          </p>
        </div>

        {!closed && (
          <div className="flex flex-wrap items-center gap-2">
            {task.status === "pending" && (
              <Button variant="ghost" size="sm" onClick={() => startTask(task.id)}>Start</Button>
            )}
            <span title={info.allowed ? "" : `Revision limit reached (${info.max}/week)`}>
              <Button variant="ghost" size="sm" onClick={() => setModal("revise")} disabled={!info.allowed}>
                Revise{!info.allowed ? ` (${info.usedThisWeek}/${info.max})` : ""}
              </Button>
            </span>
            <Button variant="outline" size="sm" onClick={() => setModal("shift")}>Shift to next week</Button>
            <Button size="sm" onClick={() => setModal("complete")}>Mark complete</Button>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* left: description + activity */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <h3 className="text-[13px] font-semibold text-navy mb-2">Description</h3>
            <p className="text-[14px] text-grey leading-relaxed whitespace-pre-wrap">
              {task.description || "No description provided."}
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="text-[13px] font-semibold text-navy mb-3">Activity & Remarks</h3>
            <RemarkComposer taskId={task.id} />
            <ol className="mt-5 space-y-4 relative before:absolute before:left-[13px] before:top-1 before:bottom-1 before:w-px before:bg-line">
              {acts.map((a) => {
                const actor = profileById(a.actorId);
                const isRemark = a.type === "remark";
                return (
                  <li key={a.id} className="relative pl-9">
                    <span className="absolute left-0 top-0 w-[26px] h-[26px] rounded-full bg-white border border-line flex items-center justify-center text-orange [&>svg]:w-3.5 [&>svg]:h-3.5">
                      {actIcon(a.type)}
                    </span>
                    {isRemark ? (
                      <div className="bg-page rounded-xl px-3.5 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          {actor && <Avatar name={actor.name} color={actor.avatarColor} size={22} />}
                          <span className="text-[12.5px] font-semibold text-navy">{actor?.name ?? "Someone"}</span>
                          <span className="text-[11px] text-grey-2">{timeAgo(a.createdAt)}</span>
                        </div>
                        <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{renderMentions(a.note ?? "")}</p>
                      </div>
                    ) : (
                      <div className="py-0.5">
                        <p className="text-[13px] text-grey leading-snug">
                          <b className="text-navy font-semibold">{actor?.name ?? "Someone"}</b> {actVerb(a.type)}
                          {a.note ? <span className="text-grey-2"> — {a.note}</span> : ""}
                        </p>
                        <span className="text-[11px] text-grey-2">{timeAgo(a.createdAt)}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        {/* right: details */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-[13px] font-semibold text-navy mb-3">Details</h3>
            <dl className="space-y-3.5">
              <Row label="Assigned to">
                {owner ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={owner.name} color={owner.avatarColor} size={24} />
                    <span className="text-[13px] font-medium text-navy">{owner.name}</span>
                  </span>
                ) : "—"}
              </Row>
              <Row label="Created by">{creator?.name ?? "—"}</Row>
              <Row label="Due date">{dateLabel(task.dueDate)}</Row>
              <Row label="Follow-up">{task.followUpDate ? dateLabel(task.followUpDate) : "—"}</Row>
              <Row label="Revisions">
                <span className={info.remaining === 0 ? "text-[#d4493f] font-medium" : ""}>
                  {task.revisionCount} total · {info.remaining}/{info.max} left this week
                </span>
              </Row>
              {task.completedAt && <Row label="Completed">{timeAgo(task.completedAt)}</Row>}
            </dl>

            {(task.shiftedFromTaskId || task.shiftedToTaskId) && (
              <div className="mt-4 pt-4 border-t border-line space-y-2">
                {task.shiftedFromTaskId && (
                  <LinkedTask label="Shifted from" id={task.shiftedFromTaskId} />
                )}
                {task.shiftedToTaskId && (
                  <LinkedTask label="Continued as" id={task.shiftedToTaskId} />
                )}
              </div>
            )}
          </Card>

          {closed && (
            <Card className="p-4 text-center">
              <p className="text-[13px] text-grey">
                This task is <b className="text-navy">{task.status === "completed" ? "completed" : "shifted to next week"}</b>.
              </p>
            </Card>
          )}
        </div>
      </div>

      {/* modals */}
      <ReviseModal task={task} open={modal === "revise"} onClose={() => setModal(null)} />
      <ShiftModal task={task} open={modal === "shift"} onClose={() => setModal(null)} onShifted={(nid) => navigate(`/task-management/tasks/${nid}`)} />
      <CompleteModal task={task} open={modal === "complete"} onClose={() => setModal(null)} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[12px] text-grey-2">{label}</dt>
      <dd className="text-[13px] text-navy text-right">{children}</dd>
    </div>
  );
}

function LinkedTask({ label, id }: { label: string; id: string }) {
  const { getTask } = useTaskStore();
  const t = getTask(id);
  if (!t) return null;
  return (
    <Link to={`/task-management/tasks/${id}`} className="flex items-center justify-between gap-2 text-[12.5px] hover:bg-page rounded-lg px-2 py-1.5 -mx-2 transition">
      <span className="text-grey-2">{label}</span>
      <span className="text-orange font-medium truncate inline-flex items-center gap-1">
        {t.title}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </span>
    </Link>
  );
}

/** Highlight @mentions inside remark text. */
function renderMentions(text: string) {
  const parts = text.split(/(@[\p{L}]+(?:\s[\p{L}]+)?)/gu);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="text-orange font-medium">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

const ICONS = {
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>,
  revise: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>,
  shift: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V4h13l-2 4 2 4H4" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12 7.7L3 21l1.8-6A8.5 8.5 0 1 1 21 11.5z" /></svg>,
  dot: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /></svg>,
};
function actIcon(t: ActivityType) {
  if (t === "completed") return ICONS.check;
  if (t === "revised") return ICONS.revise;
  if (t === "shifted") return ICONS.shift;
  if (t === "followup") return ICONS.flag;
  if (t === "assigned" || t === "created") return ICONS.user;
  if (t === "remark") return ICONS.chat;
  return ICONS.dot;
}
function actVerb(t: ActivityType) {
  return {
    created: "created this task",
    assigned: "assigned this task",
    revised: "revised this task",
    followup: "set a follow-up date",
    completed: "marked it complete",
    shifted: "shifted it to next week",
    started: "started working on it",
    remark: "commented",
  }[t];
}
