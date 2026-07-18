/**
 * The home screen's left menu — every app the signed-in user can open, grouped.
 *
 * This replaced the launcher's grid of cards. Nine cards was already a wall; the
 * portal is heading for dozens of modules, and a flat grid gives a reader no way
 * to find anything. Grouping is the whole point, so the grouping lives in ONE
 * place (`apps/categories.ts`) shared with the two admin permission screens.
 *
 * Pure and hook-free so it can be unit-rendered and so `HomeLayout` can memoise it.
 *
 * Sidebar contract (shared/components/layout/Sidebar.tsx): a section heading is
 * rendered by setting `section` on the FIRST item of a group — there is no group
 * wrapper. That is why this returns a flat list, not a tree.
 */
import type { ReactNode } from "react";
import type { AppManifest } from "@/apps/types";
import { groupByCategory } from "@/apps/categories";
import { HOME_LABEL, HOME_PATH, type NavItem } from "@/shared/components/layout/types";

const ic: Record<string, ReactNode> = {
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 5 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.6 3H11a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

/**
 * One icon per category, standing in for the whole group when the sidebar is
 * collapsed to a rail. Without these every group renders the same generic folder,
 * which makes the rail unreadable — the icon IS the label in that mode.
 */
const GROUP_ICONS: Record<string, ReactNode> = {
  Productivity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6l1 3H8l1-3Z" />
      <rect x="4" y="7" width="16" height="14" rx="2" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  ),
  FMS: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h13l5 5v7H3z" />
      <circle cx="8" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  ),
  "Sales & Receivables": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20h18" />
      <rect x="5" y="11" width="3.5" height="7" />
      <rect x="10.5" y="7" width="3.5" height="11" />
      <rect x="16" y="13" width="3.5" height="5" />
    </svg>
  ),
  Control: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="1.8" fill="currentColor" />
      <circle cx="15" cy="12" r="1.8" fill="currentColor" />
      <circle cx="8" cy="18" r="1.8" fill="currentColor" />
    </svg>
  ),
};

export function buildHomeNav(
  apps: AppManifest[],
  opts: { hasModule: (id: string) => boolean; isAdmin: boolean }
): NavItem[] {
  // Same label the other apps use to get here, so the place you clicked and the
  // place you land on are recognisably one destination.
  const nav: NavItem[] = [{ label: HOME_LABEL, to: HOME_PATH, icon: ic.today, section: "Home" }];

  // Coming-soon apps are omitted rather than disabled: NavItem has no disabled
  // state, and a menu row that silently does nothing is worse than no row.
  const visible = apps
    .filter((a) => a.status === "live" && opts.hasModule(a.id))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));

  // Every category becomes a COLLAPSIBLE group (see Sidebar), which is why these
  // carry `group` rather than `section`. An empty category never reaches here, so
  // a user with no FMS access never sees an orphan "FMS" heading.
  for (const group of groupByCategory(visible)) {
    for (const app of group.rows) {
      nav.push({
        label: app.name,
        to: app.basePath,
        icon: app.icon,
        group: group.label,
        groupIcon: GROUP_ICONS[group.label],
        // Second level, e.g. FMS → Purchase. Apps without one sit directly under
        // the category heading.
        ...(app.subGroup ? { subGroup: app.subGroup } : {}),
      });
    }
  }

  // Admin isn't a registry app (it has no manifest), so it joins the Control group
  // by hand. The sidebar merges it into the existing group by label, so there is no
  // duplicate-heading case to guard against.
  if (opts.isAdmin) {
    nav.push({ label: "Admin", to: "/admin", icon: ic.admin, group: "Control", groupIcon: GROUP_ICONS.Control });
  }

  nav.push({ label: "My Account", to: "/account", icon: ic.account, section: "Account" });
  return nav;
}
