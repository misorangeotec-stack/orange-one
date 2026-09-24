/**
 * Batch Costing — Reports → Bushra-Report.
 *
 * Tally's Voucher Register for STOCK JOURNAL-PRODUCTION, one voucher = one production batch:
 * the finished good and scrap it produced (Output, positive) and every raw material it consumed
 * (Consumption, negative), each line carrying five columns Tally does not have — Type, Category,
 * Colour, Item Group, Item Category. Data and signs: lib/batchCosting.ts. Rules:
 * lib/batchCostingRules.ts.
 *
 * PAGINATED BY VOUCHER, NOT BY ROW. A batch split across two pages is unreadable — its output is
 * on one and half its consumption on the next — so usePagination pages the voucher groups (25 per
 * page, the project default) and every group renders whole.
 *
 * TWO KINDS OF FILTER, deliberately:
 *   voucher-level  Colour, Item Group, Item Category, Search — keep or drop WHOLE batches.
 *                  Search matches the voucher number or any item in the batch, and then shows the
 *                  whole batch, because "which batches used REACTIVE POWDER BLUE 72" wants the
 *                  batch, not the lone consumption line.
 *   line-level     Type, Category — hide lines inside the batches that remain (e.g. only the
 *                  finished goods, for an output list).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Factory, Info, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { salesFyOptions } from "@hub/lib/salesReport";
import { fyBounds, isoToYmd, periodBand, tallyDate, ymdToIso } from "@hub/lib/stockSummary";
import {
  PRODUCTION_COMPANY_LABEL, fmtMoney, fmtRegisterQty, fmtTonnes, loadBatchCosting,
  loadLatestProductionDate, productionFyOptions, type BatchCostingRow,
} from "@hub/lib/batchCosting";
import { exportBatchCostingXlsx } from "@hub/lib/exportBatchCosting";
import { isScrapItem } from "@hub/lib/batchCostingRules";

const BASE = "/outstanding-dashboard";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const opts = (vals: Iterable<string>): MultiSelectOption[] =>
  [...new Set(vals)].filter(Boolean).sort(collator.compare).map((v) => ({ value: v, label: v }));

/** One production batch as the table renders it. */
interface VoucherGroup {
  key: string;
  rows: BatchCostingRow[];
}

const CATEGORY_PILL: Record<BatchCostingRow["category"], string> = {
  "Finished Good": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  Scrap: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "RM Consumption": "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
};

/** Unsigned quantity per unit — quantities never add across units. */
function unitTotals(rows: BatchCostingRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.uom ?? "", (m.get(r.uom ?? "") ?? 0) + Math.abs(r.qty));
  return m;
}

/** "12,345.00 KGS + 10.00 LTR". */
function fmtUnitTotals(m: Map<string, number>): string {
  if (!m.size) return "—";
  return [...m].sort((a, b) => b[1] - a[1]).map(([u, q]) => fmtRegisterQty(q, u)).join(" + ");
}

const qtyByUnit = (rows: BatchCostingRow[]) => fmtUnitTotals(unitTotals(rows));

/** The KGS side of a per-unit total — the only side that can be stated in tonnes. */
const kgsIn = (m: Map<string, number>) => m.get("KGS") ?? 0;

/** a − b, unit by unit. A unit only on the b side comes out negative rather than vanishing. */
function subtractUnits(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
  const out = new Map(a);
  for (const [u, q] of b) out.set(u, (out.get(u) ?? 0) - q);
  return out;
}

