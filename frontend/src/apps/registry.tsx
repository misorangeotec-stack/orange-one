import type { AppManifest } from "./types";
import { taskManagementApp } from "./task-management/meta";

/**
 * Central registry of all Orange One apps.
 * - The workspace launcher renders one card per entry.
 * - App.tsx mounts every `live` app at `${basePath}/*`.
 * Add a new app: build src/apps/<name>/, export its manifest, import it here.
 */
const comingSoon = (
  id: string,
  name: string,
  description: string,
  icon: AppManifest["icon"]
): AppManifest => ({ id, name, description, basePath: `/${id}`, status: "coming-soon", icon });

export const apps: AppManifest[] = [
  taskManagementApp,
  comingSoon(
    "outstanding-dashboard",
    "Outstanding Dashboard",
    "",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="11" width="3" height="6" rx="0.5" /><rect x="11" y="7" width="3" height="10" rx="0.5" /><rect x="16" y="13" width="3" height="4" rx="0.5" stroke="#FF6A1F" /></svg>
  ),
];

export const liveApps = apps.filter((a) => a.status === "live" && a.Component);
