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
  /** Second level inside the category — the breadcrumb's second step. */
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
    category: "fms",
    subGroup: "Purchase",
  },
  import: {
    name: "Purchase RM Import",
    basePath: "/import",
    category: "fms",
    subGroup: "Purchase",
  },
  "office-supplies": {
    name: "Purchase Office Supplies",
    basePath: "/office-supplies",
    category: "fms",
    subGroup: "Purchase",
  },
  sampling: {
    name: "Ink / RM Sampling",
    basePath: "/sampling",
    category: "fms",
    subGroup: "Sampling",
  },
  "hr-recruitment": {
    name: "New Recruitment",
    basePath: "/hr-recruitment",
    category: "fms",
    subGroup: "HR",
  },
  "hr-exit": {
    name: "Employee Exit",
    basePath: "/hr-exit",
    category: "fms",
    subGroup: "HR",
  },
  "leads-dashboard": {
    name: "Leads Dashboard",
    basePath: "/leads-dashboard",
    category: "sales",
  },
  "fms-control-center": {
    name: "FMS Control Center",
    basePath: "/fms-control-center",
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
