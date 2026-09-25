import type { NavItem } from "@/shared/components/layout/types";
import { ANNOUNCEMENTS_PATH } from "@/shared/components/layout/types";
import { appBasePath } from "@/apps/appInfo";

export const B = appBasePath("announcements");

const ic = {
  manage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  ),
  compose: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

export const announcementsNav: NavItem[] = [
  { label: "Manage", to: B, icon: ic.manage, section: "Announcements" },
  { label: "New announcement", to: `${B}/new`, icon: ic.compose },
  // The page everyone else reads, so a poster can see what staff see.
  { label: "As staff see them", to: ANNOUNCEMENTS_PATH, icon: ic.history },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
