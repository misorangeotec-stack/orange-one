import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Kpi from "@/shared/components/ui/Kpi";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { exportSheetsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { appName } from "../../appInfo";
import {
  daysBetween, fmtDate, STATE_LABEL, type ExpiryState, type NoLotStock, type StockLot,
} from "../lib/expiry";
import { useExpiryStatus } from "../lib/useExpiryStatus";
import FreshnessBar from "../components/FreshnessBar";
import {
  ActiveFilters, AGE_BANDS, ageBand, DAYS_LEFT_BANDS, daysLeftBand, monthOf, QTY_BANDS, qtyBand,
  SortFilterBody, SortFilterHead, TableTools, useSortFilter, type Col,
} from "../components/SortFilterHead";
import { PurchaseDateCell, purchaseText, ReturnDateCell } from "../components/LotDates";

/**
 * INK EXPIRY — which in-stock ink lots have their expiry date in Tally, and which don't.
 *
 * The "To update" tab is the accountant's list: export it, they enter the dates in Tally,
 * ConnectWave syncs, and the lot moves to "Updated" on the next Refresh.
 *
 * ⚠ READ-ONLY. Nothing is written anywhere — the page only reads ConnectWave.
 */

const APP = appName("ink-expiry");

type Tab = "todo" | "expired" | "updated" | "all" | "nolot";

const TABS: { key: Tab; label: string }[] = [
  { key: "todo", label: "To update" },
  { key: "expired", label: "Expired" },
  { key: "updated", label: "Updated" },
  { key: "all", label: "All in-stock lots" },
  { key: "nolot", label: "Stock without lot" },
];

const inTab = (t: Tab, l: StockLot) =>
  t === "all" ? true
  : t === "todo" ? l.state === "missing" || l.state === "invalid"
  : t === "expired" ? l.state === "expired"
  : l.state === "updated";

const STATE_CLS: Record<ExpiryState, string> = {
  missing: "bg-orange/10 text-orange",
  invalid: "bg-grey-2/20 text-grey",
  expired: "bg-ryg-red/10 text-ryg-red",
  updated: "bg-teal/10 text-teal",
};

const fmtQty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const age = (l: StockLot, today: string) => (l.inward ? daysBetween(l.inward, today) : null);

export default function ExpiryStatus() {
  const { q, today, progress, asOf, refreshing } = useExpiryStatus();

  const [tab, setTab] = useState<Tab>("todo");
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const lots = q.data?.lots ?? [];
  const noLot = q.data?.noLot ?? [];

  const companyOptions = useMemo(
    () => [...new Set([...lots, ...noLot].map((l) => l.company))].sort().map((c) => ({ value: c, label: c })), [lots, noLot]);
  const categoryOptions = useMemo(
    () => [...new Set([...lots, ...noLot]
      .filter((l) => companies.length === 0 || companies.includes(l.company)).map((l) => l.category))]
      .sort().map((c) => ({ value: c, label: c || "(no group)" })), [lots, noLot, companies]);

  const pick = <T extends { company: string; category: string; item: string }>(rows: T[], extra: (r: T) => string) =>
    rows.filter((r) =>
      (companies.length === 0 || companies.includes(r.company)) &&
      (categories.length === 0 || categories.includes(r.category)) &&
      matchesSearch(search, `${r.item} ${r.category} ${r.company} ${extra(r)}`));

  const base = useMemo(() => pick(lots, (l) => `${l.lot} ${l.godown}`), [lots, companies, categories, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseNoLot = useMemo(() => pick(noLot, () => ""), [noLot, companies, categories, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => base.filter((l) => inTab(tab, l)), [base, tab]);

  const count = useMemo(() => {
    const c = { todo: 0, expired: 0, updated: 0, all: base.length, nolot: baseNoLot.length, todoQty: 0, noLotQty: 0 };
    for (const l of base) {
      if (inTab("todo", l)) { c.todo++; c.todoQty += l.qty; }
      else if (l.state === "expired") c.expired++;
      else c.updated++;
    }
    c.noLotQty = baseNoLot.reduce((s, r) => s + r.qty, 0);
    return c;
  }, [base, baseNoLot]);

  // Per company: how far the accountant has got.
  const perCompany = useMemo(() => {
    const m = new Map<string, { total: number; done: number; todo: number }>();
    for (const l of lots) {
      const c = m.get(l.company) ?? { total: 0, done: 0, todo: 0 };
      c.total++;
      if (inTab("todo", l)) c.todo++; else c.done++;
      m.set(l.company, c);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lots]);

  // Table columns: click a heading to sort, pick under it to filter.
  const lotCols: Col<StockLot>[] = useMemo(() => [
    { key: "company", label: "Company", text: (l) => l.company, sort: (l) => l.company },
    { key: "item", label: "Stock item", text: (l) => l.item, sort: (l) => l.item,
      render: (l) => <div className="font-medium text-ink">{l.item}</div> },
    { key: "inkCategory", label: "Category", text: (l) => l.inkCategory, sort: (l) => l.inkCategory },
    { key: "category", label: "Group", text: (l) => l.category || "(no group)", sort: (l) => l.category,
      render: (l) => <span className="text-grey">{l.category}</span> },
    { key: "lot", label: "Lot no.", text: (l) => l.lot, sort: (l) => l.lot, className: "font-mono",
      render: (l) => l.lot },
    { key: "qty", label: "Qty in stock", align: "right", text: (l) => fmtQty(l.qty), sort: (l) => l.qty,
      bucket: (l) => qtyBand(l.qty), bucketOrder: QTY_BANDS,
      render: (l) => <>{fmtQty(l.qty)} <span className="text-grey">{l.uom}</span></> },
    { key: "godown", label: "Godown", text: (l) => l.godown || "—", sort: (l) => l.godown || null },
    { key: "inward", label: "Purchase / prod. date", text: (l) => purchaseText(l) || "—", sort: (l) => l.inward,
      bucket: (l) => monthOf(l.inward, "Unknown"), render: (l) => <PurchaseDateCell lot={l} /> },
    { key: "return", label: "Sales return", text: (l) => (l.returnDate ? fmtDate(l.returnDate) : "—"), sort: (l) => l.returnDate,
      bucket: (l) => (l.returnDate ? monthOf(l.returnDate) : "No return"), render: (l) => <ReturnDateCell lot={l} /> },
    { key: "age", label: "Age (d)", align: "right", text: (l) => String(age(l, today) ?? "—"), sort: (l) => age(l, today),
      bucket: (l) => ageBand(age(l, today)), bucketOrder: AGE_BANDS },
    { key: "expiry", label: "Expiry (Tally)", text: (l) => (l.expiry ? fmtDate(l.expiry) : l.expiryRaw ?? "not in Tally"),
      sort: (l) => l.expiry, bucket: (l) => (l.expiry ? monthOf(l.expiry) : l.expiryRaw ? "Not a valid date" : "Not in Tally"),
      render: (l) => l.expiry ? fmtDate(l.expiry)
        : l.expiryRaw ? <span className="text-grey">“{l.expiryRaw}”</span>
        : <span className="text-grey-2">not in Tally</span> },
    { key: "days", label: "Days left", align: "right", text: (l) => String(l.days ?? "—"), sort: (l) => l.days,
      bucket: (l) => daysLeftBand(l.days), bucketOrder: DAYS_LEFT_BANDS, className: "font-semibold",
      render: (l) => <span className={l.days !== null && l.days < 0 ? "text-ryg-red" : ""}>{l.days ?? "—"}</span> },
    { key: "status", label: "Status", text: (l) => STATE_LABEL[l.state], sort: (l) => STATE_LABEL[l.state],
      render: (l) => <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${STATE_CLS[l.state]}`}>{STATE_LABEL[l.state]}</span> },
  ], [today]);
  const noLotCols: Col<NoLotStock>[] = useMemo(() => [
    { key: "company", label: "Company", text: (r) => r.company, sort: (r) => r.company },
    { key: "item", label: "Stock item", text: (r) => r.item, sort: (r) => r.item,
      render: (r) => <div className="font-medium text-ink">{r.item}</div> },
    { key: "inkCategory", label: "Category", text: (r) => r.inkCategory, sort: (r) => r.inkCategory },
    { key: "category", label: "Group", text: (r) => r.category || "(no group)", sort: (r) => r.category,
      render: (r) => <span className="text-grey">{r.category}</span> },
    { key: "qty", label: "Qty in stock", align: "right", text: (r) => fmtQty(r.qty), sort: (r) => r.qty,
      bucket: (r) => qtyBand(r.qty), bucketOrder: QTY_BANDS,
      render: (r) => <>{fmtQty(r.qty)} <span className="text-grey">{r.uom}</span></> },
    { key: "uom", label: "Unit", text: (r) => r.uom, sort: (r) => r.uom },
  ], []);
  const ctl = useSortFilter(rows, lotCols, "status-lots");
  const ctlNoLot = useSortFilter(baseNoLot, noLotCols, "status-nolot");

  const resetKey = `${tab}|${search}|${companies.join()}|${categories.join()}`;
  const pg = usePagination(ctl.view, { pageSize: 50, resetKey: `${resetKey}|${ctl.stamp}` });
  const pgNoLot = usePagination(ctlNoLot.view, { pageSize: 50, resetKey: `${resetKey}|${ctlNoLot.stamp}` });

  const lotColumns = (forAccountant: boolean): ExportColumn<StockLot>[] => [
    { header: "Company", width: 18, value: (l) => l.company },
    { header: "Category", width: 18, value: (l) => l.inkCategory },
    { header: "Group (stock group)", width: 30, value: (l) => l.category },
    { header: "Stock item", width: 40, value: (l) => l.item },
    { header: "Lot no.", width: 22, value: (l) => l.lot },
    { header: "Qty in stock", width: 12, value: (l) => l.qty },
    { header: "Unit", width: 6, value: (l) => l.uom },
    { header: "Value (₹, Tally closing rate)", width: 14, value: (l) => Math.round(l.value) },
    { header: "Godown", width: 18, value: (l) => l.godown },
    { header: "Purchase / prod. date", width: 14, value: (l) => (l.inward ? fmtDate(l.inward) : "") },
    { header: "Purchase / prod. (how, where)", width: 28, value: (l) => purchaseText(l) },
    { header: "Sales return date", width: 14, value: (l) => (l.returnDate ? fmtDate(l.returnDate) : "") },
    { header: "Age (days)", width: 9, value: (l) => age(l, today) ?? "" },
    ...(forAccountant
      ? [
          { header: "What is in Tally now", width: 16, value: (l: StockLot) => l.expiryRaw ?? "(blank)" },
          { header: "Expiry date to enter", width: 16, value: () => "" },
          { header: "Updated by / on", width: 18, value: () => "" },
        ]
      : [
          { header: "Expiry status", width: 18, value: (l: StockLot) => STATE_LABEL[l.state] },
          { header: "Mfg date", width: 13, value: (l: StockLot) => (l.mfd ? fmtDate(l.mfd) : "") },
          { header: "Expiry date", width: 13, value: (l: StockLot) => (l.expiry ? fmtDate(l.expiry) : l.expiryRaw ?? "") },
          { header: "Days to expiry", width: 10, value: (l: StockLot) => l.days ?? "" },
          { header: "Group path", width: 50, value: (l: StockLot) => l.path },
        ]),
  ];
  const noLotColumns: ExportColumn<NoLotStock>[] = [
    { header: "Company", width: 18, value: (r) => r.company },
    { header: "Category", width: 18, value: (r) => r.inkCategory },
    { header: "Group (stock group)", width: 30, value: (r) => r.category },
    { header: "Stock item", width: 40, value: (r) => r.item },
    { header: "Qty in stock", width: 12, value: (r) => r.qty },
    { header: "Unit", width: 6, value: (r) => r.uom },
  ];

  const filters = () => {
    const t = tab === "nolot" ? { cols: noLotCols as Col<never>[], f: ctlNoLot.filters, s: ctlNoLot.sort }
      : { cols: lotCols as Col<never>[], f: ctl.filters, s: ctl.sort };
    return [
      companies.length ? `Company: ${companies.join(", ")}` : "",
      categories.length ? `Group: ${categories.join(", ")}` : "",
      search ? `Search: ${search}` : "",
      ...t.cols.filter((c) => t.f[c.key]?.length).map((c) => `${c.label}: ${t.f[c.key].join(", ")}`),
      t.s ? `Sorted by ${t.cols.find((c) => c.key === t.s!.key)?.label} (${t.s.dir === "asc" ? "ascending" : "descending"})` : "",
    ].filter(Boolean);
  };
  const notes = [
    `As at ${fmtDate(today)}. Source: ConnectWave (Tally sync)${q.data?.builtAt ? `, last built ${new Date(q.data.builtAt).toLocaleString("en-IN")}` : ""}.`,
    "Ink only — Tally stock groups whose path contains INK. One row per company + item + lot still in stock.",
    "Stock per lot is tied to Tally's closing qty per item; stock no lot accounts for is listed separately — it needs a lot before it can take an expiry.",
    "Expiry = as entered on the lot's batch in Tally. Blank means not entered; it is never estimated.",
  ];

  const exportTab = () => {
    const label = TABS.find((t) => t.key === tab)!.label;
    if (tab === "nolot") {
      return exportSheetsToXlsx({ fileName: "Ink_Stock_Without_Lot", title: `${APP} — ${label}`, filters: filters(), notes,
        sheets: [{ sheetName: label, columns: noLotColumns, rows: ctlNoLot.view }] });
    }
    // Exports exactly what the table shows — column filters and sort order included.
    return exportSheetsToXlsx({
      fileName: tab === "todo" ? "Ink_Expiry_To_Update" : `Ink_Expiry_${label.replace(/\W+/g, "_")}`,
      title: `${APP} — ${label}`, filters: filters(), notes,
      sheets: [{ sheetName: label, columns: lotColumns(tab === "todo"), rows: ctl.view, freezeCols: 3 }],
    });
  };

  const exportAll = () => exportSheetsToXlsx({
    fileName: "Ink_Expiry_Status", title: `${APP} — all sheets`, filters: filters(), notes,
    sheets: [
      { sheetName: "To Update", columns: lotColumns(true), rows: base.filter((l) => inTab("todo", l)), freezeCols: 3 },
      { sheetName: "All In-Stock Lots", columns: lotColumns(false), rows: base, freezeCols: 3,
        rowStyle: (l: StockLot) => l.state === "expired" ? { fill: { fgColor: { rgb: "F8CBAD" } } }
          : inTab("todo", l) ? { fill: { fgColor: { rgb: "FCE4D6" } } } : undefined },
      { sheetName: "Stock Without Lot", columns: noLotColumns, rows: baseNoLot },
    ],
  });

  const [done, total] = progress;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{APP}</h1>
          <p className="text-[13px] text-grey">
            Every ink lot in stock, in every company, and whether its expiry date is entered in Tally.
            Export <b>To update</b> for the accountant. Read live from Tally via ConnectWave.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FreshnessBar asOf={asOf} refreshing={refreshing} progress={progress} />
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? "Loading…" : "Refresh"}
          </Button>
          <Button size="sm" onClick={exportAll} disabled={!q.data}>Export all sheets</Button>
        </div>
      </div>

      {q.isError && (
        <Card className="border-ryg-red/40 p-4 text-[13px] text-ryg-red">
          Could not read stock from ConnectWave: {(q.error as Error).message}
        </Card>
      )}

      {q.isLoading ? (
        <Card className="p-10 text-center text-[13px] text-grey">
          <div>Reading every ink lot from ConnectWave… this takes about a minute.</div>
          {total > 0 && (
            <div className="mx-auto mt-3 h-2 w-64 overflow-hidden rounded-full bg-page">
              <div className="h-full bg-orange transition-all" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
        </Card>
      ) : q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Kpi size="lg" label="Ink lots in stock" value={count.all.toLocaleString("en-IN")} />
            <Kpi size="lg" label="Expiry updated" value={(count.updated + count.expired).toLocaleString("en-IN")}
              hint={count.all ? `${Math.round((100 * (count.updated + count.expired)) / count.all)}% of lots in stock` : undefined} />
            <Kpi size="lg" label="To update (accountant)" value={count.todo.toLocaleString("en-IN")} tone="red"
              hint={`${fmtQty(Math.round(count.todoQty))} in stock with no expiry`} />
            <Kpi size="lg" label="Already expired" value={count.expired} hint="expiry date passed, stock still on hand" />
            <Kpi size="lg" label="Stock without lot" value={fmtQty(Math.round(count.noLotQty))}
              hint={`${count.nolot} items — needs a lot before an expiry can be entered`} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {perCompany.map(([c, v]) => {
              const active = companies.length === 1 && companies[0] === c;
              return (
                <button key={c} onClick={() => setCompanies(active ? [] : [c])}
                  className={"rounded-card border bg-white p-4 text-left shadow-soft transition " +
                    (active ? "border-orange ring-2 ring-orange/20" : "border-line hover:border-orange")}>
                  <div className="flex items-baseline justify-between">
                    <div className="text-[14px] font-bold text-navy">{c}</div>
                    <div className="text-[12px] text-grey">{v.done} / {v.total} updated</div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-page">
                    <div className="h-full bg-teal" style={{ width: `${(100 * v.done) / Math.max(1, v.total)}%` }} />
                  </div>
                  <div className="mt-2 text-[12px] font-semibold text-orange">{v.todo} lots to update</div>
                </button>
              );
            })}
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <div className="flex overflow-hidden rounded-lg border border-line">
                {TABS.map((t) => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={"px-3 py-1.5 text-[12.5px] font-semibold " + (tab === t.key ? "bg-navy text-white" : "text-grey hover:text-navy")}>
                    {t.label} <span className="opacity-70">{count[t.key]}</span>
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item, lot no., godown…"
                className="h-9 w-60 rounded-lg border border-line px-3 text-[13px] outline-none focus:border-orange"
              />
              <MultiSelect values={companies} onChange={setCompanies} options={companyOptions} placeholder="All companies" className="w-52" />
              <MultiSelect values={categories} onChange={setCategories} options={categoryOptions} placeholder="All groups"
                searchable className="w-64" />
              <div className="ml-auto flex items-center gap-2">
                {tab === "nolot" ? <TableTools cols={noLotCols} ctl={ctlNoLot} /> : <TableTools cols={lotCols} ctl={ctl} />}
                <Button variant="outline" size="sm" onClick={exportTab}>
                  {tab === "todo" ? "Export for accountant" : "Export Excel"}
                </Button>
              </div>
            </div>

            {tab === "nolot" ? (
              <>
                <ActiveFilters ctl={ctlNoLot} shown={ctlNoLot.view.length} total={baseNoLot.length} />
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <SortFilterHead cols={noLotCols} ctl={ctlNoLot} />
                    <SortFilterBody cols={noLotCols} ctl={ctlNoLot} rows={pgNoLot.pageItems} rowKey={(r) => `${r.company}|${r.item}`} empty="Nothing matches." />
                  </table>
                </div>
                <Pagination state={pgNoLot} rowsLabel="items" pageSizeOptions={[50, 100, 250]} />
              </>
            ) : (
              <>
                <ActiveFilters ctl={ctl} shown={ctl.view.length} total={rows.length} />
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <SortFilterHead cols={lotCols} ctl={ctl} />
                    <SortFilterBody cols={lotCols} ctl={ctl} rows={pg.pageItems} rowKey={(l) => `${l.company}|${l.item}|${l.lot}`} empty="No lots match." />
                  </table>
                </div>
                <Pagination state={pg} rowsLabel="lots" pageSizeOptions={[50, 100, 250]} />
              </>
            )}
          </Card>

          <p className="text-[11.5px] text-grey">
            Stock per lot is tied to Tally's closing quantity per item. Expiry is as entered on the lot in Tally — a blank is
            never estimated. After the accountant updates Tally, ConnectWave picks it up within the hour; press Refresh.
          </p>
        </>
      )}
    </div>
  );
}
