/**
 * Sales Register — Reports → Bushra-Report.
 *
 * The Tally Sales Register (pages/SalesRegister.tsx) with five extra columns — Sales-Type, Ink Type,
 * Group, Category (all from Central Masters → Items) and Colour — the groundwork for the Sales
 * Dashboard. Same data, same date window, same salesperson scope; the classification is in
 * lib/bushraSalesRegister.ts. The Tally report itself is left untouched.
 *
 * The five new columns sit AFTER Revenue, so the first columns read exactly like the Tally report.
 * The per-company Refresh control is not repeated here: the snapshot rebuilds after every Tally
 * sync, and the manual refresh stays on the Tally report.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Download, NotebookText, PencilLine, RotateCcw, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { MultiSelectFilter, type MultiSelectOption } from "@hub/components/MultiSelectFilter";
import { FilterChips, type FilterChip } from "@hub/components/FilterChips";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { FitFilter, FitTh, ResetWidths } from "@/shared/components/ui/ColumnResizer";
import { useColumnWidths } from "@/shared/lib/useColumnWidths";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { defaultRange, ymdToIso, isoToYmd } from "@hub/lib/salesRegister";
import { copiesOf, loadBushraSalesRegister, loadItemLookup, type BushraRegisterRow } from "@hub/lib/bushraSalesRegister";
import BushraItemEditDialog, { type EditSuggestions } from "@hub/components/BushraItemEditDialog";
import BushraBulkItemEditDialog from "@hub/components/BushraBulkItemEditDialog";
import { DISCOUNT_TYPE } from "@hub/lib/bushraSalesFigures";
import { useSession } from "@/core/platform/session";
import { exportSalesRegisterXlsx, type ExtraColumn } from "@hub/lib/exportSalesRegister";
import { useScopedParties } from "@hub/lib/scopeParties";
import { appBasePath } from "@/apps/appInfo";

/**
 * This screen's own links, rooted at the app that serves it. It moved out of the Outstanding
 * Dashboard with the rest of the reporting (apps/reports/), so a hard-coded
 * "/outstanding-dashboard" here would now point every in-page link at a redirect.
 */
const BASE = appBasePath("reports");

const nf = (max: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: max });
const fmtQty = (n: number) => (n === 0 ? "—" : nf(3).format(n));
const fmtRate = (n: number) => (n === 0 ? "—" : nf(2).format(n));
const fmtRev = (n: number) => nf(2).format(n);

/** A blank classification is a real, pickable filter value — "what is still untyped?". */
const NOT_SET = "(Not set)";
const orNotSet = (v: string) => v || NOT_SET;

type Row = BushraRegisterRow;

/**
 * Every filterable column. The toolbar shows a few of them; the filter row under the table headings
 * shows all of them. Both read and write the same selection, so they always agree.
 */
const FILTERS = {
  location: { label: "Location", get: (r: Row) => orNotSet(r.location_name) },
  company: { label: "Company", get: (r: Row) => r.company_display },
  type: { label: "Type", get: (r: Row) => r.type },
  date: { label: "Date", get: (r: Row) => r.date_display },
  party: { label: "Party Name", get: (r: Row) => r.party },
  particulars: { label: "Particulars", get: (r: Row) => r.particulars },
  voucherType: { label: "Voucher Type", get: (r: Row) => r.voucher_type },
  voucherNo: { label: "Voucher No.", get: (r: Row) => r.voucher_no },
  gstin: { label: "GSTIN/UIN", get: (r: Row) => orNotSet(r.gstin ?? "") },
  salesType: { label: "Sales-Type", get: (r: Row) => orNotSet(r.sales_type) },
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

/** 'DD-MM-YYYY' in calendar order — a plain string sort would put 01-05 before 02-04. */
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
  { header: "Revenue", filter: null, right: true, sort: (r) => r.revenue },
  { header: "Sales-Type", filter: "salesType", sort: (r) => r.sales_type },
  { header: "Ink Type", filter: "inkType", sort: (r) => r.ink_type },
  { header: "Group", filter: "group", sort: (r) => r.item_group },
  { header: "Category", filter: "category", sort: (r) => r.item_category },
  { header: "Colour", filter: "colour", sort: (r) => r.colour },
];

/** Column ids for the dragged widths — the headings themselves. */
const COL_IDS = TABLE_COLUMNS.map((c) => c.header);

const EXPORT_EXTRA: ExtraColumn<Row>[] = [
  { header: "SALES-TYPE", width: 16, get: (r) => r.sales_type },
  { header: "INK TYPE", width: 22, get: (r) => r.ink_type },
  { header: "GROUP", width: 22, get: (r) => r.item_group },
  { header: "CATEGORY", width: 22, get: (r) => r.item_category },
  { header: "COLOUR", width: 12, get: (r) => r.colour },
];

