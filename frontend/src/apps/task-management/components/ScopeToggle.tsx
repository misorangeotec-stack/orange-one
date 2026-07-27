import PillToggle from "@/shared/components/ui/PillToggle";
import { WEEK_START } from "../mock/data";
import type { Task } from "../types";

/** Time scope shared by the dashboard + task lists: this (current) week or the full backlog. */
export type Scope = "week" | "all";

/** Narrow a task list to the current week when scoped (weekStart = this Monday); pass-through for "all". */
export function scopeTasks<T extends Pick<Task, "weekStart">>(list: T[], scope: Scope): T[] {
  return scope === "week" ? list.filter((t) => t.weekStart === WEEK_START) : list;
}

/**
 * Pill toggle: "This week" vs "All time". Shared by the dashboard, My Tasks,
 * Team Tasks, All Tasks and Tagged. A thin wrapper over the generic PillToggle
 * so this module keeps owning the Scope vocabulary (and `scopeTasks` beside it).
 */
export default function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <PillToggle<Scope>
      value={scope}
      onChange={onChange}
      options={[
        { value: "week", label: "This week" },
        { value: "all", label: "All time" },
      ]}
    />
  );
}
