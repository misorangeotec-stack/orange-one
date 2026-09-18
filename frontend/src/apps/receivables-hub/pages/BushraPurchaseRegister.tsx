/**
 * Purchase Register — Reports → Bushra-Report.
 *
 * The purchase-side twin of pages/BushraSalesRegister.tsx: same layout, filters, cascade and export,
 * over every GST purchase, service purchase, purchase return and purchase debit/credit note line.
 * Purchase-Type, Ink Type, Group, Category and Colour sit AFTER Amount, as on the Sales Register.
 * Data layer: lib/purchaseRegister.ts; classification: lib/bushraPurchaseRegister.ts.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Download, NotebookText, RotateCcw, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { defaultRange, ymdToIso, isoToYmd } from "@hub/lib/salesRegister";
import { loadItemLookup } from "@hub/lib/bushraSalesRegister";
import { loadBushraPurchaseRegister, type BushraPurchaseRow } from "@hub/lib/bushraPurchaseRegister";
import { PURCHASE_REGISTER_LOCAL, loadPurchaseSnapshot } from "@hub/lib/purchaseRegister";
import { exportPurchaseRegisterXlsx } from "@hub/lib/exportPurchaseRegister";

const BASE = "/outstanding-dashboard";

const nf = (max: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: max });
const fmtQty = (n: number) => (n === 0 ? "—" : nf(3).format(n));
const fmtRate = (n: number) => (n === 0 ? "—" : nf(2).format(n));
const fmtAmt = (n: number) => nf(2).format(n);

const NOT_SET = "(Not set)";
const orNotSet = (v: string) => v || NOT_SET;

type Row = BushraPurchaseRow;

const FILTERS = {
  location: { label: "Location", get: (r: Row) => orNotSet(r.location_name) },
  company: { label: "Company", get: (r: Row) => r.company_display },
  type: { label: "Type", get: (r: Row) => r.type },
  date: { label: "Date", get: (r: Row) => r.date_display },
  party: { label: "Party Name", get: (r: Row) => orNotSet(r.party) },
  particulars: { label: "Particulars", get: (r: Row) => r.particulars },
  voucherType: { label: "Voucher Type", get: (r: Row) => r.voucher_type },
  voucherNo: { label: "Voucher No.", get: (r: Row) => r.voucher_no },
  gstin: { label: "GSTIN/UIN", get: (r: Row) => orNotSet(r.gstin ?? "") },
  purchaseType: { label: "Purchase-Type", get: (r: Row) => orNotSet(r.purchase_type) },
  inkType: { label: "Ink Type", get: (r: Row) => orNotSet(r.ink_type) },
  group: { label: "Group", get: (r: Row) => orNotSet(r.item_group) },
  category: { label: "Category", get: (r: Row) => orNotSet(r.item_category) },
  colour: { label: "Colour", get: (r: Row) => orNotSet(r.colour) },
} as const;

type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const emptyByKey = <T,>(make: () => T) =>
  Object.fromEntries(FILTER_KEYS.map((k) => [k, make()])) as Record<FilterKey, T>;
const NO_FILTERS: Record<FilterKey, string[]> = emptyByKey(() => []);

const dateKey = (d: string) => d.split("-").reverse().join("");
const byDate = (a: string, b: string) => dateKey(a).localeCompare(dateKey(b));

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * The table's columns in order: heading, which filter sits under it (none on the amounts),
 * alignment, and what it sorts by — every column sorts, the date by calendar order and the amounts
 * as numbers rather than the text they print.
 */
const TABLE_COLUMNS: { header: string; filter: FilterKey | null; right?: boolean; sort: (r: Row) => string | number }[] = [
  { header: "Location", filter: "location", sort: (r) => r.location_name },
  { header: "Company", filter: "company", sort: (r) => r.company },
  { header: "Type", filter: "type", sort: (r) => r.type },
  { header: "Date", filter: "date", sort: (r) => r.vch_date },
  { header: "Party Name", filter: "party", sort: (r) => r.party },
  { header: "Particulars", filter: "particulars", sort: (r) => r.particulars },
  { header: "Voucher Type", filter: "voucherType", sort: (r) => r.voucher_type },
  { header: "Voucher No.", filter: "voucherNo", sort: (r) => r.voucher_no },
  { header: "GSTIN/UIN", filter: "gstin", sort: (r) => r.gstin ?? "" },
  { header: "Quantity", filter: null, right: true, sort: (r) => r.quantity },
  { header: "Rate", filter: null, right: true, sort: (r) => r.rate },
  { header: "Amount", filter: null, right: true, sort: (r) => r.amount },
  { header: "Purchase-Type", filter: "purchaseType", sort: (r) => r.purchase_type },
  { header: "Ink Type", filter: "inkType", sort: (r) => r.ink_type },
  { header: "Group", filter: "group", sort: (r) => r.item_group },
  { header: "Category", filter: "category", sort: (r) => r.item_category },
  { header: "Colour", filter: "colour", sort: (r) => r.colour },
];

