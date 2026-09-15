/**
 * INK MIS — item master.
 *
 * Every stock item in all four books, with the code, group and description the planner wants
 * the report to use. Tally's own item master is thin: most items carry no code at all, and the
 * group is wherever the book happened to file them. This screen is where that gets corrected
 * without waiting for Tally to be tidied.
 *
 * THE ITEM NAME IS THE IDENTITY and is not editable. It is what the Sales Register and the
 * stock mirror both carry, so it is the only thing that can join a row here to a row there.
 * Rename an item in Tally and it arrives here as a new row, which is correct — it is a
 * different item as far as every other system is concerned.
 *
 * A BLANK BOX MEANS "USE TALLY". Clearing a field restores Tally's value rather than blanking
 * the column, and the placeholder shows what will be used. That is why cleared entries are
 * dropped from storage instead of being saved as empty strings.
 *
 * THE CODE IS WHAT MERGES BOOKS. Two rows in different books that resolve to the same code
 * become one line on the dashboard. Until a code exists an item still appears — on its own
 * line, flagged — because hiding real stock for want of a code is exactly what this screen is
 * here to stop.
 *
 * Saved in this browser only, like the rest of the planner's data. The dashboard's export and
 * import carry this table with them.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { appBasePath } from "../../appInfo";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDown, ArrowUp, LayoutDashboard, ListOrdered, Search,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import Pagination from "@/shared/components/ui/Pagination";
import { salesFyOptions } from "@hub/lib/salesReport";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import {
  INK_COMPANIES, fmtQty, loadInkPositions, loadOrder, loadOverrides, renumber, saveOrder,
  saveOverrides,
  type InkMasterRow, type InkOrder, type InkOverride, type InkOverrides, type InkScope,
} from "../lib/inkMis";

const BASE = appBasePath("ink-mis");

/**
 * Column filters, one per column, in a filter row under the header — the same pattern as the
 * other Hub tables. Multi-selects hold every value a column can take; the two free-text columns
 * take a "contains" match. An empty selection means "no filter", never "match nothing".
 */
interface ColFilters {
  order: string[];     // "placed" | "unplaced"
  books: string[];     // InkCompany.key
  item: string;
  closing: string[];   // "positive" | "zero" | "negative"
  code: string[];      // "has" | "none" | "edited"
  groups: string[];
  description: string;
}

const NO_FILTERS: ColFilters = {
  order: [], books: [], item: "", closing: [], code: [], groups: [], description: "",
};

const ORDER_OPTS = [
  { value: "placed", label: "Has a position" },
  { value: "unplaced", label: "No position yet" },
];
const CLOSING_OPTS = [
  { value: "positive", label: "In stock" },
  { value: "zero", label: "Zero" },
  { value: "negative", label: "Negative" },
];
const CODE_OPTS = [
  { value: "has", label: "Has a code" },
  { value: "none", label: "Needs a code" },
  { value: "edited", label: "Edited by you" },
];

const labelsFor = (values: string[], opts: { value: string; label: string }[]) =>
  values.map((v) => opts.find((o) => o.value === v)?.label ?? v).join(", ");

