import {
  BarChart3,
  ShieldAlert,
  FileText,
  PackageOpen,
  UserCheck,
  HandCoins,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

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

// Base path of this app inside Orange One (see meta.tsx).
export const BASE = "/outstanding-dashboard";

export interface ReceivablesMenu {
  /** Stable id stored in the deny-list. Never reuse/rename without a data migration. */
  key: string;
  title: string;
  url: string;
  icon: LucideIcon;
}

export const RECEIVABLES_MENUS: ReceivablesMenu[] = [
  { key: "dashboard", title: "Dashboard", url: BASE, icon: BarChart3 },
  { key: "risk-register", title: "Risk Register", url: `${BASE}/risk-register`, icon: ShieldAlert },
  { key: "salesperson-analysis", title: "Salesperson Analysis", url: `${BASE}/salesperson-analysis`, icon: UserCheck },
  { key: "salesperson-collection", title: "Salesperson Collection Report", url: `${BASE}/salesperson-collection`, icon: HandCoins },
  { key: "import", title: "Import Data", url: `${BASE}/import`, icon: PackageOpen },
  { key: "reports", title: "Reports", url: `${BASE}/reports`, icon: FileText },
  { key: "settings", title: "Settings", url: `${BASE}/settings`, icon: SettingsIcon },
];

/**
 * Menus a given user may see. Admins see all; a non-admin sees everything not in
 * their deny-list. Pure helper so the sidebar and any guard share one rule.
 */
export function visibleMenusFor(isAdmin: boolean, hiddenKeys: string[]): ReceivablesMenu[] {
  if (isAdmin) return RECEIVABLES_MENUS;
  const hidden = new Set(hiddenKeys);
  return RECEIVABLES_MENUS.filter((m) => !hidden.has(m.key));
}
