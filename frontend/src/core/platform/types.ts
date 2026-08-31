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
 * How much of a granted app a user gets (`app_access.access_level`).
 *   view — may open it and read everything; every write affordance is hidden.
 *   edit — view plus change: raise, act, approve, manage masters.
 *
 * "No access" is NOT a level: it is the absence of an app_access row, exactly as
 * before. Keeping it out of the union means `moduleAccess` and `moduleLevels`
 * cannot disagree about who is granted — see `Profile.moduleLevels`.
 *
 * Every grant that existed before the level was introduced reads as `edit`
 * (the column defaults to it), so nothing an admin had already set changed.
 */
export type ModuleLevel = "view" | "edit";

/** Reading order + label. The order is the order the admin pills render in. */
export const MODULE_LEVEL_LABEL: Record<ModuleLevel, string> = {
  view: "View only",
  edit: "Full access",
};

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
  /**
   * Switched-off departments stay fully resolvable by id — 5k+ tasks and every
   * FMS step-owner list point at them — they are merely hidden from the pickers
   * that create NEW references. Optional because the legacy mock seed predates
   * the column; absent means active.
   */
  active?: boolean;
  sortOrder?: number;
  /**
   * Which list this department came from, while the portal's original 21 and
   * HR's 10 are being reconciled. `both` means the same team appears in each —
   * including the two where only the NAME differs (`Accounting & Finance` is
   * HR's "Finance", `Human Resources` is its "Human Resource"), which is why
   * they are one row and not two.
   */
  source?: "existing" | "hr_sheet" | "both";
  /** What HR's sheet calls it, where that differs from `name`. */
  hrSheetName?: string | null;
}

/** Reading order + label for `Department.source`. */
export const DEPARTMENT_SOURCE_LABEL: Record<NonNullable<Department["source"]>, string> = {
  both: "Both lists",
  existing: "Portal only",
  hr_sheet: "HR sheet only",
};

/** A subdivision of a department (HR's "Sub Department"). Unique per parent. */
export interface SubDepartment {
  id: string;
  departmentId: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/** A rung on the job ladder (`designations`). FK'd by every FMS step-owner table. */
export interface Designation {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/**
 * A band on the 9-level ladder. `name` is the CATEGORY ("Executive Level"),
 * `description` the example designations from the band categorisation sheet.
 *
 * Band is assigned per user and is INDEPENDENT of designation — several
 * designations may share a band, and nothing about a designation restricts
 * which band may sit beside it.
 */
export interface Band {
  id: string;
  bandNo: number;
  name: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
}

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  /** Mobile number. Doubles as the user's initial login password (set at create / on save). */
  phone: string | null;
  /**
   * LEGACY MIRROR of the designation master's name. Not a leftover: the
   * `list_org_people()` RPC returns this column and every @mention picker in the
   * portal renders it, so it is written alongside `designationId` on every save.
   * `designationId` is the source of truth.
   */
  designation: string | null;
  /** Named palette key (mock) or raw hex (live DB). */
  avatarColor: AvatarColor | string;
  departmentId: string | null;
  subDepartmentId: string | null;
  designationId: string | null;
  /** Independent of `designationId` — see the `Band` doc comment. */
  bandId: string | null;
  /** HR employee code (e.g. OTPL-S-10092). Null for service accounts. */
  employeeCode: string | null;
  /**
   * Passenger gender and date of birth, as every airline and rail operator
   * demands them to issue a ticket.
   *
   * ⚠ THESE ARE NOT ORG FIELDS, and they are deliberately outside
   *   `guard_profile_org_fields()`. Department, designation and band decide what
   *   somebody is ENTITLED to and are admin-only for that reason; these decide
   *   nothing. They are personal details whose only victim, if wrong, is the
   *   person who owns them - so they are editable by that person and by an
   *   administrator, exactly as `name` and `phone` already are.
   *
   * Added for Travel Desk (20261005120600); nothing else reads them yet.
   */
  gender: "male" | "female" | "other" | null;
  /** ISO date (yyyy-mm-dd). */
  dateOfBirth: string | null;
  /** Effective role (from user_roles). */
  role: AppRole;
  /** employee_id → hod_id links (user_hods); an employee may report to many HODs. */
  hodIds: string[];
  /** Granted portal app ids (app_access). Admins bypass this and see everything. */
  moduleAccess: string[];
  /**
   * The LEVEL of each grant in `moduleAccess`, keyed by app id.
   *
   * ⚠ `moduleAccess` deliberately still answers "may they open it" on its own,
   *   and is NOT derived from this map. Roughly ten consumers — RequireModule,
   *   the home launcher, My Work, the FMS Control Center, hasModuleAccess() and
   *   the Users export among them — ask only that question, and a view-only user
   *   must answer yes to every one of them. Widening `moduleAccess` into an
   *   object would have forced all ten to change in order to keep behaving
   *   identically, which is the wrong risk for a purely additive feature.
   *
   * Invariant: every key here appears in `moduleAccess`, and every id in
   * `moduleAccess` has a key here. A grant read from a row written before the
   * column existed falls back to "edit" in liveDirectory.ts, never to "view".
   */
  moduleLevels: Record<string, ModuleLevel>;
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
   * Outstanding Dashboard full-access allow-list (profiles.receivables_admin_menus):
   * the menu keys this user may use with ADMIN-LEVEL DEPTH, not merely see. Only
   * `reports` (unlocks the Dashboards + Insights categories and their reports) and
   * `settings` (unlocks the Masters tab) have a deeper tier today.
   *
   * The opposite polarity to `receivablesHiddenMenus` on purpose: visibility defaults
   * to on, elevation defaults to off. Admins ignore this (always full access).
   */
  receivablesAdminMenus: string[];
  /**
   * Outstanding Dashboard per-report grants (profiles.receivables_allowed_reports): the
   * report ids (lib/reportCatalog.ts REPORTS[].id) this user may open.
   *
   * An ALLOW-list, the opposite polarity to `receivablesHiddenMenus`, and unlike the
   * menu deny-list it has NO safe default: an empty list means NO reports, not all of
   * them. A newly shipped report therefore reaches nobody until an admin grants it.
   * Admins ignore this and see every report.
   *
   * Category ids are never stored here — the admin UI expands a category tick into the
   * report ids underneath it, so adding a report to a category never grants it silently.
   */
  receivablesAllowedReports: string[];
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
