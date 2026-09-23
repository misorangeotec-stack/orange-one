/**
 * Apps every signed-in user can open, with no per-user grant.
 *
 * Module access is normally opt-in: an admin ticks a box per user per app
 * (core/admin/ModuleAccess.tsx), and a new user starts with Task Management only
 * (core/admin/UserForm.tsx). A "universal" app opts OUT of that — it is granted
 * implicitly to everyone, like admin access.
 *
 * HR Exit and General Purchase were universal (so any employee could raise their
 * own resignation / purchase request), but that let every employee see and open
 * them regardless of their Module access grant, which admins did not want. Both
 * were moved back to the normal opt-in model: they now appear only for admins and
 * users explicitly ticked in Module access.
 *
 * ONE app is universal: the KRA / KPI Scorecard ("kra-kpi", KPI-1), by the user's
 * decision of 18-09-2026 — every employee opens their OWN report with no grant. It
 * is safe where those two were not because the app shows nothing the viewer may not
 * see: every figure comes from the `kpi_report` RPC, which checks the caller itself
 * (their own report, their reporting chain's, or anyone's for an admin). Opening the
 * app grants no one any data. Customer logins are turned away by the app itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file deliberately imports NOTHING. `core/platform/session.tsx` reads it,
 * and session is imported (transitively) by every app store — so importing the
 * app registry here instead would close a cycle:
 *     session → registry → hr-exit/meta → ExitApp → store → session
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const UNIVERSAL_APP_IDS: readonly string[] = [
  "kra-kpi",
  /*
   * Learning & Development. Every employee is a potential PARTICIPANT — they have
   * to accept an invitation, read the material and upload their assignment — so
   * granting it per user would mean ticking a box for all 67 before the first
   * invitation could go out, and a nominee without a grant would be sent a link
   * to a page they cannot open.
   *
   * ⚠ Unlike HR Exit and General Purchase, which were universal and were moved
   *   back to opt-in because admins did not want everyone SEEING them, this
   *   module's own nav hides everything but the training calendar and the
   *   person's own requests. The queues, the pipeline and Setup appear only for
   *   the people who own them, and RLS withholds the rest.
   */
  "learning-development",
];

export const isUniversalApp = (appId: string): boolean => UNIVERSAL_APP_IDS.includes(appId);
