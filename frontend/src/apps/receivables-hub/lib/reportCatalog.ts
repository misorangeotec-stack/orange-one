import {
  AlarmClock,
  BarChart3,
  BookOpen,
  Boxes,
  Calculator,
  CalendarClock,
  Crown,
  FolderTree,
  Gauge,
  HandCoins,
  Landmark,
  Layers,
  LayoutDashboard,
  NotebookText,
  PackageX,
  Percent as PercentIcon,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { appBasePath } from "@/apps/appInfo";
import type { Crumb } from "@/apps/currentApp";

/**
 * The report catalogue — ONE source of truth for every report in this app.
 *
 * The landing page (pages/Reports.tsx), the sidebar's Reports sub-nav (lib/menus.tsx)
 * and the breadcrumb trail (layouts/UserLayout.tsx) all read this list. Adding a report
 * here makes it appear in all three; there is no second place to register it.
 *
 * Reads `appBasePath` directly rather than lib/menus' BASE re-export: menus.tsx imports
 * REPORT_CATEGORIES from here to build its sub-nav, so importing BASE back from menus
 * would be a cycle. `appInfo` is an import-free leaf, which is what makes this safe.
 */

const BASE = appBasePath("outstanding-dashboard");

/**
 * Which pipeline a report's numbers come from.
 *
 * Shown as a pill on every catalogue row. Today only the financial statements read the
 * ConnectWave Tally mirror; the rest still read the Python/Sheets pipeline. Every report
 * migrates to ConnectWave over time, and flipping this one field is the whole change.
 */
export type ReportSource = "pipeline" | "tally";

/** "soon" = catalogued but not built. No route, no fetcher — the row is inert. */
export type ReportStatus = "live" | "soon";

/**
 * How a report honours the viewer's per-salesperson scope
 * (profiles.receivables_salespersons → lib/scope.tsx → lib/scopeParties.ts).
 *
 * REQUIRED on every entry, and deliberately so: a new report cannot be added to this
 * catalogue without someone deciding what a scoped user sees in it. `tsc` is the gate.
 *
 *   "party-server"  the fetcher passes the allowed party names to the server, so the
 *                   out-of-scope rows never reach the browser at all. Preferred.
 *   "party-client"  the rows carry a customer/ledger/salesperson, so they are filtered
 *                   after the fetch. (Everything on useAppData is already this today.)
 *   "none"          the report cannot be narrowed to a salesperson — either it has no
 *                   customer dimension (a Balance Sheet is the company's, full stop), it
 *                   is vendor-side, or its RPC pre-aggregates with no party filter. Per
 *                   the product rule these still show the FULL company figures, with a
 *                   banner saying so (components/ScopeBanner) rather than being hidden.
 *
 * Flipping "none" → "party-server" is the entire frontend change when an RPC later gains
 * a p_parties argument; the banner then disappears on its own.
 */
export type ReportScoping = "party-server" | "party-client" | "none";

export type ReportCategoryId =
  | "master-reports"
  | "finance"
  | "inventory"
  | "dashboards"
  | "insights"
  | "receivables"
  | "collections"
  | "customers"
  | "sales-team"
  | "tally";

export interface ReportCategory {
  id: ReportCategoryId;
  title: string;
  blurb: string;
  icon: LucideIcon;
}

export interface ReportSubcategory {
  id: string;
  category: ReportCategoryId;
  title: string;
}

export interface ReportEntry {
  /** Stable id. Never reuse or rename — it is the React key and the future permission key. */
  id: string;
  title: string;
  /** ONE line. The row truncates rather than wraps, so keep it under ~110 characters. */
  purpose: string;
  category: ReportCategoryId;
  /** Only meaningful inside the "tally" category today. */
  subcategory?: string;
  /** Path RELATIVE to BASE, query string included. Absent when status is "soon". */
  path?: string;
  icon: LucideIcon;
  source: ReportSource;
  status: ReportStatus;
  /** Extra words that should match in search but appear in neither title nor purpose. */
  keywords?: string[];
  /** How this report honours the viewer's salesperson scope. Required — see ReportScoping. */
  scoping: ReportScoping;
  /**
   * Replaces the default ScopeBanner copy when `scoping` is "none". Use it when
   * "cannot be filtered to your salespeople" would be the wrong explanation — a vendor-side
   * report isn't unfilterable, the concept simply doesn't apply to it.
   */
  scopeNote?: string;
  /**
   * This report is NOT gated by the per-report grants — it is gated by the named menu key
   * (lib/menus.tsx) because it lives OUTSIDE /reports with its own top-level sidebar entry.
   *
   * Only the two Sales & Team reports. They are catalogued so this list stays the complete
   * picture of every report in the app, but putting them behind a report grant as well would
   * mean two gates fighting over one screen — and filtering the landing page by grants alone
   * would make them vanish for users who can perfectly well open them from the sidebar.
   */
  governedByMenu?: string;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  // First in the rail on purpose — these are the headline management reports, and this
  // array's order IS the landing-page tab order and the sidebar sub-nav order.
  {
    id: "master-reports",
    title: "Master Reports",
    blurb: "The headline management reports, read straight from the Tally books.",
    icon: BarChart3,
  },
  {
    id: "finance",
    title: "Finance",
    blurb: "Receivables, payables, income and expense — straight from the Tally books.",
    icon: Landmark,
  },
  // Talligence files Stock Analysis under Report → Inventory, and this is the first report on
  // the inventory spine (stock masters + voucher inventory lines) rather than the ledger one.
  {
    id: "inventory",
    title: "Inventory",
    blurb: "What is on the shelf, what it is worth, and what has stopped moving.",
    icon: Warehouse,
  },
  {
    id: "dashboards",
    title: "Dashboards",
    blurb: "At-a-glance executive scoreboards built from the live Tally books.",
    icon: LayoutDashboard,
  },
  // Talligence files Customer Profile under its own top-level "Insights" nav, not under Report —
  // these read the book to describe the customer BASE (who is new, who left, who is growing)
  // rather than to state a balance.
  //
  // Dashboards and Insights were `adminOnly: true` until per-report grants shipped. That flag was
  // a second gate saying the same thing the grants now say directly — and a worse one, since an
  // admin could tick "C-Level Dashboard" for a user and have it silently do nothing. Withholding
  // the grant IS the restriction now.
  {
    id: "insights",
    title: "Insights",
    blurb: "How the customer base is moving — who is new, who is returning, who has gone quiet.",
    icon: Sparkles,
  },
  {
    id: "receivables",
    title: "Receivables",
    blurb: "What we are owed, how old it is, and how long it takes to come back.",
    icon: Wallet,
  },
  {
    id: "collections",
    title: "Collections",
    blurb: "Who is paying, who is not, and what has actually landed.",
    icon: HandCoins,
  },
  {
    id: "customers",
    title: "Customers",
    blurb: "The book cut by customer tier and buying behaviour.",
    icon: Users,
  },
  {
    id: "sales-team",
    title: "Sales & Team",
    blurb: "The same book read per salesperson.",
    icon: UserCheck,
  },
  {
    id: "tally",
    title: "Tally Reports",
    blurb: "Statements laid out the way Tally prints them, for line-by-line cross-verification.",
    icon: BookOpen,
  },
];

export const REPORT_SUBCATEGORIES: ReportSubcategory[] = [
  { id: "financial-statements", category: "tally", title: "Financial Statements" },
  { id: "books-registers", category: "tally", title: "Books & Registers" },
  // Reports.tsx renders the tally category as one band PER REGISTERED SUBCATEGORY, so an entry
  // whose subcategory is not in this list is silently invisible on the landing page — no error,
  // no empty band, just a missing row. Register the subcategory before the report.
  { id: "inventory-books", category: "tally", title: "Inventory Books" },
  { id: "outstanding", category: "tally", title: "Outstanding" },
];

export const REPORTS: ReportEntry[] = [
  // ── Master Reports ─────────────────────────────────────────────────────────
  {
    id: "sales-report",
    // rpt_sales_report already takes p_parties — the scope goes to the server.
    scoping: "party-server",
    title: "Sales Report",
    purpose: "The full sales picture — year, quarter, month, week, geography, product and customer.",
    category: "master-reports",
    path: "reports/sales",
    icon: BarChart3,
    source: "tally",
    status: "live",
    keywords: ["sales", "revenue", "turnover", "geography", "product", "contributing customers", "ageing"],
  },
  {
    id: "purchase-report",
    // Vendor-keyed. rpt_purchase_report DOES take p_parties, but its parties are SUPPLIERS and
    // ext_ledger_tags tags customers — filtering vendors against a customer tag list would
    // silently empty the report rather than scope it.
    scoping: "none",
    scopeNote: "Vendor-side report — salesperson scope does not apply.",
    title: "Purchase Report",
    purpose: "The full purchase picture — year, quarter, month, week, geography, product and vendor.",
    category: "master-reports",
    path: "reports/purchase",
    icon: ShoppingCart,
    source: "tally",
    status: "live",
    keywords: ["purchase", "vendor", "supplier", "payable", "procurement", "creditors", "ageing", "bill"],
  },
  {
    id: "day-book-dashboard",
    // rpt_day_book takes (p_tenant, p_date) only — no party filter, and its KPI / income /
    // expense / product panels carry no party column to re-aggregate from. Needs a p_parties
    // argument on the RPC before it can be scoped.
    scoping: "none",
    title: "Day Book",
    purpose: "One day at a glance — sales, purchases, income & expense, products and vouchers.",
    category: "master-reports",
    path: "reports/day-book",
    icon: BookOpen,
    source: "tally",
    status: "live",
    keywords: ["day book", "daybook", "today", "vouchers", "collection", "payment", "income", "expense"],
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  {
    id: "finance-receivables",
    scoping: "party-server",
    title: "Receivables",
    purpose: "Outstanding, overdue, on-account and advances per customer — the Talligence receivables view.",
    category: "finance",
    path: "reports/finance-receivables",
    icon: ReceiptText,
    source: "tally",
    status: "live",
    keywords: ["receivables", "outstanding", "overdue", "on account", "advance", "bills receivable", "ageing", "debtors"],
  },
  {
    id: "finance-payables",
    scoping: "none",
    scopeNote: "Vendor-side report — salesperson scope does not apply.",
    title: "Payables",
    purpose: "What we owe each supplier — outstanding, overdue, on-account and advances, by bill.",
    category: "finance",
    path: "reports/finance-payables",
    icon: HandCoins,
    source: "tally",
    status: "live",
    keywords: ["payables", "creditors", "supplier", "vendor", "outstanding", "overdue", "on account", "advance", "bills payable", "ageing"],
  },
  {
    id: "finance-income",
    // Posted to NOMINAL accounts — the "ledger" on every row is an income head, not a customer.
    // There is no customer dimension to narrow.
    scoping: "none",
    title: "Income",
    purpose: "Income by group, sub-group and ledger — year, quarter and month, straight from the Tally books.",
    category: "finance",
    path: "reports/finance-income",
    icon: TrendingUp,
    source: "tally",
    status: "live",
    keywords: ["income", "revenue", "sales accounts", "direct income", "indirect income", "P&L", "profit and loss"],
  },
  {
    id: "finance-expense",
    scoping: "none",
    title: "Expense",
    purpose: "Expense by group, sub-group and ledger — year, quarter and month, straight from the Tally books.",
    category: "finance",
    path: "reports/finance-expense",
    icon: Wallet,
    source: "tally",
    status: "live",
    keywords: ["expense", "cost", "overheads", "direct expenses", "indirect expenses", "purchase accounts", "P&L", "profit and loss"],
  },
  {
    id: "finance-sales-gain",
    // rpt_sales_gain_report has NO p_parties despite rpt_sales_gain_voucher carrying both party
    // and a native salesperson column, and its KPI / geography / product panels are company
    // totals. Easiest of the four to fix server-side — see the Phase 3 note in the plan.
    scoping: "none",
    title: "Sales Gain Report",
    purpose: "Gain and margin on the sales book — by state, salesperson, customer and item.",
    category: "finance",
    path: "reports/finance-sales-gain",
    icon: PercentIcon,
    source: "tally",
    status: "live",
    keywords: ["sales gain", "margin", "profit", "gross profit", "cost of goods", "cogs", "product margin"],
  },

  // ── Inventory ──────────────────────────────────────────────────────────────
  {
    id: "stock-analysis",
    // Item grain — no party dimension anywhere on the inventory spine.
    scoping: "none",
    title: "Stock Analysis",
    purpose: "Stock value by category and group, monthly inward/outward, and what has stopped moving.",
    category: "inventory",
    path: "reports/stock-analysis",
    icon: Warehouse,
    source: "tally",
    status: "live",
    keywords: ["stock", "inventory", "closing stock", "stock value", "product group", "product category",
               "bad stock", "non moving", "dead stock", "slow moving", "inward", "outward", "expired",
               "expiry", "base units", "godown", "item"],
  },

  // ── Insights ───────────────────────────────────────────────────────────────
  {
    id: "customer-profile",
    // rpt_customer_profile returns the whole roster (one row per customer-year) and each row
    // already carries `salesperson`, so this filters in the browser with no join at all.
    scoping: "party-client",
    title: "Customer Profile",
    purpose: "How the customer base is moving — new, returning, gone quiet — and the money behind each group.",
    category: "insights",
    path: "reports/customer-profile",
    icon: Users,
    source: "tally",
    status: "live",
    keywords: ["customer", "customers", "new customers", "existing customers", "non active", "dormant",
               "churn", "segment", "segmental", "small", "medium", "large", "journey", "lifecycle",
               "customer base", "insights", "contribution", "average sales"],
  },

  // ── Dashboards ─────────────────────────────────────────────────────────────
  {
    id: "sales-dashboard",
    // rpt_sales_dashboard takes no filter arrays at all and every panel (kpi, monthly, income,
    // expense, geography, products, ar) arrives company-aggregated. Its `salespersons` panel
    // names everyone, which is exactly what a scoped user should not see — Phase 3.
    scoping: "none",
    title: "Sales Dashboard",
    purpose:
      "Sales, income, expense and receivables on one screen — with geography, products, customers and salespersons.",
    category: "dashboards",
    path: "reports/sales-dashboard",
    icon: BarChart3,
    source: "tally",
    status: "live",
    keywords: ["sales dashboard", "revenue", "income", "expense", "receivables", "AR", "geography",
               "emerging products", "non performing", "salesperson", "contributing customers"],
  },
  {
    id: "purchase-dashboard",
    scoping: "none",
    scopeNote: "Vendor-side report — salesperson scope does not apply.",
    title: "Purchase Dashboard",
    purpose:
      "Purchase, income, expense and payables on one screen — with geography, vendors and top products.",
    category: "dashboards",
    path: "reports/purchase-dashboard",
    icon: ShoppingCart,
    source: "tally",
    status: "live",
    keywords: ["purchase dashboard", "procurement", "vendor", "supplier", "payables", "AP",
               "creditors", "geography", "income", "expense", "contributing vendors",
               "top products", "base units"],
  },
  {
    id: "exec-dashboard",
    // rpt_clevel_dashboard reads a frozen ~69 KB jsonb blob per (tenant, FY) — the customer is
    // already dissolved before the RPC is called, so this one cannot be scoped by adding a
    // parameter. It would need a scoped rebuild path, or to stay company-wide permanently.
    scoping: "none",
    title: "C-Level Dashboard",
    purpose:
      "The whole company on one screen — sales, profitability, ratios, funds, parties, stock and taxes.",
    category: "dashboards",
    path: "reports/c-level-dashboard",
    icon: LayoutDashboard,
    source: "tally",
    status: "live",
    keywords: ["executive", "c-level", "ceo", "cfo", "board", "kpi", "ratios", "gross profit",
               "net profit", "current ratio", "quick ratio", "return on equity", "debt to equity",
               "operating expense", "available funds", "bank", "duties", "taxes", "stock groups",
               "fast moving", "slow moving", "non moving"],
  },
  // The 2026-07-23 original, superseded by `exec-dashboard` above. Kept routed only so the two
  // can be compared side by side before it is deleted; see clevel-dashboard-reconciliation.md.
  {
    id: "c-level-dashboard",
    scoping: "none",
    title: "C-Level Dashboard (old)",
    purpose:
      "The whole company on one screen — sales, profit, ratios, funds, top parties, duties and stock, per company.",
    category: "dashboards",
    path: "reports/c-level",
    icon: LayoutDashboard,
    source: "tally",
    status: "live",
    keywords: ["executive", "c-level", "ceo", "cfo", "board", "kpi", "ratios", "gross profit", "net profit"],
  },

  // ── Receivables ────────────────────────────────────────────────────────────
  {
    id: "aging",
    // Rides useAppData, whose SCOPE CHOKEPOINT already filters allCustomers by the viewer's
    // salespeople — so this (and every other "party-client" entry marked the same way below)
    // has been scoped since long before per-report grants existed. Nothing to add.
    scoping: "party-client",
    title: "Aging Report",
    purpose:
      "Outstanding split by invoice age and days past due, grouped by sale type, customer or salesperson.",
    category: "receivables",
    path: "reports/aging",
    icon: CalendarClock,
    source: "pipeline",
    status: "live",
    keywords: ["ageing", "buckets", "180"],
  },
  {
    id: "overdue-aging",
    scoping: "party-client",
    title: "Customers Overdue Over 120 Days",
    purpose:
      "Money stuck on bills more than 120 days past due, split into debt brought forward vs billed since.",
    category: "receivables",
    path: "reports/overdue?over=120",
    icon: AlarmClock,
    source: "pipeline",
    status: "live",
    keywords: ["aged", "90", "180", "chase"],
  },
  {
    id: "top-exposure",
    scoping: "party-client",
    title: "Top 50 Credit Exposure & Overdue Accounts",
    purpose:
      "The biggest exposure / most-overdue customers as a ranked call-list, with credit limit, utilisation and terms.",
    category: "receivables",
    path: "reports/top-exposure",
    icon: Crown,
    source: "tally", // Live (Tally) only — shows a "Not applicable" panel on the default pipeline.
    status: "live",
    keywords: ["top 50", "exposure", "call list", "credit limit", "utilisation", "over limit", "overdue", "chase"],
  },
  {
    id: "dso",
    scoping: "party-client",
    title: "Customers with Average DSO over 90 Days",
    purpose:
      "How long each customer really takes to turn a sale into cash, against their own credit terms.",
    category: "receivables",
    path: "reports/dso?over=90",
    icon: Gauge,
    source: "pipeline",
    status: "live",
    keywords: ["days sales outstanding", "countback", "credit period"],
  },

  // ── Collections ────────────────────────────────────────────────────────────
  {
    id: "zero-collections",
    scoping: "party-client",
    title: "Customers with Zero Collections",
    purpose: "Customers who owe money and paid nothing in the period, flagged when we are still billing them.",
    category: "collections",
    path: "reports/collections?below=0",
    icon: UserX,
    source: "pipeline",
    status: "live",
    keywords: ["never paid", "still buying"],
  },
  {
    id: "low-collections",
    scoping: "party-client",
    title: "Customers Below 30% Collection",
    purpose:
      "Customers who collected less than 30% of what we could have collected, with the shortfall in rupees.",
    category: "collections",
    path: "reports/collections?below=30",
    icon: PercentIcon,
    source: "pipeline",
    status: "live",
    keywords: ["shortfall", "severity", "bounced"],
  },
  {
    id: "other-payments",
    scoping: "party-client",
    title: "Other Payments Report",
    purpose:
      "Manual, non-Tally payments applied against invoices or booked on account, by salesperson or customer.",
    category: "collections",
    path: "reports/other-payments",
    icon: HandCoins,
    source: "pipeline",
    status: "live",
    keywords: ["on account", "manual"],
  },

  // ── Customers ──────────────────────────────────────────────────────────────
  {
    id: "customer-category",
    scoping: "party-client",
    title: "Customer Category Report (A/B/C/D/E)",
    purpose:
      "The whole book pivoted by customer tier, plus a tag-hygiene lens that flags mis-graded customers.",
    category: "customers",
    path: "reports/category",
    icon: Layers,
    source: "pipeline",
    status: "live",
    keywords: ["tier", "grade", "abcde", "mismatch"],
  },
  {
    // Filed under Customers, not Collections: this asks a SALES question — who has stopped
    // buying and still owes us — not a payment one. See ReceivablesHubApp.tsx's route comment.
    id: "dormant-debtors",
    scoping: "party-client",
    title: "Customers with Dues but No Sales",
    purpose: "Dormant accounts — they owe money but have billed nothing in the period.",
    category: "customers",
    path: "reports/dormant",
    icon: PackageX,
    source: "pipeline",
    status: "live",
    keywords: ["dormant", "gone quiet", "stopped buying"],
  },
  {
    id: "red-mark-customers",
    scoping: "party-client",
    title: "Red Mark Customers",
    purpose: "The hand-flagged Red Mark list (managed in Masters), with live outstanding and overdue.",
    category: "customers",
    path: "reports/red-mark",
    icon: ShieldAlert,
    source: "tally",
    status: "live",
    keywords: ["red mark", "blocked", "flag", "watchlist"],
  },

  // ── Sales & Team ───────────────────────────────────────────────────────────
  // These two live OUTSIDE /reports and keep their own top-level sidebar links. They are
  // catalogued anyway so this list is the complete picture of every report in the app.
  {
    id: "salesperson-analysis",
    scoping: "party-client",
    governedByMenu: "salesperson-analysis",
    title: "Salesperson Risk Analysis",
    purpose: "The book read per salesperson, ranked by the risk sitting in their accounts.",
    category: "sales-team",
    path: "salesperson-analysis",
    icon: UserCheck,
    source: "pipeline",
    status: "live",
    keywords: ["rep", "territory", "risk"],
  },
  {
    id: "salesperson-collection",
    scoping: "party-client",
    governedByMenu: "salesperson-collection",
    title: "Salesperson Collection Report",
    purpose: "Opening, due, collected and target per salesperson for the month.",
    category: "sales-team",
    path: "salesperson-collection",
    icon: HandCoins,
    source: "pipeline",
    status: "live",
    keywords: ["target", "monthly", "rep"],
  },

  // ── Tally Reports ──────────────────────────────────────────────────────────
  {
    id: "balance-sheet",
    // A company's balance sheet is the company's. There is no per-salesperson version of it,
    // so a scoped viewer sees the full statement with the ScopeBanner above it.
    scoping: "none",
    title: "Balance Sheet",
    purpose: "What each company owns and owes, exactly as Tally states it.",
    category: "tally",
    subcategory: "financial-statements",
    path: "reports/balance-sheet",
    icon: Scale,
    source: "tally",
    status: "live",
    keywords: ["assets", "liabilities", "capital", "bs"],
  },
  {
    id: "profit-loss",
    scoping: "none",
    title: "Profit & Loss",
    purpose: "The trading and profit & loss account per company, down to Gross and Nett Profit.",
    category: "tally",
    subcategory: "financial-statements",
    path: "reports/profit-loss",
    icon: TrendingUp,
    source: "tally",
    status: "live",
    keywords: ["pnl", "p&l", "gross profit", "nett profit", "stock"],
  },
  {
    id: "trial-balance",
    // v_ledger_detail IS per-ledger, so this is technically filterable — but a trial balance
    // with only some debtor ledgers in it does not balance, which makes it a worse answer than
    // the honest company-wide one. Left whole, with the banner.
    scoping: "none",
    title: "Trial Balance",
    purpose: "Every group's closing balance, Debit and Credit side by side, drillable to the ledger.",
    category: "tally",
    subcategory: "financial-statements",
    path: "reports/trial-balance",
    icon: Calculator,
    source: "tally",
    status: "live",
    keywords: ["tb", "ledger balances"],
  },
  {
    id: "day-book",
    scoping: "none",
    title: "Day Book",
    purpose: "Every voucher entered in a date range, in Tally's own order.",
    category: "tally",
    subcategory: "books-registers",
    icon: BookOpen,
    source: "tally",
    status: "soon",
    keywords: ["vouchers", "daybook"],
  },
  {
    id: "ledger-voucher",
    // The list comes from v_ledger_detail (one row per ledger) and the statement is already
    // pinned to a single ledger by route param — so both the list and the /:ledgerId detail
    // can be narrowed to the viewer's customers.
    scoping: "party-client",
    title: "Ledger Voucher",
    purpose: "One ledger's full statement — every voucher against it, with a running balance.",
    category: "tally",
    subcategory: "books-registers",
    path: "reports/ledger-voucher",
    icon: ScrollText,
    source: "tally",
    status: "live",
    keywords: ["ledger statement", "account", "vouchers", "running balance"],
  },
  {
    id: "sales-register",
    // Read straight off rpt_sales_register through PostgREST rather than an RPC, so the scope
    // goes on the query as .in("party", …) — no server change needed.
    scoping: "party-server",
    title: "Sales Register",
    purpose: "Every sales & daybook voucher line — party, particulars, qty, rate and revenue, as booked.",
    category: "tally",
    subcategory: "books-registers",
    path: "reports/sales-register",
    icon: NotebookText,
    source: "tally",
    status: "live",
    keywords: ["register", "sales register", "voucher", "gstin", "particulars", "quantity", "rate", "revenue", "foc", "challan", "credit note", "debit note"],
  },
  {
    id: "group-summary",
    scoping: "none",
    title: "Group Summary",
    purpose: "Any Tally group rolled up, drillable down to its sub-groups and ledgers.",
    category: "tally",
    subcategory: "books-registers",
    icon: FolderTree,
    source: "tally",
    status: "soon",
    keywords: ["groups", "rollup"],
  },
  {
    id: "stock-summary",
    scoping: "none",
    title: "Stock Summary",
    purpose: "Every item's opening, inward, outward and closing — quantity, rate and value, as Tally prints it.",
    category: "tally",
    subcategory: "inventory-books",
    path: "reports/stock-summary",
    icon: Boxes,
    source: "tally",
    status: "live",
    keywords: [
      "stock summary", "stock group summary", "inventory", "opening balance", "inwards", "outwards",
      "closing balance", "item code", "primary group", "sub group", "quantity", "rate", "value",
      "base unit", "stock item", "movement", "closing stock", "godown",
    ],
  },
  {
    id: "ledger-outstanding",
    scoping: "party-client",
    title: "Ledger Outstandings",
    purpose: "Every ledger's pending bills — opening, pending, due date and overdue days, exactly as Tally shows them.",
    category: "tally",
    subcategory: "outstanding",
    path: "reports/ledger-outstanding",
    icon: ReceiptText,
    source: "tally",
    status: "live",
    keywords: ["bills", "receivables", "due date", "overdue", "pending", "bill-wise"],
  },
];

/** Absolute URL for a report. Empty for a "soon" entry, which is never a link. */
export function reportHref(r: ReportEntry): string {
  return r.path ? `${BASE}/${r.path}` : "";
}

/** Absolute URL for a category — a filter on the landing page, not a route of its own. */
export function categoryHref(id: ReportCategoryId): string {
  return `${BASE}/reports?cat=${id}`;
}

export function categoryById(id: string): ReportCategory | undefined {
  return REPORT_CATEGORIES.find((c) => c.id === id);
}

export function reportsInCategory(id: ReportCategoryId): ReportEntry[] {
  return REPORTS.filter((r) => r.category === id);
}

/** Sub-categories that actually hold a report, in declared order. */
export function subcategoriesInCategory(id: ReportCategoryId): ReportSubcategory[] {
  const used = new Set(reportsInCategory(id).map((r) => r.subcategory));
  return REPORT_SUBCATEGORIES.filter((s) => s.category === id && used.has(s.id));
}

/** Free-text match over title, purpose and keywords. Blank query returns everything. */
export function searchReports(q: string): ReportEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return REPORTS;
  return REPORTS.filter((r) =>
    [r.title, r.purpose, ...(r.keywords ?? [])].some((s) => s.toLowerCase().includes(needle)),
  );
}

/**
 * The reports a viewer may see, given the set of report ids they hold.
 *
 * Deliberately takes a plain id SET rather than a user, a role or a boolean: this module is a
 * catalogue, and keeping it free of session/permission imports is what lets lib/menus.tsx
 * import REPORT_CATEGORIES from here without a cycle. Who ends up in that set — grants,
 * admin bypass, the menu-governed Sales & Team pair — is decided in lib/reportAccess.ts,
 * which is the only place that knows about users.
 *
 * These replaced a `fullAccess: boolean` pair that dropped rows flagged `adminOnly`. That flag
 * is gone: per-report grants say the same thing directly, and say it for every report rather
 * than the four somebody remembered to flag.
 */
export function visibleReports(allowed: ReadonlySet<string>): ReportEntry[] {
  return REPORTS.filter((r) => allowed.has(r.id));
}

/**
 * Categories worth showing — those holding at least one report this viewer may see.
 *
 * An empty result is a legitimate state (a user granted nothing yet), so every caller must
 * handle it; pages/Reports.tsx would otherwise index cats[0] on a user's first ever visit.
 */
export function reportCategoriesFor(allowed: ReadonlySet<string>): ReportCategory[] {
  return REPORT_CATEGORIES.filter((c) => REPORTS.some((r) => r.category === c.id && allowed.has(r.id)));
}

/**
 * Every entry sharing a path, ignoring the query string.
 *
 * Two reports live at `reports/collections` and differ only by `?below=`, so a bare URL with no
 * query is genuinely ambiguous — `findReport` resolves it to whichever is declared first, which
 * for a permission check is a coin toss that can deny a user their own report. The route guard
 * uses this to ask "does the viewer hold ANY report at this path?" instead.
 */
export function reportsAtPath(pathname: string): ReportEntry[] {
  const rel = pathname.startsWith(`${BASE}/`) ? pathname.slice(BASE.length + 1) : null;
  if (!rel) return [];
  return REPORTS.filter((r) => r.path && r.path.split("?")[0] === rel);
}

/**
 * The catalogue entry a URL is showing.
 *
 * Query-aware, but query-SOFT, and it has to be both:
 *
 *  - Two entries share `reports/collections` and differ only by `?below=0` vs `?below=30`,
 *    so an exact query match has to win.
 *  - But `?over=` on the overdue and DSO reports is switchable ON the page, so a user sitting
 *    on `?over=180` must still resolve to the overdue report rather than falling off a cliff.
 *
 * Hence: exact `path + query` first, then fall back to the first entry with a matching path.
 */
export function findReport(pathname: string, search: string): ReportEntry | null {
  const rel = pathname.startsWith(`${BASE}/`) ? pathname.slice(BASE.length + 1) : null;
  if (!rel) return null;

  const query = new URLSearchParams(search);
  const live = REPORTS.filter((r) => r.path);

  for (const r of live) {
    const [rPath, rQuery] = r.path!.split("?");
    if (rPath !== rel || !rQuery) continue;
    const want = new URLSearchParams(rQuery);
    if ([...want].every(([k, v]) => query.get(k) === v)) return r;
  }

  return live.find((r) => r.path!.split("?")[0] === rel) ?? null;
}

/**
 * The breadcrumb tail for a reports URL: Reports › Category › Report.
 *
 * Returns null when the caller should fall back to the normal single-step page label —
 * i.e. on the bare landing page and on anything outside the catalogue. Note the landing
 * page WITH a `?cat=` still returns a trail: the pathname is plain `/reports` either way,
 * so keying only on the path would silently drop the category step.
 */
export function reportCrumbs(pathname: string, search: string): Crumb[] | null {
  const root: Crumb = { label: "Reports", to: `${BASE}/reports` };

  if (pathname === `${BASE}/reports`) {
    const cat = categoryById(new URLSearchParams(search).get("cat") ?? "");
    return cat ? [root, { label: cat.title }] : null;
  }

  // Ledger Outstandings and Ledger Vouchers each have a /:ledgerId detail sub-route with no catalogue
  // entry of its own. Give it the same trail as the list, with the report title linking back to the
  // list (the detail page's own Tally-style header carries the ledger name). The list itself (exact
  // path) falls through to findReport below and ends at a non-link title.
  for (const detail of [
    { id: "ledger-outstanding", fallback: "Ledger Outstandings" },
    { id: "ledger-voucher", fallback: "Ledger Vouchers" },
  ]) {
    const listPath = `${BASE}/reports/${detail.id}`;
    if (pathname.startsWith(`${listPath}/`)) {
      const entry = REPORTS.find((r) => r.id === detail.id);
      const cat = entry ? categoryById(entry.category) : undefined;
      return [
        root,
        ...(cat ? [{ label: cat.title, to: categoryHref(cat.id), collapsible: true }] : []),
        { label: entry?.title ?? detail.fallback, to: listPath },
      ];
    }
  }

  const report = findReport(pathname, search);
  if (!report) return null;
  const cat = categoryById(report.category);

  return [
    root,
    ...(cat ? [{ label: cat.title, to: categoryHref(cat.id), collapsible: true }] : []),
    { label: report.title },
  ];
}
