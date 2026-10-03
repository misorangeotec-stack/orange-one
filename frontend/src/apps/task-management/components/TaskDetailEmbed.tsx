import { createContext, useContext } from "react";

/**
 * Lets TaskDetail run INSIDE another screen (the Weekly Scorecard's pending-bucket
 * slide-over) instead of as its own route. When this context is present, every
 * place TaskDetail would navigate — back link, "Shifted from / Continued as",
 * after a reschedule / revise-into-a-later-week, after complete or delete — calls
 * these instead, so the viewer stays on the page they came from.
 *
 * Absent (the normal /task-management/tasks/:id route), nothing changes.
 */
export interface TaskDetailEmbed {
  /** Show another task in the same panel (e.g. the continuation after a shift). */
  openTask: (id: string) => void;
  /** Leave the task view — back to whatever list the panel came from. */
  close: () => void;
}

export const TaskDetailEmbedContext = createContext<TaskDetailEmbed | null>(null);

export const useTaskDetailEmbed = () => useContext(TaskDetailEmbedContext);
