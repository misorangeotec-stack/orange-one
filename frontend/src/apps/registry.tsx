import type { AppManifest } from "./types";
import { taskManagementApp } from "./task-management/meta";
import { receivablesHubApp } from "./receivables-hub/meta";
import { purchaseFmsApp } from "./purchase-fms/meta";

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
  receivablesHubApp,
  purchaseFmsApp,
];

export const liveApps = apps.filter((a) => a.status === "live" && a.Component);
