/**
 * The home screen's left menu — every app the signed-in user can open, grouped.
 *
 * This replaced the launcher's grid of cards. Nine cards was already a wall; the
 * portal is heading for dozens of modules, and a flat grid gives a reader no way
 * to find anything. Grouping is the whole point, so the grouping lives in ONE
 * place (`apps/categories.ts`) shared with the on-page launcher and the two admin
 * permission screens. (The cards did come back — see `AppLauncher.tsx` — but
 * grouped the same way, and below the work list rather than instead of it.)
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
import { GROUP_ICONS } from "./groupIcons";
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
 * Every app this user can actually open, in the order they should be listed.
 *
 * Exported because the home screen lists its apps TWICE — here in the left menu
 * and again as cards in `AppLauncher.tsx`. Two copies of "which apps, in what
 * order" is two chances to disagree, and the one thing a launcher must never do
 * is offer a card the menu doesn't have.
 *
 * Coming-soon apps are omitted rather than disabled: NavItem has no disabled
 * state, and a menu row that silently does nothing is worse than no row.
 */
export function visibleApps(apps: AppManifest[], hasModule: (id: string) => boolean): AppManifest[] {
  return apps
    .filter((a) => a.status === "live" && hasModule(a.id))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
}

export function buildHomeNav(
  apps: AppManifest[],
  opts: { hasModule: (id: string) => boolean; isAdmin: boolean }
): NavItem[] {
  // Same label the other apps use to get here, so the place you clicked and the
  // place you land on are recognisably one destination.
  const nav: NavItem[] = [{ label: HOME_LABEL, to: HOME_PATH, icon: ic.today, section: "Home" }];

  // Every category becomes a COLLAPSIBLE group (see Sidebar), which is why these
  // carry `group` rather than `section`. An empty category never reaches here, so
  // a user with no Purchase access never sees an orphan "Purchase" heading — and
  // a category left holding ONE app is collapsed back to a plain link by the
  // sidebar, so "Sampling → Ink / RM Sampling" doesn't cost a click to say one
  // thing twice.
  for (const group of groupByCategory(visibleApps(apps, opts.hasModule))) {
    for (const app of group.rows) {
      nav.push({
        label: app.name,
        to: app.basePath,
        icon: app.icon,
        group: group.label,
        groupIcon: GROUP_ICONS[group.key],
        // Optional second level inside a category. Nothing sets one today — see
        // the note in apps/appInfo.ts — but the level still works end to end.
        ...(app.subGroup ? { subGroup: app.subGroup } : {}),
      });
    }
  }

  // Admin isn't a registry app (it has no manifest), so it joins the Control group
  // by hand. The sidebar merges it into the existing group by label, so there is no
  // duplicate-heading case to guard against.
  if (opts.isAdmin) {
    nav.push({ label: "Admin", to: "/admin", icon: ic.admin, group: "Control", groupIcon: GROUP_ICONS.control });
  }

  nav.push({ label: "My Account", to: "/account", icon: ic.account, section: "Account" });
  return nav;
}
