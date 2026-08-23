/**
 * What each app is CALLED, WHERE it lives, and HOW it is grouped. One
 * definition, read by everything that shows a name, links to an app, or places
 * it in a menu.
 *
 * This exists because renaming five apps in their manifests fixed the left menu
 * and nothing else: the home dashboard, the FMS scoreboard, every app's own
 * headings and half its menu items each carried their own hand-typed copy of the
 * name. Fifteen copies, five of them already wrong — the Import app had been
 * displaying the *domestic* Purchase app's name since it was copy-pasted from it.
 *
 * `basePath`, `category` and `subGroup` moved here for the same reason, when the
 * topbar breadcrumb needed to answer "which module is this page in?" without
 * importing the registry (see below). Leaving them in the manifests would have
 * meant a second copy of every route — and the Outstanding Dashboard already had
 * FOUR copies of its own path scattered across the hub.
 *
 * So: never type an app's name, path or group in a component. Call the helpers.
 *
 * IMPORTS NOTHING at runtime, deliberately — same rule as `apps/universal.ts`.
 * Reading this from `apps/registry.tsx` would have worked, but each manifest also
 * imports its app's root component, so the home dashboard would pull in all five
 * FMS apps just to print a label, and any FMS page reaching back for a name would
 * cycle. The one import below is `import type`, erased at build time.
 *
 * Keys are the STABLE app ids — the same strings stored in `app_access` and used
 * by `hasModule()`. Renaming an app changes `name` here and nothing else; the
 * id must never change or you revoke everyone's access.
 */

import type { AppCategory } from "./categories";

export interface AppInfo {
  /** Display name, shown on cards, menus and the breadcrumb's module step. */
  name: string;
  /** Route base, e.g. "/import". The app owns everything under it. */
  basePath: string;
  /** Menu group (apps/categories.ts) — the breadcrumb's first step. */
  category?: AppCategory;
  /**
   * Second level inside the category — the breadcrumb's second step.
   *
   * NOTHING SETS THIS TODAY. The six sub-groups that used to hang under "FMS"
   * (Purchase, Sampling, Production, Dispatch, Assets, HR) were promoted to real
   * categories, which emptied it. Kept because the level is still supported end
   * to end — sidebar, breadcrumb and both permission screens — so Purchase or
   * Sales can grow one again by setting this and nothing else.
   */
  subGroup?: string;
}

export const APPS: Record<string, AppInfo> = {
  "task-management": {
    name: "Task Management",
    basePath: "/task-management",
    category: "productivity",
  },
  "outstanding-dashboard": {
    name: "Outstanding Dashboard",
    basePath: "/outstanding-dashboard",
    category: "sales",
  },
  procurement: {
    name: "Purchase RM Domestic",
    basePath: "/procurement",
    category: "purchase",
  },
  import: {
    name: "Purchase RM Import",
    basePath: "/import",
    category: "purchase",
  },
  /**
   * Renamed from "Purchase Office Supplies" and moved off /office-supplies on
   * 29-07-2026: the module had outgrown its name and is used for company
   * purchases generally. DISPLAY AND ROUTE ONLY — the key below is the frozen
   * app id, and the folder (apps/office-supplies/), the fms_supplies_* schema,
   * the 'office-supplies_' email_outbox prefix and the SUPPLY- document prefix
   * all keep the old word deliberately. App.tsx redirects the old base so the
   * links already in circulation still land.
   */
  "office-supplies": {
    name: "General Purchase",
    basePath: "/general-purchase",
    category: "purchase",
  },
  sampling: {
    name: "Ink / RM Sampling",
    basePath: "/sampling",
    category: "sampling",
  },
  "production-entry": {
    name: "Production Entry",
    basePath: "/production-entry",
    category: "production",
  },
  // Picks up where Production Entry ends: that module closes at "FG Transfer to
  // Godown", this one takes the goods from the godown to the customer.
  //
  // Filed under SALES, not under a process group of its own: dispatch is the leg
  // of the sales book between the order and the invoice, and the people chasing
  // "where has that order got to?" are the same people watching the receivable.
  "order-to-dispatch": {
    name: "Order to Dispatch",
    basePath: "/order-to-dispatch",
    category: "sales",
  },
  /**
   * Promoted OUT of the Outstanding Dashboard to the main menu (29-07-2026).
   *
   * ⚠ ITS CODE STILL LIVES UNDER apps/receivables-hub/, and deliberately so. The
   *   module is built entirely from hub-native (shadcn) components, because
   *   shared/ui hard-codes the portal's tokens and `.hub-root` will not remap
   *   them. Moving the files would mean rewriting every one of them. So this app
   *   is a thin shell — its own basePath, nav and AppShell chrome — that mounts
   *   the existing subtree inside a `.hub-root` wrapper.
   */
  "customer-onboarding": {
    name: "New Customer Onboarding",
    basePath: "/customer-onboarding",
    // Filed under SALES. It briefly had a top-level "Onboarding" group of its
    // own, which read as a heading and an app saying nearly the same thing; it
    // belongs with the sales book it is the gateway into.
    category: "sales",
  },
  // The only workflow module whose entity is permanent: assets and their dated
  // tracks live for years, and the thing that runs the workflow is a service JOB
  // raised off a track when it falls due.
  "asset-maintenance": {
    name: "Asset Maintenance",
    basePath: "/asset-maintenance",
    category: "asset",
  },
  "hr-recruitment": {
    name: "New Recruitment",
    basePath: "/hr-recruitment",
    category: "hr",
  },
  "hr-exit": {
    name: "Employee Exit",
    basePath: "/hr-exit",
    category: "hr",
  },
  "leads-dashboard": {
    name: "Leads Dashboard",
    basePath: "/leads-dashboard",
    category: "sales",
  },
  // The machine SALE, before there is an order to dispatch: a quotation is
  // drafted, revised through the negotiation, approved, and becomes an order
  // confirmation the customer signs. Filed under SALES between the lead that
  // starts it and the onboarding that follows a won deal.
  ocpi: {
    name: "OCPI",
    basePath: "/ocpi",
    category: "sales",
  },
  "fms-control-center": {
    name: "FMS Control Center",
    basePath: "/fms-control-center",
    category: "control",
  },
  "master-report": {
    name: "Master Report",
    basePath: "/master-report",
    category: "control",
  },
  // Virtual module: no web app and no route, so no basePath that resolves to a
  // page. It only gates login to the mobile Leads app. `basePath` is a dead
  // string kept so the shape stays uniform; nothing routes to it.
  "mobile-app": {
    name: "Mobile App",
    basePath: "/mobile-app",
    category: "mobile",
  },
};

/**
 * Display name for an app id. Falls back to the id itself, which is ugly on
 * screen but visible — an app added without an entry here shows `my-new-app`
 * rather than silently rendering nothing.
 */
export const appName = (appId: string): string => APPS[appId]?.name ?? appId;

/** Route base for an app id, e.g. "/import". Falls back to `/<id>`. */
export const appBasePath = (appId: string): string => APPS[appId]?.basePath ?? `/${appId}`;

/** Menu category for an app id, or undefined (which lands it in "Other"). */
export const appCategory = (appId: string): AppCategory | undefined => APPS[appId]?.category;

/** Second-level group inside the category, e.g. "Purchase". Often undefined. */
export const appSubGroup = (appId: string): string | undefined => APPS[appId]?.subGroup;
