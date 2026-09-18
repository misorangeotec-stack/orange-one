/**
 * The Sales dashboards under Bushra-Dashboard → Sales — one screen, many fixed slices.
 *
 * Every dashboard is pages/BushraSalesDashboard.tsx reading the Bushra Sales Register; what differs
 * is WHICH lines it counts (`include`) and what its first chart breaks them down by (`primary`).
 * The second chart is always Category.
 *
 * ─── THE SLICES ─────────────────────────────────────────────────────────────────────────────────
 *
 *   Sales Dashboard     SALES: every line that is not FOC, not Branch, not Related — SALE, Sales
 *                       Return, Credit Note, Debit Note and the still-pending SOA lines.
 *   Ink / Machines /    the same sales, narrowed to one Sales-Type. Ink also takes Provision
 *   Heads / Spare Parts Ink and Other Ink, which Central Masters files as inks.
 *   / Papers
 *   FOC                 every FOC line — FOC SALE, Branch FOC, Related FOC.
 *   SOA                 the approval lines on their own, for the pending picture in one place.
 *   Branch & Related    BRANCH SALE, RELATED SALE, Related Return — inter-company sales that are
 *                       not FOC (their FOC lines are on the FOC dashboard).
 *
 * ⚠ Each id and path must equal its twin in lib/bushraDashboards.ts AND lib/reportCatalog.ts — the id
 *   is the permission key, so a mismatch silently hides the screen.
 */
import type { BushraRegisterRow } from "./bushraSalesRegister";

export type Metric = "value" | "quantity";
/** What the first chart breaks the slice down by. */
export type PrimaryDim = "salesType" | "inkType" | "group" | "company";

export interface SalesDashboardPreset {
  id: string;
  path: string;
  title: string;
  /** Shown under the title. */
  blurb: string;
  include: (r: BushraRegisterRow) => boolean;
  primary: PrimaryDim;
  defaultMetric: Metric;
  /**
   * "overview" — quantity + revenue chart pairs by Type, Sales-Type and Month, then the full sales
   * report (the Sales page, as the business laid it out). "slices" — the two single-measure charts
   * with a Value/Quantity switch (every other dashboard, until it is laid out in turn).
   */
  layout: "overview" | "slices";
  /**
   * Overview only: the Quantity + Revenue Mix pairs, top to bottom, before the month charts and the
   * report. The business's order per dashboard — Sales: Type, Sales-Type; Ink: Category, Colour,
   * Group; Machines / Heads / Spare Parts: Category, Group.
   */
  sections?: SectionDim[];
  /**
   * How QUANTITY is written on this dashboard (the business's units):
   *   kg    ink is sold by weight — "850 KG", and from a tonne up "12.5 T"
   *   pcs   spare parts — "1,240 pcs"
   *   nos   machines and heads — "36 Nos"
   *   auto  paper — whatever unit its items carry in Central Masters
   *   none  a mixed dashboard (Sales, FOC, …) — a bare number, since units cannot be added up
   */
  qtyUnit: QtyUnit;
}

export type QtyUnit = "kg" | "pcs" | "nos" | "auto" | "none";

export type SectionDim = "type" | "salesType" | "category" | "colour" | "group" | "inkType";

const isFoc = (r: BushraRegisterRow) => /\bFOC\b/i.test(r.type);
const isInterCompany = (r: BushraRegisterRow) => /^(branch|related)\b/i.test(r.type);
/**
 * SALES = what was sold to our own customers: SALE, Sales Return, Credit Note, Debit Note AND the
 * still-pending SOA lines. Approval stock counts as sales at the business's own reading (asked for
 * 2026-09-18); only the PENDING ones are in the register at all — once a challan is billed its
 * invoice line is here instead, so nothing is counted twice.
 *
 * Out: FOC (given free) and anything Branch or Related (inter-company), each with its own dashboard.
 */
export const isPureSale = (r: BushraRegisterRow) => !isFoc(r) && !isInterCompany(r);

