/**
 * Platform-level identity types for the Orange One portal — shared by every app,
 * not just Task Management. These mirror the existing Supabase tables so Stage B
 * swaps mock data for live queries with no shape changes:
 *   - `role`        ← user_roles  (a join, denormalised onto the read-model)
 *   - `hodIds`      ← user_hods   (employee_id → hod_id links)
 *   - `moduleAccess`← app_access  (NEW in Stage B: user_id → app_id grants)
 * `admin` always has access to every app, so `moduleAccess` is only consulted for
 * non-admins (see hasModule() in session.tsx).
 */

export type AppRole = "admin" | "hod" | "sub_hod" | "employee";

/**
 * Avatar color. Mock data uses named palette keys; the live `profiles.avatar_color`
 * column stores raw hex (e.g. "#2563eb"). The Avatar component accepts either, so
 * the stored value is just a string.
 */
export type AvatarColor = "blue" | "orange" | "teal" | "violet" | "rose" | "green" | "navy";

export interface Department {
  id: string;
  name: string;
  description?: string | null;
}

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  /** Mobile number. Doubles as the user's initial login password (set at create / on save). */
  phone: string | null;
  designation: string | null;
  /** Named palette key (mock) or raw hex (live DB). */
  avatarColor: AvatarColor | string;
  departmentId: string | null;
  /** Effective role (from user_roles). */
  role: AppRole;
  /** employee_id → hod_id links (user_hods); an employee may report to many HODs. */
  hodIds: string[];
  /** Granted portal app ids (app_access). Admins bypass this and see everything. */
  moduleAccess: string[];
  /**
   * Outstanding Dashboard scope (profiles.receivables_salespersons): salesperson
   * name(s) this user may see in the receivables app. Admins ignore this (see all);
   * a non-admin sees only these names, and an empty list means they see nothing.
   */
  receivablesSalespersons: string[];
  /**
   * Outstanding Dashboard menu deny-list (profiles.receivables_hidden_menus): the
   * menu keys this user may NOT see in the receivables app's left nav. Admins ignore
   * this (see all menus); an empty list means every menu is visible (the default).
   */
  receivablesHiddenMenus: string[];
  /**
   * Receivables Hub legacy-source access (profiles.receivables_allow_pipeline). The hub
   * defaults everyone to the Live (Tally) source; when true, this non-admin also gets the
   * topbar toggle to view the legacy pipeline source. Admins ignore this (always allowed).
   */
  receivablesAllowPipeline: boolean;
  /**
   * When the user last opened the portal (profiles.last_active_at, ISO). Stamped on
   * app open / login via the touch_last_active RPC; null if never seen since the
   * feature shipped. Shown to admins (Users/Hierarchy) and HODs (their team).
   */
  lastActiveAt: string | null;
}
