/**
 * Task Management's half of the KRA / KPI facts (KPI-1).
 *
 * Every task ASSIGNED to a person is a fact on that person's report, recurring and
 * one-off alike, placed later by its due date. The rules are the user's, 18-09-2026:
 *
 *  · Counted:     what Task Management's own `countsTowardMetrics` counts — so NOT
 *                 Not Applicable, NOT personal (self-tracking), NOT peer (HOD to HOD).
 *                 The predicate is imported, never restated, so this report and the
 *                 Weekly Scorecard cannot disagree about which tasks count.
 *  · Done:        status `completed`. On time = the IST day of `completed_at` is on or
 *                 before `due_date` — and the task was never revised (see `revised`).
 *  · Bulk-closed: the 2,100 tasks closed by the two admin sweeps carry the SWEEP's
 *                 time as their completion, so they would read as late work nobody did.
 *                 They are identified by id, from the sweeps' own backup tables — never
 *                 by timestamp — and stored as `excluded`, so the report can say how
 *                 many it left out without ever counting them.
 *  · Shifted:     a task moved to a later week is marked `shifted` and continued by a
 *                 NEW task. The original is not completed, so it is given and not done
 *                 in its own week; the successor counts in its own. That is what
 *                 happened, and it is how the Weekly Scorecard reads it too.
 *
 * Rows: one per recurring TEMPLATE (its title and description — see templateLabel),
 * and one "One-off tasks" row. A task
 * whose template was deleted keeps `from_recurring` but loses the link, so it is keyed
 * on its own title instead — the only name left for it.
 *
 * Pure: bundled into the `kpi-facts` edge function.
 */
import { appName } from "@/apps/appInfo";
import { istDateOf } from "@/apps/fms-control-center/ranking/month";
import { countsTowardMetrics, isRecurringTask } from "@/apps/task-management/lib/taskCounts";
import type { RecurringTask, Task } from "@/apps/task-management/types";
import { bump, emptyStats, type KpiFact, type KpiModuleStats } from "./types";

export const TASK_MODULE = "task-management";
export const ONE_OFF_ROW = "one-off";
export const ONE_OFF_LABEL = "One-off tasks";

export interface TaskFactsInput {
  tasks: Task[];
  templates: RecurringTask[];
  /** Ids of the tasks the admin bulk sweeps closed. */
  bulkClosed: ReadonlySet<string>;
}

/**
 * A template's row name: its title, then what it actually is.
 *
 * Titles here are headings, not tasks — one person holds five templates called
 * "Bank" (BRS, URT details, payment file, payment entry, follow-up), and on 18-09-2026
 * 40 people-and-title pairs were shared by two or more templates. The description is
 * the task; with it, only 3 pairs still collide — and all three are the same task on two
 * schedules (an as-needed "when" template beside a monthly one). So where one person's
 * templates share a title and description, the schedule is added: "… · monthly".
 *
 * The name is stored WHOLE (descriptions are plain single lines, 144 characters at most).
 * It used to be clipped at 70 characters here, which left the grid's hover showing a cut name
 * too (the user, 19-09-2026); the screens now shorten a long name themselves, with the whole
 * of it on hover.
 */
const CADENCE: Record<string, string> = {
  daily: "daily",
  when: "as needed",
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
};
export function templateLabel(
  tpl: Pick<RecurringTask, "title" | "description"> & Partial<Pick<RecurringTask, "recurrenceType">>,
  withCadence = false,
): string {
  const d = (tpl.description ?? "").replace(/\s+/g, " ").trim();
  const base = d ? `${tpl.title} · ${d}` : tpl.title;
  const cadence = withCadence && tpl.recurrenceType ? CADENCE[tpl.recurrenceType] : undefined;
  return cadence ? `${base} · ${cadence}` : base;
}

/** Templates sharing their person, title and description with another: labelled with the schedule. */
function collidingTemplates(templates: RecurringTask[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const r of templates) {
    const k = `${r.assignedTo}|${templateLabel(r)}`;
    byName.set(k, [...(byName.get(k) ?? []), r.id]);
  }
  return new Set([...byName.values()].filter((ids) => ids.length > 1).flat());
}

/** Why Task Management does not count a task — for the run log, never shown per person. */
function notCountedWhy(t: Task): string {
  if (t.notApplicable) return "not_applicable";
  if (t.isPersonal) return "personal";
  if (t.isPeerAssignment) return "peer";
  return "not_counted";
}

export function taskFacts({ tasks, templates, bulkClosed }: TaskFactsInput): {
  facts: KpiFact[];
  stats: KpiModuleStats;
} {
  const stats = emptyStats("task");
  const templateById = new Map(templates.map((r) => [r.id, r]));
  const collides = collidingTemplates(templates);
  const moduleName = appName(TASK_MODULE);
  const facts: KpiFact[] = [];

  for (const t of tasks) {
    if (!countsTowardMetrics(t)) {
      bump(stats.dropped, notCountedWhy(t));
      continue;
    }
    if (!t.assignedTo) {
      bump(stats.dropped, "no_assignee");
      continue;
    }
    if (!t.dueDate) {
      bump(stats.dropped, "untimed");
      continue;
    }

    let rowKey = ONE_OFF_ROW;
    let rowLabel = ONE_OFF_LABEL;
    if (isRecurringTask(t)) {
      const tpl = t.recurringTaskId ? templateById.get(t.recurringTaskId) : undefined;
      if (tpl) {
        rowKey = tpl.id;
        rowLabel = templateLabel(tpl, collides.has(tpl.id));
      } else {
        rowKey = `title:${t.title}`;
        rowLabel = t.title;
      }
    }

    const closed = t.status === "completed" && !!t.completedAt;
    const doneDate = closed ? istDateOf(t.completedAt!) : null;
    if (closed && !doneDate) {
      bump(stats.dropped, "no_time");
      continue;
    }

    const excluded = bulkClosed.has(t.id) ? "bulk_close" : null;
    if (excluded) bump(stats.excluded, excluded);
    else if (closed) stats.closed++;
    else stats.open++;

    facts.push({
      source: "task",
      module: TASK_MODULE,
      module_name: moduleName,
      row_key: rowKey,
      row_label: rowLabel,
      user_id: t.assignedTo,
      item_id: t.id,
      entity_id: t.id,
      ref: t.title,
      round_no: 0,
      due_date: t.dueDate,
      done_at: closed ? t.completedAt : null,
      done_date_ist: doneDate,
      basis: closed ? "closed" : "open",
      revised: t.revisionCount > 0,
      excluded,
    });
  }

  stats.facts = facts.length;
  return { facts, stats };
}
