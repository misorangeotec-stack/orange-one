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

/** Named avatar colors stored on profiles.avatar_color → hex used by the UI. */
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
  designation: string | null;
  avatarColor: AvatarColor;
  departmentId: string | null;
  /** Effective role (from user_roles). */
  role: AppRole;
  /** employee_id → hod_id links (user_hods); an employee may report to many HODs. */
  hodIds: string[];
  /** Granted portal app ids (app_access). Admins bypass this and see everything. */
  moduleAccess: string[];
}
