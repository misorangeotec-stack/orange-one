/**
 * Apps every signed-in user can open, with no per-user grant.
 *
 * Module access is normally opt-in: an admin ticks a box per user per app
 * (core/admin/ModuleAccess.tsx), and a new user starts with Task Management only
 * (core/admin/UserForm.tsx). A "universal" app opts OUT of that — it is granted
 * implicitly to everyone, like admin access.
 *
 * NOTHING is universal today. HR Exit and Office Supplies were universal (so any
 * employee could raise their own resignation / supply request), but that let
 * every employee see and open them regardless of their Module access grant, which
 * admins did not want. Both were moved back to the normal opt-in model: they now
 * appear only for admins and users explicitly ticked in Module access. The list
 * is kept (empty) so an app can be made universal again by adding its id here —
 * `isUniversalApp` and the matrix's locked-on rendering both still work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file deliberately imports NOTHING. `core/platform/session.tsx` reads it,
 * and session is imported (transitively) by every app store — so importing the
 * app registry here instead would close a cycle:
 *     session → registry → hr-exit/meta → ExitApp → store → session
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const UNIVERSAL_APP_IDS: readonly string[] = [];

export const isUniversalApp = (appId: string): boolean => UNIVERSAL_APP_IDS.includes(appId);
