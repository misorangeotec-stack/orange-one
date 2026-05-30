import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Combobox from "@/shared/components/ui/Combobox";
import EmptyState from "@/shared/components/ui/EmptyState";
import { timeAgo } from "@/shared/lib/time";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { profileById, profiles } from "../mock/data";
import { visibleTasks } from "../mock/selectors";
import type { ActivityType } from "../types";

const TYPE_LABELS: Record<ActivityType, string> = {
  created: "Created", assigned: "Assigned", started: "Started", revised: "Revised",
  followup: "Follow-up", completed: "Completed", shifted: "Shifted", remark: "Remark",
};
const VERB: Record<ActivityType, string> = {
  created: "created", assigned: "assigned", started: "started", revised: "revised",
  followup: "set a follow-up on", completed: "completed", shifted: "shifted", remark: "commented on",
};

/** Filterable, workspace/team activity audit trail. */
export default function ActivityHistory() {
  const { user, role } = useSession();
  const { activity, getTask, tasks } = useTaskStore();
  const [type, setType] = useState<ActivityType | "all">("all");
  const [actor, setActor] = useState("all");

  const ids = useMemo(() => new Set(visibleTasks(role, user.id, tasks).map((t) => t.id)), [role, user.id, tasks]);

  const items = useMemo(
    () =>
      activity
        .filter((a) => ids.has(a.taskId))
        .filter((a) => (type === "all" ? true : a.type === type))
        .filter((a) => (actor === "all" ? true : a.actorId === actor))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [activity, ids, type, actor]
  );

  // people who appear as actors (for the filter)
  const actors = useMemo(() => {
    const set = new Set(activity.filter((a) => ids.has(a.taskId)).map((a) => a.actorId).filter(Boolean) as string[]);
    return profiles.filter((p) => set.has(p.id));
  }, [activity, ids]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">Activity History</h2>
        <p className="text-grey text-[13px] mt-1">A full audit trail of task actions across your workspace.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Combobox
          value={type}
          onChange={(v) => setType(v as ActivityType | "all")}
          className="w-auto min-w-[160px]"
          options={[{ value: "all", label: "All actions" }, ...(Object.keys(TYPE_LABELS) as ActivityType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] }))]}
        />
        <Combobox
          value={actor}
          onChange={setActor}
          className="w-auto min-w-[180px]"
          options={[{ value: "all", label: "Everyone" }, ...actors.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined, icon: <Avatar name={p.name} color={p.avatarColor} size={22} /> }))]}
        />
      </div>

      <Card className="p-5">
        {items.length === 0 ? (
          <EmptyState title="No activity" message="Nothing matches these filters yet." />
        ) : (
          <ol className="space-y-4 relative before:absolute before:left-[15px] before:top-1 before:bottom-1 before:w-px before:bg-line">
            {items.map((a) => {
              const actorP = profileById(a.actorId);
              const task = getTask(a.taskId);
              return (
                <li key={a.id} className="relative pl-11">
                  <span className="absolute left-0 top-0">
                    {actorP ? <Avatar name={actorP.name} color={actorP.avatarColor} size={30} /> : <span className="w-[30px] h-[30px] rounded-full bg-line block" />}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] text-grey leading-snug">
                      <b className="text-navy font-semibold">{actorP?.name ?? "Someone"}</b> {VERB[a.type]}{" "}
                      {task ? (
                        <Link to={`/task-management/tasks/${task.id}`} className="text-orange font-medium hover:underline">“{task.title}”</Link>
                      ) : (
                        "a task"
                      )}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded-pill px-1.5 py-0.5 bg-page text-grey-2">{TYPE_LABELS[a.type]}</span>
                  </div>
                  {a.note && <p className="text-[12.5px] text-grey-2 mt-0.5">{a.note}</p>}
                  <span className="text-[11px] text-grey-2">{timeAgo(a.createdAt)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
