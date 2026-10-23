import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@hub/components/ui/dialog";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, List, Loader2, Search, Wallet, X,
} from "lucide-react";

import { Card } from "@hub/components/ui/card";
import { Button } from "@hub/components/ui/button";
import { cn } from "@hub/lib/utils";
import { MultiSelectFilter } from "@hub/components/MultiSelectFilter";
import {
  COMPANIES, DEFAULT_DOWNLOAD, NO_FILTERS, TIE_TOLERANCE, UNIT_LABEL, applyFilters, buildTree, colValue, dmy, fmtAmt, fmtCr, fyMonths, isNarrowed,
  loadExpenseCfo, monthLabel, pivot, quarterColumns, quarterOf, sum,
  type Col, type DownloadOptions, type ExpLine, type ExpenseCfoData, type Filters, type TreeNode,
} from "@hub/lib/expenseCfo";
import {
  DEFAULT_MATERIALITY, auditFlags, bridge, cfoNotes, draftRemark, entityName, flagText, monthVariance,
  paretoSet, sheetIndex, tbStatus,
  type Materiality, type Review, type SheetEntry, type VarianceRow,
} from "@hub/lib/expenseCfoRules";
import { exportExpenseCfoXlsx } from "@hub/lib/exportExpenseCfo";
import { exportExpenseCfoPdf } from "@hub/lib/exportExpenseCfoPdf";

/**
 * Finance → Expense Analysis (CFO).
 *
 * The CFO's expense workbook as a hub report: the same sheets (Index, Summary with AUDIT FLAG,
 * COMPANY WISE, Direct, Direct by Component, Indirect Exp, one vendor-wise sheet per indirect
 * main group with REMARKS and 80% Pareto, RAW DATA) plus Analytics, MoM Variance and
 * TB Reconciliation. Downloads as a linked PDF and a matching Excel workbook.
 *
 * HOW THE TABLES READ (user, 23-Oct-2026): one filter bar serves every sheet; columns open on
 * QUARTER totals and a quarter header opens its months; rows open as closed groups (e.g. Company ▸
 * Direct/Indirect ▸ main group ▸ ledger); and any row opens a dropdown of the voucher lines behind
 * it — the same lines as RAW DATA, so every figure can be traced to its transactions.
 *
 * THE TB GATE. Every view carries the reconciliation status of the load it reads. A load that does
 * not tie to Tally's Trial Balance within ₹0.99 is shown — the CFO needs to see it — but under a
 * red banner, and both downloads are stamped DRAFT – NOT TIED TO TB on every page.
 */

const CHART_GRID = "hsl(220 15% 90%)";
const AXIS_TICK = { fontSize: 11, fill: "hsl(220 10% 50%)" };
const NAVY = "#0B1B40";
const ORANGE = "#FF6A1F";
const PALETTE = ["#0B1B40", "#FF6A1F", "#2F6FDE", "#27AE60", "#8A99B0", "#E5484D", "#F2B705"];
const tickCr = (v: number) => (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : `${(v / 1e5).toFixed(0)}L`);
/** Rows shown in a transaction dropdown before pointing to RAW DATA / Excel for the rest. */
const TXN_LIMIT = 300;

export default function ExpenseCfoReport() {
  const q = useQuery({ queryKey: ["expenseCfo"], queryFn: loadExpenseCfo, staleTime: 5 * 60_000 });

  if (q.isLoading) {
    return <div className="flex items-center gap-2 p-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading the expense load…</div>;
  }
  if (q.error || !q.data) {
    return <Card className="m-6 p-6 text-destructive">{(q.error as Error)?.message ?? "No data"}</Card>;
  }
  return <Report data={q.data} />;
}

