/**
 * Apps every signed-in user can open, with no per-user grant.
 *
 * Module access is normally opt-in: an admin ticks a box per user per app
 * (core/admin/ModuleAccess.tsx), and a new user starts with Task Management only
 * (core/admin/UserForm.tsx). That model breaks for an app whose whole point is
 * that ANY employee can start something in it — HR Exit, where a person raises
 * their own resignation. There is no bulk grant, and even a one-time backfill
 * would miss every future hire.
 *
 * A universal app is therefore granted implicitly, like admin access. It still
 * shows only what the user is allowed to see: the app's own nav is capability-
 * driven and its RLS scopes the rows, so an ordinary employee who opens HR Exit
 * finds their own case and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file deliberately imports NOTHING. `core/platform/session.tsx` reads it,
 * and session is imported (transitively) by every app store — so importing the
 * app registry here instead would close a cycle:
 *     session → registry → hr-exit/meta → ExitApp → store → session
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const UNIVERSAL_APP_IDS: readonly string[] = ["hr-exit", "office-supplies"];

export const isUniversalApp = (appId: string): boolean => UNIVERSAL_APP_IDS.includes(appId);
