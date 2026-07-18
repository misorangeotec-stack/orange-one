import type { ReactNode } from "react";

/** A sidebar navigation entry. `roles` (if set) restricts visibility. */
export interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** If omitted, visible to all roles. */
  roles?: string[];
  /** Optional small count badge (e.g. unread). */
  badge?: number;
  /** Render a section divider label above this item. */
  section?: string;
  /**
   * Put this item inside a COLLAPSIBLE group with this heading.
   *
   * Opt-in and additive: an app that sets neither `group` nor `subGroup` renders
   * exactly as it always has, as a flat list with `section` dividers. Only the
   * home screen uses grouping today — it lists every app in the portal, which a
   * flat list stops coping with somewhere around twenty modules.
   *
   * The nav array stays FLAT on the wire even when grouped; the sidebar builds
   * the tree. That is what lets AppShell keep deriving the page title by scanning
   * the same array, unchanged.
   */
  group?: string;
  /** Second level inside `group` (e.g. FMS → Purchase). One level only. */
  subGroup?: string;
  /**
   * Icon standing for the whole group when the rail is collapsed to icons — set
   * it on any item of the group. Without one the rail falls back to a generic
   * mark, which is legible but tells the reader nothing.
   */
  groupIcon?: ReactNode;
}

/** Display shape for a notification row in the bell dropdown. */
export interface NotificationItem {
  id: string;
  text: ReactNode;
  time: string;
  unread: boolean;
  to?: string;
}

/**
 * The portal home, named once so every route back to it agrees.
 *
 * It used to be called three different things depending on where you clicked from
 * — "Switch app" in the avatar menu, "Back to workspace" on the account page, and
 * "My Work Today" in its own menu — which read as three destinations rather than
 * one. "My" distinguishes this personal home from the process boards, several of
 * which are already called "… Control Center".
 */
export const HOME_PATH = "/home";
export const HOME_LABEL = "My Control Center";

/** Minimal current-user info the shell needs to render. */
export interface ShellUser {
  name: string;
  designation: string | null;
  color: string;
  roleLabel: string;
}