export default function BushraPurchaseRegister() {
  const init = useMemo(() => defaultRange(), []);
  const [fromIso, setFromIso] = useState(ymdToIso(init.from));
  const [toIso, setToIso] = useState(ymdToIso(init.to));
  const from = isoToYmd(fromIso);
  const to = isoToYmd(toIso);
  const validRange = !!from && !!to && from <= to;

  // Same query key as the Bushra Sales Register, so the ~14k Central Masters items are shared.
  // ⚠ Bump it WITH the Sales side's key, or the two screens download the lookup twice.
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v3"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });

  const { data: rows, isLoading, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraPurchaseRegister", "v2", PURCHASE_REGISTER_LOCAL, from, to],
    queryFn: () => loadBushraPurchaseRegister(from, to, lookup),
    enabled: validRange && !!lookup,
    staleTime: 5 * 60 * 1000,
  });

  // Localhost only: say which window the snapshot file covers, so an empty month is not a mystery.
  const { data: snap } = useQuery({
    queryKey: ["bushraPurchaseRegister", "snapshot"],
    queryFn: loadPurchaseSnapshot,
    enabled: PURCHASE_REGISTER_LOCAL,
    select: (s) => ({ from: s.from, to: s.to, built_at: s.built_at }),
  });

  const error = lookupError ?? rowsError;
  // The rows query waits, DISABLED, for the item lookup — and a disabled query is not "loading" to
  // TanStack. Without the extra check the page shows "0 lines · ₹0" meanwhile.
  const loading = !error && (isLoading || !lookup);
  const all = useMemo(() => rows ?? [], [rows]);
  const notInMasters = useMemo(
    () => new Set(all.filter((r) => r.kind === "item" && !r.in_masters).map((r) => r.particulars)).size,
    [all],
  );

  const [sel, setSel] = useState<Record<FilterKey, string[]>>(NO_FILTERS);
  const [search, setSearch] = useState("");

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      r.party.toLowerCase().includes(q) ||
      r.particulars.toLowerCase().includes(q) ||
      r.voucher_no.toLowerCase().includes(q) ||
      (r.gstin ?? "").toLowerCase().includes(q));
  }, [all, search]);

  const filtered = useMemo(
    () => searched.filter((r) =>
      FILTER_KEYS.every((k) => !sel[k].length || sel[k].includes(FILTERS[k].get(r)))),
    [searched, sel],
  );

  const options = useMemo(() => {
    const active = FILTER_KEYS.filter((k) => sel[k].length);
    const found: Record<FilterKey, Set<string>> = emptyByKey(() => new Set<string>());
    for (const r of searched) {
      let missedKey: FilterKey | null = null;
      let missed = 0;
      for (const k of active) {
        if (!sel[k].includes(FILTERS[k].get(r))) { missed++; missedKey = k; if (missed > 1) break; }
      }
      if (missed > 1) continue;
      for (const k of FILTER_KEYS) if (missed === 0 || k === missedKey) found[k].add(FILTERS[k].get(r));
    }
    return Object.fromEntries(
      FILTER_KEYS.map((k) => [k, [...found[k]].sort(k === "date" ? byDate : undefined).map((v) => ({ value: v, label: v }))]),
    ) as Record<FilterKey, MultiSelectOption[]>;
  }, [searched, sel]);

  const setFilter = (key: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [key]: v }));

  const totalAmount = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const get = TABLE_COLUMNS[sort.col].sort;
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b);
      return sort.dir * (typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)));
    });
  }, [filtered, sort]);
  /** Text columns open A→Z, amounts largest first; a second click turns it round. */
  const toggleSort = (col: number) => setSort((s) =>
    s?.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: TABLE_COLUMNS[col].right ? -1 : 1 });

  const page = usePagination(sorted, {
    resetKey: `${from}|${to}|${FILTER_KEYS.map((k) => sel[k].join(",")).join("|")}|${search}|${sort?.col}|${sort?.dir}`,
  });

  const chips: FilterChip[] = FILTER_KEYS.flatMap((k) =>
    sel[k].map((v) => ({
      label: `${FILTERS[k].label}: ${v}`,
      onRemove: () => setSel((s) => ({ ...s, [k]: s[k].filter((x) => x !== v) })),
    })));
  const clearAll = () => { setSel(NO_FILTERS); setSearch(""); };

  const onExport = () => {
    if (!sorted.length) return;
    exportPurchaseRegisterXlsx(sorted, { from, to });
  };

  const filterBox = (key: FilterKey, allLabel: string, unit: string, width: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">{FILTERS[key].label}</span>
      <MultiSelectFilter
        options={options[key]}
        value={sel[key]}
        onChange={setFilter(key)}
        allLabel={allLabel}
        unit={unit}
        triggerClassName={`${width} h-9 text-sm rounded-input border-border`}
      />
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to={`${BASE}/reports?cat=bushra-report`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Bushra-Report
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <NotebookText className="h-6 w-6 text-primary" /> Purchase Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every GST purchase, service purchase, purchase return and purchase debit note line, with
            Purchase-Type, Ink Type, Group and Category from Central Masters → Items, and Colour read
            from the item description.
          </p>
        </div>
        <Button
          onClick={onExport}
          disabled={!filtered.length}
          className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {PURCHASE_REGISTER_LOCAL && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Localhost snapshot — not the live table.
          {snap && <> Covers {ymdToIso(snap.from)} to {ymdToIso(snap.to)}, built {new Date(snap.built_at).toLocaleString("en-IN")}.</>}
          {" "}Rebuild with <code>python tools/build_purchase_register_snapshot.py</code>.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Period</span>
          <div className="flex items-center gap-1">
            <Input type="date" value={fromIso} onChange={(e) => setFromIso(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={toIso} onChange={(e) => setToIso(e.target.value)} className="h-9 w-[150px] rounded-input text-sm" />
          </div>
        </div>
        {filterBox("company", "All Companies", "Companies", "w-[200px]")}
        {filterBox("type", "All Types", "Types", "w-[180px]")}
        {filterBox("purchaseType", "All Purchase-Types", "Purchase-Types", "w-[170px]")}
        {filterBox("inkType", "All Ink Types", "Ink Types", "w-[180px]")}
        {filterBox("group", "All Groups", "Groups", "w-[180px]")}
        {filterBox("category", "All Categories", "Categories", "w-[180px]")}
        {filterBox("colour", "All Colours", "Colours", "w-[150px]")}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Search</span>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Party, particulars, voucher no…"
              className="pl-9 h-9 w-64 rounded-input"
            />
          </div>
        </div>
      </div>

      {chips.length > 0 && <FilterChips chips={chips} onClearAll={clearAll} />}

      {!validRange ? (
        <div className="py-16 text-center text-muted-foreground">Pick a valid date range (from must be on or before to).</div>
      ) : loading ? (
        <div className="py-16 text-center text-muted-foreground">Loading the purchase register…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {filtered.length.toLocaleString("en-IN")} line{filtered.length === 1 ? "" : "s"}
            {" · "}amount <b className="text-foreground font-semibold">₹ {fmtAmt(totalAmount)}</b>
            {notInMasters > 0 && (
              <> · {notInMasters.toLocaleString("en-IN")} item{notInMasters === 1 ? "" : "s"} not found in Central Masters</>
            )}
          </div>

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[64vh]">
            <table className="w-full border-collapse min-w-[1800px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {TABLE_COLUMNS.map((c, i) => (
                    <th key={c.header} className={`${c.right ? "text-right" : "text-left"} py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap`}>
                      <button type="button" onClick={() => toggleSort(i)} title={`Sort by ${c.header}`}
                              className={`inline-flex items-center gap-1 uppercase hover:text-foreground ${sort?.col === i ? "text-foreground" : ""}`}>
                        {c.header}
                        {sort?.col !== i ? <ArrowUpDown className="h-3 w-3 opacity-40" />
                          : sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="border-b-2 border-border bg-muted/30">
                  {TABLE_COLUMNS.map((c) => (
                    <th key={c.header} className="py-1.5 px-2 font-normal">
                      {c.filter && (
                        <MultiSelectFilter
                          options={options[c.filter]}
                          value={sel[c.filter]}
                          onChange={setFilter(c.filter)}
                          allLabel="Any"
                          unit={c.header}
                          triggerClassName="w-full min-w-[110px] h-8 text-xs rounded-input border-border bg-surface"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.pageItems.length === 0 ? (
                  // The table stays standing when the filters match nothing, so the way back is right here.
                  <tr><td colSpan={TABLE_COLUMNS.length} className="py-10 text-center text-sm text-muted-foreground">
                    {all.length ? (
                      <span className="inline-flex items-center gap-3">
                        No lines match those filters.
                        <Button variant="outline" onClick={clearAll} className="h-8 gap-1.5 rounded-button px-3 text-xs">
                          <RotateCcw className="h-3.5 w-3.5" /> Clear filters
                        </Button>
                      </span>
                    ) : "No purchase lines in this period."}
                  </td></tr>
                ) : (
                  page.pageItems.map((r, i) => (
                    <tr key={`${r.tenant_id}-${r.voucher_guid}-${r.line_no}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.location_name}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.company}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap tabular-nums">{r.date_display}</td>
                      <td className="py-1.5 px-3 text-sm">{r.party}</td>
                      <td className="py-1.5 px-3 text-sm">{r.particulars}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap">{r.voucher_type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.voucher_no}</td>
                      <td className="py-1.5 px-3 text-sm text-muted-foreground whitespace-nowrap tabular-nums">{r.gstin ?? ""}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtQty(r.quantity)}</td>
                      <td className="py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap">{fmtRate(r.rate)}</td>
                      <td className={`py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap ${r.amount < 0 ? "text-destructive" : ""}`}>{fmtAmt(r.amount)}</td>
                      <td
                        className="py-1.5 px-3 text-sm whitespace-nowrap"
                        title={r.purchase_type_source ? `From ${r.purchase_type_source}` : "No source typed this line"}
                      >{r.purchase_type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.ink_type}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.item_group}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap">{r.item_category}</td>
                      <td className="py-1.5 px-3 text-sm whitespace-nowrap font-medium">{r.colour}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          <Pagination state={page} rowsLabel="lines" />
        </>
      )}
    </div>
  );
}
