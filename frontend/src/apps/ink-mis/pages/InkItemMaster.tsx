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
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appBasePath } from "../../appInfo";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDown, ArrowUp, Download, LayoutDashboard, ListOrdered, Save, Search, Upload,
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
import { exportItemMaster, importItemMaster } from "../lib/itemMasterExcel";
import { ResizableHead, useTableColumns } from "../lib/tableColumns";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import {
  EMPTY_PLAN, INK_COMPANIES, fmtQty, loadInkPositions, loadOrder, loadOverrides, loadPlans,
  renumber, savePlans, saveOrder, saveOverrides,
  type InkMasterRow, type InkOrder, type InkOverride, type InkOverrides, type InkPlan,
  type InkScope,
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
  /**
   * EDITS ARE A DRAFT UNTIL SAVED.
   *
   * `overrides` / `order` are what the boxes show and edit. `savedOverrides` / `savedOrder` are
   * what is stored and what the table's data query is keyed on.
   *
   * They are separate because they used to be one. Every keystroke changed the query key, so the
   * whole table reloaded and blanked for a moment on each edit — unusable for filling in a column
   * of several hundred items. Now typing touches nothing but the draft, and Save commits the lot
   * in one go, which reloads once.
   */
  const [savedOverrides, setSavedOverrides] = useState<InkOverrides>(() => loadOverrides());
  const [overrides, setOverrides] = useState<InkOverrides>(savedOverrides);
  const [scope, setScope] = useState<InkScope>("ink");
  const [f, setF] = useState<ColFilters>(NO_FILTERS);
  const setCol = <K extends keyof ColFilters>(k: K, v: ColFilters[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const [savedOrder, setSavedOrder] = useState<InkOrder>(() => loadOrder());
  const [order, setOrder] = useState<InkOrder>(savedOrder);
  /**
   * Lead time lives with the planning inputs, not with the overrides, because the dashboard's own
   * edit mode writes the same store. Kept here as a draft like everything else on this screen.
   *
   * It belongs to the PRINTED LINE (the merge key), not to one book's row: the same ink bought on
   * one lead time cannot have four of them. Every row of a line therefore shows and edits the one
   * value.
   */
  const [savedPlans, setSavedPlans] = useState<Record<string, InkPlan>>(() => loadPlans());
  const [plans, setPlans] = useState<Record<string, InkPlan>>(savedPlans);
  const [ioNotice, setIoNotice] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Only what has been saved reaches storage, and so the dashboard.
  useEffect(() => saveOverrides(savedOverrides), [savedOverrides]);
  useEffect(() => saveOrder(savedOrder), [savedOrder]);
  useEffect(() => savePlans(savedPlans), [savedPlans]);

  const dirty =
    JSON.stringify(overrides) !== JSON.stringify(savedOverrides) ||
    JSON.stringify(order) !== JSON.stringify(savedOrder) ||
    JSON.stringify(plans) !== JSON.stringify(savedPlans);

  const save = () => {
    setSavedOverrides(overrides);
    setSavedOrder(order);
    setSavedPlans(plans);
  };
  const discard = () => {
    setOverrides(savedOverrides);
    setOrder(savedOrder);
    setPlans(savedPlans);
  };

  /** Lead time in months, against the printed line. Blank clears it. */
  const setLeadTime = (mergeKey: string, raw: string) =>
    setPlans((prev) => {
      const cur = prev[mergeKey] ?? EMPTY_PLAN;
      return { ...prev, [mergeKey]: { ...cur, leadTime: raw.trim() === "" ? 0 : Number(raw) || 0 } };
    });

  // The browser's own warning is the only one that can stop a tab closing on unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["inkMis", "positions", fy, savedOverrides, scope, savedOrder],
    queryFn: () => loadInkPositions(fy, undefined, undefined, savedOverrides, scope, savedOrder),
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
  const cols = useTableColumns("item-master");

  /**
   * Import is applied only after the whole file has been read and matched, so a bad file
   * changes nothing. Unmatched rows are reported with a sample, never silently dropped.
   */
  const onImport = async (file: File) => {
    setImporting(true);
    setIoNotice(null);
    try {
      const res = await importItemMaster(file, master, { overrides, order, plans });
      setOverrides(res.overrides);
      setOrder(res.order);
      setSavedOverrides(res.overrides);
      setSavedOrder(res.order);
      if (res.plans) {
        setPlans(res.plans);
        setSavedPlans(res.plans);
      }
      const parts = [`Imported ${res.matched} of ${res.rows} rows.`];
      if (res.unmatched.length) {
        const sample = res.unmatched.slice(0, 3).map((u) => `${u.book} / ${u.item}`).join("; ");
        parts.push(`${res.unmatched.length} did not match an item (Book or Item in Tally changed?): ${sample}.`);
      }
      if (res.orderClashes) parts.push(`${res.orderClashes} lines had different orders across books; the smallest was kept.`);
      if (res.badOrders) parts.push(`${res.badOrders} Order cells were not numbers and were skipped.`);
      setIoNotice({ kind: res.unmatched.length || res.badOrders ? "bad" : "ok", text: parts.join(" ") });
    } catch (e) {
      setIoNotice({ kind: "bad", text: e instanceof Error ? e.message : "Could not read that file." });
    } finally {
      setImporting(false);
    }
  };

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
    // ⚠ NUMBERED LINES ONLY. A number is what puts a line on the dashboard, so the arrows must
    //   never hand one out: renumbering every row in view used to number all of them, and every
    //   blank line would then have appeared on the dashboard. A blank line gets its number typed.
    if (order[mergeKey] === undefined) return;
    const lines: string[] = [];
    for (const r of rows) {
      if (order[r.mergeKey] === undefined) continue;
      if (!lines.includes(r.mergeKey)) lines.push(r.mergeKey);
    }
    const at = lines.indexOf(mergeKey);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= lines.length) return;
    lines.splice(to, 0, ...lines.splice(at, 1));
    setOrder((prev) => ({ ...prev, ...renumber(lines) }));
  };

  /**
   * Type a position directly — the only practical way to move a line across pages.
   *
   * TYPING A NUMBER THAT IS TAKEN INSERTS THE LINE THERE and pushes the old occupant down, the
   * way a spreadsheet row is inserted. Remembering an ink belongs at 13 when 13 is already used
   * is the normal case, not a mistake, and leaving two 13s would make the order ambiguous.
   *
   * The push STOPS AT THE FIRST GAP. With 10, 20, 30 spacing, typing 20 moves the old 20 to 21
   * and leaves 30 alone; with 13, 14, 15 it walks the whole run up by one. Only the lines that
   * actually collide move, so numbering the planner has deliberately spaced out survives.
   */
  const setPosition = (mergeKey: string, value: string) =>
    setOrder((prev) => {
      const next = { ...prev };
      const n = Math.round(Number(value));
      if (!value.trim() || !Number.isFinite(n)) delete next[mergeKey];
      else next[mergeKey] = n;
      return next;
    });

  /**
   * Run the insert when the box is LEFT, not on every keystroke. Typing "13" passes through "1",
   * and cascading on that would shove the whole list down before the 3 arrived.
   */
  const commitPosition = (mergeKey: string) =>
    setOrder((prev) => {
      const n = prev[mergeKey];
      if (n === undefined) return prev;
      const next = { ...prev };

      const others = Object.entries(next)
        .filter(([k]) => k !== mergeKey)
        .sort((a, b) => a[1] - b[1]);
      let blocked = n;
      for (const [k, v] of others) {
        if (v < n) continue;
        if (v !== blocked) break; // a free number: everything above it can stay where it is
        next[k] = v + 1;
        blocked = v + 1;
      }
      return next;
    });

  const cell = (r: InkMasterRow, field: keyof InkOverride, fallback: string, width: string) => (
    <Input
      className={`h-8 ${width}`}
      value={overrides[r.key]?.[field] ?? ""}
      placeholder={fallback || "—"}
      onChange={(e) => patch(r.key, field, e.target.value)}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Item master</h1>
          <p className="text-sm text-muted-foreground">
            Every item in all four books. Fill in the number, code, group and description you want
            the report to use, then press Save. Leave a box empty to keep what Tally says.
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
          disabled={!master.length}
          title="Download every item in this scope, with its current order, code, group and description"
          onClick={() => exportItemMaster(master, order, plans)}
        >
          <Download className="mr-2 h-4 w-4" /> Export to Excel
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!master.length || importing}
          title="Upload the edited file to apply its order, codes, groups and descriptions"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" /> {importing ? "Importing…" : "Import from Excel"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImport(file);
            e.target.value = "";
          }}
        />

        <Button
          size="sm"
          variant="outline"
          title="Re-space the numbers you have already given, in steps of ten, keeping their order. Blank lines stay blank."
          onClick={() => {
            // Only lines that ALREADY have a number. Numbering every row in view would put every
            // blank line on the dashboard, which is exactly what a blank number means not to do.
            const lines: string[] = [];
            for (const r of rows) {
              if (order[r.mergeKey] === undefined) continue;
              if (!lines.includes(r.mergeKey)) lines.push(r.mergeKey);
            }
            setOrder((prev) => ({ ...prev, ...renumber(lines) }));
          }}
        >
          <ListOrdered className="mr-2 h-4 w-4" /> Tidy numbers
        </Button>
        {cols.customised && (
          <Button size="sm" variant="ghost" onClick={cols.reset} title="Put every column back to its automatic width">
            Reset column widths
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (window.confirm("Clear every number? All items will disappear from the dashboard until you number them again.")) setOrder({});
          }}
        >
          Clear order
        </Button>

      </div>

      <div
        className={`sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm ${
          dirty ? "border-orange-300 bg-orange-50 text-orange-900" : "border-transparent bg-muted/40 text-muted-foreground"
        }`}
      >
        {dirty ? (
          <>
            <span>
              <strong>Unsaved changes.</strong> Edit as many lines as you like, then save once.
              Nothing reaches the dashboard until you do.
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={discard}>
                Discard
              </Button>
              <Button size="sm" onClick={save}>
                <Save className="mr-2 h-4 w-4" /> Save changes
              </Button>
            </div>
          </>
        ) : (
          <span>All changes saved.</span>
        )}
      </div>

      {ioNotice && (
        <div
          className={`rounded-md border p-3 text-sm ${
            ioNotice.kind === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {ioNotice.text}
        </div>
      )}

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
              <ResizableHead id="order" cols={cols} className="w-[8.5rem]">Order</ResizableHead>
              <ResizableHead id="book" cols={cols} className="min-w-[9rem]">Book</ResizableHead>
              <ResizableHead id="item" cols={cols} className="min-w-[20rem]">Item in Tally</ResizableHead>
              <ResizableHead id="closing" cols={cols} className="text-right">Closing</ResizableHead>
              <ResizableHead id="lead" cols={cols} className="w-[7rem] text-right">Lead time</ResizableHead>
              <ResizableHead id="code" cols={cols} className="min-w-[12rem]">Item code</ResizableHead>
              <ResizableHead id="group" cols={cols} className="min-w-[12rem]">Group</ResizableHead>
              <ResizableHead id="description" cols={cols} className="min-w-[18rem]">Description</ResizableHead>
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
              <TableHead className="py-2 font-normal" />
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
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Loading every item from the four books…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
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
                      value={order[r.mergeKey] ?? ""}
                      placeholder="–"
                      title="Type a number to place this line. A number already in use inserts here and pushes the rest down."
                      onChange={(e) => setPosition(r.mergeKey, e.target.value)}
                      onBlur={() => commitPosition(r.mergeKey)}
                    />
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={order[r.mergeKey] === undefined}
                        title={order[r.mergeKey] === undefined ? "Type a number first to put this item on the dashboard" : undefined}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                        onClick={() => move(r.mergeKey, -1)}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={order[r.mergeKey] === undefined}
                        title={order[r.mergeKey] === undefined ? "Type a number first to put this item on the dashboard" : undefined}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
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
                <TableCell className="text-right">
                  <Input
                    type="number"
                    inputMode="decimal"
                    className="h-8 w-20 text-right"
                    value={plans[r.mergeKey]?.leadTime || ""}
                    placeholder="–"
                    title="Months of cover to order against. Shared by every book on this line."
                    onChange={(e) => setLeadTime(r.mergeKey, e.target.value)}
                  />
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
