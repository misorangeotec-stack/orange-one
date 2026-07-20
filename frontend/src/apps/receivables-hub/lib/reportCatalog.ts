import {
  AlarmClock,
  BookOpen,
  Calculator,
  CalendarClock,
  Crown,
  FolderTree,
  Gauge,
  HandCoins,
  Layers,
  PackageX,
  Percent as PercentIcon,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
  Wallet,
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

export type ReportCategoryId =
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
}

export const REPORT_CATEGORIES: ReportCategory[] = [
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
  { id: "outstanding", category: "tally", title: "Outstanding" },
];

export const REPORTS: ReportEntry[] = [
  // ── Receivables ────────────────────────────────────────────────────────────
  {
    id: "aging",
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
    id: "group-summary",
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
    id: "ledger-outstanding",
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