export default function InkItemMaster() {
  const fy = useMemo(() => salesFyOptions()[0], []);
  const [overrides, setOverrides] = useState<InkOverrides>(() => loadOverrides());
  const [scope, setScope] = useState<InkScope>("ink");
  const [f, setF] = useState<ColFilters>(NO_FILTERS);
  const setCol = <K extends keyof ColFilters>(k: K, v: ColFilters[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const [order, setOrder] = useState<InkOrder>(() => loadOrder());

  useEffect(() => saveOverrides(overrides), [overrides]);
  useEffect(() => saveOrder(order), [order]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["inkMis", "positions", fy, overrides, scope, order],
    queryFn: () => loadInkPositions(fy, undefined, undefined, overrides, scope, order),
    staleTime: 5 * 60 * 1000,
  });

  const master = useMemo(() => data?.master ?? [], [data]);

  const rows = useMemo(() => {
    const itemQ = f.item.trim().toUpperCase();
    const descQ = f.description.trim().toUpperCase();
    const filtered = master.filter((r) => {
      if (f.books.length && !f.books.includes(r.companyKey)) return false;
      if (f.order.length) {
        const placed = order[r.mergeKey] !== undefined;
        if (!f.order.includes(placed ? "placed" : "unplaced")) return false;
      }
      if (f.closing.length) {
        const band = r.closingQty > 0 ? "positive" : r.closingQty < 0 ? "negative" : "zero";
        if (!f.closing.includes(band)) return false;
      }
      if (f.code.length) {
        // Ticked states are alternatives: "Needs a code" OR "Edited by you", not both at once.
        const hit =
          (f.code.includes("has") && !r.needsCode) ||
          (f.code.includes("none") && r.needsCode) ||
          (f.code.includes("edited") && Boolean(overrides[r.key]));
        if (!hit) return false;
      }
      if (f.groups.length && !f.groups.includes(r.effectiveGroup)) return false;
      if (itemQ && !r.item.toUpperCase().includes(itemQ) && !r.effectiveCode.includes(itemQ)) return false;
      if (descQ && !r.effectiveDescription.toUpperCase().includes(descQ)) return false;
      return true;
    });
    // Same order as the dashboard, so a line moved here is seen to move there. Rows sharing a
    // merge key stay together, since they are one printed line fed by several books.
    return filtered.sort((a, b) => {
      const pa = order[a.mergeKey];
      const pb = order[b.mergeKey];
      if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb;
      if (pa !== undefined && pb === undefined) return -1;
      if (pa === undefined && pb !== undefined) return 1;
      return (
        (a.effectiveCode || a.item).localeCompare(b.effectiveCode || b.item) ||
        a.company.localeCompare(b.company)
      );
    });
  }, [master, f, overrides, order]);

  // The hook resets to page 1 when resetKey changes, so a narrower filter never strands you on
  // a page that no longer exists.
  const pg = usePagination(rows, { resetKey: `${JSON.stringify(f)}|${scope}` });
  const visible = pg.pageItems;

  const needsCode = master.filter((r) => r.needsCode).length;
  const edited = Object.keys(overrides).length;

  // Group options come from the LOADED rows, not the filtered ones, so choices do not vanish
  // from the list while you are still picking.
  const groupOpts = useMemo(
    () =>
      [...new Set(master.map((r) => r.effectiveGroup).filter(Boolean))]
        .sort()
        .map((g) => ({ value: g, label: g })),
    [master],
  );
  const bookOpts = INK_COMPANIES.map((c) => ({ value: c.key, label: c.label }));

  const chips: ActiveFilter[] = [];
  if (f.order.length) chips.push({ key: "order", label: `Order: ${labelsFor(f.order, ORDER_OPTS)}`, onClear: () => setCol("order", []) });
  if (f.books.length) chips.push({ key: "books", label: `Book: ${labelsFor(f.books, bookOpts)}`, onClear: () => setCol("books", []) });
  if (f.item.trim()) chips.push({ key: "item", label: `Item: ${f.item.trim()}`, onClear: () => setCol("item", "") });
  if (f.closing.length) chips.push({ key: "closing", label: `Closing: ${labelsFor(f.closing, CLOSING_OPTS)}`, onClear: () => setCol("closing", []) });
  if (f.code.length) chips.push({ key: "code", label: `Code: ${labelsFor(f.code, CODE_OPTS)}`, onClear: () => setCol("code", []) });
  if (f.groups.length) chips.push({ key: "groups", label: `Group: ${f.groups.join(", ")}`, onClear: () => setCol("groups", []) });
  if (f.description.trim()) chips.push({ key: "desc", label: `Description: ${f.description.trim()}`, onClear: () => setCol("description", "") });

  const slim = "py-1.5 px-2.5 text-[12.5px]";

  const patch = (key: string, field: keyof InkOverride, value: string) =>
    setOverrides((prev) => {
      const next = { ...prev, [key]: { ...prev[key], [field]: value } };
      if (!value.trim()) {
        const row = { ...next[key] };
        delete row[field];
        if (Object.keys(row).length) next[key] = row;
        else delete next[key];
      }
      return next;
    });

  /**
   * Move a line one place against the CURRENT filtered view.
   *
   * Both lines get an explicit position first. Without that, swapping with an unpositioned
   * neighbour would do nothing visible: the mover would take a number, the neighbour would keep
   * falling in behind everything positioned, and the row would appear to jump the whole list.
   */
  const move = (mergeKey: string, delta: number) => {
    const lines: string[] = [];
    for (const r of rows) if (!lines.includes(r.mergeKey)) lines.push(r.mergeKey);
    const at = lines.indexOf(mergeKey);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= lines.length) return;
    lines.splice(to, 0, ...lines.splice(at, 1));
    setOrder((prev) => ({ ...prev, ...renumber(lines) }));
  };

  /** Type a position directly — the only practical way to move a line across pages. */
  const setPosition = (mergeKey: string, value: string) =>
    setOrder((prev) => {
      const next = { ...prev };
      const n = Number(value);
      if (!value.trim() || !Number.isFinite(n)) delete next[mergeKey];
      else next[mergeKey] = n;
      return next;
    });

  const cell = (r: InkMasterRow, field: keyof InkOverride, fallback: string, width: string) => (
    <Input
      className={`h-8 ${width}`}
      defaultValue={overrides[r.key]?.[field] ?? ""}
      placeholder={fallback || "—"}
      onBlur={(e) => patch(r.key, field, e.target.value)}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Item master</h1>
          <p className="text-sm text-muted-foreground">
            Every item in all four books. Fill in the code, group and description you want the
            report to use. Leave a box empty to keep what Tally says.
          </p>
        </div>
        <Button size="sm" asChild variant="secondary">
          <Link to={`${BASE}/dashboard`}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Dashboard
          </Link>
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Saved in <strong>this browser only</strong>. Use Export backup on the pipeline screen
          to keep a copy. The item code is what merges the same ink across books, so filling it
          in is what turns several lines into one.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Items listed", value: String(master.length) },
          { label: "Still without a code", value: String(needsCode) },
          { label: "You have edited", value: String(edited) },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={scope}
          onChange={(e) => setScope(e.target.value as InkScope)}
        >
          <option value="ink">Ink groups only</option>
          <option value="all">Every stock group</option>
        </select>

        <Button
          size="sm"
          variant="outline"
          title="Give every line in the current view a number, in the order shown, in steps of ten"
          onClick={() => {
            const lines: string[] = [];
            for (const r of rows) if (!lines.includes(r.mergeKey)) lines.push(r.mergeKey);
            setOrder((prev) => ({ ...prev, ...renumber(lines) }));
          }}
        >
          <ListOrdered className="mr-2 h-4 w-4" /> Number this view
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOrder({})}>
          Clear order
        </Button>

      </div>

      <ActiveFilters filters={chips} onClearAll={() => setF(NO_FILTERS)} />

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Could not load items: {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      <ScrollableTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[8.5rem]">Order</TableHead>
              <TableHead className="min-w-[9rem]">Book</TableHead>
              <TableHead className="min-w-[20rem]">Item in Tally</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="min-w-[12rem]">Item code</TableHead>
              <TableHead className="min-w-[12rem]">Group</TableHead>
              <TableHead className="min-w-[18rem]">Description</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableHead className="py-2 font-normal">
                <MultiSelect values={f.order} onChange={(v) => setCol("order", v)} options={ORDER_OPTS} placeholder="All" className="w-full" triggerClassName={slim} />
              </TableHead>
              <TableHead className="py-2 font-normal">
                <MultiSelect values={f.books} onChange={(v) => setCol("books", v)} options={bookOpts} placeholder="All" className="w-full" triggerClassName={slim} />
              </TableHead>
              <TableHead className="py-2 font-normal">
                <Input className="h-8" placeholder="Contains…" value={f.item} onChange={(e) => setCol("item", e.target.value)} />
              </TableHead>
              <TableHead className="py-2 font-normal">
                <MultiSelect values={f.closing} onChange={(v) => setCol("closing", v)} options={CLOSING_OPTS} placeholder="All" className="w-full" triggerClassName={slim} />
              </TableHead>
              <TableHead className="py-2 font-normal">
                <MultiSelect values={f.code} onChange={(v) => setCol("code", v)} options={CODE_OPTS} placeholder="All" className="w-full" triggerClassName={slim} />
              </TableHead>
              <TableHead className="py-2 font-normal">
                <MultiSelect values={f.groups} onChange={(v) => setCol("groups", v)} options={groupOpts} placeholder="All" className="w-full" triggerClassName={slim} searchable />
              </TableHead>
              <TableHead className="py-2 font-normal">
                <Input className="h-8" placeholder="Contains…" value={f.description} onChange={(e) => setCol("description", e.target.value)} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Loading every item from the four books…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nothing matches those filters.
                </TableCell>
              </TableRow>
            )}
            {visible.map((r) => (
              <TableRow key={r.key} className={r.needsCode ? "bg-amber-50/60" : undefined}>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-8 w-14 px-1 text-center tabular-nums"
                      defaultValue={order[r.mergeKey] ?? ""}
                      placeholder="–"
                      key={`${r.mergeKey}-${order[r.mergeKey] ?? "x"}`}
                      onBlur={(e) => setPosition(r.mergeKey, e.target.value)}
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Move up"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => move(r.mergeKey, -1)}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => move(r.mergeKey, 1)}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-xs">{r.company}</TableCell>
                <TableCell>
                  <div>{r.item}</div>
                  {r.tallyCode && (
                    <div className="text-[10px] text-muted-foreground">
                      Tally code {r.tallyCode}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtQty(r.closingQty)}
                  {r.baseUnit && (
                    <span className="ml-1 text-[10px] text-muted-foreground">{r.baseUnit}</span>
                  )}
                </TableCell>
                <TableCell>{cell(r, "code", r.tallyCode, "w-44")}</TableCell>
                <TableCell>{cell(r, "group", r.tallyGroup, "w-44")}</TableCell>
                <TableCell>{cell(r, "description", r.item, "w-72")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollableTable>

      <Pagination state={pg} rowsLabel="items" />
    </div>
  );
}
