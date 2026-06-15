import { cn } from "@/shared/lib/cn";
import { WEEK_START } from "../mock/data";
import type { Task } from "../types";

/** Time scope shared by the dashboard + task lists: this (current) week or the full backlog. */
export type Scope = "week" | "all";

/** Narrow a task list to the current week when scoped (weekStart = this Monday); pass-through for "all". */
export function scopeTasks<T extends Pick<Task, "weekStart">>(list: T[], scope: Scope): T[] {
  return scope === "week" ? list.filter((t) => t.weekStart === WEEK_START) : list;
}

/** Pill toggle: "This week" vs "All time". Shared by the dashboard, My Tasks, and Team Tasks. */
export default function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  const opts: { key: Scope; label: string }[] = [
    { key: "week", label: "This week" },
    { key: "all", label: "All time" },
  ];
  return (
    <div className="inline-flex items-center rounded-pill bg-page border border-line p-0.5 text-[12px] font-semibold">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "px-3 py-1.5 rounded-pill transition",
            scope === o.key ? "bg-white text-navy shadow-sm" : "text-grey-2 hover:text-navy",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
