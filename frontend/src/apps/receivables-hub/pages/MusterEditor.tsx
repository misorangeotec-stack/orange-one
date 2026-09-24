import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCheck, Save, RefreshCw, Search, ChevronDown,
  Plus, Trash2, Check, CheckCircle2, RotateCcw,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Badge } from "@hub/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@hub/components/ui/popover";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis,
} from "@hub/components/ui/pagination";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@hub/components/ui/alert-dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@hub/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";
import { useHubMenuAccess } from "@hub/lib/menus";
import {
  fetchTagRows, fetchGroupRows, fetchSnapshot, fetchOtherPaymentRows, fetchRedMarkRows,
  saveTag, saveGroup, saveCompanyMap,
  insertOtherPayment, saveOtherPayment, deleteOtherPayment,
  insertRedMark, saveRedMark, deleteRedMark, clearRedMark, reopenRedMark,
  fetchDisputeRows, fetchOpenBills, saveDispute, deleteDispute, clearDispute, reopenDispute, disputeKey,
  type TagRow, type GroupRow, type SnapRow, type OtherPaymentRow, type OtherPaymentInput,
  type RedMarkRow, type DisputeRow, type OpenBillRow,
} from "@hub/lib/musterApi";
import { fetchCompanyMap, makeCompanyResolver, companyGuidOf, type CompanyMapRow } from "@hub/lib/companyMap";
import {
  fetchSalespersonMaster, fetchCollectionTeamMaster, isUnset, knownNames,
  type NameMasterRow,
} from "@hub/lib/nameMasters";
import MasterValueCell from "@hub/components/MasterValueCell";
import NameMasterTab, { type NameMasterUsage } from "./NameMasterTab";
import { formatDateDMY } from "@hub/lib/utils";
import { MasterIoBar } from "@hub/pages/MusterIoBar";
import { tagIo, groupIo, companyIo, otherPaymentIo, redMarkIo, disputeIo } from "@hub/lib/musterIo";
import { ClearStatusToggle } from "@hub/components/ClearStatusToggle";
import { ClearStatusBadge } from "@hub/components/ClearStatusBadge";
import { ClearNoteDialog } from "@hub/components/ClearNoteDialog";
import { AddDisputeDialog, type DisputeBill, type DisputeCustomer } from "@hub/components/AddDisputeDialog";
import {
  CLEAR_VIEW_DEFAULT, DISPUTE_COPY, countByClearView, describeClear, matchesClearView, useCanClear,
  type ClearView,
} from "@hub/lib/clearStatus";
import { useColumnGrid } from "@hub/lib/useColumnGrid";
import { GridTable, describeColumnFilters, type TableColumn } from "@hub/components/GridTable";

const PAGE_SIZE = 25;

/** ₹ with Indian grouping; blank when zero. */
function fmtINR(n: number): string {
  if (!n) return "—";
  const s = Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${n < 0 ? "-" : ""}₹${s}`;
}

// NOTE: this file used to derive location here with `company.includes("NOIDA") ? "Noida" : "Surat"`.
// That guess is gone — company + location now come from the ext_company_map master (companyMap.ts),
// resolved once in MusterPanel so every SnapRow below already carries the finance-facing pair.

/** Compact page-number window with ellipses (mirrors the other Hub tables). */
function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (current >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
}

function StatusBadge({ checked, source }: { checked: boolean; source: string | null }) {
  if (checked) return <Badge className="bg-success/15 text-success-foreground border-success/30">Verified</Badge>;
  if (source === "sync_stub") return <Badge className="bg-warning/15 text-warning-foreground border-warning/40">New</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Unchecked</Badge>;
}

function PagerBar({
  page, totalPages, rangeStart, rangeEnd, total, noun, onPage,
}: {
  page: number; totalPages: number; rangeStart: number; rangeEnd: number;
  total: number; noun: string; onPage: (p: number) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3">
      <p className="text-sm text-muted-foreground">
        {total === 0 ? `No ${noun}` : `Showing ${rangeStart}–${rangeEnd} of ${total} ${noun}`}
      </p>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => onPage(Math.max(1, page - 1))}
                aria-disabled={page === 1}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {getPageWindow(page, totalPages).map((p, i) =>
              p === "..." ? (
                <PaginationItem key={`e-${i}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink isActive={p === page} onClick={() => onPage(p)} className="cursor-pointer">
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() => onPage(Math.min(totalPages, page + 1))}
                aria-disabled={page === totalPages}
                className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

/** Plain-English list of the active filters, recorded on the export's "About" sheet. */
function describeFilters(o: {
  search?: string; balanceOnly?: boolean;
  unassignedTeam?: boolean;
  noSalesperson?: boolean; noCategory?: boolean;
  clearView?: ClearView;
  /** Per-column selections, from `describeColumnFilters(COLUMNS, grid)`. */
  columns?: { label: string; values: string[] }[];
}): string[] {
  const out: string[] = [];
  if (o.search?.trim()) out.push(`Search: "${o.search.trim()}"`);
  // Named on the export even though it is the DEFAULT view: a sheet of 27 rows from a 54-row master
  // has to say why, or it reads as the whole master.
  if (o.clearView === "uncleared") out.push("Uncleared cases only");
  if (o.clearView === "cleared") out.push("Cleared cases only");
  if (o.balanceOnly) out.push("Only rows with a balance");
  // The three "who is unmapped" chips (RC-17). Each counts EVERY unmapped customer, not only those
  // who owe — so the sheet has to say which, or 1,088 rows read as a broken export.
  if (o.unassignedTeam) out.push("Only customers with no collection team");
  if (o.noSalesperson) out.push("Only customers with no salesperson");
  if (o.noCategory) out.push("Only customers with no category");
  // Every per-column filter, by the column's own header. Without this a grid narrowed from 1,882
  // rows to 12 exports a sheet whose "Filters applied" band says only what was typed in the search.
  for (const c of o.columns ?? []) out.push(`${c.label}: ${c.values.join(", ")}`);
  return out;
}

// ── Salesperson & Category muster ───────────────────────────────────────────────
interface TagDraft { salesperson: string; category: string; checked: boolean }

