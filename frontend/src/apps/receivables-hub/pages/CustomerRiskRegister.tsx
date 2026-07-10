import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, type ReactNode, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search, Download, Save, ChevronRight, ChevronDown, ChevronUp, ArrowUpDown,
  ArrowUp, ArrowDown, RefreshCw, ShieldAlert, AlertTriangle,
  Columns3, Pin,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@hub/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipTrigger as UITooltipTrigger,
  TooltipProvider as UITooltipProvider,
} from "@hub/components/ui/tooltip";
import * as XLSX from "xlsx-js-style";
import { HEADER_STYLE, TOTAL_STYLE, GRAND_TOTAL_STYLE, styleRow } from "@hub/lib/xlsxStyle";
import { saveAs } from "file-saver";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData } from "@hub/lib/useAppData";
import { useHubBase } from "@hub/lib/sourceContext";
import { RiskLegendPopover } from "@hub/components/RiskLegendPopover";
import { SaleTypeMultiSelect } from "@hub/components/SaleTypeMultiSelect";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { CustomerCategoryMultiSelect, matchesCategory } from "@hub/components/CustomerCategoryMultiSelect";
import { RiskMultiSelect } from "@hub/components/RiskMultiSelect";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { GroupByBuilder, type GroupByPreset } from "@hub/components/GroupByBuilder";
import type { AgingBuckets, Customer, ConsolidatedCustomer, GroupedCustomer, ProposedCreditLimitReason, ProposedConstituent } from "@hub/lib/types";

/* ── Types ─────────────────────────────────────────────── */

type RiskCategory = "critical" | "high" | "medium" | "low";
type SortDir = "asc" | "desc" | null;

interface CustomerRow {
  id: string;
  name: string;
  salesPerson: string;
  salesPersons?: string[];
  /** Sales/finance tier: 'A' | 'B' | 'C' | 'D' | 'E' | 'AA'; '' when Uncategorized. */
  category: string;
  /** All unique categories (tiers) for this consolidated/group row. */
  categories?: string[];
  /** All companies this row spans (one entry = single company; >1 = "Multiple"). */
  companies?: string[];
  /** All locations this row spans (one entry = single location; >1 = "Multiple"). */
  locations?: string[];
  openingBalance: number;
  sales: number;
  receipts: number;
  creditNotes: number;
  debitNotes: number;
  journalAdjustments: number;
  checkReturns: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  creditPeriod: number;
  creditLimit: number;
  utilization: number;
  risk: RiskCategory;
  blocked: boolean;
  agingBuckets: AgingBuckets;
  proposedCreditLimit3M: number;
  proposedCreditLimit3MDeltaPct: number | null;
  proposedCreditLimitAI: number;
  proposedCreditLimitAIDeltaPct: number | null;
  proposedCreditLimitReason?: ProposedCreditLimitReason;
  proposedConstituents?: ProposedConstituent[];
  constituentIds?: string[];
  /** Set on group rows in "By Group" mode; when present and length > 1, the row is expandable. */
  childNames?: string[];
  /** Set on group rows; true if isGroup === true (more than one Tally child). */
  isGroup?: boolean;
}

type ViewMode = "customer" | "group";

import { fmtINRMoney, fmtINRDrCr } from "@hub/lib/utils";
import { sumOutstanding } from "@hub/lib/receivables";
import { matchesSearch } from "@/shared/lib/search";

const fmt = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

const riskStyle: Record<RiskCategory, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high: "bg-primary/15 text-primary border-primary/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

type SortKey = keyof CustomerRow;

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, "all"] as const;
type PageSize = number | "all";
const DEFAULT_PAGE_SIZE: PageSize = 50;
const PAGE_SIZE_STORAGE_KEY = "riskRegister.pageSize";

const fmtL = (n: number) => {
  if (n >= 100) return `₹${(n / 100).toFixed(2)} Cr`;
  return `₹${n.toFixed(2)} L`;
};

/** Inline ▲/▼ % badge for proposed-vs-current credit limit deltas. */
function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return null;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) {
    return <span className="ml-1 text-[10px] text-muted-foreground">±0%</span>;
  }
  const up = rounded > 0;
  return (
    <span className={`ml-1 text-[10px] font-medium ${up ? "text-emerald-600" : "text-destructive"}`}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{rounded.toFixed(1)}%
    </span>
  );
}

/* ── Plain-language helpers for the proposed-limit tooltips ─────────────────
 * Turn the stored ProposedCreditLimitReason (factors + raw strings) into
 * everyday wording a non-finance user can read. */

const numTrim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

