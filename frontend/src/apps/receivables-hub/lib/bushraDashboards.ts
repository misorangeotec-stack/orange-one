/**
 * The Bushra-Dashboard catalogue — ONE list of every dashboard under that menu.
 *
 * Built the way lib/reportCatalog.ts is, and for the same reason: the sidebar's sub-nav, the
 * landing page and the breadcrumb all read this list, so a new dashboard is added in one place and
 * appears in all three. Nothing else needs editing but the route.
 *
 * THE SHAPE IS TWO DEEP, LIKE REPORTS. A GROUP is a subject ("Production - Batch Costing"); its
 * PAGES are the screens inside it (the dashboard itself, its expenses, whatever comes next). The
 * sidebar lists groups — one entry per subject, never per screen, or it grows past twenty rows as
 * fast as it did for Reports.
 *
 * ADDING A DASHBOARD LATER: add a page to an existing group, or a new group with its pages, then
 * add the <Route> in ReceivablesHubApp.tsx. The menu, the landing page and the trail follow.
 *
 * PERMISSIONS: EVERY LIVE PAGE IS ALSO A REPORT. Each page has a twin entry in lib/reportCatalog.ts
 * with the SAME id and path, so it is granted per screen through profiles.receivables_allowed_reports
 * like any report. The route sits behind RequireReportAccess, and the sidebar and landing page show
 * only the pages the viewer holds (groupPageIds below). A new page therefore also needs its catalogue
 * entry, or nobody but an admin can open it.
 */
import { Factory, LayoutDashboard, Package, Receipt, ShoppingCart, Truck, type LucideIcon } from "lucide-react";
import { appBasePath } from "@/apps/appInfo";
import { SALES_DASHBOARDS } from "./bushraSalesDashboards";
import { PURCHASE_DASHBOARDS, purchaseDashboardTitle } from "./bushraPurchaseDashboards";

const BASE = appBasePath("outstanding-dashboard");

/** "live" = built; "soon" = catalogued but not built, so the row is listed and inert. */
export type DashboardStatus = "live" | "soon";

export interface BushraDashboardPage {
  /** Stable id; also the React key. */
  id: string;
  title: string;
  /** ONE line: what this screen answers. */
  purpose: string;
  /** Path RELATIVE to the hub base. Absent when status is "soon". */
  path?: string;
  icon: LucideIcon;
  status: DashboardStatus;
}

export interface BushraDashboardGroup {
  id: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  pages: BushraDashboardPage[];
}

export const BUSHRA_DASHBOARDS: BushraDashboardGroup[] = [
  {
    id: "production-batch-costing",
    title: "Production - Batch Costing",
    blurb: "Every production batch of Enterprise — Surat: what it made, what it consumed, and what a kilogram cost.",
    icon: Factory,
    pages: [
      {
        id: "production-batch-costing",
        title: "Production Dashboard",
        purpose: "Output, batches, scrap and cost per KG — by year, month, colour, category and batch.",
        path: "bushra-dashboard/production-batch-costing",
        icon: LayoutDashboard,
        status: "live",
      },
      {
        id: "production-expenses",
        title: "Expenses",
        purpose: "Direct & Indirect Expenses as Tally's P&L groups them, and the full cost of a kilogram.",
        path: "bushra-dashboard/production-expenses",
        icon: Receipt,
        status: "live",
      },
      {
        id: "packing-material",
        title: "Packing Material",
        purpose: "Every outward entry of caps, cans and stickers — production, repacking, warehouse — and what it adds per KG.",
        path: "bushra-dashboard/packing-material",
        icon: Package,
        status: "live",
      },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    blurb: "Pure sales, each product line, FOC, SOA and branch & related-party sales — by sales-type and category.",
    icon: ShoppingCart,
    // Generated from the preset list, so each page's id and path cannot drift from its screen.
    pages: SALES_DASHBOARDS.map((p) => ({
      id: p.id,
      title: p.id === "bushra-sales-dashboard" ? p.title : `${p.title} Dashboard`,
      purpose: p.blurb.charAt(0).toUpperCase() + p.blurb.slice(1) + ".",
      path: p.path,
      icon: p.id === "bushra-sales-dashboard" ? LayoutDashboard : ShoppingCart,
      status: "live" as const,
    })),
  },
  {
    id: "purchase",
    title: "Purchase",
    blurb: "Every purchase, and machines, spare parts, service and everything else — by purchase-type, category and group.",
    icon: Truck,
    // Generated from the preset list, so each page's id and path cannot drift from its screen.
    pages: PURCHASE_DASHBOARDS.map((p) => ({
      id: p.id,
      title: purchaseDashboardTitle(p),
      purpose: p.blurb.charAt(0).toUpperCase() + p.blurb.slice(1) + ".",
      path: p.path,
      icon: p.id === "bushra-purchase-dashboard" ? LayoutDashboard : Truck,
      status: "live" as const,
    })),
  },
];

/** Absolute URL of a group's landing page — a filter on the landing page, not a route of its own. */
export const dashboardGroupHref = (id: string) => `${BASE}/bushra-dashboard?group=${id}`;

/** Absolute URL of one dashboard. Empty for a "soon" entry, which is never a link. */
export const dashboardHref = (p: BushraDashboardPage) => (p.path ? `${BASE}/${p.path}` : "");

/**
 * The report-catalogue ids that grant a group's live screens. A viewer who holds none of them is
 * not shown the group — nor the menu, when no group is left.
 */
export const groupPageIds = (g: BushraDashboardGroup) =>
  g.pages.filter((p) => p.status === "live" && p.path).map((p) => p.id);

/** Every page path in a group — what the sidebar lights its entry up for. */
export const groupPaths = (g: BushraDashboardGroup) =>
  g.pages.filter((p) => p.path).map((p) => `${BASE}/${p.path}`);

/** The group a path belongs to, for the sidebar and the breadcrumb. Null off the catalogue. */
export function groupOfPath(pathname: string): BushraDashboardGroup | null {
  return BUSHRA_DASHBOARDS.find((g) => groupPaths(g).some((p) => pathname === p || pathname.startsWith(`${p}/`))) ?? null;
}

/** The page a path is, for the breadcrumb's last step. */
export function pageOfPath(pathname: string): BushraDashboardPage | null {
  for (const g of BUSHRA_DASHBOARDS) {
    const hit = g.pages.find((p) => p.path && (pathname === `${BASE}/${p.path}` || pathname.startsWith(`${BASE}/${p.path}/`)));
    if (hit) return hit;
  }
  return null;
}

export const dashboardGroupById = (id: string | null | undefined) =>
  BUSHRA_DASHBOARDS.find((g) => g.id === id) ?? null;