export default function BushraSalesRegister() {
  /**
   * Only an admin is offered the editor. The table's own RLS ('edit' on bushra-central-master,
   * which admins always hold) is what actually refuses anyone else.
   */
  const { isAdmin, user } = useSession();
  const qc = useQueryClient();
  /** Column widths the reader drags — header edge, double-click resets, "Reset widths" clears all. */
  const fit = useColumnWidths("tb", COL_IDS, "bushra-sales-register");
  const [editing, setEditing] = useState<Row | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const init = useMemo(() => defaultRange(), []);
  const [fromIso, setFromIso] = useState(ymdToIso(init.from));
  const [toIso, setToIso] = useState(ymdToIso(init.to));
  const from = isoToYmd(fromIso);
  const to = isoToYmd(toIso);
  const validRange = !!from && !!to && from <= to;

  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");

  // Central Masters items (~14k) change rarely — fetched once and kept, not re-read per date change.
  const { data: lookup, error: lookupError } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v4"],
    queryFn: loadItemLookup,
    staleTime: 30 * 60 * 1000,
  });

  const { data: rows, isLoading, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bushraSalesRegister", "v8", from, to, scopeKey],
    queryFn: () => loadBushraSalesRegister(from, to, scope, lookup),
    enabled: validRange && !scopeLoading && !!lookup,
    staleTime: 5 * 60 * 1000,
  });
  const error = lookupError ?? rowsError;
  // The rows query waits, DISABLED, for the item lookup and the scope — and a disabled query is not
  // "loading" to TanStack. Without the two extra checks the page shows "0 lines · ₹0" meanwhile.
  const loading = !error && (isLoading || scopeLoading || !lookup);
  const all = useMemo(() => rows ?? [], [rows]);
  // Discount ledgers are never stock items — they read "Discount", so they are not counted as missing.
  const notInMasters = useMemo(() => new Set(all.filter((r) => !r.in_masters && !r.is_discount).map((r) => r.particulars)).size, [all]);

  /** Why a line cannot be edited — or null when it can. */
  const noEditReason = (r: Row) =>
    (r.is_discount ? "A discount ledger has no stock item — it always reads Discount."
      : !r.in_masters ? "Not found in Central Masters, so there is no item to correct."
        : null);
  const openEditor = (r: Row) => { if (isAdmin && !noEditReason(r)) setEditing(r); };
  const onSaved = () => {
    setEditing(null);
    setBulkOpen(false);
    // The lookup, every register window and every dashboard share the "bushraSalesRegister" prefix.
    qc.invalidateQueries({ queryKey: ["bushraSalesRegister"] });
    qc.invalidateQueries({ queryKey: ["bushra-central-master", "overrides"] });
  };


  /* -------- filters (same one-pass cascade as the Tally Sales Register) -------- */
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

  /** The values already in use, offered as suggestions in the editor. */
  const suggestions = useMemo<EditSuggestions>(() => {
    const uniq = (get: (r: Row) => string) =>
      [...new Set(all.map(get).filter((v) => v && v !== DISCOUNT_TYPE))].sort(collator.compare);
    return {
      inkType: uniq((r) => r.ink_type),
      groupName: uniq((r) => r.item_group),
      category: uniq((r) => r.item_category),
      color: uniq((r) => r.colour),
    };
  }, [all]);

  const setFilter = (key: FilterKey) => (v: string[]) => setSel((s) => ({ ...s, [key]: v }));

  const totalRevenue = useMemo(() => filtered.reduce((s, r) => s + r.revenue, 0), [filtered]);

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
    exportSalesRegisterXlsx(sorted, { from, to, extra: EXPORT_EXTRA, filePrefix: "Bushra_Sales_Register" });
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
          <Link to={`${BASE}?cat=bushra-report`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-3 w-3" /> Bushra-Report
          </Link>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <NotebookText className="h-6 w-6 text-primary" /> Sales Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every sales voucher line from the Tally Sales Register, with Sales-Type, Ink Type, Group,
            Category and Colour from the Bushra Central Master (Central Masters → Items with the team's
            corrections). Discount ledgers read Discount.
          </p>
        </div>
        <div className="flex items-center gap-2">
        {isAdmin && (
          <Button
            variant="outline"
            onClick={() => setBulkOpen(true)}
            disabled={!lookup || !filtered.length}
            title="Fix Sales-Type, Ink Type, Group, Category and Colour for every product in this view at once"
            className="h-9 gap-1.5 rounded-button"
          >
            <PencilLine className="h-4 w-4" /> Fix Not set products
          </Button>
        )}
        <Button
          onClick={onExport}
          disabled={!filtered.length}
          className="h-9 gap-1.5 rounded-button bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Export
        </Button>
        </div>
      </div>

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
        {filterBox("salesType", "All Sales-Types", "Sales-Types", "w-[170px]")}
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
        <div className="py-16 text-center text-muted-foreground">Loading the sales register…</div>
      ) : error ? (
        <div className="py-16 text-center text-destructive">{(error as Error).message}</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {filtered.length.toLocaleString("en-IN")} line{filtered.length === 1 ? "" : "s"}
            {" · "}revenue <b className="text-foreground font-semibold">₹ {fmtRev(totalRevenue)}</b>
            {notInMasters > 0 && (
              <> · {notInMasters.toLocaleString("en-IN")} item{notInMasters === 1 ? "" : "s"} not found in Central Masters</>
            )}
            <ResetWidths fit={fit} cols={COL_IDS} className="ml-3 inline-flex items-center gap-1 text-primary hover:underline" />
          </div>
          {isAdmin && (
            <div className="text-xs text-muted-foreground">
              Admin: click a line's Sales-Type, Ink Type, Group, Category or Colour to correct that item, or use
              "Fix Not set products" to correct every product in this view at once. Saved to the Bushra Central
              Master for every company's copy.
            </div>
          )}

          <ScrollableTable className="rounded-lg border border-border" maxHeight="max-h-[64vh]" resizeKey="bushra-sales-register">
            <table className="w-full border-collapse min-w-[1800px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {TABLE_COLUMNS.map((c, i) => (
                    <FitTh key={c.header} fit={fit} col={c.header} className={`${c.right ? "text-right" : "text-left"} py-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap`}>
                      <button type="button" onClick={() => toggleSort(i)} title={`Sort by ${c.header}`}
                              className={`inline-flex items-center gap-1 uppercase hover:text-foreground ${sort?.col === i ? "text-foreground" : ""}`}>
                        {c.header}
                        {sort?.col !== i ? <ArrowUpDown className="h-3 w-3 opacity-40" />
                          : sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                      </button>
                    </FitTh>
                  ))}
                </tr>
                {/* Filter row — one dropdown under each heading, same selection as the toolbar. */}
                <tr className="border-b-2 border-border bg-muted/30">
                  {TABLE_COLUMNS.map((c) => (
                    <th key={c.header} className="py-1.5 px-2 font-normal">
                      {c.filter && (
                        <FitFilter dragged={fit.width(c.header) !== undefined}>
                          <MultiSelectFilter
                            options={options[c.filter]}
                            value={sel[c.filter]}
                            onChange={setFilter(c.filter)}
                            allLabel="Any"
                            unit={c.header}
                            triggerClassName="w-full min-w-[110px] h-8 text-xs rounded-input border-border bg-surface"
                          />
                        </FitFilter>
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
                    ) : "No sales lines in this period."}
                  </td></tr>
                ) : (
                  page.pageItems.map((r, i) => (
                    <tr key={`${r.tenant_id}-${r.voucher_no}-${r.line_no}-${i}`} className="border-b border-border/40 hover:bg-muted/40">
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
                      <td className={`py-1.5 px-3 text-sm text-right tabular-nums whitespace-nowrap ${r.revenue < 0 ? "text-destructive" : ""}`}>{fmtRev(r.revenue)}</td>
                      {(() => {
                        // An admin's classification cells open the editor; everyone else's are plain text.
                        const blocked = noEditReason(r);
                        const editCls = isAdmin && !blocked ? " cursor-pointer hover:bg-primary/10 hover:underline decoration-dotted" : "";
                        const editTitle = isAdmin ? (blocked ?? "Click to edit this item") : undefined;
                        const cell = (value: string, extra = "", title = editTitle) => (
                          <td className={`py-1.5 px-3 text-sm whitespace-nowrap${extra}${editCls}`} title={title}
                              onClick={() => openEditor(r)}>{value}</td>
                        );
                        const source = r.sales_type_source ? `From ${r.sales_type_source}` : "No source typed this line";
                        return (
                          <>
                            {cell(r.sales_type, "", editTitle ? `${source} · ${editTitle}` : source)}
                            {cell(r.ink_type)}
                            {cell(r.item_group)}
                            {cell(r.item_category)}
                            {cell(r.colour, " font-medium")}
                          </>
                        );
                      })()}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          <Pagination state={page} rowsLabel="lines" />
        </>
      )}

      {bulkOpen && lookup && (
        <BushraBulkItemEditDialog
          rows={filtered}
          lookup={lookup}
          suggestions={suggestions}
          userId={user.id}
          onClose={() => setBulkOpen(false)}
          onSaved={onSaved}
        />
      )}
      {editing && lookup && (
        <BushraItemEditDialog
          row={editing}
          copies={copiesOf(lookup, editing.particulars)}
          suggestions={suggestions}
          userId={user.id}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