/** A multiplier factor → a plain "+10%" / "−20%" / "no change" phrase. */
function factorPct(factor: number): string {
  const pct = Math.round((factor - 1) * 100);
  if (pct === 0) return "no change";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

/** Payment-discipline reason → plain sentence ("Payments are 87 days late"). */
function paymentPhrase(reason: ProposedCreditLimitReason): string {
  if (/clean/i.test(reason.paymentReason)) return "Payments are always on time";
  const m = reason.paymentReason.match(/(\d+)\s*days/);
  const days = m ? parseInt(m[1], 10) : null;
  if (days === null) return reason.paymentReason;
  if (days === 0) return "Payments are always on time";
  return reason.paymentFactor >= 1 ? `Payments are on time (${days} days)` : `Payments are ${days} days late`;
}

/** Overdue-exposure reason → plain sentence. */
function overduePhrase(reason: ProposedCreditLimitReason): string {
  const m = reason.overdueReason.match(/([\d.]+)%/);
  if (!m) return reason.overdueReason;
  const pct = Math.round(parseFloat(m[1]));
  if (pct >= 100) return "Overdue is more than their total sales";
  if (pct <= 10) return `Only ${pct}% of their sales are overdue`;
  return `${pct}% of their sales are still unpaid`;
}

/** Risk-band reason → "Risk level Medium". */
function riskPhrase(reason: ProposedCreditLimitReason): string {
  const word = reason.riskReason.replace(/\s*risk band\s*/i, "").trim();
  return `Risk level ${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** Headline verdict tag from the AI-vs-current delta. */
function verdictTag(deltaPct: number | null): { arrow: string; label: string; cls: string } {
  if (deltaPct === null || !isFinite(deltaPct)) return { arrow: "", label: "Suggested limit", cls: "text-muted-foreground" };
  if (deltaPct > 5)  return { arrow: "▲", label: "Raise limit",  cls: "text-emerald-600" };
  if (deltaPct < -5) return { arrow: "▼", label: "Reduce limit", cls: "text-destructive" };
  return { arrow: "=", label: "Hold limit", cls: "text-muted-foreground" };
}

/** "88% below their current ₹4 Cr limit" punchline. */
function deltaText(deltaPct: number | null, creditLimit: number): string | null {
  if (deltaPct === null || !isFinite(deltaPct)) return null;
  const abs = Math.abs(Math.round(deltaPct));
  if (abs === 0) return `same as their current ${fmt(creditLimit)} limit`;
  return `${abs}% ${deltaPct < 0 ? "below" : "above"} their current ${fmt(creditLimit)} limit`;
}

/** One short reason line for a single company account inside an aggregated tooltip
 *  (multi-company customers list one line each instead of the full working). */
function compactReason(reason: ProposedCreditLimitReason): string {
  if (reason.edgeCase === "dormant") return "No recent purchases — held at half its limit";
  const bits: string[] = [];
  if (reason.paymentFactor < 1) {
    const m = reason.paymentReason.match(/(\d+)\s*days/);
    bits.push(m ? `${m[1]} days late` : "late payments");
  } else if (reason.paymentFactor > 1) {
    bits.push("pays on time");
  }
  if (reason.riskFactor !== 1) {
    bits.push(`${reason.riskReason.replace(/\s*risk band\s*/i, "").trim().toLowerCase()} risk`);
  }
  if (reason.overdueFactor <= 0.5) bits.push("most sales unpaid");
  return bits.length ? `Cut for ${bits.join(", ")}` : "Within normal range";
}

/** One-line plain summary for a multi-company customer: the total IS the sum of
 *  each account's safe limit, plus the headline reason. */
function aggregateSummary(cs: ProposedConstituent[], total: number, deltaPct: number | null, creditLimit: number): string {
  const dormant = cs.filter((k) => k.reason.edgeCase === "dormant").length;
  const late = cs.filter((k) => k.reason.edgeCase !== "dormant" && k.reason.paymentFactor < 1).length;
  const risky = cs.filter((k) => k.reason.edgeCase !== "dormant" && k.reason.paymentFactor >= 1 && k.reason.riskFactor < 1).length;
  const reasons: string[] = [];
  if (dormant) reasons.push(`${dormant} ${dormant > 1 ? "have" : "has"} no recent purchases`);
  if (late) reasons.push(`${late} ${late > 1 ? "are" : "is"} paying late`);
  if (risky) reasons.push(`${risky} carr${risky > 1 ? "y" : "ies"} high risk`);
  const because = reasons.length ? ` Most are cut back because ${reasons.slice(0, 2).join(" and ")}.` : "";
  const dt = deltaText(deltaPct, creditLimit);
  return `${fmt(total)} is the safe limits of this customer's ${cs.length} company account${cs.length > 1 ? "s" : ""} added together${dt ? ` — ${dt}` : ""}.${because}`;
}

/** Plain step-by-step working that lands on the AI Proposed number.
 *  compact (used inside aggregated rows) drops the "Why this number" label and
 *  the bordered final line — the constituent header already shows the figure. */
function AIWorking({ reason, creditLimit, deltaPct, compact = false }: {
  reason: ProposedCreditLimitReason;
  creditLimit: number;
  deltaPct: number | null;
  compact?: boolean;
}) {
  const size = compact ? "text-[11px]" : "text-xs";

  if (reason.edgeCase === "dormant") {
    return (
      <div className={`${size} leading-relaxed break-words whitespace-normal`}>
        {!compact && <div className="text-muted-foreground mb-1">Why this number:</div>}
        No purchases in the last 3 months. We hold them at{" "}
        <span className="font-semibold">half their current limit (<span className="font-mono">{fmt(reason.final)}</span>)</span>{" "}
        as a safety limit until they start buying again.
      </div>
    );
  }

  const cut = (label: ReactNode, pct: string) => (
    <li className="flex items-start gap-1">
      <span className="break-words whitespace-normal min-w-0">{label}</span>
      <span className={`ml-auto pl-2 whitespace-nowrap font-medium ${pct === "no change" ? "text-muted-foreground" : pct.startsWith("+") ? "text-emerald-600" : "text-destructive"}`}>
        {pct === "no change" ? "no change" : `→ ${pct}`}
      </span>
    </li>
  );

  const floored = reason.finalBeforeRounding === reason.floor && reason.computed < reason.floor;
  const capped  = reason.finalBeforeRounding === reason.ceiling && reason.computed > reason.ceiling && !floored;
  const delta   = deltaText(deltaPct, creditLimit);

  return (
    <div className={`${size} leading-relaxed`}>
      {!compact && <div className="text-muted-foreground mb-1">Why this number:</div>}
      <div className="mb-1.5 break-words whitespace-normal">
        They buy about <span className="font-semibold font-mono">{fmt(reason.avg3MMonthlySales)}</span> a month.
        Allowing <span className="font-semibold">{numTrim(reason.cycleMultiplier)} months of cover</span> for their
        credit terms gives a starting limit of <span className="font-semibold font-mono">{fmt(reason.base)}</span>.
      </div>
      <ul className="space-y-0.5 mb-1">
        {reason.paymentFactor !== 1 && cut(paymentPhrase(reason), factorPct(reason.paymentFactor))}
        {reason.overdueFactor !== 1 && cut(overduePhrase(reason), factorPct(reason.overdueFactor))}
        {reason.riskFactor    !== 1 && cut(riskPhrase(reason),    factorPct(reason.riskFactor))}
      </ul>
      {floored && (
        <div className="mb-1 break-words whitespace-normal text-muted-foreground">
          This is below our minimum, so it is set to <span className="font-mono">{fmt(reason.floor)}</span>.
        </div>
      )}
      {capped && (
        <div className="mb-1 break-words whitespace-normal text-muted-foreground">
          This is above the allowed maximum, so it is capped at <span className="font-mono">{fmt(reason.ceiling)}</span>.
        </div>
      )}
      {!compact && (
        <div className="border-t border-border/60 pt-1 mt-1 font-semibold break-words whitespace-normal">
          Final safe limit: <span className="font-mono">{fmt(reason.final)}</span>
          {delta && <span className="font-normal text-muted-foreground"> — {delta}.</span>}
        </div>
      )}
    </div>
  );
}

const RISK_TAGLINE: Record<RiskCategory, string> = {
  critical: "highest risk",
  high: "needs attention",
  medium: "keep an eye on this",
  low: "healthy",
};

/** Plain per-cell tooltip for the Risk badge, using the customer's own numbers. */
function RiskReason({ row }: { row: CustomerRow }) {
  const usage = row.blocked
    ? "and their limit is blocked"
    : `and they're using ${row.utilization}% of their credit limit`;
  return (
    <div className="text-xs leading-relaxed break-words whitespace-normal space-y-1">
      <div className="font-semibold capitalize">
        {row.risk} — {RISK_TAGLINE[row.risk]}.
      </div>
      <div>
        Their oldest unpaid bill is <span className="font-semibold">{row.maxOverdueDays} days overdue</span> {usage}.
      </div>
      <div className="text-muted-foreground">
        We rate risk on whichever is worse: Critical = more than 180 days late OR over the limit.
      </div>
    </div>
  );
}

/** Tooltip body explaining the 3M Proposed credit limit — a plain-language note.
 *  For aggregated rows, lists the per-company contributions. */
function ThreeMProposedReason({ row }: { row: CustomerRow }) {
  const constituents = row.proposedConstituents ?? [];
  const reason = row.proposedCreditLimitReason;

  // Single-constituent
  if (constituents.length <= 1) {
    const avg = reason?.avg3MMonthlySales ?? 0;
    return (
      <div className="space-y-1">
        <div className="font-semibold">
          3M Proposed: <span className="font-mono">{fmt(row.proposedCreditLimit3M ?? 0)}</span>
          <DeltaBadge pct={row.proposedCreditLimit3MDeltaPct ?? null} />
        </div>
        <div className="border-t border-border/60 my-1" />
        {avg > 0 ? (
          <div className="text-xs leading-relaxed break-words whitespace-normal">
            A simple benchmark based only on how much they buy: average monthly
            purchases (<span className="font-mono font-semibold">{fmt(avg)}</span>/mo) × 3 months.
            It does not look at whether they pay on time — see <span className="font-medium">AI Proposed</span> for the risk-adjusted limit.
          </div>
        ) : (
          <div className="text-xs leading-relaxed text-muted-foreground break-words whitespace-normal">
            No purchases in the last 3 months, so the 3-month benchmark is ₹0.
          </div>
        )}
      </div>
    );
  }

  // Multi-constituent — group by company.
  const byCompany = new Map<string, ProposedConstituent[]>();
  for (const k of constituents) {
    if (!byCompany.has(k.company)) byCompany.set(k.company, []);
    byCompany.get(k.company)!.push(k);
  }

  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      <div>
        <div className="font-semibold">
          3M Proposed: <span className="font-mono">{fmt(row.proposedCreditLimit3M)}</span>
          <DeltaBadge pct={row.proposedCreditLimit3MDeltaPct ?? null} />
        </div>
        <div className="text-[11px] text-muted-foreground">
          A simple benchmark — average monthly purchases × 3 months. Total of {constituents.length} row{constituents.length !== 1 ? "s" : ""} across {byCompany.size} compan{byCompany.size !== 1 ? "ies" : "y"}.
        </div>
      </div>

      {Array.from(byCompany.entries()).map(([company, list]) => {
        const companySum = list.reduce((s, k) => s + k.proposed3M, 0);
        return (
          <div key={company} className="border-t border-border/60 pt-1.5">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                {company}
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                Σ <span className="font-mono">{fmt(companySum)}</span>
              </span>
            </div>
            {list.map((k, i) => (
              <div key={`${k.customerId}-${i}`} className={`flex items-baseline justify-between gap-2 ${i > 0 ? "mt-1" : ""}`}>
                <span className="text-[11px] text-foreground/90 break-words whitespace-normal min-w-0">
                  {k.customerName} <span className="text-muted-foreground">· {k.location}</span>
                </span>
                <span className="font-semibold whitespace-nowrap shrink-0">
                  <span className="font-mono">{fmt(k.proposed3M)}</span>
                  <DeltaBadge pct={k.delta3MPct} />
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Tooltip body explaining the AI Proposed credit limit in plain language, showing
 *  the full step-by-step working that lands on the number. For aggregated rows,
 *  groups constituents under company headers, each with its own working. */
function AIProposedReason({ row }: { row: CustomerRow }) {
  const [expanded, setExpanded] = useState(false);
  const constituents = row.proposedConstituents ?? [];
  const reason = row.proposedCreditLimitReason;

  // Single-constituent (or fallback)
  if (constituents.length <= 1) {
    if (!reason) {
      return (
        <div>
          <div className="font-semibold mb-1">
            AI Proposed: <span className="font-mono">{fmt(row.proposedCreditLimitAI ?? 0)}</span>
          </div>
          <div className="text-muted-foreground">Reasoning unavailable.</div>
        </div>
      );
    }
    const tag = verdictTag(row.proposedCreditLimitAIDeltaPct ?? null);
    return (
      <div className="space-y-1">
        <div className="font-semibold">
          AI Proposed: <span className="font-mono">{fmt(reason.final)}</span>
          {tag.arrow && <span className={`ml-2 ${tag.cls}`}>{tag.arrow} {tag.label}</span>}
        </div>
        <div className="border-t border-border/60 my-1" />
        <AIWorking reason={reason} creditLimit={row.creditLimit} deltaPct={row.proposedCreditLimitAIDeltaPct ?? null} />
      </div>
    );
  }

  // Multi-constituent — group by company, each with its own plain working.
  const byCompany = new Map<string, ProposedConstituent[]>();
  for (const k of constituents) {
    if (!byCompany.has(k.company)) byCompany.set(k.company, []);
    byCompany.get(k.company)!.push(k);
  }
  const tag = verdictTag(row.proposedCreditLimitAIDeltaPct ?? null);

  return (
    <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
      <div className="font-semibold">
        AI Proposed: <span className="font-mono">{fmt(row.proposedCreditLimitAI)}</span>
        {tag.arrow && <span className={`ml-2 ${tag.cls}`}>{tag.arrow} {tag.label}</span>}
      </div>

      {/* Short summary first — the total IS the sum of the account limits below. */}
      <div className="text-[11px] leading-relaxed text-muted-foreground break-words whitespace-normal">
        {aggregateSummary(constituents, row.proposedCreditLimitAI, row.proposedCreditLimitAIDeltaPct ?? null, row.creditLimit)}
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="text-[11px] font-medium text-primary hover:underline"
      >
        {expanded ? "Hide breakdown ▲" : `Show how it adds up (${constituents.length} accounts) ▾`}
      </button>

      {expanded && (
        <div className="space-y-1.5 pt-0.5">
          {Array.from(byCompany.entries()).map(([company, list]) => {
            const companySum = list.reduce((s, k) => s + k.proposedAI, 0);
            return (
              <div key={company} className="border-t border-border/60 pt-1.5">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                    {company}
                  </span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    Σ <span className="font-mono">{fmt(companySum)}</span>
                  </span>
                </div>
                {list.map((k, i) => (
                  <div key={`${k.customerId}-${i}`} className={i > 0 ? "mt-1.5" : ""}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-medium text-foreground/90 break-words whitespace-normal min-w-0">
                        {k.customerName} <span className="text-muted-foreground font-normal">· {k.location}</span>
                      </span>
                      <span className="font-semibold whitespace-nowrap shrink-0">
                        <span className="font-mono">{fmt(k.proposedAI)}</span>
                        <DeltaBadge pct={k.deltaPct} />
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground break-words whitespace-normal">
                      {compactReason(k.reason)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="flex items-baseline justify-between gap-2 border-t border-border/80 pt-1 font-semibold">
            <span>Total</span>
            <span className="font-mono">{fmt(row.proposedCreditLimitAI)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const trendTabs = [
  { key: "all",          label: "All",          color: "" },
  { key: "sales",        label: "Sales",        color: "hsl(var(--primary))" },
  { key: "receipts",     label: "Receipts",     color: "hsl(142, 71%, 45%)" },
  { key: "creditNotes",  label: "Credit Notes", color: "hsl(271, 75%, 58%)" },
  { key: "checkReturns", label: "Chq Returns",  color: "hsl(213, 94%, 52%)" },
  { key: "outstanding",  label: "Outstanding",  color: "hsl(var(--secondary))" },
  { key: "overdue",      label: "Overdue",      color: "hsl(var(--destructive))" },
] as const;

const trendAllLines = trendTabs.filter((t) => t.key !== "all");

function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

const columns: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name",           label: "Customer" },
  { key: "salesPerson",    label: "Sales Person" },
  { key: "companies",      label: "Company" },
  { key: "locations",      label: "Location" },
  { key: "openingBalance", label: "Opening Bal",   align: "right" },
  { key: "sales",          label: "Sales",         align: "right" },
  { key: "receipts",       label: "Receipts",      align: "right" },
  { key: "creditNotes",    label: "Cr. Notes",     align: "right" },
  { key: "debitNotes",     label: "Dr. Notes",     align: "right" },
  { key: "journalAdjustments", label: "Journal (Net)", align: "right" },
  { key: "outstanding",    label: "Outstanding",   align: "right" },
  { key: "overdue",        label: "Overdue",       align: "right" },
  { key: "maxOverdueDays", label: "Max OD Days",   align: "right" },
  { key: "creditPeriod",   label: "Credit Period", align: "right" },
  { key: "creditLimit",    label: "Credit Limit",  align: "right" },
  { key: "proposedCreditLimit3M", label: "3M Proposed", align: "right" },
  { key: "proposedCreditLimitAI", label: "AI Proposed", align: "right" },
  { key: "utilization",    label: "Util %",        align: "right" },
  { key: "risk",           label: "Risk" },
  { key: "blocked",        label: "Blocked" },
];

// Leading identity columns that can be frozen (Excel-style freeze panes). They are
// the leading block of `columns`, so any visible subset stays contiguous from the
// left edge — the user pins one via the 📌 in its header to set the freeze boundary.
const FREEZABLE_KEYS: SortKey[] = ["name", "salesPerson", "companies", "locations"];

const ALL_COL_KEYS = columns.map((c) => c.key);
// Columns hidden by default — user can opt-in via the column toggle.
const HIDDEN_BY_DEFAULT: SortKey[] = ["companies", "locations", "proposedCreditLimit3M", "proposedCreditLimitAI"];
const DEFAULT_VISIBLE_COL_KEYS = ALL_COL_KEYS.filter((k) => !HIDDEN_BY_DEFAULT.includes(k));
const COL_STORAGE_KEY = "riskRegister.visibleColumns";

/* ── Group-by dimensions (Aging-style multi-level roll-up) ───────────────────── */
type RDim = "customer" | "group" | "salesperson" | "category" | "company" | "location";
const R_DIMENSIONS: { key: RDim; label: string }[] = [
  { key: "customer",    label: "Customer" },
  { key: "group",       label: "Customer Group" },
  { key: "salesperson", label: "Salesperson" },
  { key: "category",    label: "Customer Category" },
  { key: "company",     label: "Company" },
  { key: "location",    label: "Location" },
];
// A dimension that is also a table column: when it is an active group-by level the
// export emits it as a dimension column, so the data column would just repeat it.
const DIM_COL: Partial<Record<RDim, SortKey>> = {
  customer: "name", salesperson: "salesPerson", company: "companies", location: "locations",
};
const R_PRESETS: GroupByPreset<RDim>[] = [
  { label: "Customer",                     dims: ["customer"] },
  { label: "Customer Group",               dims: ["group"] },
  { label: "Salesperson → Customer",       dims: ["salesperson", "customer"] },
  { label: "Customer Category → Customer", dims: ["category", "customer"] },
  { label: "Company → Customer",           dims: ["company", "customer"] },
  { label: "Salesperson",                  dims: ["salesperson"] },
  { label: "Customer Category",            dims: ["category"] },
];

/** A roll-up node: a leaf (one customer) or a group header with summed money columns. */
interface RNode { key: string; depth: number; label: string; header: CustomerRow; children: RNode[]; isLeaf: boolean; count: number; }
const RISK_ORDER: RiskCategory[] = ["critical", "high", "medium", "low"];

/** Single display value for a consolidated row on a dimension (multi-valued → "Multiple"). */
function rdimValue(r: CustomerRow, dim: RDim, nameToGroup: Record<string, string>): string {
  switch (dim) {
    case "customer": return r.name;
    case "group":    return nameToGroup[r.name] ?? r.name;
    case "salesperson": { const xs = r.salesPersons?.length ? r.salesPersons : (r.salesPerson ? [r.salesPerson] : []); return xs.length === 0 ? "Unassigned" : xs.length === 1 ? xs[0] : "Multiple"; }
    case "category":    { const xs = r.categories?.length ? r.categories : (r.category ? [r.category] : []); return xs.length === 0 ? "Uncategorized" : xs.length === 1 ? xs[0] : "Multiple"; }
    case "company":     { const xs = r.companies ?? []; return xs.length === 0 ? "—" : xs.length === 1 ? xs[0] : "Multiple"; }
    case "location":    { const xs = r.locations ?? []; return xs.length === 0 ? "—" : xs.length === 1 ? xs[0] : "Multiple"; }
  }
}

/* ── Component ─────────────────────────────────────────── */

export default function CustomerRiskRegister() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Party rows open the Customer/Group Detail page in a NEW tab so the filtered
  // Risk Register stays intact in the original tab (filters live in component
  // state and don't survive a same-tab Back navigation).
  // Keep drill-through inside the current set (default vs Live/Tally): rebase the app prefix.
  const hubBase = useHubBase();
  const openInNewTab = (path: string) =>
    window.open(path.replace(/^\/outstanding-dashboard/, hubBase), "_blank", "noopener,noreferrer");
  // Carry the active Sale Type filter into the Customer/Group Detail page so the
  // detail view opens pre-filtered to the same type(s) (it reads ?saleType).
  const withSaleType = (path: string) =>
    saleTypes.length > 0
      ? `${path}?saleType=${encodeURIComponent(saleTypes.join(","))}`
      : path;
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [riskLevels, setRiskLevels] = useState<string[]>([]);
  const [agingFilters, setAgingFilters] = useState<string[]>([]);
  const [specialFilter, setSpecialFilter] = useState("all");
  const [customerSegment, setCustomerSegment] = useState<"all" | "active" | "no_activity">("active");
  const [balanceFilter, setBalanceFilter] = useState<"all" | "has_outstanding" | "zero_outstanding">("all");
  const [blockedFilter, setBlockedFilter] = useState<"all" | "blocked" | "not_blocked">("all");
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<string[]>([]);
  const [companyFilters, setCompanyFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey | null>("outstanding");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(() => {
    try {
      const raw = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      if (raw) {
        if (raw === "all") return "all";
        const n = Number(raw);
        if (PAGE_SIZE_OPTIONS.includes(n as never)) return n;
      }
    } catch {}
    return DEFAULT_PAGE_SIZE;
  });

  useEffect(() => {
    try { localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize)); } catch {}
  }, [pageSize]);
  const [activeTrendKeys, setActiveTrendKeys] = useState<Set<string>>(new Set());
  const [showTrend, setShowTrend] = useState(false);
  // Aging-style group-by: an ordered list of dimensions rolled up with subtotals.
  // Legacy ?view=group deep-links open the one-level Customer-Group roll-up.
  const [groupBy, setGroupBy] = useState<RDim[]>(
    searchParams.get("view") === "group" ? ["group"] : ["customer"],
  );
  // Expanded roll-up nodes, keyed by node.key (any depth).
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [visibleCols, setVisibleCols] = useState<Set<SortKey>>(() => {
    try {
      const raw = localStorage.getItem(COL_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as SortKey[];
        const valid = arr.filter((k) => ALL_COL_KEYS.includes(k));
        if (valid.length > 0) return new Set(valid);
      }
    } catch {}
    return new Set(DEFAULT_VISIBLE_COL_KEYS);
  });

  useEffect(() => {
    try { localStorage.setItem(COL_STORAGE_KEY, JSON.stringify([...visibleCols])); } catch {}
  }, [visibleCols]);

  const toggleCol = (key: SortKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // ── Frozen columns (Excel-style freeze panes) ────────────────────────────────
  // Freeze from the left edge through `freezeKey` (one of the leading identity
  // columns). Default = Customer name. Each frozen cell is position:sticky with a
  // cumulative left offset and an OPAQUE background; the boundary column carries an
  // edge shadow. Mirrors the Salesperson Collection Report, generalised for this
  // table's user-configurable columns.
  const [freezeKey, setFreezeKey] = useState<SortKey | null>("name");
  const headRefs = useRef<Map<SortKey, HTMLTableCellElement | null>>(new Map());
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const measureCols = useCallback(() => {
    setColWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of FREEZABLE_KEYS) {
        const el = headRefs.current.get(key);
        if (el) {
          const w = el.offsetWidth;
          if (next[key] !== w) { next[key] = w; changed = true; }
        }
      }
      return changed ? next : prev;
    });
  }, []);
  useLayoutEffect(measureCols); // re-measure after every render; setState is guarded so it can't loop
  useEffect(() => {
    window.addEventListener("resize", measureCols);
    return () => window.removeEventListener("resize", measureCols);
  }, [measureCols]);

  const { loading, error, customers, allCustomers, consolidatedCustomers, groupedCustomers, customerDetail, salesPersonOptions } = useAppData({
    saleType: saleTypes.length === 0 ? "all" : saleTypes.join(","),
    customerSegment,
    balanceFilter,
    salesPerson: salesPersons.length === 0 ? "all" : salesPersons.join(","),
    company:  companyFilters.length  === 0 ? undefined : companyFilters.join(","),
    location: locationFilters.length === 0 ? undefined : locationFilters.join(","),
  });
  // Leaves are always the consolidated (per-name) customers; the group-by builder
  // rolls them up into headers. (The precomputed groupedCustomers are used only to
  // derive the customer-name → customer-group mapping for the "group" dimension.)
  const allData: CustomerRow[] = consolidatedCustomers as CustomerRow[];
  const nameToGroup = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of groupedCustomers as GroupedCustomer[]) {
      if ((g.isGroup ?? (g.childNames?.length ?? 0) > 1) && g.childNames) {
        for (const n of g.childNames) m[n] = g.name;
      }
    }
    return m;
  }, [groupedCustomers]);

  // Company / Location filter options — dependent (each list narrows by the other
  // selection) and sourced from the unfiltered, salesperson-scoped customer set so
  // the options stay stable as the numeric/segment filters change.
  const companyOptions = useMemo(
    () => [...new Set(
      allCustomers
        .filter((c) => locationFilters.length === 0 || locationFilters.includes(c.location))
        .map((c) => c.company),
    )].sort(),
    [allCustomers, locationFilters],
  );
  const locationOptions = useMemo(
    () => [...new Set(
      allCustomers
        .filter((c) => companyFilters.length === 0 || companyFilters.includes(c.company))
        .map((c) => c.location),
    )].sort(),
    [allCustomers, companyFilters],
  );

  // Lookup of consolidated customer rows by Tally name (for rendering child rows
  // under each expanded group).
  const customerByName = useMemo(() => {
    const m = new Map<string, ConsolidatedCustomer>();
    for (const c of consolidatedCustomers) m.set(c.name, c);
    return m;
  }, [consolidatedCustomers]);

  // Per-ledger expansion for group children. A customer that trades under more
  // than one company/location is ONE consolidated row but several Tally ledgers;
  // under a group we show each ledger as its own row (matching the Aging Report),
  // so a 2-company customer contributes 2 rows, not 1.
  const projectedById = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  const ledgerRowsOf = (child: CustomerRow): CustomerRow[] => {
    const ids = child.constituentIds ?? [];
    if (ids.length <= 1) return [child];
    const ledgers = ids
      .map((id) => projectedById.get(id))
      .filter((c): c is Customer => !!c)
      .map((c): CustomerRow => ({
        ...c,
        companies:      [c.company],
        locations:      [c.location],
        salesPersons:   c.salesPerson ? [c.salesPerson] : [],
        categories:     c.category ? [c.category] : [],
        constituentIds: [c.id],
      }))
      .sort((a, b) => b.outstanding - a.outstanding);
    // Fall back to the consolidated child if its ledgers aren't in the current
    // (company/location-filtered) set — never collapse to nothing.
    return ledgers.length > 1 ? ledgers : [child];
  };

  // Persist the legacy ?view=group flag (one-level Customer-Group roll-up) and reset
  // expansion whenever the roll-up shape changes.
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (groupBy.length === 1 && groupBy[0] === "group") params.set("view", "group");
    else                                                params.delete("view");
    setSearchParams(params, { replace: true });
    setExpandedGroups(new Set());
  }, [groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize filters from URL query params
  useEffect(() => {
    const riskParam     = searchParams.get("risk");
    const agingParam    = searchParams.get("aging");

    const filterParam   = searchParams.get("filter");
    const segmentParam  = searchParams.get("segment");
    if (riskParam)     setRiskLevels(riskParam.toLowerCase().split(",").filter(Boolean));
    if (agingParam)    setAgingFilters(agingParam.split(",").filter((a) => a !== "all").filter(Boolean));

    if (filterParam)   setSpecialFilter(filterParam);
    if (segmentParam === "all" || segmentParam === "active" || segmentParam === "no_activity") setCustomerSegment(segmentParam);
    const blockedParam = searchParams.get("blocked");
    if (blockedParam === "1" || blockedParam === "true") setBlockedFilter("blocked");
  }, [searchParams]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      if (sortDir === "desc") setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const activeFilterCount = [specialFilter, customerSegment, balanceFilter, blockedFilter].filter((f) => f !== "all").length + (search ? 1 : 0) + (riskLevels.length > 0 ? 1 : 0) + (agingFilters.length > 0 ? 1 : 0) + (saleTypes.length > 0 ? 1 : 0) + (salesPersons.length > 0 ? 1 : 0) + (categories.length > 0 ? 1 : 0) + (companyFilters.length > 0 ? 1 : 0) + (locationFilters.length > 0 ? 1 : 0);

  const clearFilters = () => {
    setSearch("");
    setRiskLevels([]);
    setAgingFilters([]);
    setSpecialFilter("all");
    setCustomerSegment("all");
    setBalanceFilter("all");
    setBlockedFilter("all");
    setSalesPersons([]);
    setCategories([]);
    setSaleTypes([]);
    setCompanyFilters([]);
    setLocationFilters([]);
  };

  const filterChips: FilterChip[] = [
    search && {
      label: `Search: "${search}"`,
      onRemove: () => setSearch(""),
    },
    riskLevels.length > 0 && {
      label: `Risk: ${riskLevels.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(", ")}`,
      onRemove: () => setRiskLevels([]),
    },
    agingFilters.length > 0 && {
      label: agingFilters.length <= 2 ? `Aging: ${agingFilters.join(", ")} days` : `Aging: ${agingFilters.length} buckets`,
      onRemove: () => setAgingFilters([]),
    },
    specialFilter !== "all" && {
      label: specialFilter === "over_credit_limit" ? "Over Credit Limit" : specialFilter,
      onRemove: () => setSpecialFilter("all"),
    },
    customerSegment !== "all" && {
      label: `Segment: ${customerSegment === "active" ? "Active" : "No Activity"}`,
      onRemove: () => setCustomerSegment("all"),
    },
    balanceFilter !== "all" && {
      label: `Balance: ${balanceFilter === "has_outstanding" ? "Has Outstanding" : "Zero Outstanding"}`,
      onRemove: () => setBalanceFilter("all"),
    },
    blockedFilter !== "all" && {
      label: blockedFilter === "blocked" ? "Blocked" : "Not Blocked",
      onRemove: () => setBlockedFilter("all"),
    },
    salesPersons.length > 0 && {
      label: salesPersons.length <= 2 ? `Sales: ${salesPersons.join(", ")}` : `Sales: ${salesPersons.length} persons`,
      onRemove: () => setSalesPersons([]),
    },
    categories.length > 0 && {
      label: categories.length <= 3 ? `Category: ${categories.join(", ")}` : `Category: ${categories.length} selected`,
      onRemove: () => setCategories([]),
    },
    saleTypes.length > 0 && {
      label: saleTypes.length <= 2 ? `Type: ${saleTypes.join(", ")}` : `Types: ${saleTypes.length} selected`,
      onRemove: () => setSaleTypes([]),
    },
    companyFilters.length > 0 && {
      label: companyFilters.length <= 2 ? `Company: ${companyFilters.join(", ")}` : `Company: ${companyFilters.length} selected`,
      onRemove: () => setCompanyFilters([]),
    },
    locationFilters.length > 0 && {
      label: locationFilters.length <= 2 ? `Location: ${locationFilters.join(", ")}` : `Location: ${locationFilters.length} selected`,
      onRemove: () => setLocationFilters([]),
    },
  ].filter(Boolean) as FilterChip[];

  // Customer-level filter predicate. A group is flagged "blocked" / matching
  // an aging bucket / etc. if *any* of its constituents is — so when filters
  // are applied we re-check each constituent against the same predicate to
  // decide what's actually visible inside the group.
  const childPassesFilters = useMemo(() => {
    const bkMap: Record<string, keyof AgingBuckets> = {
      "0-30": "0_30", "31-60": "31_60", "61-90": "61_90",
      "91-120": "91_120", "121-180": "121_180", "180+": "180_plus",
    };
    const agingBks = agingFilters.map((a) => bkMap[a]).filter(Boolean) as (keyof AgingBuckets)[];
    return (r: CustomerRow): boolean => {
      if (search && !matchesSearch(search, r.name, r.id)) return false;
      if (riskLevels.length > 0 && !riskLevels.includes(r.risk)) return false;
      if (agingBks.length > 0 && !agingBks.some((bk) => (r.agingBuckets?.[bk] ?? 0) > 0)) return false;
      if (specialFilter === "over_credit_limit" && !(r.utilization > 100)) return false;
      if (blockedFilter === "blocked" && r.blocked !== true) return false;
      if (blockedFilter === "not_blocked" && r.blocked === true) return false;
      if (!matchesCategory(r, categories)) return false;
      return true;
    };
  }, [search, riskLevels, agingFilters, specialFilter, blockedFilter, categories]);

  const rows = useMemo(() => {
    let d = [...allData];
    // Active aging bucket (if any) — drives both the bucket filter below and the
    // overdue sort, so the Overdue column sorts by the SAME value it displays.
    const bkMap: Record<string, keyof AgingBuckets> = {
      "0-30": "0_30", "31-60": "31_60", "61-90": "61_90",
      "91-120": "91_120", "121-180": "121_180", "180+": "180_plus",
    };
    const bucketKeys: (keyof AgingBuckets)[] =
      agingFilters.map((a) => bkMap[a]).filter(Boolean) as (keyof AgingBuckets)[];
    if (search) {
      d = d.filter((r) => matchesSearch(search, r.name, r.id));
    }
    if (riskLevels.length > 0) {
      d = d.filter((r) => riskLevels.includes(r.risk));
    }
    if (bucketKeys.length > 0) {
      d = d.filter((r) => bucketKeys.some((bk) => (r.agingBuckets?.[bk] ?? 0) > 0));
    }
    if (specialFilter === "over_credit_limit") {
      d = d.filter((r) => r.utilization > 100);
    }
    if (blockedFilter === "blocked") {
      d = d.filter((r) => r.blocked === true);
    } else if (blockedFilter === "not_blocked") {
      d = d.filter((r) => r.blocked !== true);
    }
    if (categories.length > 0) {
      d = d.filter((r) => matchesCategory(r, categories));
    }
    if (sortKey && sortDir) {
      // For the Overdue column, sort by the value actually shown: the selected
      // aging bucket's amount when a bucket filter is active, else total overdue.
      const valueFor = (r: CustomerRow) =>
        sortKey === "overdue" && bucketKeys.length > 0
          ? bucketKeys.reduce((s, bk) => s + (r.agingBuckets?.[bk] ?? 0), 0)
          : r[sortKey];
      d.sort((a, b) => {
        const av = valueFor(a);
        const bv = valueFor(b);
        if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return d;
  }, [allData, search, riskLevels, agingFilters, specialFilter, blockedFilter, categories, sortKey, sortDir]);

  // When an aging bucket filter is active, sum only that specific bucket's overdue
  // rather than the customer's total overdue — otherwise customers with e.g. 180+ day
  // invoices also bring in their 0–30 day overdue amounts, overstating the figure.
  const agingBucketKeys: (keyof AgingBuckets)[] = useMemo(() => {
    const map: Record<string, keyof AgingBuckets> = {
      "0-30":    "0_30",
      "31-60":   "31_60",
      "61-90":   "61_90",
      "91-120":  "91_120",
      "121-180": "121_180",
      "180+":    "180_plus",
    };
    return agingFilters.map((a) => map[a]).filter(Boolean) as (keyof AgingBuckets)[];
  }, [agingFilters]);

  // Overdue shown per row: the sum of the selected buckets' amounts when an aging
  // filter is active, else the customer's total overdue. Keeps the column
  // consistent with the bucket-aware KPI total and the customer-detail aging
  // breakdown.
  const overdueForRow = (r: CustomerRow) =>
    agingBucketKeys.length > 0
      ? agingBucketKeys.reduce((s, bk) => s + (r.agingBuckets?.[bk] ?? 0), 0)
      : r.overdue;

  // Collapse a multi-value company/location list to a single display label,
  // matching the group view's convention (single value, else "Multiple").
  const showList = (xs?: string[]) => (!xs?.length ? "—" : xs.length === 1 ? xs[0] : "Multiple");

  // Visible columns in render order — also the basis for the freeze-pane offsets.
  const visibleColumnList = useMemo(() => columns.filter((c) => visibleCols.has(c.key)), [visibleCols]);
  const freezeIndex = freezeKey ? visibleColumnList.findIndex((c) => c.key === freezeKey) : -1;

  type FreezeStick = { className: string; style?: CSSProperties };
  /** Cumulative left offset (px) of a column = total width of the visible columns before it. */
  const leftOf = (key: SortKey): number => {
    const i = visibleColumnList.findIndex((c) => c.key === key);
    let left = 0;
    for (let j = 0; j < i; j++) left += colWidths[visibleColumnList[j].key] ?? 0;
    return left;
  };
  /** Sticky props for a leading column cell, or empty when it isn't frozen.
   *  `bg` is the OPAQUE background to use (defaults: header → muted, body → surface). */
  const freezeStick = (key: SortKey, opts?: { header?: boolean; bg?: string }): FreezeStick => {
    const i = visibleColumnList.findIndex((c) => c.key === key);
    if (i < 0 || freezeIndex < 0 || i > freezeIndex) return { className: "" };
    const bg = opts?.bg ?? (opts?.header ? "bg-muted" : "bg-surface");
    const boundary = i === freezeIndex;
    const shadow = boundary ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" : "";
    return { className: `sticky ${opts?.header ? "z-20" : "z-10"} ${bg} ${shadow}`, style: { left: leftOf(key) } };
  };
  /** Click a column's pin → freeze through it; click the current boundary → step back one. */
  const handlePin = (key: SortKey) => {
    const i = visibleColumnList.findIndex((c) => c.key === key);
    if (freezeKey === key) setFreezeKey(i > 0 ? visibleColumnList[i - 1].key : null);
    else                   setFreezeKey(key);
  };
  /** Pin button shown in a freezable header. */
  const freezePin = (key: SortKey) => {
    const i = visibleColumnList.findIndex((c) => c.key === key);
    const active = freezeIndex >= 0 && i >= 0 && i <= freezeIndex;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handlePin(key); }}
        className={`ml-1 inline-flex items-center justify-center h-4 w-4 rounded shrink-0 ${active ? "text-primary" : "text-foreground/35 hover:text-foreground/70"}`}
        title={active ? "Unfreeze from here" : "Freeze columns up to here"}
      >
        <Pin className={`h-3 w-3 ${active ? "fill-primary" : ""}`} />
      </button>
    );
  };

  const totals = useMemo(() => ({
    openingBalance:    rows.reduce((s, r) => s + (r.openingBalance ?? 0), 0),
    sales:             rows.reduce((s, r) => s + r.sales, 0),
    receipts:          rows.reduce((s, r) => s + r.receipts, 0),
    creditNotes:       rows.reduce((s, r) => s + r.creditNotes, 0),
    debitNotes:        rows.reduce((s, r) => s + (r.debitNotes ?? 0), 0),
    journalAdjustments: rows.reduce((s, r) => s + (r.journalAdjustments ?? 0), 0),
    checkReturns:      rows.reduce((s, r) => s + (r.checkReturns ?? 0), 0),
    outstanding:       sumOutstanding(rows),
    overdue:           agingBucketKeys.length > 0
                         ? rows.reduce((s, r) => s + agingBucketKeys.reduce((t, bk) => t + (r.agingBuckets?.[bk] ?? 0), 0), 0)
                         : rows.reduce((s, r) => s + r.overdue, 0),
    creditLimit:       rows.reduce((s, r) => s + (r.creditLimit ?? 0), 0),
    proposedCreditLimit3M: rows.reduce((s, r) => s + (r.proposedCreditLimit3M ?? 0), 0),
    proposedCreditLimitAI: rows.reduce((s, r) => s + (r.proposedCreditLimitAI ?? 0), 0),
    count:             rows.length,
    criticalCustomers: rows.filter((r) => r.risk === "critical").length,
    overCreditLimit:   rows.filter((r) => r.utilization > 100).length,
    overdue180Plus:    rows.filter((r) => r.maxOverdueDays > 180).length,
  }), [rows, agingBucketKeys]);

  const aggregatedTrend = useMemo(() => {
    if (rows.length === 0 || rows.length >= 10) return [];
    const byMonth = new Map<string, {
      month: string; sales: number; receipts: number;
      creditNotes: number; checkReturns: number;
      outstanding: number; overdue: number;
    }>();
    for (const row of rows) {
      const ids = (row as unknown as ConsolidatedCustomer).constituentIds ?? [row.id];
      for (const id of ids) {
        for (const t of customerDetail[id]?.trend ?? []) {
          if (!byMonth.has(t.month)) {
            byMonth.set(t.month, { ...t, checkReturns: (t as any).checkReturns ?? 0 });
          } else {
            const m = byMonth.get(t.month)!;
            m.sales         += t.sales;
            m.receipts      += t.receipts;
            m.creditNotes   += t.creditNotes;
            m.checkReturns  += (t as any).checkReturns ?? 0;
            m.outstanding   += t.outstanding;
            m.overdue       += t.overdue;
          }
        }
      }
    }
    // Sort chronologically by calendar order (handles cross-FY ranges, e.g.
    // Jan-26/Feb-26/Mar-26 in FY 25-26 followed by Apr-26 in FY 26-27).
    const calMonth = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return [...byMonth.values()].sort((a, b) => {
      const [am, ay] = [a.month.slice(0, 3), a.month.slice(4)];
      const [bm, by_] = [b.month.slice(0, 3), b.month.slice(4)];
      if (ay !== by_) return Number(ay) - Number(by_);
      return calMonth.indexOf(am) - calMonth.indexOf(bm);
    });
  }, [rows, customerDetail]);

  const activeLines = activeTrendKeys.size === 0
    ? trendAllLines
    : trendAllLines.filter((t) => activeTrendKeys.has(t.key));

  // ── Group-by roll-up (Aging-style, N levels) ────────────────────────────────
  // Leaves are the filtered+sorted consolidated customers (`rows`); internal nodes are
  // group headers whose money columns are SUBTOTALS of their members. Non-additive
  // columns (Util %, Credit Period, Blocked) are blanked at headers; Risk shows the
  // worst-case band, Max OD the largest. A terminal non-customer dimension (e.g. group
  // by Salesperson only) yields header rows with no children — exactly like the Aging Report.
  const groupTree = useMemo<RNode[]>(() => {
    const uniqStr = (xss: string[][]) => [...new Set(xss.flat().filter(Boolean))];
    const aggregate = (rs: CustomerRow[], key: string, label: string): CustomerRow => {
      const sum = (f: keyof CustomerRow) => rs.reduce((s, r) => s + (Number(r[f]) || 0), 0);
      const buckets: AgingBuckets = { "0_30": 0, "31_60": 0, "61_90": 0, "91_120": 0, "121_180": 0, "180_plus": 0 };
      for (const r of rs) for (const k of Object.keys(buckets) as (keyof AgingBuckets)[]) buckets[k] += r.agingBuckets?.[k] ?? 0;
      const worst = RISK_ORDER.find((lv) => rs.some((r) => r.risk === lv)) ?? "low";
      return {
        id: `__grp__${key}`,
        name: label,
        salesPerson: "",
        salesPersons: uniqStr(rs.map((r) => r.salesPersons ?? (r.salesPerson ? [r.salesPerson] : []))),
        category: "",
        categories: uniqStr(rs.map((r) => r.categories ?? (r.category ? [r.category] : []))),
        companies: uniqStr(rs.map((r) => r.companies ?? [])),
        locations: uniqStr(rs.map((r) => r.locations ?? [])),
        openingBalance: sum("openingBalance"),
        sales: sum("sales"),
        receipts: sum("receipts"),
        creditNotes: sum("creditNotes"),
        debitNotes: sum("debitNotes"),
        journalAdjustments: sum("journalAdjustments"),
        checkReturns: sum("checkReturns"),
        outstanding: sumOutstanding(rs),
        overdue: rs.reduce((s, r) => s + overdueForRow(r), 0),
        maxOverdueDays: rs.reduce((m, r) => Math.max(m, r.maxOverdueDays), 0),
        creditPeriod: 0,
        creditLimit: sum("creditLimit"),
        utilization: 0,
        risk: worst,
        blocked: false,
        agingBuckets: buckets,
        proposedCreditLimit3M: sum("proposedCreditLimit3M"),
        proposedCreditLimit3MDeltaPct: null,
        proposedCreditLimitAI: sum("proposedCreditLimitAI"),
        proposedCreditLimitAIDeltaPct: null,
        constituentIds: rs.flatMap((r) => r.constituentIds ?? [r.id]),
      } as CustomerRow;
    };
    const valueFor = (r: CustomerRow): number | string =>
      sortKey === "overdue" && agingBucketKeys.length > 0
        ? agingBucketKeys.reduce((s, bk) => s + (r.agingBuckets?.[bk] ?? 0), 0)
        : (r[(sortKey ?? "name") as keyof CustomerRow] as number | string);
    const cmp = (a: CustomerRow, b: CustomerRow): number => {
      if (!sortKey || !sortDir) return 0;
      const av = valueFor(a), bv = valueFor(b);
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    };
    const build = (rs: CustomerRow[], dims: RDim[], depth: number, prefix: string): RNode[] => {
      if (dims.length === 0) return [];
      const dim = dims[0];
      const rest = dims.slice(1);
      if (dim === "customer") {
        return rs.map((r) => ({ key: `${prefix}/c:${r.id}`, depth, label: r.name, header: r, children: [], isLeaf: true, count: 1 }));
      }
      const order: string[] = [];
      const buckets = new Map<string, CustomerRow[]>();
      for (const r of rs) {
        const v = rdimValue(r, dim, nameToGroup);
        let arr = buckets.get(v);
        if (!arr) { arr = []; buckets.set(v, arr); order.push(v); }
        arr.push(r);
      }
      const nodes = order.map((v): RNode => {
        const brs = buckets.get(v)!;
        const key = `${prefix}/${dim}:${v}`;
        return { key, depth, label: v, header: aggregate(brs, key, v), children: rest.length ? build(brs, rest, depth + 1, key) : [], isLeaf: false, count: brs.length };
      });
      nodes.sort((a, b) => cmp(a.header, b.header));
      return nodes;
    };
    return build(rows, groupBy, 0, "");
  }, [rows, groupBy, nameToGroup, sortKey, sortDir, agingBucketKeys]);

  // Reset to page 1 whenever filters, sort, page size, or grouping changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, riskLevels, agingFilters, blockedFilter, companyFilters, locationFilters, sortKey, sortDir, groupBy, pageSize]);

  // Pagination applies to TOP-LEVEL roll-up nodes.
  const effectivePageSize = pageSize === "all" ? Math.max(groupTree.length, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(groupTree.length / effectivePageSize));
  const paginatedNodes = pageSize === "all"
    ? groupTree
    : groupTree.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);
  const rangeStart = groupTree.length === 0 ? 0 : (currentPage - 1) * effectivePageSize + 1;
  const rangeEnd = Math.min(currentPage * effectivePageSize, groupTree.length);
  // Noun for the top-level row count (the first group-by dimension, e.g. "salesperson").
  const groupByNoun = (R_DIMENSIONS.find((x) => x.key === groupBy[0])?.label ?? "row").toLowerCase();

  /** One table row for a customer (leaf) or a group header. Header rows blank the
   *  non-additive columns (Util %, Credit Period, Blocked) and drop the per-row
   *  tooltips; Risk shows the worst-case band. */
  const renderRow = (
    r: CustomerRow,
    opts: { key: string; depth: number; isHeader?: boolean; onClick?: () => void; leadCell: ReactNode },
  ): ReactNode => {
    const isHeader = !!opts.isHeader;
    const bg = "bg-surface group-hover:bg-[hsl(var(--muted))]";
    const tint = isHeader ? (opts.depth === 0 ? "" : "bg-muted/20") : (opts.depth > 0 ? "bg-muted/10" : "");
    return (
      <TableRow key={opts.key} className={`group hover:bg-muted/30 transition-colors ${opts.onClick ? "cursor-pointer" : ""} ${tint}`} onClick={opts.onClick}>
        {visibleCols.has("name") && (() => { const f = freezeStick("name", { bg }); return (
          <TableCell style={f.style} className={`font-medium text-sm whitespace-nowrap ${f.className}`}>{opts.leadCell}</TableCell>
        ); })()}
        {visibleCols.has("salesPerson") && (() => { const f = freezeStick("salesPerson", { bg }); return (
          <TableCell style={f.style} className={`text-sm whitespace-nowrap ${f.className}`}>{r.salesPersons?.length ? (r.salesPersons.length === 1 ? r.salesPersons[0] : "Multiple") : r.salesPerson}</TableCell>
        ); })()}
        {visibleCols.has("companies") && (() => { const f = freezeStick("companies", { bg }); return (
          <TableCell style={f.style} className={`text-sm whitespace-nowrap ${f.className}`} title={r.companies?.join(", ")}>{showList(r.companies)}</TableCell>
        ); })()}
        {visibleCols.has("locations") && (() => { const f = freezeStick("locations", { bg }); return (
          <TableCell style={f.style} className={`text-sm whitespace-nowrap ${f.className}`} title={r.locations?.join(", ")}>{showList(r.locations)}</TableCell>
        ); })()}
        {visibleCols.has("openingBalance") && <TableCell className="text-sm text-right font-mono">{fmt(r.openingBalance)}</TableCell>}
        {visibleCols.has("sales") && <TableCell className="text-sm text-right font-mono">{fmt(r.sales)}</TableCell>}
        {visibleCols.has("receipts") && <TableCell className="text-sm text-right font-mono">{fmt(r.receipts)}</TableCell>}
        {visibleCols.has("creditNotes") && <TableCell className="text-sm text-right font-mono">{fmt(r.creditNotes)}</TableCell>}
        {visibleCols.has("debitNotes") && <TableCell className="text-sm text-right font-mono">{fmtINRMoney(r.debitNotes ?? 0)}</TableCell>}
        {visibleCols.has("journalAdjustments") && (
          <TableCell className={`text-sm text-right font-mono ${(r.journalAdjustments ?? 0) > 0 ? "text-destructive" : (r.journalAdjustments ?? 0) < 0 ? "text-emerald-700" : ""}`}>{fmtINRDrCr(r.journalAdjustments ?? 0)}</TableCell>
        )}
        {visibleCols.has("outstanding") && (
          <TableCell className={`text-sm text-right font-mono font-semibold ${r.outstanding < 0 ? "text-emerald-600" : ""}`}>
            {fmt(Math.abs(r.outstanding))}{r.outstanding < 0 && <span className="text-[10px] font-normal ml-0.5">(Cr)</span>}
          </TableCell>
        )}
        {visibleCols.has("overdue") && (
          <TableCell className={`text-sm text-right font-mono ${overdueForRow(r) > 0 ? "text-destructive font-semibold" : ""}`}>{fmt(overdueForRow(r))}</TableCell>
        )}
        {visibleCols.has("maxOverdueDays") && (
          <TableCell className={`text-sm text-right font-mono ${r.maxOverdueDays > 180 ? "text-destructive font-semibold" : r.maxOverdueDays > 90 ? "text-primary font-semibold" : ""}`}>{r.maxOverdueDays}</TableCell>
        )}
        {visibleCols.has("creditPeriod") && <TableCell className="text-sm text-right">{isHeader ? "" : `${r.creditPeriod}d`}</TableCell>}
        {visibleCols.has("creditLimit") && <TableCell className="text-sm text-right font-mono">{fmt(r.creditLimit)}</TableCell>}
        {visibleCols.has("proposedCreditLimit3M") && (
          <TableCell className="text-sm text-right font-mono whitespace-nowrap">
            {isHeader ? fmt(r.proposedCreditLimit3M ?? 0) : (
              <UITooltip delayDuration={150}>
                <UITooltipTrigger asChild>
                  <span className="inline-flex items-center cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2" onClick={(e) => e.stopPropagation()}>
                    {fmt(r.proposedCreditLimit3M ?? 0)}
                    <DeltaBadge pct={r.proposedCreditLimit3MDeltaPct ?? null} />
                  </span>
                </UITooltipTrigger>
                <UITooltipContent side="left" className="w-[22rem] max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed whitespace-normal break-words" onClick={(e) => e.stopPropagation()}>
                  <ThreeMProposedReason row={r} />
                </UITooltipContent>
              </UITooltip>
            )}
          </TableCell>
        )}
        {visibleCols.has("proposedCreditLimitAI") && (
          <TableCell className="text-sm text-right font-mono whitespace-nowrap">
            {isHeader ? fmt(r.proposedCreditLimitAI ?? 0) : (
              <UITooltip delayDuration={150}>
                <UITooltipTrigger asChild>
                  <span className="inline-flex items-center cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2" onClick={(e) => e.stopPropagation()}>
                    {fmt(r.proposedCreditLimitAI ?? 0)}
                    <DeltaBadge pct={r.proposedCreditLimitAIDeltaPct ?? null} />
                  </span>
                </UITooltipTrigger>
                <UITooltipContent side="left" className="w-[22rem] max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed whitespace-normal break-words" onClick={(e) => e.stopPropagation()}>
                  <AIProposedReason row={r} />
                </UITooltipContent>
              </UITooltip>
            )}
          </TableCell>
        )}
        {visibleCols.has("utilization") && (
          <TableCell className={`text-sm text-right font-mono font-semibold ${isHeader ? "text-muted-foreground" : r.blocked ? "text-muted-foreground" : r.utilization > 100 ? "text-destructive" : r.utilization > 80 ? "text-primary" : ""}`}>
            {isHeader ? "—" : r.blocked ? "—" : `${r.utilization}%`}
          </TableCell>
        )}
        {visibleCols.has("risk") && (
          <TableCell>
            {isHeader ? (
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${riskStyle[r.risk]}`} title="Worst risk band in this group">{r.risk}</Badge>
            ) : (
              <UITooltip delayDuration={150}>
                <UITooltipTrigger asChild>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-button capitalize cursor-help ${riskStyle[r.risk]}`} onClick={(e) => e.stopPropagation()}>{r.risk}</Badge>
                </UITooltipTrigger>
                <UITooltipContent side="left" className="w-[20rem] max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed whitespace-normal break-words" onClick={(e) => e.stopPropagation()}>
                  <RiskReason row={r} />
                </UITooltipContent>
              </UITooltip>
            )}
          </TableCell>
        )}
        {visibleCols.has("blocked") && (
          <TableCell>
            {isHeader ? <span className="text-[10px] text-muted-foreground">—</span> : r.blocked ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-destructive/15 text-destructive border-destructive/30">Blocked</Badge>
            ) : (
              <span className="text-[10px] text-muted-foreground">—</span>
            )}
          </TableCell>
        )}
        <TableCell>
          {!isHeader && (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); opts.onClick?.(); }} className="h-7 w-7 p-0 rounded-button text-muted-foreground hover:text-primary">
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </TableCell>
      </TableRow>
    );
  };

  /** Render a roll-up node (and, when expanded, its descendants). */
  const renderNode = (n: RNode): ReactNode[] => {
    if (n.isLeaf) {
      const r = n.header;
      return [renderRow(r, {
        key: n.key, depth: n.depth,
        onClick: () => openInNewTab(withSaleType(`/outstanding-dashboard/customer/${encodeURIComponent(r.name)}`)),
        leadCell: (
          <span className="inline-flex items-center gap-2" style={{ paddingLeft: n.depth * 18 }}>
            {n.depth > 0 && <span className="text-xs text-muted-foreground shrink-0">↳</span>}
            <span>{r.name}</span>
            {r.sales === 0 && r.receipts === 0 && r.creditNotes === 0 && (
              <Badge className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 border border-amber-200 rounded font-normal shrink-0">No Activity</Badge>
            )}
          </span>
        ),
      })];
    }
    const isOpen = expandedGroups.has(n.key);
    const canExpand = n.children.length > 0;
    const toggle = () => setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(n.key)) next.delete(n.key); else next.add(n.key);
      return next;
    });
    const out: ReactNode[] = [renderRow(n.header, {
      key: n.key, depth: n.depth, isHeader: true,
      onClick: canExpand ? toggle : undefined,
      leadCell: (
        <span className="inline-flex items-center gap-2" style={{ paddingLeft: n.depth * 18 }}>
          {canExpand ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggle(); }} className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50 shrink-0" aria-label={isOpen ? "Collapse" : "Expand"}>
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-5 shrink-0" />}
          <span className="font-semibold">{n.label}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 rounded font-normal text-muted-foreground border-border shrink-0">
            {n.count} {n.count === 1 ? "customer" : "customers"}
          </Badge>
        </span>
      ),
    })];
    if (isOpen) for (const c of n.children) out.push(...renderNode(c));
    return out;
  };

  /** One exported cell. `isHeader` marks a group subtotal row, where the
   *  non-additive columns are blank (matching `aggregate()` and `renderRow`). */
  const exportCell = (row: CustomerRow, key: SortKey, isHeader: boolean): string | number => {
    if (isHeader && (key === "creditPeriod" || key === "utilization" || key === "blocked")) return "";
    if (key === "salesPerson") return row.salesPersons?.join("; ") ?? row.salesPerson ?? "";
    if (key === "companies" || key === "locations") return (row[key] as string[] | undefined)?.join("; ") ?? "";
    if (key === "risk") return row.risk.charAt(0).toUpperCase() + row.risk.slice(1);
    if (key === "blocked") return row.blocked ? "Blocked" : "";
    if (key === "overdue") return overdueForRow(row);
    // Blocked customers carry a ₹1 sentinel credit limit, not a real limit,
    // so their utilization % is meaningless — export a dash instead.
    if (key === "utilization") return row.blocked ? "—" : row.utilization;
    const v = row[key];
    return typeof v === "number" ? v : (v ?? "") as string;
  };

  /** Exports the roll-up the user is actually looking at: one column per group-by
   *  level, a subtotal row per group header, its members beneath it, and a Grand
   *  Total. Covers every page, not just the visible one. */
  const handleExport = () => {
    if (groupTree.length === 0) {
      toast({ title: "Nothing to export", description: "No customers match the current filters." });
      return;
    }

    const INR_FMT = '_-"₹"* #,##0_-;-"₹"* #,##0_-;_-"₹"* "-"_-;_-@_-';
    const PCT_FMT = '0.0"%"';
    const INT_FMT = "0";
    const numericFmt: Partial<Record<SortKey, string>> = {
      openingBalance: INR_FMT, sales: INR_FMT, receipts: INR_FMT,
      creditNotes: INR_FMT, debitNotes: INR_FMT, journalAdjustments: INR_FMT,
      outstanding: INR_FMT, overdue: INR_FMT, creditLimit: INR_FMT,
      proposedCreditLimit3M: INR_FMT, proposedCreditLimitAI: INR_FMT,
      maxOverdueDays: INT_FMT, creditPeriod: INT_FMT,
      utilization: PCT_FMT,
    };

    // Dimension columns (one per group-by level) lead; then the visible data
    // columns, minus `name` (always carried by a dimension column) and minus any
    // column an active dimension already spells out.
    const dimCols = groupBy.map((d) => ({ dim: d, label: R_DIMENSIONS.find((x) => x.key === d)!.label }));
    const suppressed = new Set<SortKey>(["name", ...groupBy.map((d) => DIM_COL[d]).filter(Boolean) as SortKey[]]);
    const dataCols = columns.filter((c) => visibleCols.has(c.key) && !suppressed.has(c.key));

    const header = [
      ...dimCols.map((d) => d.label),
      ...dataCols.map((c) =>
        c.key === "overdue" && agingBucketKeys.length > 0 ? `Overdue (${agingFilters.join(", ")})` : c.label),
    ];
    const width = header.length;
    const aoa: (string | number)[][] = [header];

    // Pre-order walk (parents before children). Ancestor labels fill the leading
    // dimension columns; deeper levels stay blank on a subtotal row.
    const subtotalRows: number[] = [];
    const walk = (nodes: RNode[], ancestors: string[]) => {
      for (const n of nodes) {
        const path = [...ancestors, n.label];
        const isHeader = !n.isLeaf;
        // A terminal non-customer node (e.g. group by Salesperson alone) is the row
        // itself, not a subtotal over anything — leave it unstyled.
        if (n.children.length > 0) subtotalRows.push(aoa.length);
        aoa.push([
          ...dimCols.map((_, i) => path[i] ?? ""),
          ...dataCols.map((c) => exportCell(n.header, c.key, isHeader)),
        ]);
        if (n.children.length) walk(n.children, path);
      }
    };
    walk(groupTree, []);

    // Grand Total — mirrors the on-screen row: money sums, ratio/count columns blank.
    const grandTotal: (string | number)[] = [
      "GRAND TOTAL",
      ...dimCols.slice(1).map(() => ""),
      ...dataCols.map((c) => {
        switch (c.key) {
          case "openingBalance":        return totals.openingBalance;
          case "sales":                 return totals.sales;
          case "receipts":              return totals.receipts;
          case "creditNotes":           return totals.creditNotes;
          case "debitNotes":            return totals.debitNotes;
          case "journalAdjustments":    return totals.journalAdjustments;
          case "outstanding":           return totals.outstanding;
          case "overdue":               return totals.overdue;
          case "creditLimit":           return totals.creditLimit;
          case "proposedCreditLimit3M": return totals.proposedCreditLimit3M;
          case "proposedCreditLimitAI": return totals.proposedCreditLimitAI;
          default:                      return "";
        }
      }),
    ];
    aoa.push(grandTotal);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Apply number formats to the numeric data columns (offset past the dimensions).
    for (let di = 0; di < dataCols.length; di++) {
      const fmt = numericFmt[dataCols[di].key];
      if (!fmt) continue;
      const ci = dimCols.length + di;
      for (let ri = 1; ri < aoa.length; ri++) {
        const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
        const cell = ws[ref];
        if (cell && typeof cell.v === "number") cell.z = fmt;
      }
    }

    // Auto column widths.
    ws["!cols"] = header.map((label, ci) => {
      let max = label.length;
      for (let ri = 1; ri < aoa.length; ri++) {
        const v = aoa[ri][ci];
        const len = typeof v === "number" ? Math.round(v).toString().length + 4 : String(v ?? "").length;
        if (len > max) max = len;
      }
      return { wch: Math.min(Math.max(max + 2, 10), 40) };
    });

    // Freeze the header row and the dimension columns.
    ws["!freeze"] = { xSplit: dimCols.length, ySplit: 1 };

    // Styles go last — `styleRow` preserves the number formats set above.
    styleRow(ws, 0, width, HEADER_STYLE);
    for (const ri of subtotalRows) styleRow(ws, ri, width, TOTAL_STYLE);
    styleRow(ws, aoa.length - 1, width, GRAND_TOTAL_STYLE);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Risk Register");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const ts = new Date().toISOString().slice(0, 10);
    saveAs(
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `risk-register-${ts}.xlsx`,
    );

    const n = groupTree.length;
    toast({ title: "Export complete", description: `${n} ${groupByNoun}${n !== 1 ? "s" : ""} exported to Excel.` });
  };
  const handleSaveView = () => toast({ title: "View saved", description: "Current filters have been saved." });

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading customer data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm font-medium text-destructive">Data not loaded</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <UITooltipProvider>
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Customer Risk Register</h1>
            <p className="text-sm text-muted-foreground">
              {(() => {
                if (groupTree.length === 0) return `0 of ${allData.length} customers`;
                const isFlat = groupBy.length === 1 && groupBy[0] === "customer";
                const noun = isFlat ? "customer" : groupByNoun;
                return `Showing ${rangeStart}–${rangeEnd} of ${groupTree.length} ${noun}${groupTree.length !== 1 ? "s" : ""}${isFlat ? "" : ` · ${rows.length} customers`}`;
              })()}
            </p>
            <p className="text-[11px] text-muted-foreground/80 italic mt-0.5">
              Note: "Blocked" is set when the source-sheet credit limit equals 1. In practice this marker is used for the INK product category only.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="rounded-button border-border">
                <Columns3 className="h-4 w-4 mr-2" />
                Columns{visibleCols.size < columns.length ? ` (${visibleCols.size}/${columns.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleCols.has(col.key)}
                  onCheckedChange={() => toggleCol(col.key)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={visibleCols.size === columns.length}
                onCheckedChange={() => setVisibleCols(new Set(ALL_COL_KEYS))}
                onSelect={(e) => e.preventDefault()}
              >
                Show all
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleSaveView} className="rounded-button border-border">
            <Save className="h-4 w-4 mr-2" /> Save View
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="rounded-button border-border">
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      {/* Group-by builder */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <GroupByBuilder dimensions={R_DIMENSIONS} presets={R_PRESETS} value={groupBy} onChange={setGroupBy} />
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 flex-1 min-w-[200px] max-w-xs">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customer..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 rounded-input border-border text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Risk Level</span>
              <RiskMultiSelect value={riskLevels} onChange={setRiskLevels} triggerClassName="w-[140px] h-9 text-sm rounded-input border-border" />
            </div>
            <div className="mb-1"><RiskLegendPopover /></div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Aging</span>
              <MultiSelectFilter
                options={[
                  { value: "0-30",    label: "0–30 days" },
                  { value: "31-60",   label: "31–60 days" },
                  { value: "61-90",   label: "61–90 days" },
                  { value: "91-120",  label: "91–120 days" },
                  { value: "121-180", label: "121–180 days" },
                  { value: "180+",    label: "180+ days" },
                ]}
                value={agingFilters}
                onChange={setAgingFilters}
                allLabel="All Aging"
                unit="buckets"
                triggerClassName="w-[150px] h-9 text-sm rounded-input border-border"
              />
            </div>

            {companyOptions.length > 1 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
                <MultiSelectFilter
                  options={companyOptions.map((c) => ({ value: c, label: c }))}
                  value={companyFilters}
                  onChange={setCompanyFilters}
                  allLabel="All Companies"
                  unit="Companies"
                  triggerClassName="w-[150px] h-9 text-sm rounded-input border-border"
                />
              </div>
            )}
            {locationOptions.length > 1 && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
                <MultiSelectFilter
                  options={locationOptions.map((loc) => ({ value: loc, label: loc }))}
                  value={locationFilters}
                  onChange={setLocationFilters}
                  allLabel="All Locations"
                  unit="Locations"
                  triggerClassName="w-[150px] h-9 text-sm rounded-input border-border"
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer Segment</span>
              <Select value={customerSegment} onValueChange={(v) => setCustomerSegment(v as "all" | "active" | "no_activity")}>
                <SelectTrigger className="w-40 rounded-input h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="no_activity">No Activity</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Balance</span>
              <Select value={balanceFilter} onValueChange={(v) => setBalanceFilter(v as "all" | "has_outstanding" | "zero_outstanding")}>
                <SelectTrigger className="w-44 rounded-input h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Balances</SelectItem>
                  <SelectItem value="has_outstanding">Has Outstanding</SelectItem>
                  <SelectItem value="zero_outstanding">Zero Outstanding</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Blocked</span>
              <Select value={blockedFilter} onValueChange={(v) => setBlockedFilter(v as "all" | "blocked" | "not_blocked")}>
                <SelectTrigger className="w-36 rounded-input h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="blocked">Blocked only</SelectItem>
                  <SelectItem value="not_blocked">Not blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sales Person</span>
              <SalesPersonMultiSelect options={salesPersonOptions} value={salesPersons} onChange={setSalesPersons} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer Category</span>
              <CustomerCategoryMultiSelect value={categories} onChange={setCategories} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sale Type</span>
              <SaleTypeMultiSelect value={saleTypes} onChange={setSaleTypes} />
            </div>
          </div>
          {saleTypes.length > 0 && (
            <p className="text-[11px] text-muted-foreground italic mt-2">
              Receipts and credit notes are attributed to the sale type of the bill they settle; amounts paid against a bill with no readable reference (true on-account / opening-balance collections) are left unallocated, not split. Opening balance and cheque returns carry no sale type, so outstanding/overdue distribute them across types by each customer's sales mix (estimate).
            </p>
          )}
          <FilterChips chips={filterChips} onClearAll={clearFilters} />
        </CardContent>
      </Card>

      {/* Aggregate Trend — shown only when < 10 customers match filters */}
      {rows.length > 0 && rows.length < 10 && aggregatedTrend.length > 0 && (
        <Card className="rounded-card">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors rounded-card"
            onClick={() => setShowTrend((v) => !v)}
          >
            <div className="flex items-center gap-2">
              {showTrend
                ? <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Trends — {rows.length} customer{rows.length !== 1 ? "s" : ""}
              </span>
            </div>
          </button>
          {showTrend && (
          <CardContent className="px-4 pb-4 pt-0">
            <div className="border-t border-border pt-3">
            <div className="flex flex-wrap gap-1 mb-4">
              {/* All — clears selection */}
              <Button
                key="all"
                variant={activeTrendKeys.size === 0 ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTrendKeys(new Set())}
                className="rounded-button text-xs h-7"
              >
                All
              </Button>
              {trendAllLines.map((t) => {
                const active = activeTrendKeys.has(t.key);
                return (
                <Button
                  key={t.key}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setActiveTrendKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.key)) next.delete(t.key);
                      else next.add(t.key);
                      return next;
                    });
                  }}
                  className="rounded-button text-xs h-7"
                >
                  {t.label}
                </Button>
                );
              })}
            </div>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={aggregatedTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmtL} width={72} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--surface))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                    formatter={(v: number) => fmtL(v)}
                  />
                  <>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {activeLines.map((t) => (
                      <Line
                        key={t.key}
                        type="monotone"
                        dataKey={t.key}
                        name={t.label}
                        stroke={t.color}
                        strokeWidth={2}
                        dot={{ r: activeLines.length === 1 ? 4 : 3, fill: t.color }}
                        activeDot={{ r: activeLines.length === 1 ? 6 : 5 }}
                      />
                    ))}
                  </>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-6 gap-3">
              {[
                { label: "Total Sales",       value: fmtL(aggregatedTrend.reduce((s, r) => s + r.sales, 0)),              color: "text-primary" },
                { label: "Total Receipts",    value: fmtL(aggregatedTrend.reduce((s, r) => s + r.receipts, 0)),           color: "text-[hsl(142,71%,45%)]" },
                { label: "Total Cr. Notes",   value: fmtL(aggregatedTrend.reduce((s, r) => s + r.creditNotes, 0)),        color: "text-[hsl(271,75%,58%)]" },
                { label: "Total Chq Returns", value: fmtL(aggregatedTrend.reduce((s, r) => s + r.checkReturns, 0)),       color: "text-[hsl(213,94%,52%)]" },
                { label: "Outstanding",       value: fmt(Math.abs(totals.outstanding)), color: "text-secondary" },
                { label: "Overdue",           value: fmt(totals.overdue),    color: "text-destructive" },
              ].map((item) => (
                <div key={item.label} className="bg-muted/40 rounded-input px-3 py-2">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{item.label}</p>
                  <p className={`text-sm font-bold font-mono mt-0.5 ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>
            </div>
          </CardContent>
          )}
        </Card>
      )}

      {/* Table */}
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        Use the <Pin className="h-3 w-3 inline" /> on a leading column header to freeze it (and everything to its left) while scrolling sideways.
      </p>
      <Card className="rounded-card border-border bg-surface overflow-hidden">
        <ScrollableTable>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {visibleColumnList.map((col) => {
                  const freezable = FREEZABLE_KEYS.includes(col.key);
                  const f = freezeStick(col.key, { header: true });
                  return (
                  <TableHead
                    key={col.key}
                    ref={freezable ? (el) => { headRefs.current.set(col.key, el); } : undefined}
                    style={f.style}
                    className={`text-xs font-semibold text-foreground/70 cursor-pointer select-none whitespace-nowrap ${col.align === "right" ? "text-right" : ""} ${f.className}`}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.key === "overdue" && agingBucketKeys.length > 0 ? `Overdue (${agingFilters.join(", ")})` : col.label}
                      {sortKey === col.key && sortDir === "asc"  && <ArrowUp   className="h-3 w-3" />}
                      {sortKey === col.key && sortDir === "desc" && <ArrowDown  className="h-3 w-3" />}
                      {sortKey !== col.key && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      {freezable && freezePin(col.key)}
                    </span>
                  </TableHead>
                  );
                })}
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Grand Total — sums the entire filtered set (all pages), not just
                  the current page. Money columns sum; ratio/count columns (Util %,
                  Max OD, Credit Period, Risk, Blocked) are left blank. */}
              {rows.length > 0 && (
                <TableRow className="bg-muted/60 border-b-2 border-border/60 font-semibold hover:bg-muted/60">
                  {visibleColumnList.map((col) => {
                    const f = freezeStick(col.key, { bg: "bg-muted" });
                    if (col.key === "name") {
                      return (
                        <TableCell
                          key="name"
                          style={f.style}
                          className={`text-sm whitespace-nowrap uppercase tracking-wide text-foreground/80 ${f.className}`}
                        >
                          Grand Total
                        </TableCell>
                      );
                    }
                    let content: ReactNode = null;
                    let cls = "text-sm text-right font-mono";
                    switch (col.key) {
                      case "openingBalance": content = fmt(totals.openingBalance); break;
                      case "sales":          content = fmt(totals.sales); break;
                      case "receipts":       content = fmt(totals.receipts); break;
                      case "creditNotes":    content = fmt(totals.creditNotes); break;
                      case "debitNotes":
                        content = fmtINRMoney(totals.debitNotes);
                        if (totals.debitNotes > 0) cls += " text-destructive";
                        break;
                      case "journalAdjustments":
                        content = fmtINRDrCr(totals.journalAdjustments);
                        cls += totals.journalAdjustments > 0 ? " text-destructive" : totals.journalAdjustments < 0 ? " text-emerald-700" : "";
                        break;
                      case "outstanding":
                        content = (
                          <>
                            {fmt(Math.abs(totals.outstanding))}
                            {totals.outstanding < 0 && <span className="text-[10px] font-normal ml-0.5">(Cr)</span>}
                          </>
                        );
                        if (totals.outstanding < 0) cls += " text-emerald-600";
                        break;
                      case "overdue":
                        content = fmt(totals.overdue);
                        if (totals.overdue > 0) cls += " text-destructive";
                        break;
                      case "creditLimit":           content = fmt(totals.creditLimit); break;
                      case "proposedCreditLimit3M":  content = fmt(totals.proposedCreditLimit3M); break;
                      case "proposedCreditLimitAI":  content = fmt(totals.proposedCreditLimitAI); break;
                      default: content = null; cls = "";  // salesPerson, companies, locations, maxOverdueDays, creditPeriod, utilization, risk, blocked
                    }
                    return <TableCell key={col.key} style={f.style} className={`${cls} ${f.className}`}>{content}</TableCell>;
                  })}
                  <TableCell className="w-8" />
                </TableRow>
              )}
              {paginatedNodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleCols.size + 1} className="text-center py-12 text-muted-foreground">
                    No {groupByNoun}s match your filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedNodes.flatMap((n) => renderNode(n))
              )}
            </TableBody>
          </Table>
        </ScrollableTable>
      </Card>

      {/* Pagination */}
      {rows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(v === "all" ? "all" : Number(v))}
            >
              <SelectTrigger className="w-[90px] h-8 rounded-input border-border text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-input">
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <SelectItem key={String(opt)} value={String(opt)}>
                    {opt === "all" ? "All" : opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {rangeStart}–{rangeEnd} of {groupTree.length}
            </span>
          </div>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-disabled={currentPage === 1}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                {getPageWindow(currentPage, totalPages).map((p, i) =>
                  p === "..." ? (
                    <PaginationItem key={`ellipsis-${i}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p}>
                      <PaginationLink
                        isActive={p === currentPage}
                        onClick={() => setCurrentPage(p)}
                        className="cursor-pointer"
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    aria-disabled={currentPage === totalPages}
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
    </UITooltipProvider>
  );
}
