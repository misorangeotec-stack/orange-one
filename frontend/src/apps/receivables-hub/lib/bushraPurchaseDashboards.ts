/**
 * The Purchase dashboards under Bushra-Dashboard → Purchase — one screen, fixed slices.
 *
 * The purchase-side twin of lib/bushraSalesDashboards.ts (branch Bushra-Sales-Dashboard). Every
 * dashboard is pages/BushraPurchaseDashboard.tsx reading the Bushra Purchase Register; what differs is
 * WHICH lines it counts (`include`) and which breakdowns it shows (`sections`).
 *
 *   Purchase          PURE purchases: every line that is not Branch and not Related — the companies'
 *                     own vendors, goods and service
 *   Machines /        the same pure purchases, narrowed to one Purchase-Type
 *   Spare Parts /
 *   Service
 *   Other             pure purchases of everything else — Ink, Heads, Paper, Packing Material,
 *                     Raw Material, untyped
 *   Branch & Related  inter-company purchases from branches and related parties — the lines every
 *                     other dashboard leaves out (asked for 2026-09-16)
 *
 * ⚠ Each id and path must equal its twin in lib/bushraDashboards.ts AND lib/reportCatalog.ts — the id
 *   is the permission key, so a mismatch silently hides the screen. Both are generated from this list.
 */
import type { BushraPurchaseRow } from "./bushraPurchaseRegister";

export type PurchaseSectionDim = "type" | "purchaseType" | "category" | "group" | "colour" | "inkType" | "particulars" | "company";

/** How QUANTITY is written: pcs / nos in the business's units; none where units are mixed or absent. */
export type PurchaseQtyUnit = "pcs" | "nos" | "none";

export interface PurchaseDashboardPreset {
  id: string;
  path: string;
  title: string;
  blurb: string;
  include: (r: BushraPurchaseRow) => boolean;
  /** The Quantity + Value Mix pairs, top to bottom, before the month charts and the report. */
  sections: PurchaseSectionDim[];
  qtyUnit: PurchaseQtyUnit;
  /** False where lines carry no quantity at all (service bills) — the quantity panels are dropped. */
  hasQuantity: boolean;
}

const MACHINE = "Machine";
const SPARES = "Spare Parts";
const SERVICE = "Service Expense";
const NAMED = new Set([MACHINE, SPARES, SERVICE]);

/** 'Branch Purchase', 'Related Purchase Return', … — the inter-company TYPEs. */
const isInterCompany = (r: BushraPurchaseRow) => /^(branch|related)\b/i.test(r.type);
/** What every dashboard but Branch & Related counts: the companies' own vendors. */
export const isPurePurchase = (r: BushraPurchaseRow) => !isInterCompany(r);

const pureOf = (...purchaseTypes: string[]) => (r: BushraPurchaseRow) =>
  isPurePurchase(r) && purchaseTypes.includes(r.purchase_type);

export const PURCHASE_DASHBOARDS: PurchaseDashboardPreset[] = [
  {
    id: "bushra-purchase-dashboard",
    path: "bushra-dashboard/purchase-dashboard",
    title: "Purchase Dashboard",
    blurb: "pure purchases — no branch or related-party lines",
    include: isPurePurchase,
    sections: ["type", "purchaseType"],
    qtyUnit: "none",
    hasQuantity: true,
  },
  {
    id: "bushra-purchase-machines",
    path: "bushra-dashboard/purchase-machines",
    title: "Machines",
    blurb: "pure purchases of machines",
    include: pureOf(MACHINE),
    sections: ["category", "group"],
    qtyUnit: "nos",
    hasQuantity: true,
  },
  {
    id: "bushra-purchase-spare-parts",
    path: "bushra-dashboard/purchase-spare-parts",
    title: "Spare Parts",
    blurb: "pure purchases of spare parts",
    include: pureOf(SPARES),
    sections: ["category", "group"],
    qtyUnit: "pcs",
    hasQuantity: true,
  },
  {
    id: "bushra-purchase-service",
    path: "bushra-dashboard/purchase-service",
    title: "Service",
    blurb: "inward service bills from own vendors — by expense ledger",
    include: pureOf(SERVICE),
    sections: ["particulars"],
    qtyUnit: "none",
    hasQuantity: false,
  },
  {
    id: "bushra-purchase-other",
    path: "bushra-dashboard/purchase-other",
    title: "Other",
    blurb: "pure purchases of everything else — ink, heads, paper, packing, raw material",
    include: (r) => isPurePurchase(r) && !NAMED.has(r.purchase_type),
    sections: ["purchaseType", "category", "group"],
    qtyUnit: "none",
    hasQuantity: true,
  },
  {
    id: "bushra-purchase-branch-related",
    path: "bushra-dashboard/purchase-branch-related",
    title: "Branch & Related",
    blurb: "inter-company purchases from branches and related parties",
    include: isInterCompany,
    sections: ["company", "purchaseType"],
    qtyUnit: "none",
    hasQuantity: true,
  },
];

export const purchasePresetById = (id: string) => PURCHASE_DASHBOARDS.find((p) => p.id === id)!;

/** The tab / sidebar title: the first dashboard keeps its own name, the rest read "X Dashboard". */
export const purchaseDashboardTitle = (p: PurchaseDashboardPreset) =>
  p.id === "bushra-purchase-dashboard" ? p.title : `${p.title} Dashboard`;
