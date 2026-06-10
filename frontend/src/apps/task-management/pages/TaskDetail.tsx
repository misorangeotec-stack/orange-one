import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import { dateLabel, timeAgo, formatDateTime } from "@/shared/lib/time";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../mock/store";
import { locationLabel, type ActivityType } from "../types";
import StatusChip from "../components/StatusChip";
import RemarkComposer from "../components/RemarkComposer";
import ReviseModal from "../components/ReviseModal";
import CompleteModal from "../components/CompleteModal";

type ModalKind = "revise" | "complete" | null;

export default function TaskDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { getTask, activityFor, revisionInfo, startTask, rescheduleTask, profileById, departmentById, canWrite, canStatusActions, canReschedule, locationById, taskLocationsComplete, setTaskLocationDone, isWhenTask, setTaskNotApplicable } = useTaskStore();
  const [modal, setModal] = useState<ModalKind>(null);
  const [starting, setStarting] = useState(false);
  const [togglingLoc, setTogglingLoc] = useState<string | null>(null);
  const [togglingNa, setTogglingNa] = useState(false);

  const task = getTask(id);
  if (!task) {
    return <EmptyState title="Task not found" message="It may have been removed." actionLabel="Back to My Tasks" actionTo="/task-management/tasks" />;
  }

  const onReschedule = async (date: string) => {
    if (!date) return;
    const newId = await rescheduleTask(task.id, date);
    if (newId) navigate(`/task-management/tasks/${newId}`); // shifted to a future week
  };

  const owner = profileById(task.assignedTo);
  const creator = profileById(task.createdBy);
  const dept = departmentById(task.departmentId);
  const info = revisionInfo(task);
  const closed = task.status === "completed" || task.status === "shifted";
  const acts = activityFor(task.id);

  // "When" instances can be parked as Not Applicable for the day (reversible).
  // While N/A the normal status actions are hidden and the task is excluded from reports.
  const whenTask = isWhenTask(task);
  const na = task.notApplicable;

  // Location checklist + completion gate. A task with locations can't be completed
  // until every one is ticked (the DB trigger enforces it too — this is the UI guard).
  const hasLocations = task.locations.length > 0;
  const pendingLocations = task.locations.filter((l) => !l.completedAt).length;
  const locationsComplete = taskLocationsComplete(task);
  const completeBlocked = hasLocations && !locationsComplete;

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
            <StatusChip status={task.status} notApplicable={na} />
            {task.recurringTaskId && (
              <span
                title="Generated from a recurring task"
                className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-blue bg-[#EAF1FE] rounded-pill px-2 py-1"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                Recurring
              </span>
            )}
          </div>
          <p className="text-grey text-[13px] mt-1">
            {dept?.name ?? "No department"} · Created <span title={formatDateTime(task.createdAt)}>{timeAgo(task.createdAt)}</span>
            {creator ? ` by ${creator.name}` : ""}
          </p>
        </div>

        {/* N/A "when" instance: only offer to switch it back to applicable. */}
        {na && canStatusActions && (
          <Button
            variant="ghost"
            size="sm"
            disabled={togglingNa}
            onClick={async () => {
              setTogglingNa(true);
              try {
                await setTaskNotApplicable(task.id, false);
              } finally {
                setTogglingNa(false);
              }
            }}
          >
            {togglingNa ? "Updating…" : "Mark Applicable"}
          </Button>
        )}

        {!na && !closed && canStatusActions && (
          <div className="flex flex-wrap items-center gap-2">
            {whenTask && (
              <Button
                variant="ghost"
                size="sm"
                disabled={togglingNa}
                onClick={async () => {
                  setTogglingNa(true);
                  try {
                    await setTaskNotApplicable(task.id, true);
                  } finally {
                    setTogglingNa(false);
                  }
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.9" y1="4.9" x2="19.1" y2="19.1" /></svg>
                {togglingNa ? "Updating…" : "Mark N/A"}
              </Button>
            )}
            {task.status !== "in_progress" && (
              <Button
                variant="progress"
                size="sm"
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await startTask(task.id);
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 4 20 12 6 20 6 4" /></svg>
                {starting ? "Starting…" : "Mark in progress"}
              </Button>
            )}
            <span title={info.allowed ? "" : `Revision limit reached (${info.max}/week)`}>
              <Button variant="ghost" size="sm" onClick={() => setModal("revise")} disabled={!info.allowed}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></svg>
                Revise{!info.allowed ? ` (${info.usedThisWeek}/${info.max})` : ""}
              </Button>
            </span>
            <span title={completeBlocked ? `Complete all locations first — ${pendingLocations} pending` : ""}>
              <Button size="sm" onClick={() => setModal("complete")} disabled={completeBlocked}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                Mark complete{completeBlocked ? ` (${pendingLocations} left)` : ""}
              </Button>
            </span>
          </div>
        )}
      </div>

      {na && (
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-[#F4F6F9] px-4 py-3 text-[13px] text-grey">
          <svg className="mt-0.5 shrink-0 text-grey-2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.9" y1="4.9" x2="19.1" y2="19.1" /></svg>
          <span>
            Marked <b className="text-navy">Not Applicable</b> for this day — it's excluded from the reports and counts. Use <b>Mark Applicable</b> above to bring it back.
          </span>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        {/* left: description + activity */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <h3 className="text-[13px] font-semibold text-navy mb-2">Description</h3>
            <p className="text-[14px] text-grey leading-relaxed whitespace-pre-wrap">
              {task.description || "No description provided."}
            </p>
          </Card>

          {hasLocations && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold text-navy">Locations</h3>
                <span className={cn("text-[12px] font-medium", locationsComplete ? "text-[#27AE60]" : "text-grey-2")}>
                  {task.locations.length - pendingLocations}/{task.locations.length} done
                </span>
              </div>
              <ul className="space-y-1.5">
                {task.locations.map((tl) => {
                  const loc = locationById(tl.locationId);
                  const label = loc ? locationLabel(loc) : "Unknown location";
                  const done = tl.completedAt !== null;
                  const by = profileById(tl.completedBy);
                  const editable = !closed && canStatusActions;
                  return (
                    <li key={tl.id}>
                      <button
                        type="button"
                        disabled={!editable || togglingLoc === tl.id}
                        onClick={async () => {
                          setTogglingLoc(tl.id);
                          try {
                            await setTaskLocationDone(tl.id, !done);
                          } finally {
                            setTogglingLoc(null);
                          }
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition border",
                          done ? "bg-[#E8F8EF] border-[#bde9cf]" : "bg-page border-line",
                          editable ? "hover:border-orange/50 cursor-pointer" : "cursor-default"
                        )}
                      >
                        <span
                          className={cn(
                            "w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 [&>svg]:w-3 [&>svg]:h-3",
                            done ? "bg-[#27AE60] border-[#27AE60] text-white" : "bg-white border-grey-2/50 text-transparent"
                          )}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn("text-[13px] font-medium", done ? "text-navy" : "text-ink")}>{label}</span>
                          {done && (
                            <span className="block text-[11px] text-grey-2" title={formatDateTime(tl.completedAt!)}>
                              {by ? `Done by ${by.name}` : "Done"} · {timeAgo(tl.completedAt!)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {completeBlocked && !closed && (
                <p className="mt-3 text-[12px] text-grey-2">
                  Tick off every location to enable <b className="text-navy font-medium">Mark complete</b>.
                </p>
              )}
            </Card>
          )}

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
                          <span className="text-[11px] text-grey-2" title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span>
                        </div>
                        <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{renderMentions(a.note ?? "")}</p>
                      </div>
                    ) : (
                      <div className="py-0.5">
                        <p className="text-[13px] text-grey leading-snug">
                          <b className="text-navy font-semibold">{actor?.name ?? "Someone"}</b> {actVerb(a.type)}
                          {a.note ? <span className="text-grey-2"> — {a.note}</span> : ""}
                        </p>
                        <span className="text-[11px] text-grey-2" title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</span>
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
              <Row label="Due date">
                <DueDateEditor value={task.dueDate} closed={closed || !canReschedule} onChange={onReschedule} />
              </Row>
              <Row label="Follow-up">{task.followUpDate ? dateLabel(task.followUpDate) : "—"}</Row>
              <Row label="Revisions">
                <span className={info.remaining === 0 ? "text-[#d4493f] font-medium" : ""}>
                  {task.revisionCount} total · {info.remaining}/{info.max} left this week
                </span>
              </Row>
              {task.completedAt && <Row label="Completed"><span title={formatDateTime(task.completedAt)}>{timeAgo(task.completedAt)}</span></Row>}
              <Row label="Last updated"><span title={formatDateTime(task.updatedAt)}>{timeAgo(task.updatedAt)}</span></Row>
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
      <CompleteModal task={task} open={modal === "complete"} onClose={() => setModal(null)} />
    </div>
  );
}

/** Inline-editable due date. Picking a future-week date auto-shifts the task. */
function DueDateEditor({ value, closed, onChange }: { value: string | null; closed: boolean; onChange: (d: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (closed) return <>{dateLabel(value)}</>;
  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={value ?? ""}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
        className="rounded-lg border border-orange bg-white px-2 py-1 text-[12.5px] text-navy outline-none ring-4 ring-orange/10"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      title="Change due date — pick a date in a future week to shift the task to that week"
      className="inline-flex items-center gap-1.5 text-navy hover:text-orange transition group"
    >
      {dateLabel(value)}
      <svg className="text-grey-2 group-hover:text-orange transition" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
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
