/**
 * The home screen's left menu — every app the signed-in user can open, grouped.
 *
 * This replaced the launcher's grid of cards. Nine cards was already a wall; the
 * portal is heading for dozens of modules, and a flat grid gives a reader no way
 * to find anything. Grouping is the whole point, so the grouping lives in ONE
 * place (`apps/categories.ts`) shared with the two admin permission screens. The
 * cards came back briefly as a collapsible section on the home screen and were
 * removed again — this menu is now the only place the app list is rendered.
 *
 * Pure and hook-free so it can be unit-rendered and so `HomeLayout` can memoise it.
 *
 * Sidebar contract (shared/components/layout/Sidebar.tsx): a section heading is
 * rendered by setting `section` on the FIRST item of a group — there is no group
 * wrapper. That is why this returns a flat list, not a tree.
 */
import type { ReactNode } from "react";
import type { AppManifest } from "@/apps/types";
import type { Profile } from "@/core/platform/types";
import { groupByCategory } from "@/apps/categories";
import { GROUP_ICONS } from "./groupIcons";
import {
  ANNOUNCEMENTS_LABEL,
  ANNOUNCEMENTS_PATH,
  HOME_LABEL,
  HOME_PATH,
  type NavItem,
} from "@/shared/components/layout/types";

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
  announcements: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  ),
};

/**
 * Every app this user can actually open, in the order they should be listed.
 *
 * Exported so any second listing of the apps — the home screen carried one as
 * cards for a while — has to come from here rather than re-deriving it. Two
 * copies of "which apps, in what order" is two chances to disagree.
 *
 * Coming-soon apps are omitted rather than disabled: NavItem has no disabled
 * state, and a menu row that silently does nothing is worse than no row. Same reasoning
 * behind `canOpenApp` below carrying the FULL rule rather than just the module grant: a
 * row that bounces you straight back to /home is a row that should not be drawn.
 */
export function visibleApps(apps: AppManifest[], access: AppAccess): AppManifest[] {
  return apps
    .filter((a) => a.status === "live" && canOpenApp(a, access))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));
}

/**
 * "Can this person open this app?" — the whole rule, in one place so the menu and the
 * route guard in App.tsx cannot answer it differently.
 *
 * Two parts, and most apps only have the first:
 *   1. the module grant, read under `accessAppId` where an app rides another app's grant
 *      rather than one of its own (Reports rides `outstanding-dashboard`);
 *   2. the app's own extra rule, where its access was never the module grant alone.
 */
export function canOpenApp(app: AppManifest, { hasModule, isAdmin, user }: AppAccess): boolean {
  return hasModule(app.accessAppId ?? app.id) && (app.canOpen?.({ isAdmin, user }) ?? true);
}

/** Everything the two rules above need about the signed-in person. */
export interface AppAccess {
  hasModule: (id: string) => boolean;
  isAdmin: boolean;
  user: Profile;
}

export function buildHomeNav(apps: AppManifest[], opts: AppAccess): NavItem[] {
  // Same label the other apps use to get here, so the place you clicked and the
  // place you land on are recognisably one destination.
  const nav: NavItem[] = [
    { label: HOME_LABEL, to: HOME_PATH, icon: ic.today, section: "Home" },
    // PF-18: everyone's, no grant needed, so it sits under Home rather than in a
    // category that only some people would see.
    { label: ANNOUNCEMENTS_LABEL, to: ANNOUNCEMENTS_PATH, icon: ic.announcements },
  ];

  // Every category becomes a COLLAPSIBLE group (see Sidebar), which is why these
  // carry `group` rather than `section`. An empty category never reaches here, so
  // a user with no Purchase access never sees an orphan "Purchase" heading — and
  // a category left holding ONE app is collapsed back to a plain link by the
  // sidebar, so "Sampling → Ink / RM Sampling" doesn't cost a click to say one
  // thing twice.
  for (const group of groupByCategory(visibleApps(apps, opts))) {
    for (const app of group.rows) {
      // One row per app, unless the app says otherwise. Reports is the only one that does:
      // it is a catalogue, so its group lists the sections the reader holds rather than a
      // single link they would have to open to find out what is inside (see
      // AppManifest.menuEntries). A group of several rows is not collapsed back to a plain
      // link by the sidebar, which is what makes the heading appear at all.
      const rows = app.menuEntries?.(opts) ?? [{ label: app.name, to: app.basePath, icon: app.icon }];
      for (const row of rows) {
        // Second level inside a category, rendered as a dropdown. A row may claim its own —
        // that is how Reports folds its Bushra-Dashboard subjects behind one label — and
        // otherwise it inherits the app's, which nothing sets today (see apps/appInfo.ts).
        const subGroup = row.subGroup ?? app.subGroup;
        nav.push({
          ...row,
          group: group.label,
          groupIcon: GROUP_ICONS[group.key],
          ...(subGroup ? { subGroup } : {}),
        });
      }
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
