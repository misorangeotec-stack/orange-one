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
}

/** Display shape for a notification row in the bell dropdown. */
export interface NotificationItem {
  id: string;
  text: ReactNode;
  time: string;
  unread: boolean;
  to?: string;
}

/** Minimal current-user info the shell needs to render. */
export interface ShellUser {
  name: string;
  designation: string | null;
  color: string;
  roleLabel: string;
}