export default function BatchCosting() {
  const [params, setParams] = useSearchParams();

  // One company books production (Enterprise — Surat), so there is no company picker. The FY
  // alone picks the book: FY 2025-26 reads the pre-split one (see lib/batchCosting.ts).
  const fyOptions = useMemo(() => productionFyOptions(salesFyOptions()), []);
  const fy = params.get("fy") && fyOptions.includes(params.get("fy")!) ? params.get("fy")! : fyOptions[0];
  const bounds = useMemo(() => fyBounds(fy), [fy]);

  const fromYmd = params.get("from") || bounds.from;
  const toYmd = params.get("to") || bounds.to;
  const validRange = /^\d{8}$/.test(fromYmd) && /^\d{8}$/.test(toYmd) && fromYmd <= toYmd;
  const wholeFy = fromYmd === bounds.from && toYmd === bounds.to;

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const pickFy = (nextFy: string) => {
    const b = fyBounds(nextFy);
    setParam({ fy: nextFy, from: b.from, to: b.to });
  };

  const { data, isLoading, error } = useQuery<BatchCostingRow[]>({
    queryKey: ["batchCosting", fy, fromYmd, toYmd],
    queryFn: () => loadBatchCosting(fy, fromYmd, toYmd),
    enabled: validRange,
    staleTime: 5 * 60 * 1000,
  });
  const all = useMemo(() => data ?? [], [data]);

  const { data: latest } = useQuery({
    queryKey: ["batchCostingLatest", fy],
    queryFn: () => loadLatestProductionDate(fy),
    staleTime: 5 * 60 * 1000,
  });

  /* -------- filters -------- */
  const [types, setTypes] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [itemCats, setItemCats] = useState<string[]>([]);
  // `?q=` seeds the search — the dashboard's batch table links here with the voucher number.
  const [searchRaw, setSearchRaw] = useState(() => params.get("q") ?? "");
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchRaw), 200);
    return () => clearTimeout(t);
  }, [searchRaw]);

  const typeOptions = useMemo(() => opts(all.map((r) => r.type)), [all]);
  const categoryOptions = useMemo(() => opts(all.map((r) => r.category)), [all]);
  const colourOptions = useMemo(() => opts(all.map((r) => r.colour || "(No colour)")), [all]);
  const groupOptions = useMemo(() => opts(all.map((r) => r.item_group ?? "(No finished good)")), [all]);
  // Cascades off Item Group, so "Sublimation" never offers a Reactive category.
  const itemCatOptions = useMemo(
    () => opts(all
      .filter((r) => !groups.length || groups.includes(r.item_group ?? "(No finished good)"))
      .map((r) => r.item_category || "(None)")),
    [all, groups],
  );
  useEffect(() => {
    setItemCats((s) => {
      const next = s.filter((v) => itemCatOptions.some((o) => o.value === v));
      return next.length === s.length ? s : next;
    });
  }, [itemCatOptions]);

  /** Voucher groups after the voucher-level filters, then the line-level ones inside each. */
  const groupsFiltered: VoucherGroup[] = useMemo(() => {
    const byV = new Map<string, BatchCostingRow[]>();
    for (const r of all) {
      const k = `${r.company_guid}|${r.voucher_guid}`;
      const arr = byV.get(k);
      if (arr) arr.push(r);
      else byV.set(k, [r]);
    }
    const q = search.trim().toLowerCase();
    const out: VoucherGroup[] = [];
    for (const [key, rows] of byV) {
      const head = rows[0];
      if (colours.length && !colours.includes(head.colour || "(No colour)")) continue;
      if (groups.length && !groups.includes(head.item_group ?? "(No finished good)")) continue;
      if (itemCats.length && !itemCats.includes(head.item_category || "(None)")) continue;
      if (q && !(
        head.voucher_no.toLowerCase().includes(q) ||
        rows.some((r) => r.item.toLowerCase().includes(q) || r.batches.some((b) => b.toLowerCase().includes(q)))
      )) continue;
      const kept = rows.filter((r) =>
        (!types.length || types.includes(r.type)) &&
        (!categories.length || categories.includes(r.category)));
      if (kept.length) out.push({ key, rows: kept });
    }
    return out;
  }, [all, colours, groups, itemCats, search, types, categories]);

  const filteredRows = useMemo(() => groupsFiltered.flatMap((g) => g.rows), [groupsFiltered]);

  const activeFilterCount = types.length + categories.length + colours.length + groups.length + itemCats.length;

  const page = usePagination(groupsFiltered, {
    resetKey: `${fy}|${fromYmd}|${toYmd}|${types.join(",")}|${categories.join(",")}|` +
      `${colours.join(",")}|${groups.join(",")}|${itemCats.join(",")}|${search}`,
  });

  /* -------- the headline numbers, over the FILTERED set -------- */
  const stats = useMemo(() => {
    const fg = filteredRows.filter((r) => r.category === "Finished Good");
    const scrap = filteredRows.filter((r) => r.category === "Scrap");
    const rm = filteredRows.filter((r) => r.category === "RM Consumption");
    // Scrap that a later batch re-used as an input — the consumption side of the same item.
    const scrapUsed = rm.filter((r) => isScrapItem(r.item));
    const scrapOut = unitTotals(scrap);
    const scrapIn = unitTotals(scrapUsed);
    const scrapLeft = subtractUnits(scrapOut, scrapIn);
    const fgUnits = unitTotals(fg);
    // Tonnes is the headline — the unit the factory talks in — with the exact quantity under it.
    // Only the KGS side converts: a litre is not a kilogram, so other units stay on the exact line.
    return {
      fgTonnes: fmtTonnes(kgsIn(fgUnits)), fgExact: fmtUnitTotals(fgUnits),
      fgValue: fg.reduce((s, r) => s + r.amount, 0),
      scrapTonnes: fmtTonnes(kgsIn(scrapOut)), scrapExact: fmtUnitTotals(scrapOut),
      scrapUsedTonnes: fmtTonnes(kgsIn(scrapIn)), scrapUsedExact: fmtUnitTotals(scrapIn),
      scrapUsedValue: scrapUsed.reduce((s, r) => s + Math.abs(r.amount), 0),
      scrapFinalTonnes: fmtTonnes(kgsIn(scrapLeft)), scrapFinalExact: fmtUnitTotals(scrapLeft),
      rmValue: rm.reduce((s, r) => s + Math.abs(r.amount), 0),
    };
  }, [filteredRows]);

  const ruleFallbacks = useMemo(
    () => [...new Set(all.filter((r) => r.category_from_tally && r.item_group !== "Others").map((r) => r.fg_item))],
    [all],
  );

  const chips: FilterChip[] = [
    ...types.map((v) => ({ label: v, onRemove: () => setTypes((s) => s.filter((x) => x !== v)) })),
    ...categories.map((v) => ({ label: v, onRemove: () => setCategories((s) => s.filter((x) => x !== v)) })),
    ...colours.map((v) => ({ label: v, onRemove: () => setColours((s) => s.filter((x) => x !== v)) })),
    ...groups.map((v) => ({ label: v, onRemove: () => setGroups((s) => s.filter((x) => x !== v)) })),
    ...itemCats.map((v) => ({ label: v, onRemove: () => setItemCats((s) => s.filter((x) => x !== v)) })),
  ];
  const clearAll = () => {
    setTypes([]); setCategories([]); setColours([]); setGroups([]); setItemCats([]);
    setSearchRaw(""); setSearch("");
  };

  const companyLabel = PRODUCTION_COMPANY_LABEL;

  const onExport = () => {
    if (!filteredRows.length) return;
    const filterSummary: string[] = [];
    if (types.length) filterSummary.push(`Type: ${types.join(", ")}`);
    if (categories.length) filterSummary.push(`Category: ${categories.join(", ")}`);
    if (colours.length) filterSummary.push(`Colour: ${colours.join(", ")}`);
    if (groups.length) filterSummary.push(`Item group: ${groups.join(", ")}`);
    if (itemCats.length) filterSummary.push(`Item category: ${itemCats.join(", ")}`);
    if (search.trim()) filterSummary.push(`Search: ${search.trim()}`);
    exportBatchCostingXlsx(filteredRows, { companyLabel, fy, from: fromYmd, to: toYmd, filterSummary });
  };

  const COLS = 12;

  /* ------------------------------------------------------------------ render */

  return (
    <div className="p-6 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to={`${BASE}/reports?cat=bushra-report`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Bushra-Report
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Factory className="h-6 w-6 text-primary" /> Batch Costing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every Stock Journal-Production voucher of <b className="font-semibold text-foreground">{PRODUCTION_COMPANY_LABEL}</b>
            {" "}— what each batch produced and what it consumed, classified by colour, item group and item category.
          </p>
        </div>
        <Button
          onClick={onExport}
          disabled={!filteredRows.length}
          className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-end gap-3 p-3">
          <Field label="Financial year">
            <select
              value={fy}
              onChange={(e) => pickFy(e.target.value)}
              className="h-9 rounded-input border border-border bg-surface px-2 text-sm"
            >
              {fyOptions.map((f) => <option key={f} value={f}>FY {f}</option>)}
            </select>
          </Field>

          <Field label="Period">
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={ymdToIso(fromYmd)}
                min={ymdToIso(bounds.from)}
                max={ymdToIso(bounds.to)}
                onChange={(e) => setParam({ from: isoToYmd(e.target.value) })}
                className="h-9 w-[148px] rounded-input text-sm"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="date"
                value={ymdToIso(toYmd)}
                min={ymdToIso(bounds.from)}
                max={ymdToIso(bounds.to)}
                onChange={(e) => setParam({ to: isoToYmd(e.target.value) })}
                className="h-9 w-[148px] rounded-input text-sm"
              />
              {!wholeFy && (
                <button
                  type="button"
                  onClick={() => setParam({ from: bounds.from, to: bounds.to })}
                  className="text-[11px] text-primary hover:underline whitespace-nowrap ml-1"
                >
                  Full year
                </button>
              )}
            </div>
          </Field>

          <Field label="Search">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchRaw}
                onChange={(e) => setSearchRaw(e.target.value)}
                placeholder="Vch no., item, lot…"
                className="pl-9 h-9 w-56 rounded-input"
              />
            </div>
          </Field>

          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant={panelOpen || activeFilterCount ? "secondary" : "outline"}
              onClick={() => setPanelOpen((o) => !o)}
              className="h-9 gap-1.5 rounded-button"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {panelOpen && (
          <div className="flex flex-wrap items-end gap-3 border-t border-border bg-muted/30 p-3">
            <Field label="Item group">
              <MultiSelectFilter
                options={groupOptions} value={groups} onChange={setGroups}
                allLabel="All Groups" unit="Groups"
                triggerClassName="w-[160px] h-9 text-sm rounded-input border-border"
              />
            </Field>
            <Field label="Item category">
              <MultiSelectFilter
                options={itemCatOptions} value={itemCats} onChange={setItemCats}
                allLabel="All Categories" unit="Categories" searchable
                triggerClassName="w-[220px] h-9 text-sm rounded-input border-border"
              />
            </Field>
            <Field label="Colour">
              <MultiSelectFilter
                options={colourOptions} value={colours} onChange={setColours}
                allLabel="All Colours" unit="Colours"
                triggerClassName="w-[150px] h-9 text-sm rounded-input border-border"
              />
            </Field>
            <Field label="Type">
              <MultiSelectFilter
                options={typeOptions} value={types} onChange={setTypes}
                allLabel="All Types" unit="Types"
                triggerClassName="w-[140px] h-9 text-sm rounded-input border-border"
              />
            </Field>
            <Field label="Category">
              <MultiSelectFilter
                options={categoryOptions} value={categories} onChange={setCategories}
                allLabel="All Categories" unit="Categories"
                triggerClassName="w-[170px] h-9 text-sm rounded-input border-border"
              />
            </Field>
          </div>
        )}
      </div>

      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {!validRange ? (
        <div className="py-16 text-center text-muted-foreground">Pick a valid period (from must be on or before to).</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading production vouchers…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          {/* One compact row: what the batches are, then the scrap trail — produced, re-used and
              what is left, side by side so Total − Consumed = Final reads across. */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Stat label="Batches" value={groupsFiltered.length.toLocaleString("en-IN")} exact={`${filteredRows.length.toLocaleString("en-IN")} lines`} />
            <Stat label="Finished good" value={stats.fgTonnes} exact={stats.fgExact} sub={`₹ ${fmtMoney(stats.fgValue)}`} />
            <Stat label="RM consumed" value={`₹ ${fmtMoney(stats.rmValue)}`} exact="cost of the batches" />
            <Stat label="Total scrap" value={stats.scrapTonnes} exact={stats.scrapExact} sub="output side · no value" />
            <Stat label="Consumed scrap" value={stats.scrapUsedTonnes} exact={stats.scrapUsedExact} sub={`re-used · ₹ ${fmtMoney(stats.scrapUsedValue)}`} />
            <Stat label="Final scrap" value={stats.scrapFinalTonnes} exact={stats.scrapFinalExact} sub="total − consumed" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              <b className="text-foreground font-semibold">{companyLabel}</b>
              {" · "}{periodBand(fromYmd, toYmd)}
            </div>
            {latest && <div>Latest production voucher in the Tally mirror: {tallyDate(latest)}</div>}
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[62vh]">
            <Table className="border-collapse min-w-[1750px] [&_th]:border-b [&_th]:border-border">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60 sticky top-0 z-30">
                  <Head w={90}>Date</Head>
                  <Head w={330}>Particulars</Head>
                  <Head w={170}>Vch No.</Head>
                  <Head w={150} right>Quantity</Head>
                  <Head w={90} right>Rate</Head>
                  <Head w={120} right>Amount</Head>
                  <Head w={200}>Batch</Head>
                  <Head w={100} added>Type</Head>
                  <Head w={130} added>Category</Head>
                  <Head w={90} added>Colour</Head>
                  <Head w={110} added>Item Group</Head>
                  <Head w={200} added>Item Category</Head>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLS} className="py-10 text-center text-sm text-muted-foreground">
                      {all.length === 0
                        ? `No Stock Journal-Production vouchers in ${periodBand(fromYmd, toYmd)}.`
                        : "No batches match those filters."}
                    </TableCell>
                  </TableRow>
                ) : (
                  page.pageItems.flatMap((g) =>
                    g.rows.map((r, i) => {
                      const first = i === 0;
                      const fg = r.category === "Finished Good";
                      return (
                        <TableRow
                          key={`${g.key}|${r.line_no}`}
                          className={`hover:bg-muted/40 ${first ? "border-t-2 border-t-border" : "border-t border-t-border/30"}`}
                        >
                          <Cell className="text-muted-foreground">{first ? tallyDate(r.vch_date) : ""}</Cell>
                          <Cell title={r.item_booked ? `${r.item}\nBooked in Tally as: ${r.item_booked}` : r.item} className={`${fg ? "font-semibold text-foreground" : r.type === "Consumption" ? "pl-7 text-foreground/85" : "pl-7 text-foreground"}`}>
                            {r.item}
                          </Cell>
                          <Cell title={r.voucher_no} className="text-muted-foreground">{first ? r.voucher_no : ""}</Cell>
                          <Cell right className={r.qty < 0 ? "text-foreground/85" : "font-medium"}>{fmtRegisterQty(r.qty, r.uom)}</Cell>
                          <Cell right className="italic text-muted-foreground">{fmtMoney(r.rate)}</Cell>
                          <Cell right className={r.amount < 0 ? "text-foreground/85" : "font-medium"}>{r.amount ? fmtMoney(r.amount) : ""}</Cell>
                          <Cell title={r.batches.join("\n")} className="text-muted-foreground text-[12px]">
                            {r.batches.length > 1 ? `${r.batches[0]} +${r.batches.length - 1}` : r.batches[0] ?? ""}
                          </Cell>
                          <Cell>{r.type}</Cell>
                          <Cell>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_PILL[r.category]}`}>
                              {r.category}
                            </span>
                          </Cell>
                          <Cell>{r.colour}</Cell>
                          <Cell>{r.item_group ?? ""}</Cell>
                          <Cell
                            title={r.category_from_tally ? "No naming rule matched — this is the item's Tally stock group" : undefined}
                            className={r.category_from_tally ? "italic text-muted-foreground" : ""}
                          >
                            {r.item_category}
                          </Cell>
                        </TableRow>
                      );
                    }),
                  )
                )}
              </TableBody>
            </Table>
          </ScrollableTable>

          <Pagination state={page} rowsLabel="batches" />

          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>
              Straight from Tally's Stock Journal-Production vouchers. Output is positive and Consumption
              negative, as Tally prints it; a line drawn from several lots is summed to one row, with
              the lots under Batch. <b>Type, Category, Colour, Item Group and Item Category</b> are
              added here: Colour, Item Group and Item Category are read from the batch's finished good
              and filled down the whole entry. An Item Category in <i>italics</i> is the Tally stock
              group, used where no naming rule matched.
              {ruleFallbacks.length > 0 && (
                <> {ruleFallbacks.length} Sublimation/Reactive item{ruleFallbacks.length === 1 ? "" : "s"} matched
                  no rule: {ruleFallbacks.join(", ")}.</>
              )}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * label · headline (tonnes on a weight card) · the exact quantity · a note.
 *
 * Deliberately tight: six of these sit in one row, so the chrome is padding-2 and the three text
 * lines step 10 / 17 / 11 / 10 px. Every line truncates with the full text on hover, and the whole
 * card carries "headline · exact" as its title, so nothing is lost at the narrowest width.
 */
function Stat({ label, value, exact, sub }: { label: string; value: string; exact?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2" title={exact ? `${value} · ${exact}` : value}>
      <div className="text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className="text-[17px] font-semibold leading-tight text-foreground truncate">{value}</div>
      {exact && <div className="text-[11px] font-medium leading-snug tabular-nums text-foreground/70 truncate">{exact}</div>}
      {sub && <div className="text-[10px] leading-snug text-muted-foreground tabular-nums truncate">{sub}</div>}
    </div>
  );
}

/** Header cell. `added` marks the five columns Tally does not have, so they read as ours. */
function Head({ w, right, added, children }: { w: number; right?: boolean; added?: boolean; children: React.ReactNode }) {
  return (
    <TableHead
      style={{ width: w, minWidth: w }}
      className={`h-auto py-2 px-3 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${right ? "text-right" : "text-left"} ${added ? "text-primary bg-primary/5" : "text-foreground/70"}`}
    >
      {children}
    </TableHead>
  );
}

function Cell({ right, className = "", title, children }: { right?: boolean; className?: string; title?: string; children: React.ReactNode }) {
  return (
    <TableCell
      title={title}
      className={`py-1.5 px-3 text-[13px] truncate max-w-0 ${right ? "text-right tabular-nums whitespace-nowrap" : ""} ${className}`}
    >
      {children}
    </TableCell>
  );
}
