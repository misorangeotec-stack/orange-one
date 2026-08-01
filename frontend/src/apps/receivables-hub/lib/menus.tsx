import {
  BarChart3,
  ShieldAlert,
  FileText,
  PackageOpen,
  PhoneCall,
  UserCheck,
  HandCoins,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { appBasePath } from "@/apps/appInfo";
import { REPORT_CATEGORIES, categoryHref } from "@hub/lib/reportCatalog";
import { useSession } from "@/core/platform/session";

/**
 * Single source of truth for the Receivables Control left-nav menus.
 *
 * `key` is a stable identifier (decoupled from the label/URL) used by BOTH per-user
 * access columns on `profiles`:
 *
 *   receivables_hidden_menus  DENY-list  — "may this user SEE the menu?"
 *   receivables_admin_menus   ALLOW-list — "may they use it with ADMIN DEPTH?"
 *
 * The two polarities are deliberate and opposite. Visibility defaults to ON so a
 * newly shipped menu reaches everyone without an admin touching every user;
 * elevation defaults to OFF so a newly shipped admin panel never does.
 *
 * Admins bypass both. An admin edits them in Admin → Users (the user form) or in
 * Settings → Menu Permissions; the two screens write the same two columns.
 *
 * Adding a menu here automatically: (a) shows it for everyone, and (b) adds a row
 * to both permission screens. Removing access is then per-user.
 */

// Base path of this app inside Orange One. Read from the shared app list rather
// than retyped — this literal used to appear in four separate places across the
// hub, which is exactly the drift the shared list exists to prevent.
export const BASE = appBasePath("outstanding-dashboard");

/**
 * A sub-nav entry under a parent menu.
 *
 * Deliberately NOT independently permissionable: the parent's key gates the whole group.
 * Hiding a sidebar entry does not hide its route, so a per-category tick-box would only
 * look like access control while `/outstanding-dashboard/reports/balance-sheet` stayed
 * directly reachable. Real per-category permission needs the catalogue filtered AND the
 * routes guarded, which is a separate job.
 *
 * `key` is namespaced ("reports:tally") anyway, so if that job is ever done these keys
 * drop into the same deny-list with no data migration.
 */
export interface ReceivablesMenuChild {
  key: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  /** Admin-only sub-nav entry (e.g. the Dashboards category). Hidden from non-admins. */
  adminOnly?: boolean;
}

export interface ReceivablesMenu {
  /** Stable id stored in the deny-list. Never reuse/rename without a data migration. */
  key: string;
  title: string;
  url: string;
  icon: LucideIcon;
  /** Admin-only menu: never shown to non-admins and excluded from the permission matrix. */
  adminOnly?: boolean;
  /**
   * This menu has a second, deeper tier behind an explicit per-user grant
   * (`profiles.receivables_admin_menus`). Seeing the menu is NOT the same as having it:
   *
   *   reports  — standard shows the everyday categories; full adds Dashboards + Insights
   *              and the three reports behind them (C-Level ×2, Customer Profile).
   *   settings — standard shows Data Refresh; full adds the Masters tab.
   *
   * `fullAccessNote` is the one-line "what does full unlock here?" the permission
   * screens show, so the admin granting it doesn't have to guess.
   */
  fullAccessNote?: string;
  /** Sub-nav rendered as a collapsible group. Gated by this menu's own key, not its own. */
  children?: ReceivablesMenuChild[];
}

export const RECEIVABLES_MENUS: ReceivablesMenu[] = [
  { key: "dashboard", title: "Dashboard", url: BASE, icon: BarChart3 },
  { key: "risk-register", title: "Risk Register", url: `${BASE}/risk-register`, icon: ShieldAlert },
  { key: "followups", title: "Follow-ups", url: `${BASE}/followups`, icon: PhoneCall },
  // Customer Onboarding used to hang here as a sub-menu. It became its own
  // top-level app on 29-07-2026 (apps/customer-onboarding/) and now carries its
  // own sidebar, so listing it here too would put one module in two menus with
  // two different grants behind them. The hub still redirects its old URLs.
  // Admin-only: parked in the "Hidden" section of the sidebar. Not in use for regular users, but
  // kept reachable for admins rather than deleted.
  { key: "salesperson-analysis", title: "Salesperson Analysis", url: `${BASE}/salesperson-analysis`, icon: UserCheck, adminOnly: true },
  { key: "salesperson-collection", title: "Salesperson Collection Report", url: `${BASE}/salesperson-collection`, icon: HandCoins },
  // NOTE: the parallel "Live (Tally)" view is NOT a set of separate menu items — an admin toggles
  // the whole hub to the ConnectWave live source via the topbar switch (see lib/liveMode), so the
  // nav stays a single clean set instead of showing every screen twice. The Collection Report used to
  // break this rule with a duplicate "Collection Report (Tally Live)" entry that rendered the very same
  // Salesperson Collection Report against ConnectWave; it's gone — toggle Live on the report instead.
  // Admin-only: parked in the "Hidden" section of the sidebar (see salesperson-analysis above).
  { key: "import", title: "Import Data", url: `${BASE}/import`, icon: PackageOpen, adminOnly: true },
  // The sub-nav lists CATEGORIES, not reports. One child per report would push the sidebar
  // past twenty entries as the Tally section fills in; categories stay a fixed five.
  {
    key: "reports",
    title: "Reports",
    url: `${BASE}/reports`,
    icon: FileText,
    fullAccessNote: "adds the Dashboards and Insights categories (C-Level Dashboard, Customer Profile)",
    children: REPORT_CATEGORIES.map((c) => ({
      key: `reports:${c.id}`,
      title: c.title,
      url: categoryHref(c.id),
      icon: c.icon,
      adminOnly: c.adminOnly,
    })),
  },
  {
    key: "settings",
    title: "Settings",
    url: `${BASE}/settings`,
    icon: SettingsIcon,
    fullAccessNote: "adds the Masters tab (customer, group and company musters)",
  },
];

/**
 * Menus a given user may see. Admins see all; a non-admin sees every non-admin-only menu
 * not in their deny-list. Pure helper so the sidebar and the route guard share one rule.
 *
 * `adminKeys` is the full-access allow-list: it does NOT make a hidden menu appear (that is
 * the deny-list's job, and a menu you cannot see is one you cannot use), but it does keep
 * the admin-only sub-nav children of a menu you were granted — so a user with full Reports
 * gets Dashboards and Insights in the sidebar the way an admin does.
 */
export function visibleMenusFor(
  isAdmin: boolean,
  hiddenKeys: string[],
  adminKeys: string[] = [],
): ReceivablesMenu[] {
  if (isAdmin) return RECEIVABLES_MENUS;
  const hidden = new Set(hiddenKeys);
  const elevated = new Set(adminKeys);
  return RECEIVABLES_MENUS.filter((m) => !m.adminOnly && !hidden.has(m.key)).map((m) =>
    // Drop admin-only sub-nav children (e.g. the Dashboards category) unless this user
    // holds full access to the parent menu.
    m.children && !elevated.has(m.key)
      ? { ...m, children: m.children.filter((c) => !c.adminOnly) }
      : m,
  );
}

/** May this user open the menu at all? Admins always can. */
export function canSeeMenu(isAdmin: boolean, hiddenKeys: string[], key: string): boolean {
  if (isAdmin) return true;
  const menu = RECEIVABLES_MENUS.find((m) => m.key === key);
  if (menu?.adminOnly) return false;
  return !hiddenKeys.includes(key);
}

/** May this user use the menu's ADMIN-DEPTH features? Admins always can. */
export function hasMenuFullAccess(isAdmin: boolean, adminKeys: string[], key: string): boolean {
  return isAdmin || adminKeys.includes(key);
}

/** Menus eligible for the per-user permission screens (admin-only menus are excluded). */
export const PERMISSION_MENUS: ReceivablesMenu[] = RECEIVABLES_MENUS.filter((m) => !m.adminOnly);

/**
 * The three access levels an admin picks per user, per menu. One vocabulary shared by the
 * user form and the Menu Permissions matrix so the two screens can't drift apart.
 *
 * "full" is only offered for menus carrying `fullAccessNote`; granting it anywhere else is
 * harmless (the key is simply never consulted) but the UI doesn't offer it.
 */
export type MenuAccessLevel = "hidden" | "standard" | "full";

export function menuAccessLevel(menuKey: string, hiddenKeys: string[], adminKeys: string[]): MenuAccessLevel {
  if (hiddenKeys.includes(menuKey)) return "hidden";
  return adminKeys.includes(menuKey) ? "full" : "standard";
}

/**
 * Apply a level to the two key lists, returning the new pair. Kept here rather than in each
 * screen because the invariant is easy to get wrong: "hidden" must also drop the full-access
 * grant, or a menu re-shown later silently comes back elevated.
 */
export function setMenuAccessLevel(
  menuKey: string,
  level: MenuAccessLevel,
  hiddenKeys: string[],
  adminKeys: string[],
): { hidden: string[]; admin: string[] } {
  const hidden = hiddenKeys.filter((k) => k !== menuKey);
  const admin = adminKeys.filter((k) => k !== menuKey);
  if (level === "hidden") hidden.push(menuKey);
  if (level === "full") admin.push(menuKey);
  return { hidden, admin };
}

/**
 * The signed-in user's receivables menu access. The one place hub screens ask
 * "can I show this?" — reads the session profile so no screen re-implements the rule.
 */
export function useHubMenuAccess(): {
  isAdmin: boolean;
  canSee: (key: string) => boolean;
  hasFullAccess: (key: string) => boolean;
} {
  const { isAdmin, user } = useSession();
  const hidden = user?.receivablesHiddenMenus ?? [];
  const admin = user?.receivablesAdminMenus ?? [];
  return {
    isAdmin,
    canSee: (key) => canSeeMenu(isAdmin, hidden, key),
    hasFullAccess: (key) => hasMenuFullAccess(isAdmin, admin, key),
  };
}