function TagMuster({ rows, snapByGuid, master, knownNames, onReload }: {
  rows: TagRow[]; snapByGuid: Map<string, SnapRow>;
  /** The salesperson master. The cell picks from it; the Excel import is validated against it. */
  master: NameMasterRow[]; knownNames: Set<string>; onReload: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Record<string, TagDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort(),
    [rows],
  );
  const snap = (r: TagRow) => snapByGuid.get(r.ledger_id);
  const out = (r: TagRow) => Number(snap(r)?.outstanding ?? 0);

  /**
   * "Who is unmapped?" in one click — no salesperson, no category (RC-17).
   *
   * ⚠ EVERY UNMAPPED CUSTOMER, not only those who owe. The neighbouring collection-team chip counted
   *   owing-only for years and that was right for ITS job — finding customers nobody is chasing, where
   *   a credit balance means there is nothing to collect. This chip does a different job. An untagged
   *   customer is invisible to every scoped salesperson and to the Advances report (RC-18) whether or
   *   not they owe today, and they will bill tomorrow: owing-only would report 3 where 27 are actually
   *   unmapped, and the 24 it hid are precisely the ones worth fixing BEFORE they bill. The
   *   "Has balance" toggle beside it narrows to those carrying a balance — `Math.abs(out) >= 1`, so
   *   credit balances are kept too; it is not an "owes money" filter.
   *
   * ⚠ `isUnset`, never `=== null`. '' and NULL both mean unset — the muster seed left empty strings
   *   on 1,631 rows, and 14 of the unset categories are '' rather than NULL.
   *
   * 🔴 "OTHERS" IS A REAL SALESPERSON, not an unset one — 678 ledgers carry it deliberately. Folding
   *   it in here would overstate the gap and send somebody to re-tag rows that are already tagged.
   *
   * ⚠ Counted over ALL rows, so the number on the chip does not move as somebody filters the table.
   *
   * ⚠ DECLARED AFTER `out` — these two do not use it, but an amount-based variant added here later
   *   would. useMemo runs its callback DURING render at the line it sits on, so referencing a const
   *   declared further down throws "Cannot access 'out' before initialization" and takes the whole tab
   *   out. TypeScript cannot catch it: the reference is inside a closure, which for all the compiler
   *   knows runs later.
   */
  const [noSalespersonOnly, setNoSalespersonOnly] = useState(false);
  const [noCategoryOnly, setNoCategoryOnly] = useState(false);
  const unmapped = useMemo(() => ({
    salesperson: rows.filter((r) => isUnset(r.salesperson)).length,
    category: rows.filter((r) => isUnset(r.category)).length,
  }), [rows]);

  const cur = (r: TagRow): TagDraft =>
    draft[r.ledger_id] ?? { salesperson: r.salesperson ?? "", category: r.category ?? "", checked: r.checked };
  const isDirty = (r: TagRow): boolean => {
    const d = draft[r.ledger_id];
    return !!d && (d.salesperson !== (r.salesperson ?? "") || d.category !== (r.category ?? "") || d.checked !== r.checked);
  };
  const patch = (r: TagRow, p: Partial<TagDraft>) =>
    setDraft((prev) => ({ ...prev, [r.ledger_id]: { ...cur(r), ...p } }));

  const save = async (r: TagRow) => {
    const d = cur(r);
    setSavingId(r.ledger_id);
    try {
      await saveTag({
        ledger_id: r.ledger_id,
        salesperson: d.salesperson.trim() || null,
        category: d.category.trim() || null,
        checked: d.checked,
      });
      r.salesperson = d.salesperson.trim() || null;
      r.category = d.category.trim() || null;
      r.checked = d.checked;
      setDraft((prev) => { const { [r.ledger_id]: _omit, ...rest } = prev; return rest; });
      toast({ title: "Saved", description: `${r.tally_name ?? "Customer"} updated.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save", description: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  /**
   * ⚠ SORT AND FILTER READ THE SAVED ROW, NEVER THE DRAFT. A half-typed category must not make its
   *   row jump out of the list the person is typing into. The `cell` renderers below are the only
   *   place the draft appears.
   *
   * ⚠ Each `value` folds through `isUnset`, not just `?? ""`. `filterValueOf` maps '' and null to
   *   the blank sentinel but does NOT trim, so a whitespace-only tag would become its own filter
   *   option while the chip above counted it as unset. There are none today; this keeps it that way.
   */
  const columns = useMemo<TableColumn<TagRow>[]>(() => [
    {
      key: "customer", label: "Customer", head: "min-w-[220px]",
      value: (r) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "",
      cell: (r) => (
        <span className="font-medium">{snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "—"}</span>
      ),
    },
    {
      key: "company", label: "Company", head: "min-w-[150px]", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim() || "—",
    },
    {
      key: "location", label: "Location", head: "w-28", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim() || "—",
    },
    {
      key: "salesperson", label: "Salesperson", head: "min-w-[180px]",
      value: (r) => (isUnset(r.salesperson) ? "" : (r.salesperson as string)),
      cell: (r) => (
        <MasterValueCell
          value={cur(r).salesperson} master={master}
          onChange={(v) => patch(r, { salesperson: v ?? "" })}
        />
      ),
    },
    {
      key: "category", label: "Category", head: "w-28",
      value: (r) => (isUnset(r.category) ? "" : (r.category as string)),
      cell: (r) => (
        <Input list="muster-categories" value={cur(r).category}
          onChange={(e) => patch(r, { category: e.target.value })} className="h-8" />
      ),
    },
    {
      // Money: ordered by the amount, never by "₹1,23,456" as a string. No filter — every value is
      // its own, so the dropdown would merely restate the column.
      key: "outstanding", label: "Outstanding", head: "w-32", right: true, filter: false,
      value: (r) => fmtINR(out(r)), sortValue: (r) => out(r),
      cell: (r) => fmtINR(out(r)),
    },
    {
      key: "status", label: "Status", head: "w-28",
      value: (r) => (r.checked ? "Verified" : r.source === "sync_stub" ? "New" : "Unchecked"),
      cell: (r) => <StatusBadge checked={r.checked} source={r.source} />,
    },
    {
      key: "checked", label: "Checked", head: "w-20 text-center", cellClass: "text-center",
      value: (r) => (r.checked ? "Yes" : "No"),
      cell: (r) => (
        <Checkbox checked={cur(r).checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
      ),
    },
    {
      key: "save", label: "Save", head: "w-24 text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (r) => (
        <Button size="sm" variant={isDirty(r) ? "default" : "outline"} disabled={!isDirty(r) || savingId === r.ledger_id}
          onClick={() => save(r)} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />{savingId === r.ledger_id ? "…" : "Save"}
        </Button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [snapByGuid, master, draft, savingId]);

  /** ⚠ useCallback: useColumnGrid's `base` depends on this identity, and would recompute every render. */
  const prefilter = useCallback((r: TagRow) => {
    const s = snapByGuid.get(r.ledger_id);
    if (balanceOnly && Math.abs(Number(s?.outstanding ?? 0)) < 1) return false;
    if (noSalespersonOnly && !isUnset(r.salesperson)) return false;
    if (noCategoryOnly && !isUnset(r.category)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${s?.name ?? r.tally_name ?? ""} ${r.salesperson ?? ""} ${s?.company ?? ""} ${s?.location ?? ""}`
      .toLowerCase().includes(q);
  }, [search, balanceOnly, noSalespersonOnly, noCategoryOnly, snapByGuid]);

  // Opens on the biggest debtors, as it always has. Without this the grid would open in fetch order.
  const grid = useColumnGrid(rows, columns, prefilter, { key: "outstanding", dir: "desc" });
  const view = grid.rows;

  // ⚠ Reset the page on every narrowing control. A chip that cuts 1,887 rows to 27 while the reader
  //   sits on page 40 lands them on a blank page with no hint why.
  useEffect(() => { setPage(1); }, [search, balanceOnly, noSalespersonOnly, noCategoryOnly, grid.anyFilter]);

  const totalPages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rangeStart = view.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, view.length);

  const clearAll = () => {
    grid.clearFilters();
    setSearch(""); setBalanceOnly(false); setNoSalespersonOnly(false); setNoCategoryOnly(false);
  };

  const chip = (on: boolean, toggle: () => void, label: string, n: number) => (
    <Button size="sm" variant={on ? "default" : "outline"} onClick={toggle} className="gap-1.5">
      {label}<span className="tabular-nums opacity-80">{n}</span>
    </Button>
  );

  return (
    <>
      {/* Salesperson has no datalist any more — it is a picker fed by the master (RC-15).
          Category is still free text and deliberately out of scope. */}
      <datalist id="muster-categories">
        {["A", "B", "C", "D", "E", "AA", ...categories].filter((v, i, a) => a.indexOf(v) === i).map((c) => <option key={c} value={c} />)}
      </datalist>
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / salesperson / company…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant={balanceOnly ? "default" : "outline"} onClick={() => setBalanceOnly((v) => !v)}>
              Has balance
            </Button>
            {chip(noSalespersonOnly, () => setNoSalespersonOnly((v) => !v), "No salesperson", unmapped.salesperson)}
            {chip(noCategoryOnly, () => setNoCategoryOnly((v) => !v), "No category", unmapped.category)}
            <MasterIoBar io={tagIo(snapByGuid, knownNames)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({
                search, balanceOnly, noSalesperson: noSalespersonOnly, noCategory: noCategoryOnly,
                columns: describeColumnFilters(columns, grid),
              })}
              onReload={onReload} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Customers with nothing tagged. An untagged customer is invisible to every scoped salesperson
          and to the Advances report whether or not they owe today — <span className="font-medium">Has
          balance</span> narrows to the ones carrying a balance, in either direction.
          {" "}<span className="font-medium">OTHERS</span> is a real salesperson, so it is not counted here.
        </p>
      </div>
      <GridTable
        columns={columns} grid={grid} pageRows={pageRows} rowKey={(r) => r.ledger_id}
        sourceCount={rows.length}
        emptyMessage="No customers in the muster yet."
        emptyFilteredMessage="No customers match the current filters."
        onClearFilters={clearAll}
      />
      <PagerBar page={page} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={view.length} noun="customers" onPage={setPage} />
      <p className="text-xs text-muted-foreground pt-1">
        The same name in two <span className="font-medium">companies</span> shows as two rows (each its own ledger + balance).
        Leave salesperson blank to fall back to <span className="font-medium">OTHERS</span>; tick <span className="font-medium">Checked</span> once verified.
        {" "}<button className="underline" onClick={onReload}>Reload</button> to discard unsaved edits.
      </p>
    </>
  );
}

// ── Customer group muster (keyed by ledger GUID, one row per ledger/company) ─────
interface GroupDraft { group_name: string; collection_team: string; checked: boolean }

function GroupMuster({ rows, snapByGuid, master, knownNames, onReload }: {
  rows: GroupRow[]; snapByGuid: Map<string, SnapRow>;
  /** The collection team master. Group name stays free text — it is a label, not a vocabulary. */
  master: NameMasterRow[]; knownNames: Set<string>; onReload: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Record<string, GroupDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group_name).filter((g): g is string => !!g))].sort(), [rows]);
  const snap = (r: GroupRow) => snapByGuid.get(r.ledger_id);
  const name = (r: GroupRow) => snap(r)?.name ?? r.tally_name ?? "—";
  const out = (r: GroupRow) => Number(snap(r)?.outstanding ?? 0);

  /**
   * "Unassigned" — a customer with no collection team (RC-11, widened by RC-17).
   *
   * ⚠ THIS IS NOT A TIDINESS REPORT. Once a user is scoped by collection team, a customer with no
   *   team is invisible to every one of them. And the gap re-opens on its own: collection_refresh()
   *   enrols each new customer with no team at all, so the list grows quietly unless somebody looks.
   *   This is where they look.
   *
   * 🔴 EVERY UNMAPPED CUSTOMER — changed deliberately on 18-09-2026, and the reasoning it replaced is
   *   worth stating so it is not "restored" as a bug. This chip used to count `out(r) >= 1`, owing
   *   only, deliberately not the `Math.abs()` the "Has balance" toggle uses: a CREDIT balance is money
   *   we owe the customer, so there is nothing to collect and nobody to assign. That is sound for
   *   COLLECTIONS — the question "who is nobody chasing?" — and it is why the chip read 6 against 54.
   *
   *   But the chip's job changed. The question now asked of this screen is "who needs TAGGING?", and
   *   for that owing-today is the wrong denominator: the Advances report (RC-18) shows money against
   *   the collection team, so an untagged customer holding unapplied credit is invisible to everyone
   *   scoped to a team — and a customer who owes nothing today will bill tomorrow. Owing-only reported
   *   7 where 1,088 are actually unmapped, and hid the ones holding most of the advance money.
   *
   * ⚠ "HAS BALANCE" DOES NOT REPRODUCE THE OLD NUMBER, and it would be wrong to say it does. It tests
   *   `Math.abs(out) >= 1`, so it keeps CREDIT balances too: chip + Has balance reads 25, where the
   *   old owing-only chip read 7 (measured 18-09-2026). The 18 between them are customers carrying a
   *   credit — money we owe them. Nothing on this screen reproduces the old 7 exactly; if that reading
   *   is ever wanted back it needs its own predicate, not this toggle.
   *
   * ⚠ `isUnset`, never `=== null`. The seed left an empty string on 960 of these rows and NULL on 128
   *   — `=== null` would report 128 of 1,088.
   *
   * ⚠ Counted over ALL rows, so the number does not move as somebody filters the table.
   *
   * ⚠ DECLARED AFTER `out`, and anything amount-based added here must stay below it. useMemo runs its
   *   callback DURING render, at the line it sits on, so referencing a const declared further down
   *   throws "Cannot access 'out' before initialization" and takes the whole tab out. TypeScript
   *   cannot catch it: the reference is inside a closure, which for all the compiler knows runs later.
   */
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const unassignedCount = useMemo(
    () => rows.filter((r) => isUnset(r.collection_team)).length,
    [rows],
  );

  const cur = (r: GroupRow): GroupDraft =>
    draft[r.ledger_id] ?? { group_name: r.group_name ?? "", collection_team: r.collection_team ?? "", checked: r.checked };
  const isDirty = (r: GroupRow): boolean => {
    const d = draft[r.ledger_id];
    return !!d && (d.group_name !== (r.group_name ?? "") || d.collection_team !== (r.collection_team ?? "") || d.checked !== r.checked);
  };
  const patch = (r: GroupRow, p: Partial<GroupDraft>) =>
    setDraft((prev) => ({ ...prev, [r.ledger_id]: { ...cur(r), ...p } }));

  const save = async (r: GroupRow) => {
    const d = cur(r);
    const fallback = name(r); // blank group → the customer's own (live) name
    setSavingId(r.ledger_id);
    try {
      await saveGroup({
        ledger_id: r.ledger_id,
        group_name: d.group_name.trim() || fallback,
        collection_team: d.collection_team.trim() || null,
        checked: d.checked,
      });
      r.group_name = d.group_name.trim() || fallback;
      r.collection_team = d.collection_team.trim() || null;
      r.checked = d.checked;
      setDraft((prev) => { const { [r.ledger_id]: _omit, ...rest } = prev; return rest; });
      toast({ title: "Saved", description: `${name(r)} updated.` });
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save", description: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  /**
   * ⚠ SORT AND FILTER READ THE SAVED ROW, NEVER THE DRAFT — a half-typed group must not make its row
   *   jump out of the list the person is typing into. `cell` is the only place the draft appears.
   *
   * ⚠ Collection Team folds through `isUnset` rather than `?? ""`: `filterValueOf` maps '' and null to
   *   the blank sentinel but does not trim, so without this a whitespace-only team would be its own
   *   filter option while the chip above counted it unset — the dropdown and the chip would disagree.
   */
  const columns = useMemo<TableColumn<GroupRow>[]>(() => [
    {
      key: "customer", label: "Customer", head: "min-w-[220px]",
      value: (r) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "",
      cell: (r) => <span className="font-medium">{snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "—"}</span>,
    },
    {
      key: "company", label: "Company", head: "min-w-[150px]", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim() || "—",
    },
    {
      key: "location", label: "Location", head: "w-28", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim() || "—",
    },
    {
      key: "group", label: "Group", head: "min-w-[180px]",
      value: (r) => (isUnset(r.group_name) ? "" : r.group_name),
      cell: (r) => (
        <Input list="muster-groups" value={cur(r).group_name}
          onChange={(e) => patch(r, { group_name: e.target.value })} placeholder={name(r)} className="h-8" />
      ),
    },
    {
      key: "team", label: "Collection Team", head: "min-w-[170px]",
      value: (r) => (isUnset(r.collection_team) ? "" : (r.collection_team as string)),
      cell: (r) => (
        <MasterValueCell
          value={cur(r).collection_team} master={master}
          onChange={(v) => patch(r, { collection_team: v ?? "" })}
        />
      ),
    },
    {
      // Money: ordered by the amount, never by "₹1,23,456" as a string; no filter, every value is its own.
      key: "outstanding", label: "Outstanding", head: "w-32", right: true, filter: false,
      value: (r) => fmtINR(out(r)), sortValue: (r) => out(r),
      cell: (r) => fmtINR(out(r)),
    },
    {
      key: "status", label: "Status", head: "w-28",
      value: (r) => (r.checked ? "Verified" : r.source === "sync_stub" ? "New" : "Unchecked"),
      cell: (r) => <StatusBadge checked={r.checked} source={r.source} />,
    },
    {
      key: "checked", label: "Checked", head: "w-20 text-center", cellClass: "text-center",
      value: (r) => (r.checked ? "Yes" : "No"),
      cell: (r) => (
        <Checkbox checked={cur(r).checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
      ),
    },
    {
      key: "save", label: "Save", head: "w-24 text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (r) => (
        <Button size="sm" variant={isDirty(r) ? "default" : "outline"} disabled={!isDirty(r) || savingId === r.ledger_id}
          onClick={() => save(r)} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />{savingId === r.ledger_id ? "…" : "Save"}
        </Button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [snapByGuid, master, draft, savingId]);

  /** ⚠ useCallback: useColumnGrid's `base` depends on this identity, and would recompute every render. */
  const prefilter = useCallback((r: GroupRow) => {
    const s = snapByGuid.get(r.ledger_id);
    if (balanceOnly && Math.abs(Number(s?.outstanding ?? 0)) < 1) return false;
    if (unassignedOnly && !isUnset(r.collection_team)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${s?.name ?? r.tally_name ?? ""} ${r.group_name ?? ""} ${r.collection_team ?? ""} ${s?.company ?? ""} ${s?.location ?? ""}`
      .toLowerCase().includes(q);
  }, [search, balanceOnly, unassignedOnly, snapByGuid]);

  // Opens on the biggest debtors, as it always has. Without this the grid would open in fetch order.
  const grid = useColumnGrid(rows, columns, prefilter, { key: "outstanding", dir: "desc" });
  const view = grid.rows;

  // ⚠ Reset the page on every narrowing control. The chip cuts 1,887 rows to a handful, and a reader
  //   sitting on page 40 would otherwise land on a blank page with no hint why.
  useEffect(() => { setPage(1); }, [search, balanceOnly, unassignedOnly, grid.anyFilter]);

  const totalPages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rangeStart = view.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, view.length);

  const clearAll = () => {
    grid.clearFilters();
    setSearch(""); setBalanceOnly(false); setUnassignedOnly(false);
  };

  return (
    <>
      <datalist id="muster-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      {/* Collection team has no datalist any more — it is a picker fed by the master (RC-15). */}
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / group / team…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant={balanceOnly ? "default" : "outline"} onClick={() => setBalanceOnly((v) => !v)}>
              Has balance
            </Button>
            <Button size="sm" variant={unassignedOnly ? "default" : "outline"}
              onClick={() => setUnassignedOnly((v) => !v)} className="gap-1.5">
              No collection team
              <span className="tabular-nums opacity-80">{unassignedCount}</span>
            </Button>
            <MasterIoBar io={groupIo(snapByGuid, knownNames)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({
                search, balanceOnly, unassignedTeam: unassignedOnly,
                columns: describeColumnFilters(columns, grid),
              })}
              onReload={onReload} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Customers with nobody assigned to collect from them. Anyone scoped to a collection team cannot
          see these at all — on any report, including the money they are holding on account — and every
          new customer starts here. <span className="font-medium">Has balance</span> narrows to the ones
          carrying a balance, in either direction.
        </p>
      </div>
      <GridTable
        columns={columns} grid={grid} pageRows={pageRows} rowKey={(r) => r.ledger_id}
        sourceCount={rows.length}
        emptyMessage="No customers in the muster yet."
        emptyFilteredMessage="No customers match the current filters."
        onClearFilters={clearAll}
      />
      <PagerBar page={page} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={view.length} noun="customers" onPage={setPage} />
      <p className="text-xs text-muted-foreground pt-1">
        One row per ledger (per company), keyed by the Tally GUID — a rename never orphans a mapping.
        Blank group falls back to the customer's own name; tick <span className="font-medium">Checked</span> once verified.
        {" "}<button className="underline" onClick={onReload}>Reload</button> to discard unsaved edits.
      </p>
    </>
  );
}

/**
 * Company master — maps each Tally BOOK to the finance-facing (Company, Location) pair every
 * report renders. One row per Tally company (a handful), so no pagination here.
 *
 * Keyed by the company GUID, never the name: the raw book name embeds the financial year
 * ("…-FY 26-27", "…(from 1-Apr-25)") and Tally re-mints it every April, so a name-keyed mapping
 * silently drifts once a year. A book added since the last refresh shows as New with its raw name
 * and no location — until it is mapped here, its Other Payments cannot be applied.
 */
function CompanyMuster({ rows, custCounts, onReload }: {
  rows: CompanyMapRow[];
  custCounts: Map<string, number>;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Record<string, { company: string; location: string; checked: boolean }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const cur = (r: CompanyMapRow) =>
    draft[r.company_guid] ?? { company: r.company ?? "", location: r.location ?? "", checked: r.checked };
  const isDirty = (r: CompanyMapRow) => {
    const d = cur(r);
    return d.company !== (r.company ?? "") || d.location !== (r.location ?? "") || d.checked !== r.checked;
  };
  const patch = (guid: string, r: CompanyMapRow, p: Partial<{ company: string; location: string; checked: boolean }>) =>
    setDraft((prev) => ({ ...prev, [guid]: { ...cur(r), ...p } }));

  const save = async (r: CompanyMapRow) => {
    const d = cur(r);
    if (!d.company.trim()) {
      toast({ title: "Company is required", description: "Every Tally book must map to a company.", variant: "destructive" });
      return;
    }
    setSaving(r.company_guid);
    try {
      await saveCompanyMap({
        company_guid: r.company_guid,
        tally_company: r.tally_company,
        company: d.company.trim(),
        location: d.location.trim(),
        checked: d.checked,
      });
      toast({ title: "Saved", description: `${d.company}${d.location ? ` · ${d.location}` : ""}` });
      onReload();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  /** ⚠ Sort and filter read the SAVED row, never the draft — see the note on the musters above. */
  const columns = useMemo<TableColumn<CompanyMapRow>[]>(() => [
    {
      key: "tally", label: "Tally company (as named in Tally)", head: "min-w-[280px]",
      cellClass: "text-muted-foreground",
      value: (r) => r.tally_company ?? "",
      cell: (r) => (
        <div className="max-w-[420px] truncate" title={r.tally_company ?? ""}>{r.tally_company ?? "—"}</div>
      ),
    },
    {
      key: "company", label: "Company", head: "w-[170px]",
      value: (r) => (isUnset(r.company) ? "" : (r.company as string)),
      cell: (r) => (
        <Input value={cur(r).company} onChange={(e) => patch(r.company_guid, r, { company: e.target.value })}
          placeholder="O-tec" className="h-8" />
      ),
    },
    {
      key: "location", label: "Location", head: "w-[150px]",
      value: (r) => (isUnset(r.location) ? "" : (r.location as string)),
      cell: (r) => (
        <Input value={cur(r).location} onChange={(e) => patch(r.company_guid, r, { location: e.target.value })}
          placeholder="Surat" className="h-8" />
      ),
    },
    {
      // A count: ordered as a number, and no filter — the values are near-unique per book.
      key: "customers", label: "Customers", head: "w-[110px]", right: true, filter: false,
      value: (r) => String(custCounts.get(r.company_guid) ?? 0),
      sortValue: (r) => custCounts.get(r.company_guid) ?? 0,
      cell: (r) => (custCounts.get(r.company_guid) ?? 0).toLocaleString("en-IN"),
    },
    {
      key: "status", label: "Status", head: "w-[110px]",
      value: (r) => (r.checked ? "Verified" : r.source === "sync_stub" ? "New" : "Unchecked"),
      cell: (r) => <StatusBadge checked={r.checked} source={r.source} />,
    },
    {
      key: "checked", label: "Checked", head: "w-[90px] text-center", cellClass: "text-center",
      value: (r) => (r.checked ? "Yes" : "No"),
      cell: (r) => (
        <Checkbox checked={cur(r).checked} onCheckedChange={(v) => patch(r.company_guid, r, { checked: v === true })} aria-label="Checked" />
      ),
    },
    {
      key: "save", label: "Save", head: "w-[90px] text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (r) => (
        <Button size="sm" variant={isDirty(r) ? "default" : "outline"} disabled={!isDirty(r) || saving === r.company_guid}
          onClick={() => save(r)} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />Save
        </Button>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [custCounts, draft, saving]);

  /** ⚠ useCallback: useColumnGrid's `base` depends on this identity, and would recompute every render. */
  const prefilter = useCallback((r: CompanyMapRow) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${r.tally_company ?? ""} ${r.company ?? ""} ${r.location ?? ""}`.toLowerCase().includes(q);
  }, [search]);

  // Alphabetical by book, which is the order it has always arrived in.
  const grid = useColumnGrid(rows, columns, prefilter, { key: "tally", dir: "asc" });

  // A handful of books, so no pagination — every row that survives the filters is on screen.
  const clearAll = () => { grid.clearFilters(); setSearch(""); };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Tally book / company / location…" className="pl-8" />
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
          <MasterIoBar io={companyIo(custCounts)} exportRows={grid.rows} existingRows={rows}
            activeFilters={describeFilters({ search, columns: describeColumnFilters(columns, grid) })}
            onReload={onReload} />
        </div>
      </div>
      <GridTable
        columns={columns} grid={grid} pageRows={grid.rows} rowKey={(r) => r.company_guid}
        sourceCount={rows.length}
        emptyMessage="No Tally companies found."
        emptyFilteredMessage="No Tally companies match the current filters."
        onClearFilters={clearAll}
        maxHeight="max-h-[60vh]"
      />
      <p className="text-xs text-muted-foreground pt-2">
        One row per Tally company, keyed by its permanent Tally ID — so next year's renamed book keeps
        its mapping. These two values drive the Company and Location filters on every Live report.
        {" "}<button className="underline" onClick={onReload}>Reload</button> to discard unsaved edits.
      </p>
    </>
  );
}

// ── Other Payments muster ───────────────────────────────────────────────────────
// The odd one out: the three tabs above are ONE ROW PER LEDGER, this one is one row per
// TRANSACTION. So rows are keyed by the bigint `id`, and it is the only tab with Add / Delete.
// `ledger_id` (the Tally GUID) says whose money it is — that is the key liveOtherPayments groups
// by, which is why the picker below resolves a GUID and never a name.

const ALLOC_TYPES = ["AGST REF", "ON ACCOUNT"] as const;
const allocLabel = (t: string | null) => (t === "AGST REF" ? "Against Invoice" : t === "ON ACCOUNT" ? "On Account" : "—");

interface OpDraft {
  payment_date: string; amount: string; allocation_type: string;
  ref_invoice: string; payment_ref: string; remarks: string; checked: boolean;
}
const draftOf = (r: OtherPaymentRow): OpDraft => ({
  payment_date: r.payment_date ?? "",
  amount: String(r.amount ?? ""),
  allocation_type: r.allocation_type ?? "",
  ref_invoice: r.ref_invoice ?? "",
  payment_ref: r.payment_ref ?? "",
  remarks: r.remarks ?? "",
  checked: r.checked,
});

/**
 * Type-to-search customer picker resolving to a Tally GUID.
 *
 * Caps the rendered list at 50 matches: the snapshot is ~1,800 rows and mounting them all is a
 * jank machine. Each option shows company/location because the SAME customer name legitimately
 * exists in two books — which is exactly why the GUID, not the name, is the key.
 */
function CustomerPicker({ snap, value, onPick }: {
  snap: SnapRow[]; value: string | null; onPick: (s: SnapRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const picked = value ? snap.find((s) => s.ledger_id === value) : undefined;
  const matches = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const pool = needle
      ? snap.filter((s) => (s.name ?? "").toUpperCase().includes(needle))
      : snap;
    return pool.slice(0, 50);
  }, [snap, q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          <span className={picked ? "" : "text-muted-foreground"}>
            {picked ? `${picked.name} · ${picked.company}/${picked.location}` : "Search a customer…"}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type a customer name…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>No customer matches.</CommandEmpty>
            <CommandGroup>
              {matches.map((s) => (
                <CommandItem
                  key={s.ledger_id}
                  value={s.ledger_id}
                  onSelect={() => { onPick(s); setOpen(false); setQ(""); }}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === s.ledger_id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground shrink-0">
                    {s.company}/{s.location}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Add-payment dialog. A dialog, not an inline blank row: a new row in a filtered+sorted+paginated
 *  table vanishes the moment its draft stops matching the active filter. */
function AddOtherPaymentDialog({ open, onOpenChange, snap, onAdded }: {
  open: boolean; onOpenChange: (v: boolean) => void; snap: SnapRow[];
  onAdded: (r: OtherPaymentRow) => void;
}) {
  const { toast } = useToast();
  const [ledger, setLedger] = useState<SnapRow | null>(null);
  const [d, setD] = useState<OpDraft>({
    payment_date: "", amount: "", allocation_type: "AGST REF",
    ref_invoice: "", payment_ref: "", remarks: "", checked: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setLedger(null);
      setD({ payment_date: "", amount: "", allocation_type: "AGST REF", ref_invoice: "", payment_ref: "", remarks: "", checked: true });
    }
  }, [open]);

  const amt = Number(d.amount);
  const valid = !!ledger && Number.isFinite(amt) && amt > 0 && !!d.allocation_type;

  const submit = async () => {
    if (!ledger) return;
    setSaving(true);
    try {
      const { row } = await insertOtherPayment({
        ledger_id: ledger.ledger_id,
        tally_name: ledger.name,
        payment_date: d.payment_date || null,
        amount: amt,
        allocation_type: d.allocation_type,
        ref_invoice: d.ref_invoice.trim() || null,
        payment_ref: d.payment_ref.trim() || null,
        remarks: d.remarks.trim() || null,
        checked: d.checked,
      });
      onAdded(row);
      onOpenChange(false);
      toast({ title: "Payment added", description: `${ledger.name} · ${fmtINR(amt)}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not add", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an Other Payment</DialogTitle>
          <DialogDescription>
            Money paid outside Tally. It is deducted from the customer's outstanding on the
            Live (Tally) screens — against the named invoice when there is one, oldest bills first otherwise.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Customer</span>
            <CustomerPicker snap={snap} value={ledger?.ledger_id ?? null} onPick={setLedger} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <Input type="date" value={d.payment_date} onChange={(e) => setD({ ...d, payment_date: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Amount (₹)</span>
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={d.amount}
                onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder="0.00" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Allocation</span>
            <Select value={d.allocation_type} onValueChange={(v) => setD({ ...d, allocation_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALLOC_TYPES.map((t) => <SelectItem key={t} value={t}>{allocLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ref invoice</span>
              <Input value={d.ref_invoice} onChange={(e) => setD({ ...d, ref_invoice: e.target.value })}
                placeholder="e.g. HEAD/24-25/327" />
            </div>
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Payment ref</span>
              <Input value={d.payment_ref} onChange={(e) => setD({ ...d, payment_ref: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Remarks</span>
            <Input value={d.remarks} onChange={(e) => setD({ ...d, remarks: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving} className="gap-1.5">
            <Plus className="h-4 w-4" />{saving ? "Adding…" : "Add payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OtherPaymentMuster({ rows, snap, snapByGuid, onReload }: {
  rows: OtherPaymentRow[]; snap: SnapRow[]; snapByGuid: Map<string, SnapRow>;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, OpDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<OtherPaymentRow | null>(null);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const cur = (r: OtherPaymentRow): OpDraft => draft[String(r.id)] ?? draftOf(r);
  const isDirty = (r: OtherPaymentRow) => {
    const d = draft[String(r.id)];
    if (!d) return false;
    const o = draftOf(r);
    return (Object.keys(o) as (keyof OpDraft)[]).some((k) => d[k] !== o[k]);
  };
  const patch = (r: OtherPaymentRow, p: Partial<OpDraft>) =>
    setDraft((prev) => ({ ...prev, [String(r.id)]: { ...cur(r), ...p } }));

  const nameOf = (r: OtherPaymentRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "—";
  const isOrphan = (r: OtherPaymentRow) => !snapByGuid.has(r.ledger_id);

  const save = async (r: OtherPaymentRow) => {
    const d = cur(r);
    const amt = Number(d.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ variant: "destructive", title: "Amount must be a number greater than 0" });
      return;
    }
    setSavingId(r.id);
    try {
      const input: OtherPaymentInput & { id: number } = {
        id: r.id,
        ledger_id: r.ledger_id,
        tally_name: r.tally_name,
        payment_date: d.payment_date || null,
        amount: amt,
        allocation_type: d.allocation_type,
        ref_invoice: d.ref_invoice.trim() || null,
        payment_ref: d.payment_ref.trim() || null,
        remarks: d.remarks.trim() || null,
        checked: d.checked,
      };
      await saveOtherPayment(input);
      // Mutate in place so the row reflects the save without a full reload (same idiom as the
      // tag/group tabs above).
      r.payment_date = input.payment_date; r.amount = amt; r.allocation_type = input.allocation_type;
      r.ref_invoice = input.ref_invoice; r.payment_ref = input.payment_ref;
      r.remarks = input.remarks; r.checked = input.checked;
      setDraft((prev) => { const { [String(r.id)]: _omit, ...rest } = prev; return rest; });
      toast({ title: "Saved", description: `${nameOf(r)} · ${fmtINR(amt)}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  const doDelete = async (r: OtherPaymentRow) => {
    try {
      await deleteOtherPayment(r.id);
      setConfirmDelete(null);
      toast({ title: "Deleted", description: `${nameOf(r)} · ${fmtINR(Number(r.amount))}` });
      onReload();
    } catch (e) {
      toast({ variant: "destructive", title: "Delete failed", description: (e as Error).message });
    }
  };

  /**
   * ⚠ Sort and filter read the SAVED row, never the draft — a half-typed amount must not reorder the
   *   list under the cursor. `cell` is the only place the draft appears.
   *
   * ⚠ The Orphan badge is rendered INSIDE the Customer cell but must stay OUT of its `value`, or
   *   "ACME" and "ACME Orphan" become two separate filter options for one customer.
   */
  const columns = useMemo<TableColumn<OtherPaymentRow>[]>(() => [
    {
      key: "customer", label: "Customer", head: "min-w-[220px]",
      value: (r) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "",
      cell: (r) => (
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate" title={nameOf(r)}>{nameOf(r)}</span>
          {isOrphan(r) && (
            <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">Orphan</Badge>
          )}
        </div>
      ),
    },
    {
      key: "company", label: "Company", head: "w-32", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim() || "—",
    },
    {
      key: "location", label: "Location", head: "w-28", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim() || "—",
    },
    {
      // Filters on the date as READ, sorts on the ISO value — "01-Sep-26" sorts alphabetically, which
      // would put September before March. The `#id` tail reproduces the old tie-break exactly: newest
      // payment first, and the higher id first within a day.
      key: "date", label: "Date", head: "w-36",
      value: (r) => (r.payment_date ? formatDateDMY(r.payment_date) : ""),
      sortValue: (r) => `${r.payment_date ?? ""}#${String(r.id).padStart(12, "0")}`,
      cell: (r) => (
        <Input type="date" value={cur(r).payment_date} className="h-8 min-w-[140px]"
          onChange={(e) => patch(r, { payment_date: e.target.value })} />
      ),
    },
    {
      // Sorted on the number: the cell is an <input type="number">, whose rendered text is empty, so
      // without sortValue this column could not be ordered at all. No filter — every amount is its own.
      key: "amount", label: "Amount", head: "w-32 text-right", filter: false,
      value: (r) => fmtINR(Number(r.amount) || 0), sortValue: (r) => Number(r.amount) || 0,
      cell: (r) => (
        <>
          {/* min-w, not just the column's w-32: 12 columns squeeze the flex layout hard enough that
              the field collapsed to ~57px and rendered "2000000" as "20" — an unreadable amount is
              worse than a scrollbar, and the grid's scroll container is already here to carry it. */}
          <Input type="number" inputMode="decimal" min="0" step="0.01" value={cur(r).amount}
            className="h-8 text-right tabular-nums min-w-[120px]"
            onChange={(e) => patch(r, { amount: e.target.value })} />
          <span className="block text-[10px] text-muted-foreground text-right tabular-nums pt-0.5">
            {fmtINR(Number(cur(r).amount) || 0)}
          </span>
        </>
      ),
    },
    {
      // A two-value vocabulary, so it filters on the LABEL — what the cell shows — not on the stored code.
      key: "allocation", label: "Allocation", head: "w-40",
      value: (r) => allocLabel(r.allocation_type),
      cell: (r) => (
        <Select value={cur(r).allocation_type} onValueChange={(v) => patch(r, { allocation_type: v })}>
          <SelectTrigger className="h-8 min-w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALLOC_TYPES.map((t) => <SelectItem key={t} value={t}>{allocLabel(t)}</SelectItem>)}
          </SelectContent>
        </Select>
      ),
    },
    {
      // References and free text: every value is its own, so they sort but carry no filter.
      key: "refInvoice", label: "Ref Invoice", head: "w-44", filter: false,
      value: (r) => r.ref_invoice ?? "",
      cell: (r) => (
        <Input value={cur(r).ref_invoice} className="h-8 min-w-[150px]"
          onChange={(e) => patch(r, { ref_invoice: e.target.value })} />
      ),
    },
    {
      key: "paymentRef", label: "Payment Ref", head: "w-36", filter: false,
      value: (r) => r.payment_ref ?? "",
      cell: (r) => (
        <Input value={cur(r).payment_ref} className="h-8 min-w-[120px]"
          onChange={(e) => patch(r, { payment_ref: e.target.value })} />
      ),
    },
    {
      key: "remarks", label: "Remarks", head: "min-w-[200px]", filter: false,
      value: (r) => r.remarks ?? "",
      cell: (r) => (
        <Input value={cur(r).remarks} className="h-8 min-w-[200px]"
          onChange={(e) => patch(r, { remarks: e.target.value })} />
      ),
    },
    {
      key: "status", label: "Status", head: "w-24",
      value: (r) => (r.checked ? "Verified" : r.source === "sync_stub" ? "New" : "Unchecked"),
      cell: (r) => <StatusBadge checked={r.checked} source={r.source} />,
    },
    {
      key: "checked", label: "Checked", head: "w-20 text-center", cellClass: "text-center",
      value: (r) => (r.checked ? "Yes" : "No"),
      cell: (r) => (
        <Checkbox checked={cur(r).checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
      ),
    },
    {
      key: "actions", label: "Actions", head: "w-28 text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant={isDirty(r) ? "default" : "ghost"} disabled={!isDirty(r) || savingId === r.id}
            onClick={() => save(r)} className="gap-1" aria-label="Save">
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}
            className="text-destructive hover:text-destructive" aria-label="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [snapByGuid, draft, savingId]);

  /** ⚠ useCallback: useColumnGrid's `base` depends on this identity, and would recompute every render. */
  const prefilter = useCallback((r: OtherPaymentRow) => {
    const q = search.trim().toUpperCase();
    if (!q) return true;
    const name = snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
    return `${name} ${r.ref_invoice ?? ""} ${r.payment_ref ?? ""} ${r.remarks ?? ""}`.toUpperCase().includes(q);
  }, [search, snapByGuid]);

  // Newest payment first — the order this tab has always opened in, previously hard-coded into the
  // view and unreachable from the UI. Now it is the default AND every column sorts.
  const grid = useColumnGrid(rows, columns, prefilter, { key: "date", dir: "desc" });
  const view = grid.rows;

  useEffect(() => { setPage(1); }, [search, grid.anyFilter]);

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sumShown = view.reduce((s, r) => s + Number(r.amount || 0), 0);

  const clearAll = () => { grid.clearFilters(); setSearch(""); };

  return (
    <div>
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / invoice / ref / remark…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <MasterIoBar io={otherPaymentIo(snapByGuid)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({ search, columns: describeColumnFilters(columns, grid) })}
              onReload={onReload} />
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />Add payment
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span> payment{total === 1 ? "" : "s"} ·
          {" "}<span className="font-medium text-foreground tabular-nums">{fmtINR(sumShown)}</span> shown
        </p>
      </div>

      <GridTable
        columns={columns} grid={grid} pageRows={pageRows} rowKey={(r) => String(r.id)}
        sourceCount={rows.length}
        emptyMessage="No payments recorded yet."
        emptyFilteredMessage="No payments match the current filters."
        onClearFilters={clearAll}
      />

      <PagerBar
        page={page} totalPages={totalPages}
        rangeStart={total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} rangeEnd={Math.min(page * PAGE_SIZE, total)}
        total={total} noun="payments" onPage={setPage}
      />

      <p className="text-xs text-muted-foreground pt-2">
        Money paid outside Tally, kept here because Tally has never seen it. Deducted from Outstanding
        on the Live (Tally) screens — against the named invoice, then oldest bills first, and anything
        left over sits on account. Keyed by the Tally GUID, so a rename never orphans a payment.
        <br />
        <span className="font-medium">This list is independent of the Google Sheet</span> that feeds the
        other (pipeline) view — a payment added here does not appear there, and vice versa. That is deliberate.
      </p>

      <AddOtherPaymentDialog open={addOpen} onOpenChange={setAddOpen} snap={snap} onAdded={() => onReload()} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  {nameOf(confirmDelete)} · {fmtINR(Number(confirmDelete.amount))} ·{" "}
                  {formatDateDMY(confirmDelete.payment_date)}.
                  <br />
                  Their outstanding will go UP by this amount on the Live (Tally) screens. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Red Mark master ────────────────────────────────────────────────────────────────────────────
// A per-ledger flag (presence = flagged), keyed by the Tally GUID. Drives the "Red Mark" badge/KPI/
// filter on the Live (Tally) screens. Add = pick a customer; Delete = un-flag.

type RmDraft = { salesperson: string; reason: string; checked: boolean };
const rmDraftOf = (r: RedMarkRow): RmDraft => ({
  salesperson: r.salesperson ?? "", reason: r.reason ?? "", checked: r.checked,
});

/** Add-red-mark dialog: pick a customer + optional reason, then flag them. */
function AddRedMarkDialog({ open, onOpenChange, snap, rows, onAdded }: {
  open: boolean; onOpenChange: (v: boolean) => void; snap: SnapRow[];
  /** The master as it stands, so the dialog can say when this add REOPENS a cleared case. */
  rows: RedMarkRow[]; onAdded: () => void;
}) {
  const { toast } = useToast();
  const [ledger, setLedger] = useState<SnapRow | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setLedger(null); setReason(""); } }, [open]);

  // Adding a customer whose case was CLEARED is a re-flag, and the server reopens it (the upsert
  // sends cleared:false). Saying so beats a silent "added" on a row that was already there.
  const existing = ledger ? rows.find((r) => r.ledger_id === ledger.ledger_id) ?? null : null;

  const submit = async () => {
    if (!ledger) return;
    setSaving(true);
    try {
      // The server also sets cleared:false — re-flagging a settled customer starts a new case
      // rather than leaving a row every screen ignores.
      await insertRedMark({
        ledger_id: ledger.ledger_id,
        tally_name: ledger.name,
        company: ledger.company,
        location: ledger.location,
        salesperson: null,
        reason: reason.trim() || null,
        checked: true,
      });
      onAdded();
      onOpenChange(false);
      toast({
        title: existing?.cleared ? "Red Mark reopened" : "Red Mark added",
        description: `${ledger.name}`,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not add", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a Red Mark customer</DialogTitle>
          <DialogDescription>
            Flags the customer as Red Mark across the Live (Tally) screens (KPI, badge, filter, and
            the Red Mark report). Keyed by the Tally GUID, so a rename never loses the flag.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Customer</span>
            <CustomerPicker snap={snap} value={ledger?.ledger_id ?? null} onPick={setLedger} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Reason (optional)</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. long overdue, disputed…" />
          </div>
          {existing && (
            <p className="text-[11px] text-muted-foreground">
              {existing.cleared
                ? "This customer is already on the master with a CLEARED case — adding them reopens it."
                : "This customer is already flagged; this will update their details."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ledger || saving} className="gap-1.5">
            <Plus className="h-4 w-4" />{saving ? "Adding…" : "Add Red Mark"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RedMarkMuster({ rows, snap, snapByGuid, teamByGuid, master, knownNames, onReload }: {
  rows: RedMarkRow[]; snap: SnapRow[]; snapByGuid: Map<string, SnapRow>;
  /** ledger_id → collection team, from the group muster: the who-may-clear test reads it (RC-12). */
  teamByGuid: Map<string, string>;
  /** The salesperson master. This tab kept its OWN copy of the salesperson as bare free text with
   *  no suggestions at all, and 6 of its 54 rows had already drifted off the muster vocabulary. */
  master: NameMasterRow[]; knownNames: Set<string>; onReload: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, RmDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RedMarkRow | null>(null);
  // RC-12: closing a settled case. `clearing` carries the row AND which way it is going, because
  // the dialog asks for a note one way and only confirms the other.
  const [clearing, setClearing] = useState<{ row: RedMarkRow; mode: "clear" | "reopen" } | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearView, setClearView] = useState<ClearView>(CLEAR_VIEW_DEFAULT);
  const canClear = useCanClear();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const cur = (r: RedMarkRow): RmDraft => draft[r.ledger_id] ?? rmDraftOf(r);
  const isDirty = (r: RedMarkRow) => {
    const d = draft[r.ledger_id];
    if (!d) return false;
    const o = rmDraftOf(r);
    return (Object.keys(o) as (keyof RmDraft)[]).some((k) => d[k] !== o[k]);
  };
  const patch = (r: RedMarkRow, p: Partial<RmDraft>) =>
    setDraft((prev) => ({ ...prev, [r.ledger_id]: { ...cur(r), ...p } }));

  const nameOf = (r: RedMarkRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "—";
  const isOrphan = (r: RedMarkRow) => !snapByGuid.has(r.ledger_id);
  const companyOf = (r: RedMarkRow) => (snapByGuid.get(r.ledger_id)?.company ?? r.company ?? "").trim();
  const locationOf = (r: RedMarkRow) => (snapByGuid.get(r.ledger_id)?.location ?? r.location ?? "").trim();

  const prefilter = useCallback((r: RedMarkRow) => {
    if (!matchesClearView(r, clearView)) return false;
    const q = search.trim().toUpperCase();
    if (!q) return true;
    const name = snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
    return `${name} ${r.salesperson ?? ""} ${r.reason ?? ""} ${r.clear_note ?? ""}`.toUpperCase().includes(q);
  }, [search, clearView, snapByGuid]);

  const counts = useMemo(() => countByClearView(rows), [rows]);

  const save = async (r: RedMarkRow) => {
    const d = cur(r);
    setSavingId(r.ledger_id);
    try {
      await saveRedMark({
        ledger_id: r.ledger_id,
        salesperson: d.salesperson.trim() || null,
        reason: d.reason.trim() || null,
        checked: d.checked,
      });
      r.salesperson = d.salesperson.trim() || null;
      r.reason = d.reason.trim() || null;
      r.checked = d.checked;
      setDraft((prev) => { const { [r.ledger_id]: _omit, ...rest } = prev; return rest; });
      toast({ title: "Saved", description: nameOf(r) });
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  const doDelete = async (r: RedMarkRow) => {
    try {
      await deleteRedMark(r.ledger_id);
      setConfirmDelete(null);
      toast({ title: "Removed", description: nameOf(r) });
      onReload();
    } catch (e) {
      toast({ variant: "destructive", title: "Remove failed", description: (e as Error).message });
    }
  };

  /**
   * Clear or reopen. The server's answer IS the new row, so it is written back rather than guessed
   * at — and `onReload` follows so the rest of the screen catches up.
   */
  const doClear = async (note: string) => {
    if (!clearing) return;
    const { row, mode } = clearing;
    setClearBusy(true);
    try {
      const { row: saved } = mode === "clear"
        ? await clearRedMark(row.ledger_id, note)
        : await reopenRedMark(row.ledger_id);
      Object.assign(row, saved);
      setClearing(null);
      toast({ title: mode === "clear" ? "Cleared" : "Reopened", description: nameOf(row) });
      onReload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: mode === "clear" ? "Couldn't clear" : "Couldn't reopen",
        description: (e as Error).message,
      });
    } finally {
      setClearBusy(false);
    }
  };

  /**
   * Sort and filter read the SAVED row, never the draft: a half-typed reason must not make its row
   * jump out of the list the person is typing into. `cell` is the only place the draft appears.
   *
   * ⚠ The Orphan badge renders inside the Customer cell but stays OUT of its `value`, or "ACME" and
   *   "ACME Orphan" would be two filter options for one customer.
   */
  const columns = useMemo<TableColumn<RedMarkRow>[]>(() => [
    {
      key: "customer", label: "Customer", head: "min-w-[220px]",
      value: (r) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "",
      cell: (r) => (
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate" title={nameOf(r)}>{nameOf(r)}</span>
          {isOrphan(r) && (
            <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">Orphan</Badge>
          )}
        </div>
      ),
    },
    {
      key: "company", label: "Company", head: "w-28", cellClass: "text-muted-foreground",
      value: (r) => companyOf(r), cell: (r) => companyOf(r) || "—",
    },
    {
      key: "location", label: "Location", head: "w-24", cellClass: "text-muted-foreground",
      value: (r) => locationOf(r), cell: (r) => locationOf(r) || "—",
    },
    {
      key: "salesperson", label: "Salesperson", head: "w-40",
      value: (r) => (isUnset(r.salesperson) ? "" : (r.salesperson as string)),
      cell: (r) => (
        <MasterValueCell
          value={cur(r).salesperson} master={master} className="min-w-[140px]"
          onChange={(v) => patch(r, { salesperson: v ?? "" })}
        />
      ),
    },
    {
      // Free text — every reason is its own, so it sorts but carries no filter.
      key: "reason", label: "Reason", head: "min-w-[200px]", filter: false,
      value: (r) => r.reason ?? "",
      cell: (r) => (
        <Input value={cur(r).reason} className="h-8 min-w-[200px]"
          onChange={(e) => patch(r, { reason: e.target.value })} />
      ),
    },
    {
      key: "status", label: "Status", head: "w-24",
      value: (r) => (r.source === "sync_stub" && !r.checked ? "New" : r.checked ? "Verified" : "Unchecked"),
      cell: (r) => <StatusBadge checked={r.checked} source={r.source} />,
    },
    {
      // "Clear status", never just "Status": the column beside it answers a different question —
      // has a steward verified this row?
      key: "clear", label: "Clear status", head: "w-32",
      value: (r) => (r.cleared ? "Cleared" : "Red Mark"),
      cell: (r) => <ClearStatusBadge row={r} />,
    },
    {
      key: "clearedBy", label: "Cleared by", head: "w-36",
      cellClass: "text-[11px] text-muted-foreground truncate",
      value: (r) => (r.cleared ? r.cleared_by ?? "" : ""),
      cell: (r) => <span title={describeClear(r)}>{r.cleared ? (r.cleared_by ?? "—") : "—"}</span>,
    },
    {
      key: "checked", label: "Checked", head: "w-20 text-center", cellClass: "text-center",
      value: (r) => (r.checked ? "Yes" : "No"),
      cell: (r) => (
        <Checkbox checked={cur(r).checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
      ),
    },
    {
      key: "actions", label: "Actions", head: "w-44 text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (r) => {
        const mayClear = canClear(teamByGuid.get(r.ledger_id));
        return (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant={isDirty(r) ? "default" : "ghost"} disabled={!isDirty(r) || savingId === r.ledger_id}
              onClick={() => save(r)} className="gap-1" title="Save this row">
              <Save className="h-3.5 w-3.5" />
            </Button>
            {/* Clear is the ROUTINE action and reads as one — a labelled button, in the settled-case
                colour. Delete is a correction and stays an icon. */}
            <Button
              size="sm" variant="outline"
              className="h-8 gap-1 px-2 text-[11px] border-emerald-600/40 text-emerald-700 hover:text-emerald-700 dark:text-emerald-400"
              disabled={!mayClear}
              title={mayClear
                ? (r.cleared ? "Reopen this case" : "Clear — the case is settled; the record stays")
                : "Only this customer's collection team, or an administrator, can clear it"}
              onClick={() => setClearing({ row: r, mode: r.cleared ? "reopen" : "clear" })}
            >
              {r.cleared
                ? <><RotateCcw className="h-3.5 w-3.5" />Reopen</>
                : <><CheckCircle2 className="h-3.5 w-3.5" />Clear</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}
              className="text-destructive hover:text-destructive"
              title="Delete — only if this customer was marked by mistake">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [snapByGuid, master, teamByGuid, draft, savingId, canClear]);

  const grid = useColumnGrid(rows, columns, prefilter);
  const view = grid.rows;

  useEffect(() => { setPage(1); }, [search, clearView, grid.anyFilter]);

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const clearAll = () => { grid.clearFilters(); setSearch(""); setClearView("all"); };

  return (
    <div>
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / salesperson / reason / clear note…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Company and Location moved into the column filters below, where every other column now
                has one too — two controls over the same thing would disagree the moment one of them
                cascades. */}
            <ClearStatusToggle value={clearView} onChange={setClearView} counts={counts} />
            <MasterIoBar io={redMarkIo(snapByGuid, knownNames)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({ search, clearView, columns: describeColumnFilters(columns, grid) })}
              onReload={onReload} />
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />Add Red Mark
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span> Red Mark customer{total === 1 ? "" : "s"} shown
        </p>
      </div>

      <GridTable
        columns={columns} grid={grid} pageRows={pageRows} rowKey={(r) => r.ledger_id}
        rowClass={(r) => (r.cleared ? "opacity-70" : undefined)}
        sourceCount={rows.length}
        emptyMessage="No Red Mark customers yet."
        emptyFilteredMessage={`No Red Mark customers match the current filters${clearView !== "all" ? ` in the ${clearView} view` : ""}.`}
        onClearFilters={clearAll}
      />

      <PagerBar
        page={page} totalPages={totalPages}
        rangeStart={(page - 1) * PAGE_SIZE + 1} rangeEnd={Math.min(page * PAGE_SIZE, total)}
        total={total} noun="customers" onPage={setPage}
      />

      <p className="text-xs text-muted-foreground pt-2">
        Hand-picked customers flagged <span className="font-medium">Red Mark</span>. The flag shows as a
        red badge, a Dashboard KPI, a filter, and the Red Mark report on the Live (Tally) screens.
        Keyed by the Tally GUID, so a rename never loses the flag.{" "}
        <span className="font-medium">Clear</span> closes a settled case and keeps the record;{" "}
        <span className="font-medium">Delete</span> is only for a customer marked by mistake.
      </p>

      <AddRedMarkDialog open={addOpen} onOpenChange={setAddOpen} snap={snap} rows={rows} onAdded={onReload} />

      <ClearNoteDialog
        mode={clearing?.mode ?? null}
        subject={clearing ? `${nameOf(clearing.row)}${companyOf(clearing.row) ? ` · ${companyOf(clearing.row)}` : ""}` : ""}
        row={clearing?.row ?? null}
        busy={clearBusy}
        onCancel={() => setClearing(null)}
        onConfirm={(note) => void doClear(note)}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Red Mark?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  {nameOf(confirmDelete)} will no longer be flagged as Red Mark on the Live (Tally) screens,
                  and the record is thrown away.
                  <br /><br />
                  <span className="font-medium">If the case was settled, use Clear instead</span> — that
                  removes the flag everywhere but keeps who was marked, why, and how it ended. Delete is
                  for a customer who should never have been marked.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Disputed bills master (RC-13) ─────────────────────────────────────────────────────────────
// One row per disputed BILL, addressed by its id and keyed (ledger_id, bill_ref). Stores what a
// human typed; the money lives on the Disputed Bills report, where it matches every other screen.
// Loads its own data (the disputes and the open bills) so the rest of the panel does not pay for a
// 6,000-row read nobody on the other tabs needs.

type DsDraft = { remarks: string; item: string; checked: boolean };
const dsDraftOf = (r: DisputeRow): DsDraft => ({
  remarks: r.remarks ?? "", item: r.item_description ?? "", checked: r.checked,
});

/** yyyymmdd (the snapshot's storage form) → yyyy-mm-dd; "" when it is not one. */
const ymdIso = (s: string | null) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "");

function DisputeMuster({ snap, snapByGuid, teamByGuid }: {
  snap: SnapRow[]; snapByGuid: Map<string, SnapRow>;
  /** ledger_id → collection team: the who-may-clear test, exactly as on the Red Mark tab. */
  teamByGuid: Map<string, string>;
}) {
  const { toast } = useToast();
  const canClear = useCanClear();
  // Same keys as the report, so a write here is seen there without a second fetch.
  const disputes = useQuery({ queryKey: ["disputeRows"], queryFn: fetchDisputeRows, staleTime: 60 * 1000 });
  const openBills = useQuery({ queryKey: ["openBills"], queryFn: fetchOpenBills, staleTime: 5 * 60 * 1000 });
  const rows = useMemo(() => disputes.data ?? [], [disputes.data]);

  const [draft, setDraft] = useState<Record<number, DsDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DisputeRow | null>(null);
  const [clearing, setClearing] = useState<{ row: DisputeRow; mode: "clear" | "reopen" } | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearView, setClearView] = useState<ClearView>(CLEAR_VIEW_DEFAULT);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  /** Every open (ledger, bill) — "is this dispute's bill still open?" — and the bills per customer. */
  const { openKeys, billsByLedger } = useMemo(() => {
    const keys = new Set<string>();
    const by = new Map<string, OpenBillRow[]>();
    for (const b of openBills.data ?? []) {
      keys.add(disputeKey(b.ledger_id, b.bill_ref));
      const list = by.get(b.ledger_id);
      if (list) list.push(b); else by.set(b.ledger_id, [b]);
    }
    return { openKeys: keys, billsByLedger: by };
  }, [openBills.data]);

  const reload = () => { void disputes.refetch(); void openBills.refetch(); };

  const cur = (r: DisputeRow): DsDraft => draft[r.id] ?? dsDraftOf(r);
  const isDirty = (r: DisputeRow) => {
    const d = draft[r.id];
    if (!d) return false;
    const o = dsDraftOf(r);
    return (Object.keys(o) as (keyof DsDraft)[]).some((k) => d[k] !== o[k]);
  };
  const patch = (r: DisputeRow, p: Partial<DsDraft>) =>
    setDraft((prev) => ({ ...prev, [r.id]: { ...cur(r), ...p } }));

  const nameOf = (r: DisputeRow) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "—";
  /** The customer's ledger has left the snapshot altogether — rarer than a settled bill. */
  const isOrphan = (r: DisputeRow) => !snapByGuid.has(r.ledger_id);
  /** Still open in Tally? Unknown (true) until the bills have loaded, so nothing flashes "gone". */
  const billOpen = (r: DisputeRow) => !openBills.data || openKeys.has(disputeKey(r.ledger_id, r.bill_ref));

  const prefilter = useCallback((r: DisputeRow) => {
    if (!matchesClearView(r, clearView)) return false;
    const q = search.trim().toUpperCase();
    if (!q) return true;
    const name = snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "";
    return `${name} ${r.bill_ref} ${r.remarks ?? ""} ${r.item_description ?? ""} ${r.clear_note ?? ""}`
      .toUpperCase().includes(q);
  }, [search, clearView, snapByGuid]);

  const counts = useMemo(() => countByClearView(rows), [rows]);
  const goneCount = openBills.data ? rows.filter((r) => !r.cleared && !billOpen(r)).length : 0;

  /** Only the fields that changed are sent, so this never overwrites a colleague's other edit. */
  const save = async (r: DisputeRow) => {
    const d = cur(r);
    const o = dsDraftOf(r);
    setSavingId(r.id);
    try {
      const { row } = await saveDispute({
        id: r.id,
        ...(d.remarks !== o.remarks ? { remarks: d.remarks.trim() || null } : {}),
        ...(d.item !== o.item ? { item_description: d.item.trim() || null } : {}),
        ...(d.checked !== o.checked ? { checked: d.checked } : {}),
      });
      Object.assign(r, row);
      setDraft((prev) => { const { [r.id]: _omit, ...rest } = prev; return rest; });
      toast({ title: "Saved", description: `${nameOf(r)} · ${r.bill_ref}` });
    } catch (e) {
      toast({ variant: "destructive", title: "Save failed", description: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  const doDelete = async (r: DisputeRow) => {
    try {
      await deleteDispute(r.id);
      setConfirmDelete(null);
      toast({ title: "Removed", description: `${nameOf(r)} · ${r.bill_ref}` });
      reload();
    } catch (e) {
      toast({ variant: "destructive", title: "Remove failed", description: (e as Error).message });
    }
  };

  const doClear = async (note: string) => {
    if (!clearing) return;
    const { row, mode } = clearing;
    setClearBusy(true);
    try {
      const { row: saved } = mode === "clear" ? await clearDispute(row.id, note) : await reopenDispute(row.id);
      Object.assign(row, saved);
      setClearing(null);
      toast({ title: mode === "clear" ? "Dispute cleared" : "Dispute reopened", description: `${nameOf(row)} · ${row.bill_ref}` });
      reload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: mode === "clear" ? "Couldn't clear" : "Couldn't reopen",
        description: (e as Error).message,
      });
    } finally {
      setClearBusy(false);
    }
  };

  /**
   * Sort and filter read the SAVED row, never the draft — a half-typed remark must not make its row
   * jump out of the list the person is typing into.
   *
   * ⚠ The Orphan badge renders inside the Customer cell but stays OUT of its `value`, and the "No
   *   longer open" badge is its own `open` column rather than part of the Bill ref text.
   */
  const columns = useMemo<TableColumn<DisputeRow>[]>(() => [
    {
      key: "customer", label: "Customer", head: "min-w-[220px]",
      value: (r) => snapByGuid.get(r.ledger_id)?.name ?? r.tally_name ?? "",
      cell: (r) => (
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate" title={nameOf(r)}>{nameOf(r)}</span>
          {isOrphan(r) && (
            <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">Orphan</Badge>
          )}
        </div>
      ),
    },
    {
      key: "company", label: "Company", head: "w-28", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.company ?? "").trim() || "—",
    },
    {
      key: "location", label: "Location", head: "w-24", cellClass: "text-muted-foreground",
      value: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim(),
      cell: (r) => (snapByGuid.get(r.ledger_id)?.location ?? "").trim() || "—",
    },
    {
      // Every bill reference is its own, so it sorts but carries no filter.
      key: "bill", label: "Bill ref", head: "w-36", cellClass: "font-mono text-xs whitespace-nowrap",
      filter: false,
      value: (r) => r.bill_ref, cell: (r) => r.bill_ref,
    },
    {
      key: "open", label: "Bill", head: "w-32",
      value: (r) => (billOpen(r) ? "Open" : "No longer open"),
      cell: (r) => billOpen(r) ? (
        <span className="text-xs text-muted-foreground">Open</span>
      ) : (
        <Badge
          variant="outline"
          className={`whitespace-nowrap ${r.cleared ? "text-muted-foreground" : "border-warning/50 bg-warning/10 text-warning-foreground"}`}
          title={r.cleared
            ? "Tally no longer lists this bill as open."
            : "Tally no longer lists this bill as open — most likely settled. Check, then clear the dispute."}
        >
          No longer open
        </Badge>
      ),
    },
    {
      key: "remarks", label: "Remark", head: "min-w-[240px]", filter: false,
      value: (r) => r.remarks ?? "",
      cell: (r) => (
        <Input value={cur(r).remarks} className="h-8 min-w-[240px]"
          onChange={(e) => patch(r, { remarks: e.target.value })} />
      ),
    },
    {
      key: "item", label: "Item", head: "min-w-[160px]", filter: false,
      value: (r) => r.item_description ?? "",
      cell: (r) => (
        <Input value={cur(r).item} className="h-8 min-w-[160px]"
          onChange={(e) => patch(r, { item: e.target.value })} />
      ),
    },
    {
      key: "status", label: "Status", head: "w-24",
      value: (r) => (r.checked ? "Verified" : "Unchecked"),
      cell: (r) => <StatusBadge checked={r.checked} source={r.source} />,
    },
    {
      key: "clear", label: "Clear status", head: "w-32",
      value: (r) => (r.cleared ? "Cleared" : DISPUTE_COPY.openLabel),
      cell: (r) => <ClearStatusBadge row={r} copy={DISPUTE_COPY} />,
    },
    {
      key: "clearedBy", label: "Cleared by", head: "w-36",
      cellClass: "text-[11px] text-muted-foreground truncate",
      value: (r) => (r.cleared ? r.cleared_by ?? "" : ""),
      cell: (r) => <span title={describeClear(r)}>{r.cleared ? (r.cleared_by ?? "—") : "—"}</span>,
    },
    {
      key: "checked", label: "Checked", head: "w-20 text-center", cellClass: "text-center",
      value: (r) => (r.checked ? "Yes" : "No"),
      cell: (r) => (
        <Checkbox checked={cur(r).checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
      ),
    },
    {
      key: "actions", label: "Actions", head: "w-44 text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (r) => {
        const mayClear = canClear(teamByGuid.get(r.ledger_id));
        return (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant={isDirty(r) ? "default" : "ghost"} disabled={!isDirty(r) || savingId === r.id}
              onClick={() => save(r)} className="gap-1" title="Save this row">
              <Save className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm" variant="outline"
              className={`h-8 gap-1 px-2 text-[11px] border-emerald-600/40 text-emerald-700 hover:text-emerald-700 dark:text-emerald-400 ${
                !r.cleared && !billOpen(r) ? "ring-1 ring-warning" : ""
              }`}
              disabled={!mayClear}
              title={mayClear
                ? (r.cleared ? "Reopen this dispute" : "Clear — the dispute is settled; the record stays")
                : "Only this customer's collection team, or an administrator, can clear it"}
              onClick={() => setClearing({ row: r, mode: r.cleared ? "reopen" : "clear" })}
            >
              {r.cleared
                ? <><RotateCcw className="h-3.5 w-3.5" />Reopen</>
                : <><CheckCircle2 className="h-3.5 w-3.5" />Clear</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}
              className="text-destructive hover:text-destructive"
              title="Delete — only if this bill was listed by mistake">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [snapByGuid, openKeys, openBills.data, teamByGuid, draft, savingId, canClear]);

  const grid = useColumnGrid(rows, columns, prefilter);
  const view = grid.rows;

  useEffect(() => { setPage(1); }, [search, clearView, grid.anyFilter]);

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const clearAll = () => { grid.clearFilters(); setSearch(""); setClearView("all"); };

  // The add dialog reads the raw snapshot here, like every other muster tab (see OpenBillRow).
  const dialogCustomers = useMemo<DisputeCustomer[]>(
    () => snap.map((s) => ({
      ledgerId: s.ledger_id, name: s.name ?? "", company: (s.company ?? "").trim(), location: (s.location ?? "").trim(),
    })),
    [snap],
  );
  const billsOf = useCallback((ledgerId: string): DisputeBill[] =>
    (billsByLedger.get(ledgerId) ?? []).map((b) => ({
      billRef: b.bill_ref,
      date: ymdIso(b.bill_date),
      dueDate: ymdIso(b.due_date),
      amount: Number(b.amount) || 0,
      pending: Number(b.pending) || 0,
      overdueDays: Number(b.overdue_days) || 0,
      saleType: b.sale_type ?? "other",
    })), [billsByLedger]);

  if (disputes.error || openBills.error) {
    return (
      <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-3">
        Could not load the disputed bills: {((disputes.error ?? openBills.error) as Error).message}
      </div>
    );
  }
  if (disputes.isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Loading disputed bills…</p>;

  return (
    <div>
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / bill / remark / item…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ClearStatusToggle value={clearView} onChange={setClearView} counts={counts} />
            <MasterIoBar io={disputeIo(snapByGuid, openKeys)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({ search, clearView, columns: describeColumnFilters(columns, grid) })}
              onReload={reload} />
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={!openBills.data} className="gap-1.5">
              <Plus className="h-4 w-4" />Add disputed bills
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span> disputed bill{total === 1 ? "" : "s"} shown
          {goneCount > 0 && (
            <>
              {" · "}
              <button
                className="underline text-warning-foreground"
                onClick={() => { grid.setSelected("open", ["No longer open"]); setClearView("uncleared"); }}
              >
                {goneCount} open dispute{goneCount === 1 ? "" : "s"} on a bill no longer open in Tally
              </button>
            </>
          )}
        </p>
      </div>

      <GridTable
        columns={columns} grid={grid} pageRows={pageRows} rowKey={(r) => String(r.id)}
        rowClass={(r) => (r.cleared ? "opacity-70" : undefined)}
        sourceCount={rows.length}
        emptyMessage="No disputed bills yet."
        emptyFilteredMessage={`No disputed bills match the current filters${clearView !== "all" ? ` in the ${clearView} view` : ""}.`}
        onClearFilters={clearAll}
      />

      <PagerBar
        page={page} totalPages={totalPages}
        rangeStart={(page - 1) * PAGE_SIZE + 1} rangeEnd={Math.min(page * PAGE_SIZE, total)}
        total={total} noun="disputed bills" onPage={setPage}
      />

      <p className="text-xs text-muted-foreground pt-2">
        Customer bills under dispute, one row per bill. Amounts are not kept here — the{" "}
        <span className="font-medium">Disputed Bills report</span> shows each bill's live figures.{" "}
        <span className="font-medium">No longer open</span> means Tally has knocked the bill off, usually
        because it was settled: check it, then clear the dispute.{" "}
        <span className="font-medium">Clear</span> closes a settled dispute and keeps the record;{" "}
        <span className="font-medium">Delete</span> is only for a bill added by mistake.
      </p>

      <AddDisputeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customers={dialogCustomers}
        billsOf={billsOf}
        existing={rows}
        onAdded={() => reload()}
      />

      <ClearNoteDialog
        mode={clearing?.mode ?? null}
        subject={clearing ? `${clearing.row.bill_ref} · ${nameOf(clearing.row)}` : ""}
        row={clearing?.row ?? null}
        busy={clearBusy}
        onCancel={() => setClearing(null)}
        onConfirm={(note) => void doClear(note)}
        copy={DISPUTE_COPY}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this disputed bill?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  {confirmDelete.bill_ref} on {nameOf(confirmDelete)} comes off the list, and its remark and
                  history are thrown away.
                  <br /><br />
                  <span className="font-medium">If the dispute was settled, use Clear instead</span> — that
                  keeps the remark, who cleared it and how. Delete is for a bill added by mistake.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The Master panel — a self-contained governance section (rendered INSIDE Settings). Reads
 * the ConnectWave musters + snapshot directly; writes go through the muster-write Edge
 * Function.
 *
 * Gated on FULL ACCESS to the Settings menu — admins, plus any user an admin granted it
 * (profiles.receivables_admin_menus). Renders nothing otherwise; Settings also hides the tab.
 * The Edge Function re-checks the same grant server-side with the service role, so this is a
 * render decision, not the access control.
 */
export function MusterPanel() {
  const { hasFullAccess, canEdit } = useHubMenuAccess();
  // Full access to the Settings menu says WHICH depth they get; the module grant
  // says whether they may write at all. Both must pass.
  const canManage = canEdit && hasFullAccess("settings");
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [snap, setSnap] = useState<SnapRow[] | null>(null);
  const [companyMap, setCompanyMap] = useState<CompanyMapRow[] | null>(null);
  const [otherPayments, setOtherPayments] = useState<OtherPaymentRow[] | null>(null);
  const [redMarks, setRedMarks] = useState<RedMarkRow[] | null>(null);
  // The two managed vocabularies (RC-15). They gate what the pickers on the tabs below may offer,
  // so they are loaded with everything else rather than per-tab: the io descriptors that validate
  // an Excel import are built from them at render time.
  const [salespersonMaster, setSalespersonMaster] = useState<NameMasterRow[] | null>(null);
  const [teamMaster, setTeamMaster] = useState<NameMasterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const load = () => {
    setLoading(true);
    setError(null);
    // The Disputed Bills tab loads its own data through react-query; Reload has to mean that too.
    void queryClient.invalidateQueries({ queryKey: ["disputeRows"] });
    void queryClient.invalidateQueries({ queryKey: ["openBills"] });
    Promise.all([
      fetchTagRows(), fetchGroupRows(), fetchSnapshot(), fetchCompanyMap(),
      fetchOtherPaymentRows(), fetchRedMarkRows(),
      fetchSalespersonMaster(), fetchCollectionTeamMaster(),
    ])
      .then(([t, g, s, cm, op, rm, spm, ctm]) => {
        // Resolve each snapshot row's company/location from the master ONCE, here, so every
        // consumer below (filters, search, columns) sees the same finance-facing pair the reports
        // show — the snapshot itself only carries the raw Tally book name and a blank location.
        const resolve = makeCompanyResolver(cm);
        setTags(t);
        setGroups(g);
        setCompanyMap(cm);
        setOtherPayments(op);
        setRedMarks(rm);
        setSalespersonMaster(spm);
        setTeamMaster(ctm);
        setSnap(s.map((row) => ({ ...row, ...resolve(row.tenant_id, row.company) })));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (canManage) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canManage]);

  const snapByGuid = useMemo(() => {
    const m = new Map<string, SnapRow>();
    (snap ?? []).forEach((s) => m.set(s.ledger_id, s));
    return m;
  }, [snap]);
  // The Company and Location option lists that used to live here are gone: every tab now derives
  // them per column, from the rows the OTHER filters still allow, so they cascade. A list computed
  // once over the whole snapshot could offer a combination that returns an empty table.

  // Customers per Tally book — shown in the company master so a mapping's blast radius is visible.
  const custCountByGuid = useMemo(() => {
    const m = new Map<string, number>();
    (snap ?? []).forEach((s) => {
      const g = companyGuidOf(s.tenant_id);
      m.set(g, (m.get(g) ?? 0) + 1);
    });
    return m;
  }, [snap]);

  /**
   * How each vocabulary value is actually used — the "Customers" column on the master tabs, and the
   * drift banner beside it.
   *
   * Both come from rows already in memory, so the master screens cost no extra query.
   * `inUseAnywhere` is deliberately WIDER than `counts`: Red Mark keeps its own copy of the
   * salesperson, and 6 of its 54 rows carry a name the customer muster has never held. Counting only
   * customers would leave that invisible, which is the failure this whole feature is about.
   */
  const salespersonUsage = useMemo<NameMasterUsage>(() => {
    const counts = new Map<string, number>();
    const anywhere = new Set<string>();
    (tags ?? []).forEach((t) => {
      if (isUnset(t.salesperson)) return;
      const n = t.salesperson as string;
      counts.set(n, (counts.get(n) ?? 0) + 1);
      anywhere.add(n);
    });
    (redMarks ?? []).forEach((r) => { if (!isUnset(r.salesperson)) anywhere.add(r.salesperson as string); });
    return { counts, inUseAnywhere: anywhere };
  }, [tags, redMarks]);

  /**
   * ledger_id → collection team, for the Red Mark tab's who-may-clear test (RC-12).
   *
   * From the group muster, which this panel already loads — the Red Mark master does not carry the
   * team, and the server derives it from exactly the same column, so the button and the write agree.
   * '' and NULL both mean unset, and unset is NOBODY's rather than everybody's: a collector may not
   * clear a customer with no team, and neither will the server.
   */
  const teamByGuid = useMemo(
    () => new Map(
      (groups ?? []).map((g) => [g.ledger_id, isUnset(g.collection_team) ? "" : (g.collection_team as string)]),
    ),
    [groups],
  );

  const teamUsage = useMemo<NameMasterUsage>(() => {
    const counts = new Map<string, number>();
    (groups ?? []).forEach((g) => {
      // '' and NULL both mean unset here, and they are not the same value — the sheet seed left an
      // empty string on 1,631 of the 1,875 rows. Counting them would invent a team named "".
      if (isUnset(g.collection_team)) return;
      const n = g.collection_team as string;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    });
    return { counts, inUseAnywhere: new Set(counts.keys()) };
  }, [groups]);

  /** What a WRITE is validated against — every name the list knows, switched off or not. */
  const knownSalespersons = useMemo(() => knownNames(salespersonMaster ?? []), [salespersonMaster]);
  const knownTeams = useMemo(() => knownNames(teamMaster ?? []), [teamMaster]);

  if (!canManage) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Master
            </CardTitle>
            <CardDescription className="max-w-3xl">
              The hand-kept tags behind the Collection Report (Tally Live). New customers auto-appear here after each
              sync as <span className="font-medium">New</span> (salesperson OTHERS, group = own name). Fix them and tick
              <span className="font-medium"> Checked</span>. Edits save straight to the live data — no Google Sheet needed.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5 shrink-0">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Reload
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-3 mb-3">{error}</div>
        )}
        {loading && !tags && <p className="text-sm text-muted-foreground py-8 text-center">Loading master…</p>}
        {tags && groups && (
          <Tabs defaultValue="tags">
            <TabsList>
              <TabsTrigger value="tags">Salesperson &amp; Category</TabsTrigger>
              <TabsTrigger value="groups">Customer Groups</TabsTrigger>
              <TabsTrigger value="companies">Companies &amp; Locations</TabsTrigger>
              <TabsTrigger value="other-payments">Other Payments</TabsTrigger>
              <TabsTrigger value="redmark">Red Mark</TabsTrigger>
              <TabsTrigger value="disputes">Disputed Bills</TabsTrigger>
              <TabsTrigger value="salesperson-list">Salespersons</TabsTrigger>
              <TabsTrigger value="team-list">Collection Teams</TabsTrigger>
            </TabsList>
            <TabsContent value="tags" className="mt-4">
              <TagMuster
                rows={tags} snapByGuid={snapByGuid} master={salespersonMaster ?? []}
                knownNames={knownSalespersons} onReload={load}
              />
            </TabsContent>
            <TabsContent value="groups" className="mt-4">
              <GroupMuster
                rows={groups} snapByGuid={snapByGuid} master={teamMaster ?? []}
                knownNames={knownTeams} onReload={load}
              />
            </TabsContent>
            <TabsContent value="companies" className="mt-4">
              <CompanyMuster rows={companyMap ?? []} custCounts={custCountByGuid} onReload={load} />
            </TabsContent>
            <TabsContent value="other-payments" className="mt-4">
              <OtherPaymentMuster
                rows={otherPayments ?? []} snap={snap ?? []} snapByGuid={snapByGuid} onReload={load}
              />
            </TabsContent>
            <TabsContent value="redmark" className="mt-4">
              <RedMarkMuster
                rows={redMarks ?? []} snap={snap ?? []} snapByGuid={snapByGuid}
                teamByGuid={teamByGuid}
                master={salespersonMaster ?? []} knownNames={knownSalespersons} onReload={load}
              />
            </TabsContent>
            <TabsContent value="disputes" className="mt-4">
              <DisputeMuster snap={snap ?? []} snapByGuid={snapByGuid} teamByGuid={teamByGuid} />
            </TabsContent>
            <TabsContent value="salesperson-list" className="mt-4">
              <NameMasterTab
                kind="salesperson" title="salesperson"
                rows={salespersonMaster ?? []} usage={salespersonUsage} onReload={load}
              />
            </TabsContent>
            <TabsContent value="team-list" className="mt-4">
              <NameMasterTab
                kind="collection_team" title="collection team"
                rows={teamMaster ?? []} usage={teamUsage} onReload={load}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
