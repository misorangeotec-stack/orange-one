import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, AlertTriangle, Clock, ReceiptText, RefreshCw, Search, ChevronRight,
  Info, CheckCircle2,
} from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { SalesPersonMultiSelect } from "@hub/components/SalesPersonMultiSelect";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useAppData } from "@hub/lib/useAppData";
import { formatDateDMY } from "@hub/lib/utils";
import {
  buildHubAlerts, alertAmount, HUB_ALERT_DEFS,
  type HubAlert, type HubAlertType, type HubAlertSeverity,
} from "@hub/lib/hubAlerts";

/**
 * Alerts — the hub's noticeboard.
 *
 * Every other screen answers a question the user arrived with. This is the only one that says
 * "look at this" unprompted, so it is deliberately a short, finite list of things a person can
 * act on today — not another filterable register.
 *
 * The rules live in lib/hubAlerts.ts, not here: the same rules have to run server-side for the
 * daily email later, and two copies would eventually disagree about who is going critical.
 *
 * WHAT THIS REPLACED. The previous version of this page rendered `dashboard.alerts`, fed by the
 * old Python pipeline's dashboard.json. Both live fetchers now return `alerts: []`
 * (connectwaveFetcher.ts:494, supabaseFetcher.ts:266) — that feed is dead, and the page was never
 * routed, so nobody saw the empty result. Alerts are now derived in the browser from the customer
 * and bill data already on screen, which works on whichever source the hub is pointed at.
 *
 * ROWS ARE CAPPED, NOT PAGINATED. The house rule is 25/page, but a two-block noticeboard reads
 * worse behind pagers — each block caps at 25 with a "Show all" toggle. A block that routinely
 * runs to hundreds of rows means the rule is too loose, not that this needs a pager.
 */

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000)   return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

const ICONS: Record<HubAlertType, typeof AlertTriangle> = {
  going_critical: Clock,
  new_bill_bad_account: ReceiptText,
};

const SEVERITY_STYLE: Record<HubAlertSeverity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high:     "bg-primary/15 text-primary border-primary/30",
  medium:   "bg-muted text-muted-foreground border-border",
};

const ROWS_COLLAPSED = 25;

/* ── Page ──────────────────────────────────────────────────── */

