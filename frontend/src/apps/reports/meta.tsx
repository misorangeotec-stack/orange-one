import type { AppManifest } from "../types";
import type { ReactNode } from "react";
import type { Profile } from "@/core/platform/types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import { canSeeMenu } from "@hub/lib/menus";
import { allowedReportIds, GRANTABLE_REPORTS } from "@hub/lib/reportAccess";
import { categoryHref, reportCategoriesFor } from "@hub/lib/reportCatalog";
import { BUSHRA_DASHBOARDS, dashboardGroupHref, groupPageIds } from "@hub/lib/bushraDashboards";
import ReportsApp from "./ReportsApp";

/**
 * The report ids one viewer holds. Shared by the two hooks below so the menu can never
 * offer a section the route guard would then refuse.
 *
 * Duplicating `useReportAccess`'s body rather than calling it: both callers run outside a
 * React tree (the launcher builds its list in a memo over the session, the route guard runs
 * before the app mounts), and the underlying helpers are pure precisely so that is possible.
 */
const heldReports = (isAdmin: boolean, user: Profile) => {
  const hiddenMenus = user.receivablesHiddenMenus ?? [];
  return allowedReportIds(isAdmin, user.receivablesAllowedReports ?? [], (key) =>
    canSeeMenu(isAdmin, hiddenMenus, key),
  );
};

/**
 * THE APP HAS TWO HALVES, EACH BEHIND ITS OWN MENU KEY, and they are deliberately independent.
 *
 * Reports and Bushra-Dashboard were two separate menus in the Outstanding Dashboard, gated by
 * two separate keys in profiles.receivables_hidden_menus. They now share one module, but a
 * user granted one and not the other must keep exactly what they had — so the module opens if
 * EITHER half is open, and the menu lists only the halves they hold. Requiring both would have
 * taken screens away from people on the day of the move.
 */
const halves = (isAdmin: boolean, user: Profile) => {
  const hiddenMenus = user.receivablesHiddenMenus ?? [];
  const held = heldReports(isAdmin, user);
  return {
    held,
    // At least one report granted THROUGH the catalogue. The two Sales & Team entries are
    // excluded (`GRANTABLE_REPORTS` already drops them): they are gated by their own hub menu
    // and live on their own hub pages, so holding only those must not light up a Reports
    // section that would open on an empty list.
    reports: canSeeMenu(isAdmin, hiddenMenus, "reports") && GRANTABLE_REPORTS.some((r) => held.has(r.id)),
    // Same shape for the dashboards, but returned as the LIST of groups rather than a yes/no:
    // the menu lists one row per group, and deciding twice which groups are held is how the
    // menu and the module gate drift apart. Empty means "not open", which is what `canOpen`
    // reads it as.
    dashboards: canSeeMenu(isAdmin, hiddenMenus, "bushra-dashboard")
      ? BUSHRA_DASHBOARDS.filter((g) => groupPageIds(g).some((id) => held.has(id)))
      : [],
  };
};

/** A one-path inline icon, for the rows that have no catalogue entry to borrow one from. */
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/**
 * Manifest for Reports — the Outstanding Dashboard's report catalogue, promoted out of
 * that app's sidebar and onto the main menu.
 *
 * ⚠ NOT A NEW PERMISSION. Every gate this module had inside the hub is the gate it has
 *   here, and there is no migration and no new row on any permission screen:
 *
 *     accessAppId  the module grant stays `outstanding-dashboard`, so exactly the people
 *                  who could open the hub yesterday can open Reports today. A grant of its
 *                  own would have started empty and locked everybody out.
 *     canOpen      the two finer gates the hub sidebar also applied, restated for the
 *                  launcher menu and the route guard: the `reports` menu key
 *                  (profiles.receivables_hidden_menus) and the per-report grants
 *                  (profiles.receivables_allowed_reports).
 *
 *   The same pair is enforced again INSIDE the app, by the RequireHubMenu /
 *   RequireReportAccess routes that came across with the screens. That is not redundant:
 *   this predicate decides whether the module is worth offering, those decide whether a
 *   given URL may be served, and a hidden menu entry has never been access control.
 *
 * ⚠ Its pages remain under apps/receivables-hub/ on purpose — see ReportsApp for why
 *   moving them would be a rewrite, not a move.
 */
