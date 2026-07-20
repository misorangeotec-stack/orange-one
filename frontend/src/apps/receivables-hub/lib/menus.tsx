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

/**
 * Single source of truth for the Receivables Control left-nav menus.
 *
 * `key` is a stable identifier (decoupled from the label/URL) used by the
 * per-user menu-visibility deny-list (`profiles.receivables_hidden_menus`).
 * The sidebar renders these and hides any whose key is in the user's deny-list;
 * the Settings → Menu Permissions matrix lets an admin edit that list. Admins
 * always see every menu (the deny-list is ignored for them).
 *
 * Adding a menu here automatically: (a) shows it for everyone, and (b) adds a
 * column to the permission matrix. Removing access is then per-user.
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
}

export interface ReceivablesMenu {
  /** Stable id stored in the deny-list. Never reuse/rename without a data migration. */
  key: string;
  title: string;
  url: string;
  icon: LucideIcon;
  /** Admin-only menu: never shown to non-admins and excluded from the permission matrix. */
  adminOnly?: boolean;
  /** Sub-nav rendered as a collapsible group. Gated by this menu's own key, not its own. */
  children?: ReceivablesMenuChild[];
}

export const RECEIVABLES_MENUS: ReceivablesMenu[] = [
  { key: "dashboard", title: "Dashboard", url: BASE, icon: BarChart3 },
  { key: "risk-register", title: "Risk Register", url: `${BASE}/risk-register`, icon: ShieldAlert },
  { key: "followups", title: "Follow-ups", url: `${BASE}/followups`, icon: PhoneCall },
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
    children: REPORT_CATEGORIES.map((c) => ({
      key: `reports:${c.id}`,
      title: c.title,
      url: categoryHref(c.id),
      icon: c.icon,
    })),
  },
  { key: "settings", title: "Settings", url: `${BASE}/settings`, icon: SettingsIcon },
];

/**
 * Menus a given user may see. Admins see all; a non-admin sees every non-admin-only menu
 * not in their deny-list. Pure helper so the sidebar and any guard share one rule.
 */
export function visibleMenusFor(isAdmin: boolean, hiddenKeys: string[]): ReceivablesMenu[] {
  if (isAdmin) return RECEIVABLES_MENUS;
  const hidden = new Set(hiddenKeys);
  return RECEIVABLES_MENUS.filter((m) => !m.adminOnly && !hidden.has(m.key));
}

/** Menus eligible for the per-user permission matrix (admin-only menus are excluded). */
export const PERMISSION_MENUS: ReceivablesMenu[] = RECEIVABLES_MENUS.filter((m) => !m.adminOnly);
