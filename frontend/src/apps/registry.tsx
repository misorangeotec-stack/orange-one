import type { AppManifest } from "./types";
import type { AppCategory } from "./categories";
import { taskManagementApp } from "./task-management/meta";
import { receivablesHubApp } from "./receivables-hub/meta";
import { procurementApp } from "./procurement/meta";
import { importApp } from "./import/meta";
import { hrRecruitmentApp } from "./hr-recruitment/meta";
import { hrExitApp } from "./hr-exit/meta";
import { officeSuppliesApp } from "./office-supplies/meta";
import { leadsDashboardApp } from "./leads-dashboard/meta";
import { fmsControlCenterApp } from "./fms-control-center/meta";
import { isUniversalApp } from "./universal";

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
  // Import Purchase FMS — separate module (own fms_import_* tables), granted per
  // user to the import team (not universal). Runs alongside domestic `procurement`.
  importApp,
  hrRecruitmentApp,
  // Universal (apps/universal.ts): no per-user grant — every employee must be able to
  // raise their own resignation, and there is no bulk grant to fall back on.
  hrExitApp,
  // Universal (apps/universal.ts): every employee can raise an office-supply request.
  officeSuppliesApp,
  leadsDashboardApp,
  fmsControlCenterApp,
];

export const liveApps = apps.filter((a) => a.status === "live" && a.Component);

/**
 * A grantable "module" is anything an admin can switch on per user in Module
 * Access / the User form. That's every web app PLUS virtual modules that aren't
 * web launcher cards — e.g. the mobile app, whose grant (`app_id: "mobile-app"`)
 * gates login to the Orange One mobile Leads app. Kept separate from `apps` so
 * the workspace launcher and router (which use `apps`/`liveApps`) never render or
 * mount it as a web app.
 */
export interface GrantableModule {
  id: string;
  name: string;
  status: AppManifest["status"];
  /** Granted to everyone implicitly (see apps/universal.ts) — the matrix shows it as locked-on. */
  universal?: boolean;
  /** Same grouping the home menu uses, so the permission screens read identically. */
  category?: AppCategory;
  order?: number;
  subGroup?: string;
}

export const grantableModules: GrantableModule[] = [
  ...apps.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    universal: isUniversalApp(a.id),
    category: a.category,
    order: a.order,
    subGroup: a.subGroup,
  })),
  // Virtual module: no web app, no launcher entry, no menu item — it only gates
  // login to the mobile Leads app. Categorised so it isn't stranded in "Other".
  { id: "mobile-app", name: "Mobile App", status: "live", category: "mobile", order: 10 },
];