function Report({ data }: { data: ExpenseCfoData }) {
  const allMonths = useMemo(() => fyMonths(data.meta.dateTo), [data.meta.dateTo]);
  const [filters, setFilters] = useState<Filters>({ from: allMonths[0], to: allMonths[allMonths.length - 1], ...NO_FILTERS });
  const [sheet, setSheet] = useState("analytics");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [opts, setOpts] = useState<DownloadOptions>(DEFAULT_DOWNLOAD);

  const months = allMonths.filter((m) => m >= filters.from && m <= filters.to);
  const lines = useMemo(() => applyFilters(data.lines, filters), [data.lines, filters]);
  const flags = useMemo(() => auditFlags(lines), [lines]);
  const index = useMemo(() => sheetIndex(lines, flags), [lines, flags]);
  const tb = useMemo(() => tbStatus(data), [data]);
  const current = index.find((s) => s.id === sheet) ?? index[0];

  const download = async () => {
    setAsking(false);
    setBusy(true);
    try {
      const stem = `Expense_CFO_${monthLabel(months[0])}_to_${monthLabel(months[months.length - 1])}_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
      const ctx = { data, lines, months, filters, flags, index, tb, stem, opts };
      await exportExpenseCfoPdf(ctx);
      exportExpenseCfoXlsx(ctx);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold"><Wallet className="h-5 w-5 text-primary" /> Expense Analysis (CFO)</h1>
            <p className="text-sm text-muted-foreground">
              Direct + Indirect expenses, all 5 companies, straight from the Tally books · load #{data.meta.loadId} built {new Date(data.meta.finishedAt).toLocaleString("en-IN")}
            </p>
          </div>
          <Button onClick={() => setAsking(true)} disabled={busy || !lines.length} className="h-9">
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} PDF + Excel
          </Button>
        </div>
        <TbBanner tb={tb} onOpen={() => setSheet("tb")} />
      </Card>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>How should the report be laid out?</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <Choice label="Show figures in" value={opts.unit} onChange={(v) => setOpts({ ...opts, unit: v as DownloadOptions["unit"] })}
              options={[["cr", "₹ Crore"], ["lakh", "₹ Lakh"], ["rupees", "Full rupees"]]} />
            <Choice label="Columns" value={opts.columns} onChange={(v) => setOpts({ ...opts, columns: v as DownloadOptions["columns"] })}
              options={[["quarters", "Quarters only"], ["months", "Quarters with months"]]} />
            <Choice label="Rows" value={opts.rows} onChange={(v) => setOpts({ ...opts, rows: v as DownloadOptions["rows"] })}
              options={[["grouped", "Grouped (groups only; Excel rows can be opened)"], ["detail", "Full detail (down to ledger / party)"]]} />
            <p className="text-xs text-muted-foreground">
              Applies to both files. The filters on the page apply too. Amounts {UNIT_LABEL[opts.unit]}; the TB reconciliation always stays in full rupees.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>Cancel</Button>
            <Button onClick={download}><Download className="mr-1 h-4 w-4" /> Download PDF + Excel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <Card className="max-h-[78vh] overflow-y-auto p-2 lg:sticky lg:top-2">
          {index.map((s) => (
            <button key={s.id} onClick={() => setSheet(s.id)}
              className={cn("flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                s.id === current.id && "bg-primary/10 font-semibold text-primary")}>
              <span className="truncate">{s.name}</span>
              {s.review !== "LOW" && <ReviewBadge r={s.review} />}
            </button>
          ))}
        </Card>
        <Card className="min-w-0 p-4">
          <FilterBar all={data.lines} months={allMonths} filters={filters} setFilters={setFilters} shown={lines} />
          <h2 className="mb-1 mt-4 text-lg font-semibold">{current.name}</h2>
          <p className="mb-4 text-sm text-muted-foreground">{current.description}</p>
          {!lines.length ? <p className="text-muted-foreground">No expense lines for this selection.</p> : (
            <SheetBody sheet={current} lines={lines} months={months} flags={flags} index={index} data={data} tb={tb} onOpen={setSheet} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ── The filter bar (every sheet) ─────────────────────────────────────────────────────────────

function FilterBar({ all, months, filters, setFilters, shown }: {
  all: ExpLine[]; months: string[]; filters: Filters; setFilters: (f: (p: Filters) => Filters) => void; shown: ExpLine[];
}) {
  // Each list offers only what the OTHER filters leave, so a choice can never empty the table.
  const optsFor = (field: keyof Filters, pick: (l: ExpLine) => string) => {
    const others = applyFilters(all, { ...filters, [field]: [] });
    return [...new Set(others.map(pick))].sort().map((v) => ({ value: v, label: v }));
  };
  const set = (field: keyof Filters) => (v: string[]) => setFilters((f) => ({ ...f, [field]: v }));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
      <MonthSelect label="From" value={filters.from} months={months} onChange={(v) => setFilters((f) => ({ ...f, from: v, to: v > f.to ? v : f.to }))} />
      <MonthSelect label="To" value={filters.to} months={months} onChange={(v) => setFilters((f) => ({ ...f, to: v, from: v < f.from ? v : f.from }))} />
      <MultiSelectFilter options={COMPANIES.map((c) => ({ value: c, label: c }))} value={filters.companies} onChange={set("companies")} allLabel="All companies" unit="Company" triggerClassName="h-9 w-[160px]" />
      <MultiSelectFilter options={optsFor("expTypes", (l) => l.expType)} value={filters.expTypes} onChange={set("expTypes")} allLabel="Direct + Indirect" unit="Type" triggerClassName="h-9 w-[150px]" />
      <MultiSelectFilter options={optsFor("mainGroups", (l) => l.mainGroup)} value={filters.mainGroups} onChange={set("mainGroups")} allLabel="All main groups" unit="Group" searchable triggerClassName="h-9 w-[170px]" />
      <MultiSelectFilter options={optsFor("gls", (l) => l.gl)} value={filters.gls} onChange={set("gls")} allLabel="All ledgers" unit="Ledger" searchable triggerClassName="h-9 w-[170px]" />
      <MultiSelectFilter options={optsFor("parties", (l) => l.party)} value={filters.parties} onChange={set("parties")} allLabel="All parties" unit="Party" searchable triggerClassName="h-9 w-[170px]" />
      <label className="flex h-9 items-center gap-1 rounded-md border bg-background px-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input className="w-40 bg-transparent text-sm outline-none" placeholder="Voucher no / narration" value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
      </label>
      {isNarrowed(filters) && (
        <Button variant="ghost" size="sm" onClick={() => setFilters((f) => ({ ...f, ...NO_FILTERS }))}><X className="mr-1 h-4 w-4" /> Clear filters</Button>
      )}
      <span className="ml-auto text-xs text-muted-foreground">{shown.length.toLocaleString("en-IN")} lines · ₹{fmtAmt(sum(shown))}</span>
    </div>
  );
}

function SheetBody(p: {
  sheet: SheetEntry; lines: ExpLine[]; months: string[]; flags: Map<string, string[]>;
  index: SheetEntry[]; data: ExpenseCfoData; tb: ReturnType<typeof tbStatus>; onOpen: (id: string) => void;
}) {
  const { sheet, lines, months, flags } = p;
  const flagged = (n: TreeNode) => n.depth === 2 && !!flagText(flags, n.path[0] as "DIRECT", n.path[1]);
  switch (sheet.id) {
    case "analytics": return <Analytics lines={lines} months={months} flags={flags} tb={p.tb} />;
    case "index": return <IndexSheet index={p.index} onOpen={p.onOpen} />;
    case "summary":
      return (<>
        <CompanyTrend lines={lines} months={months} />
        <TreeTable key="summary" lines={lines} months={months} levels={["EXP TYPE", "MAIN GROUP", "LEDGER"]}
          keys={[(l) => l.expType, (l) => l.mainGroup, (l) => l.gl]}
          extra={{ header: "AUDIT FLAG", cell: (n) => (n.depth === 2 ? flagText(flags, n.path[0] as "DIRECT", n.path[1]) : "") }}
          highlight={flagged} />
      </>);
    case "company":
      return (<>
        <CompanyTrend lines={lines} months={months} />
        <TreeTable key="company" lines={lines} months={months} levels={["COMPANY", "EXP TYPE", "MAIN GROUP", "LEDGER"]}
          keys={[(l) => entityName(l.entity), (l) => l.expType, (l) => l.mainGroup, (l) => l.gl]} />
      </>);
    case "direct":
      return <TreeTable key="direct" lines={lines.filter((l) => l.expType === "DIRECT")} months={months} levels={["MAIN GROUP", "LEDGER (TYPES)", "PARTY"]}
        keys={[(l) => l.mainGroup, (l) => l.gl, (l) => l.party]} />;
    case "component": {
      const direct = lines.filter((l) => l.expType === "DIRECT");
      return (<>
        <TreeTable key="component" lines={direct} months={months} levels={["COMPONENT", "MAIN GROUP", "LEDGER"]}
          keys={[(l) => l.component, (l) => l.mainGroup, (l) => l.gl]} />
        <h3 className="mb-2 mt-6 font-semibold">Main group × component (period total)</h3>
        <CrossTab lines={direct} />
      </>);
    }
    case "indirect":
      return <TreeTable key="indirect" lines={lines.filter((l) => l.expType === "INDIRECT")} months={months} levels={["MAIN GROUP", "SUB-GROUP", "LEDGER"]}
        keys={[(l) => l.mainGroup, (l) => l.subGroup, (l) => l.gl]} />;
    case "other":
      return <TreeTable key="other" lines={lines.filter((l) => l.expType === "OTHER")} months={months} levels={["MAIN GROUP", "COMPANY", "LEDGER"]}
        keys={[(l) => l.mainGroup, (l) => l.company, (l) => l.gl]} />;
    case "variance": return <VarianceSheet lines={lines} months={months} />;
    case "tb": return <TbSheet data={p.data} lines={lines} />;
    case "raw": return <RawData lines={lines} />;
    default:
      return <GroupSheet key={sheet.id} group={sheet.mainGroup!} lines={lines.filter((l) => l.expType === "INDIRECT" && l.mainGroup === sheet.mainGroup)} months={months} />;
  }
}

// ── The collapsible table ────────────────────────────────────────────────────────────────────

/**
 * Rows open as closed groups, columns open on quarter totals; any row's list icon (or a click on
 * a bottom-level row) drops down the voucher lines behind it. The grand total is always shown.
 */
function TreeTable({ lines, months, levels, keys, extra, highlight, cellClass }: {
  lines: ExpLine[]; months: string[]; levels: string[]; keys: ((l: ExpLine) => string)[];
  extra?: { header: string; cell: (n: TreeNode) => ReactNode };
  highlight?: (n: TreeNode) => boolean;
  cellClass?: (n: TreeNode, c: Col) => string;
}) {
  const root = useMemo(() => buildTree(lines, keys), [lines, keys]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openQ, setOpenQ] = useState<Set<number>>(new Set());
  const [txn, setTxn] = useState<Set<string>>(new Set());
  const cols = quarterColumns(months, openQ);
  const quarters = [...new Set(months.map(quarterOf))];
  const toggle = (s: Set<string>, set: (x: Set<string>) => void, k: string) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); set(n); };
  const allKeys = (n: TreeNode): string[] => n.children.flatMap((c) => (c.children.length ? [c.key, ...allKeys(c)] : []));
  const span = 1 + cols.length + (extra ? 1 : 0);

  const row = (n: TreeNode): ReactNode => {
    const isOpen = open.has(n.key);
    const leaf = !n.children.length;
    return (
      <Fragment key={n.key}>
        <tr className={cn("border-b hover:bg-muted/50", n.depth === 1 && "font-semibold", highlight?.(n) && "bg-[#FFE6B3]")}>
          <td className="whitespace-nowrap px-2 py-1" style={{ paddingLeft: 8 + (n.depth - 1) * 18 }}>
            <span className="inline-flex items-center gap-1">
              {leaf ? <span className="inline-block w-4" /> : (
                <button onClick={() => toggle(open, setOpen, n.key)} className="rounded hover:bg-muted" title={isOpen ? "Close" : "Open"}>
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              )}
              <button className={cn("text-left", leaf ? "hover:text-primary hover:underline" : "")}
                onClick={() => (leaf ? toggle(txn, setTxn, n.key) : toggle(open, setOpen, n.key))}>{n.label}</button>
              <button onClick={() => toggle(txn, setTxn, n.key)} title="Show the transactions behind this line"
                className={cn("ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-primary", txn.has(n.key) && "text-primary")}>
                <List className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] text-muted-foreground">{levels[n.depth - 1]}</span>
            </span>
          </td>
          {cols.map((c) => (
            <td key={c.label} className={cn("whitespace-nowrap px-2 py-1 text-right tabular-nums", c.kind !== "month" && "font-semibold", cellClass?.(n, c))}>
              {fmtAmt(colValue(n.byMonth, c, months))}
            </td>
          ))}
          {extra && <td className="px-2 py-1 align-top text-xs">{extra.cell(n)}</td>}
        </tr>
        {txn.has(n.key) && (
          <tr><td colSpan={span} className="bg-muted/30 p-2"><TxnList lines={n.lines} title={n.path.join(" › ")} onClose={() => toggle(txn, setTxn, n.key)} /></td></tr>
        )}
        {isOpen && n.children.map(row)}
      </Fragment>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button variant="outline" size="sm" onClick={() => setOpen(new Set(allKeys(root)))}>Open all groups</Button>
        <Button variant="outline" size="sm" onClick={() => setOpen(new Set())}>Close all groups</Button>
        <Button variant="outline" size="sm" onClick={() => setOpenQ(new Set(quarters))}>Show all months</Button>
        <Button variant="outline" size="sm" onClick={() => setOpenQ(new Set())}>Quarters only</Button>
        <span className="text-muted-foreground">Click ▸ to open a group, a quarter header to see its months, <List className="inline h-3 w-3" /> to see the transactions.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[#0B1B40] text-white">
              <th className="whitespace-nowrap px-2 py-1.5 text-left">{levels.join(" › ")}</th>
              {cols.map((c) => (
                <th key={c.label} className={cn("whitespace-nowrap px-2 py-1.5 text-right", c.kind !== "month" && "bg-[#15294F]")}>
                  {c.kind === "quarter" ? (
                    <button className="inline-flex items-center gap-1 hover:underline" onClick={() => {
                      const n = new Set(openQ); n.has(c.q) ? n.delete(c.q) : n.add(c.q); setOpenQ(n);
                    }} title={openQ.has(c.q) ? "Hide months" : "Show months"}>
                      {openQ.has(c.q) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{c.label}
                    </button>
                  ) : c.label}
                </th>
              ))}
              {extra && <th className="min-w-[240px] px-2 py-1.5 text-left">{extra.header}</th>}
            </tr>
          </thead>
          <tbody>
            {root.children.map(row)}
            <tr className="bg-[#0B1B40] font-semibold text-white">
              <td className="px-2 py-1">Grand Total</td>
              {cols.map((c) => <td key={c.label} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmtAmt(colValue(root.byMonth, c, months))}</td>)}
              {extra && <td />}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The voucher lines behind a row — the RAW DATA rows that make up its figure. */
function TxnList({ lines, title, onClose }: { lines: ExpLine[]; title: string; onClose: () => void }) {
  const sorted = useMemo(() => [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo)), [lines]);
  const shown = sorted.slice(0, TXN_LIMIT);
  return (
    <div className="rounded border bg-background">
      <div className="flex items-center justify-between border-b px-2 py-1 text-xs">
        <span><b>Transactions</b> — {title} · {lines.length.toLocaleString("en-IN")} line(s) · total ₹{fmtAmt(sum(lines))}</span>
        <button onClick={onClose} className="rounded p-0.5 hover:bg-muted" title="Close"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-[#FFC000]"><tr>
            {["Date", "Company", "Vch type", "Vch no", "Ledger (GL)", "Party", "Narration", "Amount"].map((h) =>
              <th key={h} className={cn("whitespace-nowrap px-2 py-1", h === "Amount" ? "text-right" : "text-left")}>{h}</th>)}
          </tr></thead>
          <tbody>{shown.map((l, i) => (
            <tr key={i} className="border-b">
              <td className="whitespace-nowrap px-2 py-0.5">{dmy(l.date)}</td><td className="px-2 py-0.5">{l.company}</td>
              <td className="px-2 py-0.5">{l.voucherType}</td><td className="px-2 py-0.5">{l.voucherNo}</td>
              <td className="px-2 py-0.5">{l.gl}</td><td className="px-2 py-0.5">{l.party}</td>
              <td className="max-w-[320px] truncate px-2 py-0.5" title={l.narration}>{l.narration}</td>
              <td className={cn("px-2 py-0.5 text-right tabular-nums", l.amount < 0 && "text-emerald-700")}>{fmtAmt(l.amount)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {lines.length > TXN_LIMIT && (
        <div className="border-t px-2 py-1 text-[11px] text-muted-foreground">
          Showing the first {TXN_LIMIT} of {lines.length.toLocaleString("en-IN")}. Narrow the filters, or use RAW DATA / the Excel download for every line.
        </div>
      )}
    </div>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────────────────────

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 font-semibold">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            className={cn("rounded-md border px-3 py-1.5 text-left", value === v ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function MonthSelect({ label, value, months, onChange }: { label: string; value: string; months: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-sm text-muted-foreground">
      {label}
      <select className="h-9 rounded-md border bg-background px-2 text-foreground" value={value} onChange={(e) => onChange(e.target.value)}>
        {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
      </select>
    </label>
  );
}

function ReviewBadge({ r }: { r: Review }) {
  return <span className={cn("ml-2 rounded px-1.5 text-[10px] font-bold", r === "HIGH" ? "bg-amber-200 text-amber-900" : "bg-amber-50 text-amber-700")}>{r}</span>;
}

function TbBanner({ tb, onOpen }: { tb: ReturnType<typeof tbStatus>; onOpen: () => void }) {
  return tb.tied ? (
    <div className="mt-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <CheckCircle2 className="h-4 w-4" /> Tied to Tally Trial Balance for all companies as at {dmy(tb.asOf)} (TB captured {new Date(tb.capturedAt).toLocaleString("en-IN")}).
    </div>
  ) : (
    <button onClick={onOpen} className="mt-3 flex w-full items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-left text-sm text-red-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      NOT TIED TO TB — {tb.gaps.filter((g) => g.level === "group").length} company total(s) differ from Tally's Trial Balance
      (largest gap ₹{fmtAmt(Math.max(...tb.gaps.map((g) => Math.abs(g.gap))))}). Downloads are stamped DRAFT. Open TB Reconciliation →
    </button>
  );
}

function ChartBox({ title, children, h = 260 }: { title: string; children: ReactNode; h?: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div style={{ height: h }}><ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer></div>
    </div>
  );
}

function CompanyTrend({ lines, months }: { lines: ExpLine[]; months: string[] }) {
  const companies = COMPANIES.filter((c) => lines.some((l) => l.company === c));
  const data = months.map((m) => ({
    month: monthLabel(m),
    ...Object.fromEntries(companies.map((c) => [c, sum(lines.filter((l) => l.company === c && l.month === m))])),
  }));
  return (
    <div className="mb-4">
      <ChartBox title="Monthly expense by company" h={200}>
        <LineChart data={data}>
          <CartesianGrid stroke={CHART_GRID} vertical={false} />
          <XAxis dataKey="month" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} tickFormatter={tickCr} width={52} />
          <Tooltip formatter={(v: number) => fmtCr(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {companies.map((c, i) => <Line key={c} dataKey={c} stroke={PALETTE[i]} strokeWidth={2} dot={false} />)}
        </LineChart>
      </ChartBox>
    </div>
  );
}

function CrossTab({ lines }: { lines: ExpLine[] }) {
  const comps = [...new Set(lines.map((l) => l.component))].sort();
  const groups = [...new Set(lines.map((l) => l.mainGroup))]
    .map((g) => ({ g, t: sum(lines.filter((l) => l.mainGroup === g)) })).sort((a, b) => b.t - a.t);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="bg-[#0B1B40] text-white"><th className="px-2 py-1.5 text-left">MAIN GROUP</th>
          {comps.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 text-right">{c}</th>)}<th className="px-2 py-1.5 text-right">Grand Total</th></tr></thead>
        <tbody>
          {groups.map(({ g, t }) => (
            <tr key={g} className="border-b"><td className="px-2 py-1">{g}</td>
              {comps.map((c) => <td key={c} className="px-2 py-1 text-right tabular-nums">{fmtAmt(sum(lines.filter((l) => l.mainGroup === g && l.component === c)))}</td>)}
              <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtAmt(t)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sheets ───────────────────────────────────────────────────────────────────────────────────

function Analytics({ lines, months, flags, tb }: { lines: ExpLine[]; months: string[]; flags: Map<string, string[]>; tb: ReturnType<typeof tbStatus> }) {
  const total = sum(lines);
  const direct = sum(lines.filter((l) => l.expType === "DIRECT"));
  const other = sum(lines.filter((l) => l.expType === "OTHER"));
  const indirect = total - direct - other;
  const last = months[months.length - 1], prev = months[months.length - 2];
  const lastT = sum(lines.filter((l) => l.month === last)), prevT = prev ? sum(lines.filter((l) => l.month === prev)) : 0;
  const high = [...flags.values()].filter((r) => r.some((x) => x.includes("Top-5")) || r.length > 1).length;
  const trend = months.map((m) => ({
    month: monthLabel(m),
    Direct: sum(lines.filter((l) => l.month === m && l.expType === "DIRECT")),
    Indirect: sum(lines.filter((l) => l.month === m && l.expType === "INDIRECT")),
    Other: sum(lines.filter((l) => l.month === m && l.expType === "OTHER")),
  }));
  const byCompany = COMPANIES.map((c) => ({ name: c, value: sum(lines.filter((l) => l.company === c)) })).filter((x) => x.value);
  // Group and mover charts leave out Other (inventory valuation, exchange) — user, 23-Oct-2026.
  const operating = lines.filter((l) => l.expType !== "OTHER");
  const topGroups = (t: string, n: number) => pivot(operating.filter((l) => l.expType === t), [(l) => l.mainGroup])
    .filter((r) => r.kind === "detail").slice(0, n).map((r) => ({ name: r.path[0], value: r.total }));
  const groups = pivot(operating, [(l) => l.mainGroup]).filter((r) => r.kind === "detail").slice(0, 10).map((r) => ({ name: r.path[0], value: r.total }));
  const movers = prev ? monthVariance(operating, months, prev, last, DEFAULT_MATERIALITY) : [];
  const ups = movers.filter((v) => v.change > 0).slice(0, 5), downs = movers.filter((v) => v.change < 0).slice(0, 5);
  const moverData = [...ups, ...downs].map((v) => ({ name: v.mainGroup, change: v.change }));
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);

  const kpis = [
    { label: "Total expense", value: fmtCr(total), sub: `${monthLabel(months[0])} – ${monthLabel(last)}` },
    { label: "Direct / Indirect / Other", value: `${pct(direct)}% / ${pct(indirect)}% / ${pct(other)}%`, sub: `${fmtCr(direct)} / ${fmtCr(indirect)} / ${fmtCr(other)}` },
    { label: `${monthLabel(last)} vs ${prev ? monthLabel(prev) : "-"}`, value: prevT > 0 ? `${(((lastT - prevT) / prevT) * 100).toFixed(1)}%` : "n/m", sub: `${fmtCr(lastT)} vs ${fmtCr(prevT)}`, alarm: lastT > prevT },
    { label: "HIGH review groups", value: String(high), sub: "Top-5 driver or 2+ flags" },
    { label: "TB status", value: tb.tied ? "Tied" : "NOT tied", sub: tb.tied ? `as at ${dmy(tb.asOf)}` : `${tb.gaps.length} gap line(s)`, alarm: !tb.tied },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-md border border-l-4 border-l-[#FF6A1F] p-3">
            <div className="text-[11px] font-semibold uppercase text-muted-foreground">{k.label}</div>
            <div className={cn("text-lg font-bold", k.alarm && "text-destructive")}>{k.value}</div>
            <div className="text-xs text-muted-foreground">{k.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartBox title="Monthly trend — Direct and Indirect">
          <BarChart data={trend}><CartesianGrid stroke={CHART_GRID} vertical={false} /><XAxis dataKey="month" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} tickFormatter={tickCr} width={52} /><Tooltip formatter={(v: number) => fmtCr(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Direct" stackId="a" fill={NAVY} /><Bar dataKey="Indirect" stackId="a" fill={ORANGE} /><Bar dataKey="Other" stackId="a" fill="#8A99B0" /></BarChart>
        </ChartBox>
        <ChartBox title="By company">
          <BarChart data={byCompany} layout="vertical"><CartesianGrid stroke={CHART_GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={tickCr} /><YAxis type="category" dataKey="name" tick={AXIS_TICK} width={80} />
            <Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="value" fill={NAVY}>{byCompany.map((_, i) => <Cell key={i} fill={PALETTE[i]} />)}</Bar></BarChart>
        </ChartBox>
        <ChartBox title="Direct expenses — by main group">
          <BarChart data={topGroups("DIRECT", 10)} layout="vertical"><CartesianGrid stroke={CHART_GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={tickCr} /><YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={150} />
            <Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="value" fill={NAVY} /></BarChart>
        </ChartBox>
        <ChartBox title="Indirect expenses — by main group (top 10)">
          <BarChart data={topGroups("INDIRECT", 10)} layout="vertical"><CartesianGrid stroke={CHART_GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={tickCr} /><YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={150} />
            <Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="value" fill={ORANGE} /></BarChart>
        </ChartBox>
        <ChartBox title="Top 10 main groups">
          <BarChart data={groups} layout="vertical"><CartesianGrid stroke={CHART_GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={tickCr} /><YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={150} />
            <Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="value" fill={ORANGE} /></BarChart>
        </ChartBox>
        <ChartBox title={`Top movers — ${monthLabel(last)} vs ${prev ? monthLabel(prev) : "-"}`}>
          <BarChart data={moverData} layout="vertical"><CartesianGrid stroke={CHART_GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={tickCr} /><YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={150} />
            <Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="change">{moverData.map((d, i) => <Cell key={i} fill={d.change > 0 ? "#E5484D" : "#27AE60"} />)}</Bar></BarChart>
        </ChartBox>
      </div>
      <div className="rounded-md border-l-4 border-l-[#FF6A1F] bg-[#FFF1E8] p-4">
        <div className="mb-2 text-xs font-bold uppercase text-[#FF6A1F]">CFO notes</div>
        <ul className="list-disc space-y-1 pl-5 text-sm">{cfoNotes(lines, months, tb, flags).map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
    </div>
  );
}

function IndexSheet({ index, onOpen }: { index: SheetEntry[]; onOpen: (id: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-[#0B1B40] text-white"><th className="px-2 py-1.5 text-left">Sheet</th><th className="px-2 py-1.5 text-left">Description</th><th className="px-2 py-1.5 text-left">Must Review</th></tr></thead>
      <tbody>
        {index.map((s) => (
          <tr key={s.id} className={cn("border-b", s.review === "HIGH" && "bg-[#FFE6B3]")}>
            <td className="px-2 py-1"><button className="text-primary underline" onClick={() => onOpen(s.id)}>{s.name}</button></td>
            <td className="px-2 py-1">{s.description}</td><td className="px-2 py-1 font-semibold">{s.review}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GroupSheet({ group, lines, months }: { group: string; lines: ExpLine[]; months: string[] }) {
  const parties = useMemo(() => buildTree(lines, [(l) => l.party]).children, [lines]);
  const lastTwo = months.slice(-2);
  const pareto = new Map(lastTwo.map((m) => [m, paretoSet(new Map(parties.map((n) => [n.label, n.byMonth.get(m) ?? 0])))]));
  const monthly = months.map((m) => ({ month: monthLabel(m), value: sum(lines.filter((l) => l.month === m)) }));
  const top5 = parties.slice(0, 5).map((n) => ({ name: n.label, value: n.total }));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartBox title={`${group} — monthly`} h={200}>
          <BarChart data={monthly}><CartesianGrid stroke={CHART_GRID} vertical={false} /><XAxis dataKey="month" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} tickFormatter={tickCr} width={52} /><Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="value" fill={ORANGE} /></BarChart>
        </ChartBox>
        <ChartBox title="Top 5 vendors" h={200}>
          <BarChart data={top5} layout="vertical"><CartesianGrid stroke={CHART_GRID} horizontal={false} /><XAxis type="number" tick={AXIS_TICK} tickFormatter={tickCr} />
            <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 10 }} width={170} /><Tooltip formatter={(v: number) => fmtCr(v)} /><Bar dataKey="value" fill={NAVY} /></BarChart>
        </ChartBox>
      </div>
      <p className="text-xs italic text-muted-foreground">Green = top 80% of that month's spend ({lastTwo.map(monthLabel).join(", ")}) — open the quarter to see it.</p>
      <TreeTable lines={lines} months={months} levels={["PARTY", "LEDGER"]} keys={[(l) => l.party, (l) => l.gl]}
        cellClass={(n, c) => (n.depth === 1 && c.kind === "month" && pareto.get(c.key)?.has(n.label) ? "bg-[#C6EFCE]" : "")}
        extra={{ header: "REMARKS", cell: (n) => (n.depth === 1 ? <span className="text-muted-foreground">{draftRemark(n.lines.map((l) => l.narration))}</span> : "") }} />
    </div>
  );
}

function VarianceSheet({ lines, months }: { lines: ExpLine[]; months: string[] }) {
  const [cur, setCur] = useState(months[months.length - 1]);
  const [byGl, setByGl] = useState(false);
  const [onlyMaterial, setOnlyMaterial] = useState(true);
  const [mat, setMat] = useState<Materiality>(DEFAULT_MATERIALITY);
  const ci = months.indexOf(cur);
  if (ci < 1) return <p className="text-muted-foreground">Pick a range of at least two months to see month-on-month variance.</p>;
  const prev = months[ci - 1];
  const all = monthVariance(lines, months, prev, cur, mat, byGl);
  const rows = onlyMaterial ? all.filter((r) => r.material) : all;
  const movement = sum(lines.filter((l) => l.month === cur)) - sum(lines.filter((l) => l.month === prev));
  const control = all.reduce((s, r) => s + r.change, 0);
  const wf = waterfall(sum(lines.filter((l) => l.month === prev)), all.slice(0, 8), movement, monthLabel(prev), monthLabel(cur));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <MonthSelect label="Month" value={cur} months={months.slice(1)} onChange={setCur} />
        <span className="text-muted-foreground">vs {monthLabel(prev)}</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={byGl} onChange={(e) => setByGl(e.target.checked)} /> Ledger level</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyMaterial} onChange={(e) => setOnlyMaterial(e.target.checked)} /> Material only</label>
        <label className="flex items-center gap-1">≥ ₹<input className="h-8 w-24 rounded border px-1" type="number" value={mat.amount} onChange={(e) => setMat({ ...mat, amount: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-1">or ≥ <input className="h-8 w-16 rounded border px-1" type="number" value={mat.pct} onChange={(e) => setMat({ ...mat, pct: Number(e.target.value) })} />%</label>
      </div>
      <ChartBox title={`Bridge ${monthLabel(prev)} → ${monthLabel(cur)} (top 8 moves)`} h={240}>
        <BarChart data={wf}><CartesianGrid stroke={CHART_GRID} vertical={false} /><XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0} />
          <YAxis tick={AXIS_TICK} tickFormatter={tickCr} width={52} /><Tooltip formatter={(v: number, n: string) => (n === "base" ? null : fmtCr(v))} />
          <Bar dataKey="base" stackId="w" fill="transparent" /><Bar dataKey="value" stackId="w">{wf.map((d, i) => <Cell key={i} fill={d.color} />)}</Bar></BarChart>
      </ChartBox>
      <p className={cn("text-xs", Math.abs(control - movement) < 0.01 ? "text-emerald-700" : "text-destructive")}>
        Control: sum of changes ₹{fmtAmt(control)} = movement in month totals ₹{fmtAmt(movement)} {Math.abs(control - movement) < 0.01 ? "✓" : "✗ MISMATCH"}
      </p>
      <VarianceTable rows={rows} byGl={byGl} lines={lines} prev={prev} cur={cur} />
    </div>
  );
}

function waterfall(start: number, moves: VarianceRow[], movement: number, prevL: string, curL: string) {
  const out: { name: string; base: number; value: number; color: string }[] = [{ name: prevL, base: 0, value: start, color: NAVY }];
  let run = start;
  for (const m of moves) {
    out.push({ name: m.mainGroup.slice(0, 14), base: m.change >= 0 ? run : run + m.change, value: Math.abs(m.change), color: m.change >= 0 ? "#E5484D" : "#27AE60" });
    run += m.change;
  }
  const other = movement - moves.reduce((s, m) => s + m.change, 0);
  if (Math.abs(other) > 0.5) {
    out.push({ name: "Others", base: other >= 0 ? run : run + other, value: Math.abs(other), color: "#8A99B0" });
    run += other;
  }
  out.push({ name: curL, base: 0, value: run, color: NAVY });
  return out;
}

function VarianceTable({ rows, byGl, lines, prev, cur }: { rows: VarianceRow[]; byGl: boolean; lines: ExpLine[]; prev: string; cur: string }) {
  const [openRow, setOpenRow] = useState<number | null>(null);
  const heads = ["Type", "Main group", ...(byGl ? ["Ledger"] : []), "Prev month", "This month", "Change ₹", "Change %", "Inc / Dec", "Nature", "Main drivers"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="bg-[#0B1B40] text-white">
          {heads.map((h) => <th key={h} className={cn("whitespace-nowrap px-2 py-1.5", /month|Change/.test(h) ? "text-right" : "text-left")}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={i}>
              <tr className="cursor-pointer border-b align-top hover:bg-muted/50" onClick={() => setOpenRow(openRow === i ? null : i)} title="Show the transactions of both months">
                <td className="px-2 py-1">{r.expType}</td>
                <td className="px-2 py-1"><span className="inline-flex items-center gap-1">{openRow === i ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{r.mainGroup}</span></td>
                {byGl && <td className="px-2 py-1">{r.gl}</td>}
                <td className="px-2 py-1 text-right tabular-nums">{fmtAmt(r.prev)}</td><td className="px-2 py-1 text-right tabular-nums">{fmtAmt(r.cur)}</td>
                <td className={cn("px-2 py-1 text-right font-semibold tabular-nums", r.change > 0 ? "text-destructive" : "text-emerald-700")}>{fmtAmt(r.change)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.pct === null ? "n/m" : `${r.pct.toFixed(1)}%`}</td>
                <td className={cn("px-2 py-1 font-semibold", r.direction === "Increase" ? "text-destructive" : "text-emerald-700")}>{r.direction === "Increase" ? "▲ " : r.direction === "Decrease" ? "▼ " : ""}{r.direction}</td>
                <td className="px-2 py-1">{r.nature}</td>
                <td className="px-2 py-1">{r.drivers.map((d) => <div key={d.label}><b>{d.label}</b> {fmtCr(d.change)}{d.narration && <span className="text-muted-foreground"> — {d.narration.slice(0, 80)}</span>}</div>)}</td>
              </tr>
              {openRow === i && (
                <tr><td colSpan={heads.length} className="bg-muted/30 p-2">
                  <TxnList title={`${r.mainGroup}${r.gl ? ` › ${r.gl}` : ""} — ${monthLabel(prev)} and ${monthLabel(cur)}`} onClose={() => setOpenRow(null)}
                    lines={lines.filter((l) => (l.month === prev || l.month === cur) && l.expType === r.expType && l.mainGroup === r.mainGroup && (!r.gl || l.gl === r.gl))} />
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TbSheet({ data, lines }: { data: ExpenseCfoData; lines: ExpLine[] }) {
  const chart = COMPANIES.map((c) => {
    const g = data.ties.filter((t) => t.company === c && t.level === "group");
    return { name: c, tb: g.reduce((s, t) => s + t.tb, 0), report: g.reduce((s, t) => s + t.lines, 0) };
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each company's Direct and Indirect Expenses, and every first-level group or ledger under them, against Tally's own Trial Balance for the same period
        (1-Apr to the TB date; the filters above do not apply to this check). Tolerance ₹{TIE_TOLERANCE}.
      </p>
      <ChartBox title="Report vs Tally TB, per company" h={220}>
        <BarChart data={chart}><CartesianGrid stroke={CHART_GRID} vertical={false} /><XAxis dataKey="name" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} tickFormatter={tickCr} width={52} /><Tooltip formatter={(v: number) => fmtCr(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="tb" name="Tally TB" fill={NAVY} /><Bar dataKey="report" name="This report" fill={ORANGE} /></BarChart>
      </ChartBox>
      <table className="w-full text-xs">
        <thead><tr className="bg-[#0B1B40] text-white">{["Company", "Type", "Level", "Group / ledger", "Tally TB", "This report", "Gap", "TB as at", "Status"].map((h) =>
          <th key={h} className={cn("px-2 py-1.5", ["Tally TB", "This report", "Gap"].includes(h) ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
        <tbody>
          {data.ties.slice().sort((a, b) => COMPANIES.indexOf(a.company as never) - COMPANIES.indexOf(b.company as never) || a.expType.localeCompare(b.expType) || (a.level === "group" ? -1 : 1)).map((t, i) => {
            const bad = Math.abs(t.gap) > TIE_TOLERANCE;
            return (
              <tr key={i} className={cn("border-b", t.level === "group" && "bg-muted font-semibold", bad && "bg-red-50 text-red-800")}>
                <td className="px-2 py-1">{t.company}</td><td className="px-2 py-1">{t.expType}</td><td className="px-2 py-1">{t.level === "group" ? "Total" : "Group / ledger"}</td>
                <td className="px-2 py-1">{t.name}</td><td className="px-2 py-1 text-right tabular-nums">{fmtAmt(t.tb)}</td><td className="px-2 py-1 text-right tabular-nums">{fmtAmt(t.lines)}</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{fmtAmt(t.gap)}</td><td className="px-2 py-1">{dmy(t.asOf)}</td><td className="px-2 py-1">{bad ? "GAP" : "Tied"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {Object.entries(data.meta.companies).some(([, c]) => c.notes.length) && (
        <div className="rounded-md bg-muted p-3 text-xs">
          <b>Loader notes</b>
          <ul className="list-disc pl-5">{Object.entries(data.meta.companies).flatMap(([co, c]) => c.notes.map((n) => <li key={co + n}>{co}: {n}</li>))}</ul>
        </div>
      )}
      <h3 className="font-semibold">Bridge to the old Excel basis (selected period and filters)</h3>
      <table className="w-full max-w-2xl text-sm">
        <tbody>{bridge(lines).map((b, i) => <tr key={i} className={cn("border-b", i === 2 && "font-semibold")}><td className="px-2 py-1">{b.label}</td><td className="px-2 py-1 text-right tabular-nums">{fmtAmt(b.amount)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

const RAW_PAGE = 200;

function RawData({ lines }: { lines: ExpLine[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(lines.length / RAW_PAGE));
  const slice = lines.slice(page * RAW_PAGE, (page + 1) * RAW_PAGE);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{lines.length.toLocaleString("en-IN")} lines · total ₹{fmtAmt(sum(lines))} — use the filter bar above to narrow them.</span>
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Every line is in the Excel download.</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="text-xs">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-[#FFC000]">{["Company", "Date", "Vch type", "Vch no", "EXP TYPE", "MAIN GROUP", "SUB-GROUP", "TYPES (GL)", "LEDGER NAME (party)", "Amount", "Narration"].map((h) =>
            <th key={h} className={cn("whitespace-nowrap px-2 py-1.5", h === "Amount" ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
          <tbody>{slice.map((l, i) => (
            <tr key={i} className="border-b">
              <td className="px-2 py-1">{l.company}</td><td className="whitespace-nowrap px-2 py-1">{dmy(l.date)}</td><td className="px-2 py-1">{l.voucherType}</td>
              <td className="px-2 py-1">{l.voucherNo}</td><td className="px-2 py-1">{l.expType}</td><td className="px-2 py-1">{l.mainGroup}</td><td className="px-2 py-1">{l.subGroup}</td>
              <td className="px-2 py-1">{l.gl}</td><td className="px-2 py-1">{l.party}</td><td className="px-2 py-1 text-right tabular-nums">{fmtAmt(l.amount)}</td>
              <td className="max-w-[320px] truncate px-2 py-1" title={l.narration}>{l.narration}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
