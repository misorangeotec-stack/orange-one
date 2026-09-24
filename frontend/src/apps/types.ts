import type { ComponentType, ReactNode } from "react";
import type { AppCategory } from "./categories";
import type { Profile } from "@/core/platform/types";

/**
 * Every business app in the Orange One portal is described by an AppManifest.
 * The home screen renders a grouped menu entry per manifest; the router mounts
 * each live app's component at `${basePath}/*`. Adding a new app = create a folder
 * under src/apps/<name>/ that exports a manifest, then register it in registry.tsx.
 */
export interface AppManifest {
  /** Stable unique id, e.g. "task-management". */
  id: string;
  /**
   * The app_access id this app is GRANTED under, when that is not its own `id`.
   *
   * Set it only when an app was carved out of another one and must keep riding the
   * original grant. Reports is the case it exists for: it was the Outstanding
   * Dashboard's Reports menu until it was promoted to the main menu, and everybody
   * who could open it then must still be able to open it now — so it is gated by
   * `outstanding-dashboard`, not by a grant of its own that nobody holds.
   *
   * An app with this set is NOT independently grantable: `grantableModules` skips it,
   * so it never appears as a row on the permission screens offering a switch that
   * would write an id nothing reads.
   */
  accessAppId?: string;
  /**
   * An EXTRA visibility rule on top of the module grant — the launcher menu and the
   * route guard both apply it. Pure (no hooks), so it can be called from either.
   *
   * Only for an app whose access was never the module grant alone. Reports again:
   * inside the hub it was additionally gated by the `reports` menu deny-list and by
   * the per-report grants, and moving the screens must not quietly hand them to
   * people the hub was keeping them from.
   *
   * Returning false hides the menu entry AND refuses the route, so the two can never
   * disagree — a hidden link is not access control.
   */
  canOpen?: (ctx: { isAdmin: boolean; user: Profile }) => boolean;
  /**
   * The rows this app contributes to the home menu, where ONE row per app is the wrong
   * shape. Omitted by every app but Reports, which gets one row per section it holds.
   *
   * A catalogue is the case that breaks the one-row rule. A single "Reports" link tells the
   * reader nothing about what is behind it, and the sections are exactly what they came
   * looking for — so the group lists them, the way the menu inside the Outstanding Dashboard
   * always did before the module was promoted out of it.
   *
   * Pure and session-aware for the same reason `canOpen` is: a section the viewer holds no
   * report in must not be offered, and that is a per-user answer.
   *
   * Returning an empty array leaves the app out of the menu entirely. That is a real state
   * (a user granted nothing) and a correct one — `canOpen` will have refused the route too.
   */
  menuEntries?: (ctx: { isAdmin: boolean; user: Profile }) => {
    label: string;
    to: string;
    icon: ReactNode;
    /**
     * Put this row inside a named DROPDOWN within the app's group — the sidebar's `subGroup`
     * level, one deep. Rows without one sit directly under the group heading.
     *
     * Reports uses it for Bushra-Dashboard: its three subjects belong together and behind one
     * label, not loose among the report sections where "Sales" and "Purchase" would read as
     * report sections themselves.
     */
    subGroup?: string;
  }[];
  /** Display name shown on the launcher card. */
  name: string;
  /** One-line description for the launcher card. */
  description: string;
  /** Route base, e.g. "/task-management". The app owns everything under it. */
  basePath: string;
  /** "live" apps are clickable + routed; "coming-soon" render as disabled cards. */
  status: "live" | "coming-soon";
  /** Card icon (inline SVG). */
  icon: ReactNode;
  /** Root component for a live app; it renders its own internal <Routes>. */
  Component?: ComponentType;
  /**
   * Which menu group this app belongs to (apps/categories.ts). Optional so adding
   * the field broke no manifest — but leave it off and the app lands in a trailing
   * "Other" group on every screen that lists apps. Tag new apps.
   */
  category?: AppCategory;
  /** Sort position within the category; ties fall back to name. Default 100. */
  order?: number;
  /**
   * Optional second level inside the category, e.g. FMS → Purchase → these apps.
   * Untagged apps sit directly under the category heading.
   */
  subGroup?: string;
}