export default function Alerts() {
  const navigate = useNavigate();
  const { loading, error, allCustomers, customerDetail, dashboard, salesPersonOptions } = useAppData();

  const [search, setSearch]             = useState("");
  const [salesPersons, setSalesPersons] = useState<string[]>([]);
  const [company, setCompany]           = useState("all");
  const [location, setLocation]         = useState("all");
  const [expanded, setExpanded]         = useState<Set<HubAlertType>>(new Set());
  const [showRule, setShowRule]         = useState<Set<HubAlertType>>(new Set());

  const asOfDate = dashboard?.asOfDate ?? "";

  const companies = useMemo(
    () => [...new Set(allCustomers.map((c) => c.company).filter(Boolean))].sort(),
    [allCustomers],
  );
  const locations = useMemo(
    () => [...new Set(allCustomers.map((c) => c.location).filter(Boolean))].sort(),
    [allCustomers],
  );

  // Build once off the full in-scope set, then filter the RESULT. Filtering customers first would
  // be equivalent today, but would silently break any later rule that compares a customer against
  // the rest of the book.
  const allAlerts = useMemo(
    () => buildHubAlerts({ customers: allCustomers, detailById: customerDetail, asOfDate }),
    [allCustomers, customerDetail, asOfDate],
  );

  const alerts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const spSet = salesPersons.length ? new Set(salesPersons) : null;
    return allAlerts.filter((a) => {
      if (q && !a.customer.toLowerCase().includes(q)) return false;
      if (spSet && !spSet.has(a.salesPerson)) return false;
      if (company !== "all" && a.company !== company) return false;
      if (location !== "all" && a.location !== location) return false;
      return true;
    });
  }, [allAlerts, search, salesPersons, company, location]);

  const byType = useMemo(() => {
    const map = new Map<HubAlertType, HubAlert[]>();
    for (const def of HUB_ALERT_DEFS) map.set(def.type, []);
    for (const a of alerts) map.get(a.type)?.push(a);
    return map;
  }, [alerts]);

  const totalCount = alerts.length;
  const filtersOn =
    !!search.trim() || salesPersons.length > 0 || company !== "all" || location !== "all";

  const clearFilters = () => {
    setSearch(""); setSalesPersons([]); setCompany("all"); setLocation("all");
  };

  const toggle = (
    set: Set<HubAlertType>,
    setter: (s: Set<HubAlertType>) => void,
    t: HubAlertType,
  ) => {
    const next = new Set(set);
    if (next.has(t)) next.delete(t); else next.add(t);
    setter(next);
  };

  const openCustomer = (name: string) =>
    navigate(`/outstanding-dashboard/customer/${encodeURIComponent(name)}`);

  /* ── Loading / error ─────────────────────────────────────── */

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading alerts…</p>
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

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div className="p-6 space-y-6 max-w-content mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-button bg-primary/15 flex items-center justify-center shrink-0">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {totalCount > 0
              ? `${totalCount} thing${totalCount === 1 ? "" : "s"} need attention`
              : "Nothing needs attention"}
            {asOfDate && <span className="text-foreground/60"> · as of {formatDateDMY(asOfDate)}</span>}
          </p>
        </div>
      </div>

      {/* Summary tiles — one per alert type */}
      <div className="grid gap-4 sm:grid-cols-2">
        {HUB_ALERT_DEFS.map((def) => {
          const rows = byType.get(def.type) ?? [];
          const amount = rows.reduce((s, a) => s + alertAmount(a), 0);
          const Icon = ICONS[def.type];
          const urgent = rows.filter((a) => a.severity === "critical").length;
          return (
            <Card key={def.type} className="rounded-card border-border bg-surface">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-button flex items-center justify-center shrink-0 ${
                    rows.length === 0
                      ? "bg-muted text-muted-foreground"
                      : "bg-destructive/15 text-destructive"
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-2xl font-bold text-foreground tabular-nums">{rows.length}</span>
                      <span className="text-sm font-medium text-foreground/80">{def.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmt(amount)} {def.amountLabel}
                      {urgent > 0 && <span className="text-destructive"> · {urgent} most urgent</span>}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Customer</span>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name…"
                  className="w-52 h-9 pl-8 text-sm rounded-input border-border"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Sales Person</span>
              <SalesPersonMultiSelect
                options={salesPersonOptions}
                value={salesPersons}
                onChange={setSalesPersons}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger className="w-[150px] h-9 rounded-input border-border text-sm">
                  <SelectValue placeholder="Company" />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger className="w-[150px] h-9 rounded-input border-border text-sm">
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {filtersOn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 text-xs rounded-button text-muted-foreground"
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* One block per alert type */}
      {HUB_ALERT_DEFS.map((def) => {
        const rows = byType.get(def.type) ?? [];
        const amount = rows.reduce((s, a) => s + alertAmount(a), 0);
        const Icon = ICONS[def.type];
        const isExpanded = expanded.has(def.type);
        const visible = isExpanded ? rows : rows.slice(0, ROWS_COLLAPSED);
        const ruleOpen = showRule.has(def.type);

        return (
          <Card key={def.type} className="rounded-card border-border bg-surface overflow-hidden">
            {/* Block header */}
            <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-button bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold text-foreground">{def.title}</h2>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 rounded-button border-border text-muted-foreground tabular-nums"
                    >
                      {rows.length}
                    </Badge>
                    {rows.length > 0 && (
                      <span className="text-xs font-medium text-foreground/70 tabular-nums">
                        {fmt(amount)} {def.amountLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{def.blurb}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggle(showRule, setShowRule, def.type)}
                className="h-7 text-xs rounded-button text-muted-foreground hover:text-foreground shrink-0"
                aria-expanded={ruleOpen}
              >
                <Info className="h-3 w-3 mr-1" />
                {ruleOpen ? "Hide rule" : "What triggers this?"}
              </Button>
            </div>

            {ruleOpen && (
              <div className="px-4 py-3 bg-muted/40 border-b border-border">
                <p className="text-xs text-muted-foreground max-w-3xl">{def.rule}</p>
              </div>
            )}

            {/* Rows */}
            {rows.length === 0 ? (
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="h-6 w-6 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {filtersOn ? "Nothing matches your filters." : "Nothing here right now."}
                </p>
              </CardContent>
            ) : (
              <>
                <ScrollableTable>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="min-w-[220px]">Customer</TableHead>
                        <TableHead>Why</TableHead>
                        {def.type === "going_critical" ? (
                          <>
                            <TableHead className="text-right whitespace-nowrap">Days left</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Crossing 180d</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Limit used</TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead className="text-right whitespace-nowrap">New bills</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Billed</TableHead>
                            <TableHead className="whitespace-nowrap">Latest bill</TableHead>
                          </>
                        )}
                        <TableHead className="text-right whitespace-nowrap">Overdue</TableHead>
                        <TableHead className="whitespace-nowrap">Sales Person</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((a) => (
                        <TableRow key={a.id} className="cursor-pointer" onClick={() => openCustomer(a.customer)}>
                          <TableCell className="font-medium text-foreground">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{a.customer}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${SEVERITY_STYLE[a.severity]}`}
                              >
                                {a.severity}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {a.company}{a.location ? ` · ${a.location}` : ""}
                            </span>
                          </TableCell>

                          <TableCell className="text-sm text-muted-foreground max-w-[280px]">
                            {a.reason}
                          </TableCell>

                          {def.type === "going_critical" ? (
                            <>
                              <TableCell className="text-right tabular-nums">
                                {a.daysToCritical != null ? (
                                  <span className={a.daysToCritical <= 10 ? "font-semibold text-destructive" : "text-foreground"}>
                                    {a.daysToCritical}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-foreground">
                                {a.crossingAmount
                                  ? fmt(a.crossingAmount)
                                  : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {a.creditLimit > 0 ? (
                                  <span className={a.utilization >= 95 ? "font-semibold text-destructive" : "text-foreground"}>
                                    {a.utilization.toFixed(0)}%
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell className="text-right tabular-nums text-foreground">{a.billCount}</TableCell>
                              <TableCell className="text-right tabular-nums text-foreground">{fmt(a.billAmount ?? 0)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {a.latestBillRef || "—"}
                                {a.latestBillDate && <span className="block">{formatDateDMY(a.latestBillDate)}</span>}
                              </TableCell>
                            </>
                          )}

                          <TableCell className="text-right tabular-nums text-foreground">{fmt(a.overdue)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{a.salesPerson}</TableCell>
                          <TableCell className="text-right">
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollableTable>

                {rows.length > ROWS_COLLAPSED && (
                  <div className="p-3 border-t border-border text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggle(expanded, setExpanded, def.type)}
                      className="h-7 text-xs rounded-button text-primary hover:text-primary"
                    >
                      {isExpanded ? `Show first ${ROWS_COLLAPSED}` : `Show all ${rows.length}`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