export const reportsApp: AppManifest = {
  id: "reports",
  accessAppId: "outstanding-dashboard",
  name: appName("reports"),
  description:
    "Every management report on the Tally books in one catalogue: the master reports, the finance statements, inventory, the sales and purchase dashboards, receivables, collections and the customer lenses.",
  basePath: appBasePath("reports"),
  status: "live",
  category: appCategory("reports"),
  subGroup: appSubGroup("reports"),
  // Just after the Outstanding Dashboard it came out of, and before the rest of the sales
  // group — people who want a number go here first.
  order: 15,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
      <path d="M9 17v-3M12 17v-6M15 17v-4" stroke="#FF6A1F" />
    </svg>
  ),
  /**
   * Pure, because both callers need it outside a React tree — the launcher menu builds its
   * list in a `useMemo` over the session, and the route guard runs before the app mounts.
   * `allowedReportIds` is the same helper `useReportAccess` wraps, so the launcher and the
   * in-app guards cannot drift apart on who holds what.
   */
  canOpen: ({ isAdmin, user }) => {
    const { reports, dashboards } = halves(isAdmin, user);
    return reports || dashboards.length > 0;
  },
  /**
   * The home menu's "Reports" group: one row per SECTION, plus the whole catalogue at the
   * top — the same shape this module had as a sub-nav inside the Outstanding Dashboard, and
   * the reason it is a group at all rather than a single collapsed link.
   *
   * SECTIONS, NOT REPORTS. There are around forty-five reports and eleven sections; listing
   * every report would put a forty-five-row wall in a menu that already carries every module
   * in the portal, and the sections are the vocabulary people already navigate by.
   *
   * A section the viewer holds nothing in is dropped by `reportCategoriesFor`, exactly as the
   * old sub-nav dropped it — the menu never offers a section that opens on an empty list.
   */
  menuEntries: ({ isAdmin, user }) => {
    const { held, reports, dashboards } = halves(isAdmin, user);
    const rows: { label: string; to: string; icon: ReactNode; subGroup?: string }[] = [];

    if (reports) {
      // The unfiltered catalogue. It needs its own row because a group HEADING in the portal
      // sidebar only expands and collapses — it is not a link — so without this there would
      // be no way to reach /reports itself from here.
      rows.push({ label: "All Reports", to: appBasePath("reports"), icon: <Icon d="M4 5h16M4 12h16M4 19h10" /> });
      for (const c of reportCategoriesFor(held)) {
        rows.push({
          label: c.title,
          to: categoryHref(c.id),
          // The catalogue's own icon for the section, so the menu row and the page it opens
          // are recognisably the same thing. `c.icon` is a lucide COMPONENT, hence the element
          // here — and deliberately without sizing classes: the sidebar sizes its rows' icons
          // itself (`[&>svg]:w-[18px]`), and a width class of ours would race that rule.
          icon: <c.icon />,
        });
      }
    }

    // A DROPDOWN, not a row. It was one row to the landing page, which meant a click, a page
    // load, and only then the three subjects — while the report sections above open what they
    // name in one click. `subGroup` folds them behind an expander instead, so the subjects are
    // visible in the menu and one click opens one.
    //
    // The label also has to stay: "Sales" and "Purchase" loose among the report sections would
    // read as report sections and send people to the wrong screen.
    for (const g of dashboards) {
      rows.push({
        label: g.title,
        to: dashboardGroupHref(g.id),
        icon: <g.icon />,
        subGroup: "Bushra-Dashboard",
      });
    }

    return rows;
  },
  Component: ReportsApp,
};