const pureOf = (...salesTypes: string[]) => (r: BushraRegisterRow) =>
  isPureSale(r) && salesTypes.includes(r.sales_type);

export const SALES_DASHBOARDS: SalesDashboardPreset[] = [
  {
    id: "bushra-sales-dashboard",
    path: "bushra-dashboard/sales-dashboard",
    title: "Sales Dashboard",
    blurb: "sales incl. pending SOA — no FOC, branch or related-party lines",
    include: isPureSale,
    primary: "salesType",
    defaultMetric: "value",
    layout: "overview",
    qtyUnit: "none", // mixed products — KG, pcs and Nos cannot add up to tonnes
    sections: ["type", "salesType"],
  },
  {
    id: "bushra-sales-ink",
    path: "bushra-dashboard/sales-ink",
    title: "Ink",
    blurb: "pure sales of ink (incl. provision & other ink)",
    include: pureOf("Ink", "Provision Ink", "Other Ink"),
    primary: "inkType",
    defaultMetric: "value",
    layout: "overview",
    qtyUnit: "kg",
    sections: ["category", "colour", "group"],
  },
  {
    id: "bushra-sales-machines",
    path: "bushra-dashboard/sales-machines",
    title: "Machines",
    blurb: "pure sales of machines",
    include: pureOf("Machine"),
    primary: "group",
    defaultMetric: "value",
    layout: "overview",
    qtyUnit: "nos",
    sections: ["category", "group"],
  },
  {
    id: "bushra-sales-heads",
    path: "bushra-dashboard/sales-heads",
    title: "Heads",
    blurb: "pure sales of print heads",
    include: pureOf("Heads"),
    primary: "group",
    defaultMetric: "value",
    layout: "overview",
    qtyUnit: "nos",
    sections: ["category", "group"],
  },
  {
    id: "bushra-sales-spare-parts",
    path: "bushra-dashboard/sales-spare-parts",
    title: "Spare Parts",
    blurb: "pure sales of spare parts",
    include: pureOf("Spare Parts"),
    primary: "group",
    defaultMetric: "value",
    layout: "overview",
    qtyUnit: "pcs",
    sections: ["category", "group"],
  },
  {
    id: "bushra-sales-papers",
    path: "bushra-dashboard/sales-papers",
    title: "Papers",
    blurb: "pure sales of paper",
    include: pureOf("Paper"),
    primary: "group",
    defaultMetric: "value",
    layout: "slices",
    qtyUnit: "auto",
  },
  {
    id: "bushra-sales-foc",
    path: "bushra-dashboard/sales-foc",
    title: "FOC",
    blurb: "free-of-cost issues — FOC Sale, Branch FOC and Related FOC",
    include: isFoc,
    primary: "salesType",
    // Branch and Related FOC are booked at no value, so quantity is the honest first view.
    defaultMetric: "quantity",
    layout: "slices",
    qtyUnit: "none", // mixed products — KG, pcs and Nos cannot add up to tonnes
  },
  {
    id: "bushra-sales-soa",
    path: "bushra-dashboard/sales-soa",
    title: "SOA",
    blurb: "sales on approval still pending — not billed, not returned (also counted in Sales)",
    include: (r) => r.type === "SOA",
    primary: "salesType",
    defaultMetric: "value",
    layout: "slices",
    qtyUnit: "none", // mixed products — KG, pcs and Nos cannot add up to tonnes
  },
  {
    id: "bushra-sales-branch-related",
    path: "bushra-dashboard/sales-branch-related",
    title: "Branch & Related",
    blurb: "inter-company sales to branches and related parties (their FOC is on the FOC dashboard)",
    include: (r) => isInterCompany(r) && !isFoc(r),
    primary: "company",
    defaultMetric: "value",
    layout: "slices",
    qtyUnit: "none", // mixed products — KG, pcs and Nos cannot add up to tonnes
  },
];

export const salesPresetById = (id: string) => SALES_DASHBOARDS.find((p) => p.id === id)!;
