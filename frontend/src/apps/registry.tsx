import type { AppManifest } from "./types";
import { taskManagementApp } from "./task-management/meta";
import { receivablesHubApp } from "./receivables-hub/meta";
import { procurementApp } from "./procurement/meta";
// Legacy `purchase-fms` (the older linear prototype) is retired from the portal —
// the newer `procurement` app (also named "Purchase FMS") replaces it. Its folder
// is kept as dead code; re-add `purchaseFmsApp` here to bring it back.

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
  procurementApp,
];

export const liveApps = apps.filter((a) => a.status === "live" && a.Component);
