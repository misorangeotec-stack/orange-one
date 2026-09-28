import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import AnnouncementsApp from "./AnnouncementsApp";

/**
 * Manifest for Announcements (PF-18) — where a message for the whole hub is written.
 *
 * Holding this module is what "may post" means: admins always may, and anyone else
 * once an admin grants it at Full access in Module Access (view-only is not offered;
 * see NO_VIEW_ONLY_APP_IDS). The database checks the same thing on every call
 * (can_post_announcements), so the grant is the permission, not just the menu.
 *
 * Reading needs no grant at all: the strip on every screen and the /announcements
 * history page are for all staff.
 */
export const announcementsApp: AppManifest = {
  id: "announcements",
  name: appName("announcements"),
  description: "Post a message that shows at the top of every screen in the hub, for all staff or chosen modules, with an optional email.",
  basePath: appBasePath("announcements"),
  status: "live",
  category: appCategory("announcements"),
  order: 25,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <circle cx="19" cy="7" r="1.6" fill="#FF6A1F" stroke="none" />
    </svg>
  ),
  Component: AnnouncementsApp,
};
