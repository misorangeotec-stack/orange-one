import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import TaskManagementApp from "./TaskManagementApp";

/** Manifest for the Task Management app. */
export const taskManagementApp: AppManifest = {
  id: "task-management",
  name: appName("task-management"),
  description: "Track assignments, revisions, follow-ups, and weekly execution accountability.",
  basePath: appBasePath("task-management"),
  status: "live",
  category: appCategory("task-management"),
  order: 10,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3.5h6v1" />
      <path d="M8.5 12l2.1 2.1L15.5 9.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: TaskManagementApp,
};
