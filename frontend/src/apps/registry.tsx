import type { AppManifest } from "./types";
import type { AppCategory } from "./categories";
import { taskManagementApp } from "./task-management/meta";
import { receivablesHubApp } from "./receivables-hub/meta";
import { procurementApp } from "./procurement/meta";
import { importApp } from "./import/meta";
import { hrRecruitmentApp } from "./hr-recruitment/meta";
import { hrExitApp } from "./hr-exit/meta";
import { officeSuppliesApp } from "./office-supplies/meta";
import { samplingApp } from "./sampling/meta";
import { productionEntryApp } from "./production-entry/meta";
import { orderToDispatchApp } from "./order-to-dispatch/meta";
import { customerOnboardingApp } from "./customer-onboarding/meta";
import { assetMaintenanceApp } from "./asset-maintenance/meta";
import { leadsDashboardApp } from "./leads-dashboard/meta";
import { ocpiApp } from "./ocpi/meta";
import { fmsControlCenterApp } from "./fms-control-center/meta";
import { processCoordinatorApp } from "./process-coordinator/meta";
import { masterReportApp } from "./master-report/meta";
import { isUniversalApp } from "./universal";
import { appCategory, appName } from "./appInfo";

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
  // Granted per user like every other module (was universal — see apps/universal.ts —
  // but that let everyone see it regardless of their grant, which admins didn't want).
  hrExitApp,
  // Granted per user like every other module (was universal — see apps/universal.ts).
  officeSuppliesApp,
  // Sampling FMS — separate module (own fms_sampling_* tables), granted per user to
  // the sampling team (not universal). Ink / raw-material lab sampling.
  samplingApp,
  // Production Entry FMS — separate module (own fms_production_* tables), granted per
  // user to the production team (not universal). Ink production job-card tracker.
  productionEntryApp,
  // Order to Dispatch FMS — separate module (own fms_dispatch_* tables), granted
  // per user to the sales, stores, accounts and plant teams. Sales order through
  // credit, stock, LOT, sales bill and gate-out to the delivery confirmation.
  orderToDispatchApp,
  // Asset Maintenance FMS — own fms_asset_* tables, granted per user. The only
  // module whose entity is PERMANENT: assets and their dated tracks live for
  // years, and a service JOB is raised off a track when it falls due, then closed
  // to roll the track forward. Nightly pg_cron opens the jobs and pushes reminders.
  assetMaintenanceApp,
  // New Customer Onboarding — promoted out of the Outstanding Dashboard to the
  // main menu (29-07-2026). Its pages still live under apps/receivables-hub/
  // because they are hub-native components; this manifest mounts that subtree
  // under its own basePath and chrome. See customer-onboarding/meta.tsx.
  customerOnboardingApp,
  leadsDashboardApp,
  // OCPI — the machine SALE before there is an order to dispatch: a quotation
  // drafted and revised through the negotiation, approved, then turned into an
  // order confirmation the customer signs. Own fms_ocpi_* tables, granted per
  // user to the sales team and to whoever approves.
  ocpiApp,
  fmsControlCenterApp,
  // Process Coordinator — the coordinator's own desk, and the only screen in the
  // Control category that WRITES: every module's master approvals land in one
  // queue here. Its second half answers the question the Control Center cannot —
  // not just which step is delayed, but who is sitting on it and how to reach
  // them. Granted per user; the grant itself is what makes someone the
  // coordinator.
  processCoordinatorApp,
  // Master Report — the director's read on module ADOPTION, not on due work.
  // Sits beside the Control Center in the Control category and answers the
  // question that one cannot: "is anyone actually using this module?". Counts
  // come from a single server-side RPC so the page and the 08:00 email agree.
  masterReportApp,
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
  { id: "mobile-app", name: appName("mobile-app"), status: "live", category: appCategory("mobile-app"), order: 10 },
];

/**
 * Modules that cannot be granted VIEW-ONLY, so the permission screens offer only
 * "No access" and "Full access" for them.
 *
 * `mobile-app` is here because view-only would be a LIE there, not merely
 * unimplemented. The phone app writes — it creates and edits leads and uploads
 * media — its login gate asks `app_mobile_has_access()` as a plain yes/no, and
 * RLS on the lead tables checks only "is this your own row", never app_access.
 * On top of that it is offline-first: an edit made with the buttons hidden would
 * still be replayed by the sync queue once the phone came back online. Hiding
 * buttons cannot enforce anything there, and offering a switch that does nothing
 * is worse than not offering it.
 *
 * Remove an id from here once that app's writes actually consult
 * `public.module_level()` (see 20260906120000_add_app_access_level.sql).
 */
export const NO_VIEW_ONLY_APP_IDS = new Set<string>(["mobile-app"]);

/** The access levels a module offers, in display order. */
export const levelsForModule = (appId: string): ("view" | "edit")[] =>
  NO_VIEW_ONLY_APP_IDS.has(appId) ? ["edit"] : ["view", "edit"];
