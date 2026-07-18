/**
 * What each app is CALLED. One definition, read by everything that shows a name.
 *
 * This exists because renaming five apps in their manifests fixed the left menu
 * and nothing else: the home dashboard, the FMS scoreboard, every app's own
 * headings and half its menu items each carried their own hand-typed copy of the
 * name. Fifteen copies, five of them already wrong — the Import app had been
 * displaying the *domestic* Purchase app's name since it was copy-pasted from it.
 *
 * So: never type an app's name in a component. Call `appName(id)`.
 *
 * IMPORTS NOTHING, deliberately — same rule as `apps/universal.ts`. Reading names
 * from `apps/registry.tsx` would have worked, but each manifest also imports its
 * app's root component, so the home dashboard would pull in all five FMS apps just
 * to print a label, and any FMS page reaching back for a name would cycle.
 *
 * Keys are the STABLE app ids — the same strings stored in `app_access` and used
 * by `hasModule()`. Renaming an app changes the value here and nothing else; the
 * id must never change or you revoke everyone's access.
 */

export const APP_NAMES: Record<string, string> = {
  "task-management": "Task Management",
  "outstanding-dashboard": "Outstanding Dashboard",
  procurement: "Purchase RM Domestic",
  import: "Purchase RM Import",
  "office-supplies": "Purchase Office Supplies",
  "hr-recruitment": "New Recruitment",
  "hr-exit": "Employee Exit",
  "leads-dashboard": "Leads Dashboard",
  "fms-control-center": "FMS Control Center",
  "mobile-app": "Mobile App",
};

/**
 * Display name for an app id. Falls back to the id itself, which is ugly on
 * screen but visible — an app added without a name here shows `my-new-app`
 * rather than silently rendering nothing.
 */
export const appName = (appId: string): string => APP_NAMES[appId] ?? appId;
