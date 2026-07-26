import { useEffect, useMemo, useState } from "react";
import {
  ClipboardCheck, Save, RefreshCw, Search, ArrowUpDown, ArrowDown, ArrowUp, ChevronDown,
  Plus, Trash2, Check,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Badge } from "@hub/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@hub/components/ui/tabs";
import { Popover, PopoverTrigger, PopoverContent } from "@hub/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
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
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useToast } from "@hub/hooks/use-toast";
import { useSession } from "@/core/platform/session";
import {
  fetchTagRows, fetchGroupRows, fetchSnapshot, fetchOtherPaymentRows, fetchRedMarkRows,
  saveTag, saveGroup, saveCompanyMap,
  insertOtherPayment, saveOtherPayment, deleteOtherPayment,
  insertRedMark, saveRedMark, deleteRedMark,
  type TagRow, type GroupRow, type SnapRow, type OtherPaymentRow, type OtherPaymentInput,
  type RedMarkRow,
} from "@hub/lib/musterApi";
import { fetchCompanyMap, makeCompanyResolver, companyGuidOf, type CompanyMapRow } from "@hub/lib/companyMap";
import { formatDateDMY } from "@hub/lib/utils";
import { MasterIoBar } from "@hub/pages/MusterIoBar";
import { tagIo, groupIo, companyIo, otherPaymentIo, redMarkIo } from "@hub/lib/musterIo";

const PAGE_SIZE = 25;
type FilterMode = "all" | "unchecked" | "new";
type SortDir = "desc" | "asc" | null;

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

/** Sortable "Outstanding" header cell. */
function OutstandingHead({ dir, onToggle }: { dir: SortDir; onToggle: () => void }) {
  const Icon = dir === "desc" ? ArrowDown : dir === "asc" ? ArrowUp : ArrowUpDown;
  return (
    <TableHead className="w-36 text-right">
      <button onClick={onToggle} className="inline-flex items-center gap-1 ml-auto hover:text-foreground">
        Outstanding <Icon className="h-3.5 w-3.5" />
      </button>
    </TableHead>
  );
}

/**
 * Checkbox multi-select in a popover. Empty selection = no filter (show all), per the
 * platform multi-select rule (visible checkboxes + Select all + Clear).
 */
function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={selected.length ? "default" : "outline"} className="gap-1.5">
          {label}
          {selected.length > 0 && <span className="tabular-nums opacity-80">{selected.length}</span>}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="flex items-center justify-between px-1 pb-2 text-xs">
          <button className="underline text-muted-foreground hover:text-foreground" onClick={() => onChange([...options])}>Select all</button>
          <button className="underline text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>Clear</button>
        </div>
        <div className="max-h-64 overflow-auto space-y-0.5">
          {options.length === 0 && <p className="text-xs text-muted-foreground px-1 py-2">No options.</p>}
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer rounded hover:bg-muted">
              <Checkbox checked={selected.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="truncate" title={o}>{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
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

function Toolbar({
  search, onSearch, filter, onFilter, counts, balanceOnly, onToggleBalance,
  companyOptions, selectedCompanies, onCompanies,
  locationOptions, selectedLocations, onLocations,
  orphanCount, orphanOnly, onToggleOrphan,
}: {
  search: string; onSearch: (v: string) => void;
  filter: FilterMode; onFilter: (f: FilterMode) => void;
  counts: { all: number; unchecked: number; new: number };
  balanceOnly: boolean; onToggleBalance: () => void;
  companyOptions: string[]; selectedCompanies: string[]; onCompanies: (v: string[]) => void;
  locationOptions: string[]; selectedLocations: string[]; onLocations: (v: string[]) => void;
  orphanCount?: number; orphanOnly?: boolean; onToggleOrphan?: () => void;
}) {
  const btn = (mode: FilterMode, label: string, n: number) => (
    <Button size="sm" variant={filter === mode ? "default" : "outline"} onClick={() => onFilter(mode)} className="gap-1.5">
      {label}<span className="tabular-nums opacity-70">{n}</span>
    </Button>
  );
  return (
    <div className="flex flex-col gap-3 pb-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search customer / company…" className="pl-8" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {btn("all", "All", counts.all)}
          {btn("unchecked", "Unchecked", counts.unchecked)}
          {btn("new", "New", counts.new)}
          <Button size="sm" variant={balanceOnly ? "default" : "outline"} onClick={onToggleBalance}>Has balance</Button>
          {onToggleOrphan && (orphanCount ?? 0) > 0 && (
            <Button size="sm" variant={orphanOnly ? "default" : "outline"}
              className={orphanOnly ? "" : "border-destructive/40 text-destructive hover:text-destructive"}
              onClick={onToggleOrphan}>
              Orphan <span className="tabular-nums opacity-70">{orphanCount}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <MultiSelect label="Location" options={locationOptions} selected={selectedLocations} onChange={onLocations} />
        <MultiSelect label="Company" options={companyOptions} selected={selectedCompanies} onChange={onCompanies} />
        {(selectedCompanies.length > 0 || selectedLocations.length > 0) && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { onCompanies([]); onLocations([]); }}>
            Reset company/location
          </Button>
        )}
      </div>
    </div>
  );
}

/** Plain-English list of the active filters, recorded on the export's "About" sheet. */
function describeFilters(o: {
  search?: string; mode?: FilterMode; balanceOnly?: boolean;
  allocs?: string[]; companies?: string[]; locations?: string[];
}): string[] {
  const out: string[] = [];
  if (o.search?.trim()) out.push(`Search: "${o.search.trim()}"`);
  if (o.mode === "unchecked") out.push("Only unchecked");
  if (o.mode === "new") out.push("Only new");
  if (o.balanceOnly) out.push("Only rows with a balance");
  if (o.allocs?.length) out.push(`Allocation: ${o.allocs.join(", ")}`);
  if (o.companies?.length) out.push(`Companies: ${o.companies.join(", ")}`);
  if (o.locations?.length) out.push(`Locations: ${o.locations.join(", ")}`);
  return out;
}

function useMusterFilters() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [orphanOnly, setOrphanOnly] = useState(false);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, filter, balanceOnly, orphanOnly, companies, locations, sortDir]);
  const cycleSort = () => setSortDir((d) => (d === "desc" ? "asc" : d === "asc" ? null : "desc"));
  return {
    search, setSearch, filter, setFilter, balanceOnly, setBalanceOnly, orphanOnly, setOrphanOnly,
    companies, setCompanies, locations, setLocations, sortDir, cycleSort, page, setPage,
  };
}

// ── Salesperson & Category muster ───────────────────────────────────────────────
interface TagDraft { salesperson: string; category: string; checked: boolean }

function TagMuster({ rows, snapByGuid, companyOptions, locationOptions, onReload }: {
  rows: TagRow[]; snapByGuid: Map<string, SnapRow>;
  companyOptions: string[]; locationOptions: string[]; onReload: () => void;
}) {
  const { toast } = useToast();
  const f = useMusterFilters();
  const [draft, setDraft] = useState<Record<string, TagDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const salespersons = useMemo(
    () => [...new Set(rows.map((r) => r.salesperson).filter((s): s is string => !!s && s !== "OTHERS"))].sort(),
    [rows],
  );
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort(),
    [rows],
  );
  const snap = (r: TagRow) => snapByGuid.get(r.ledger_id);
  const out = (r: TagRow) => Number(snap(r)?.outstanding ?? 0);

  const counts = useMemo(() => ({
    all: rows.length,
    unchecked: rows.filter((r) => !r.checked).length,
    new: rows.filter((r) => r.source === "sync_stub").length,
  }), [rows]);

  const view = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (f.filter === "unchecked" && r.checked) return false;
      if (f.filter === "new" && r.source !== "sync_stub") return false;
      if (f.balanceOnly && Math.abs(out(r)) < 1) return false;
      const s = snap(r);
      if (f.companies.length && !f.companies.includes(s?.company ?? "")) return false;
      if (f.locations.length && !f.locations.includes(s?.location ?? "")) return false;
      if (q) {
        const hay = `${s?.name ?? r.tally_name ?? ""} ${r.salesperson ?? ""} ${s?.company ?? ""} ${s?.location ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (f.sortDir) list.sort((a, b) => f.sortDir === "desc" ? out(b) - out(a) : out(a) - out(b));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, f.search, f.filter, f.balanceOnly, f.companies, f.locations, f.sortDir, snapByGuid]);

  const totalPages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const pageRows = view.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE);
  const rangeStart = view.length === 0 ? 0 : (f.page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(f.page * PAGE_SIZE, view.length);

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

  return (
    <>
      <datalist id="muster-salespersons">{salespersons.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="muster-categories">
        {["A", "B", "C", "D", "E", "AA", ...categories].filter((v, i, a) => a.indexOf(v) === i).map((c) => <option key={c} value={c} />)}
      </datalist>
      <div className="flex justify-end pb-2">
        <MasterIoBar io={tagIo(snapByGuid)} exportRows={view} existingRows={rows}
          activeFilters={describeFilters({ search: f.search, mode: f.filter, balanceOnly: f.balanceOnly, companies: f.companies, locations: f.locations })}
          onReload={onReload} />
      </div>
      <Toolbar
        search={f.search} onSearch={f.setSearch} filter={f.filter} onFilter={f.setFilter}
        counts={counts} balanceOnly={f.balanceOnly} onToggleBalance={() => f.setBalanceOnly((v) => !v)}
        companyOptions={companyOptions} selectedCompanies={f.companies} onCompanies={f.setCompanies}
        locationOptions={locationOptions} selectedLocations={f.locations} onLocations={f.setLocations}
      />
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-52">Customer</TableHead>
              <TableHead className="min-w-40">Company</TableHead>
              <TableHead className="min-w-28">Location</TableHead>
              <TableHead className="min-w-44">Salesperson</TableHead>
              <TableHead className="w-24">Category</TableHead>
              <OutstandingHead dir={f.sortDir} onToggle={f.cycleSort} />
              <TableHead className="w-28 text-center">Status</TableHead>
              <TableHead className="w-20 text-center">Checked</TableHead>
              <TableHead className="w-24 text-right">Save</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => {
              const d = cur(r);
              const dirty = isDirty(r);
              const s = snap(r);
              return (
                <TableRow key={r.ledger_id}>
                  <TableCell className="font-medium">{s?.name ?? r.tally_name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{s?.company ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{s?.location || "—"}</TableCell>
                  <TableCell>
                    <Input list="muster-salespersons" value={d.salesperson}
                      onChange={(e) => patch(r, { salesperson: e.target.value })} placeholder="OTHERS" className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input list="muster-categories" value={d.category}
                      onChange={(e) => patch(r, { category: e.target.value })} className="h-8" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtINR(out(r))}</TableCell>
                  <TableCell className="text-center"><StatusBadge checked={r.checked} source={r.source} /></TableCell>
                  <TableCell className="text-center">
                    <Checkbox checked={d.checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || savingId === r.ledger_id}
                      onClick={() => save(r)} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" />{savingId === r.ledger_id ? "…" : "Save"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No matching customers.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <PagerBar page={f.page} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={view.length} noun="customers" onPage={f.setPage} />
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

function GroupMuster({ rows, snapByGuid, companyOptions, locationOptions, onReload }: {
  rows: GroupRow[]; snapByGuid: Map<string, SnapRow>;
  companyOptions: string[]; locationOptions: string[]; onReload: () => void;
}) {
  const { toast } = useToast();
  const f = useMusterFilters();
  const [draft, setDraft] = useState<Record<string, GroupDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group_name).filter((g): g is string => !!g))].sort(), [rows]);
  const teams = useMemo(() => [...new Set(rows.map((r) => r.collection_team).filter((t): t is string => !!t))].sort(), [rows]);
  const snap = (r: GroupRow) => snapByGuid.get(r.ledger_id);
  const name = (r: GroupRow) => snap(r)?.name ?? r.tally_name ?? "—";
  const out = (r: GroupRow) => Number(snap(r)?.outstanding ?? 0);

  const counts = useMemo(() => ({
    all: rows.length,
    unchecked: rows.filter((r) => !r.checked).length,
    new: rows.filter((r) => r.source === "sync_stub").length,
  }), [rows]);

  const view = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (f.filter === "unchecked" && r.checked) return false;
      if (f.filter === "new" && r.source !== "sync_stub") return false;
      if (f.balanceOnly && Math.abs(out(r)) < 1) return false;
      const s = snap(r);
      if (f.companies.length && !f.companies.includes(s?.company ?? "")) return false;
      if (f.locations.length && !f.locations.includes(s?.location ?? "")) return false;
      if (q) {
        const hay = `${s?.name ?? r.tally_name ?? ""} ${r.group_name ?? ""} ${r.collection_team ?? ""} ${s?.company ?? ""} ${s?.location ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (f.sortDir) list.sort((a, b) => f.sortDir === "desc" ? out(b) - out(a) : out(a) - out(b));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, f.search, f.filter, f.balanceOnly, f.companies, f.locations, f.sortDir, snapByGuid]);

  const totalPages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
  const pageRows = view.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE);
  const rangeStart = view.length === 0 ? 0 : (f.page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(f.page * PAGE_SIZE, view.length);

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

  return (
    <>
      <datalist id="muster-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="muster-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist>
      <div className="flex justify-end pb-2">
        <MasterIoBar io={groupIo(snapByGuid)} exportRows={view} existingRows={rows}
          activeFilters={describeFilters({ search: f.search, mode: f.filter, balanceOnly: f.balanceOnly, companies: f.companies, locations: f.locations })}
          onReload={onReload} />
      </div>
      <Toolbar
        search={f.search} onSearch={f.setSearch} filter={f.filter} onFilter={f.setFilter}
        counts={counts} balanceOnly={f.balanceOnly} onToggleBalance={() => f.setBalanceOnly((v) => !v)}
        companyOptions={companyOptions} selectedCompanies={f.companies} onCompanies={f.setCompanies}
        locationOptions={locationOptions} selectedLocations={f.locations} onLocations={f.setLocations}
      />
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-52">Customer</TableHead>
              <TableHead className="min-w-40">Company</TableHead>
              <TableHead className="min-w-28">Location</TableHead>
              <TableHead className="min-w-44">Group</TableHead>
              <TableHead className="min-w-40">Collection Team</TableHead>
              <OutstandingHead dir={f.sortDir} onToggle={f.cycleSort} />
              <TableHead className="w-28 text-center">Status</TableHead>
              <TableHead className="w-20 text-center">Checked</TableHead>
              <TableHead className="w-24 text-right">Save</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => {
              const d = cur(r);
              const dirty = isDirty(r);
              const s = snap(r);
              return (
                <TableRow key={r.ledger_id}>
                  <TableCell className="font-medium">{name(r)}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{s?.company ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{s?.location || "—"}</TableCell>
                  <TableCell>
                    <Input list="muster-groups" value={d.group_name}
                      onChange={(e) => patch(r, { group_name: e.target.value })} placeholder={name(r)} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <Input list="muster-teams" value={d.collection_team}
                      onChange={(e) => patch(r, { collection_team: e.target.value })} className="h-8" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtINR(out(r))}</TableCell>
                  <TableCell className="text-center"><StatusBadge checked={r.checked} source={r.source} /></TableCell>
                  <TableCell className="text-center">
                    <Checkbox checked={d.checked} onCheckedChange={(v) => patch(r, { checked: v === true })} aria-label="Checked" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || savingId === r.ledger_id}
                      onClick={() => save(r)} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" />{savingId === r.ledger_id ? "…" : "Save"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No matching customers.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <PagerBar page={f.page} totalPages={totalPages} rangeStart={rangeStart} rangeEnd={rangeEnd} total={view.length} noun="customers" onPage={f.setPage} />
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
 * report renders. One row per Tally company (a handful), so no search/pagination here.
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

  return (
    <>
      <div className="flex justify-end pb-3">
        <MasterIoBar io={companyIo(custCounts)} exportRows={rows} existingRows={rows} activeFilters={[]} onReload={onReload} />
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tally company (as named in Tally)</TableHead>
              <TableHead className="w-[160px]">Company</TableHead>
              <TableHead className="w-[140px]">Location</TableHead>
              <TableHead className="w-[110px] text-right">Customers</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[90px]">Checked</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const d = cur(r);
              return (
                <TableRow key={r.company_guid}>
                  <TableCell className="text-muted-foreground">{r.tally_company ?? "—"}</TableCell>
                  <TableCell>
                    <Input value={d.company} onChange={(e) => patch(r.company_guid, r, { company: e.target.value })} placeholder="O-tec" />
                  </TableCell>
                  <TableCell>
                    <Input value={d.location} onChange={(e) => patch(r.company_guid, r, { location: e.target.value })} placeholder="Surat" />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {custCounts.get(r.company_guid) ?? 0}
                  </TableCell>
                  <TableCell><StatusBadge checked={r.checked} source={r.source} /></TableCell>
                  <TableCell>
                    <Checkbox checked={d.checked} onCheckedChange={(v) => patch(r.company_guid, r, { checked: v === true })} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant={isDirty(r) ? "default" : "outline"} disabled={!isDirty(r) || saving === r.company_guid}
                      onClick={() => save(r)} className="gap-1.5">
                      <Save className="h-3.5 w-3.5" />
                      Save
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No Tally companies found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
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

function OtherPaymentMuster({ rows, snap, snapByGuid, companyOptions, locationOptions, onReload }: {
  rows: OtherPaymentRow[]; snap: SnapRow[]; snapByGuid: Map<string, SnapRow>;
  companyOptions: string[]; locationOptions: string[]; onReload: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, OpDraft>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<OtherPaymentRow | null>(null);

  const [search, setSearch] = useState("");
  const [allocs, setAllocs] = useState<string[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, allocs, companies, locations]);

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

  const view = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows
      .filter((r) => {
        const s = snapByGuid.get(r.ledger_id);
        if (q && !`${nameOf(r)} ${r.ref_invoice ?? ""} ${r.payment_ref ?? ""}`.toUpperCase().includes(q)) return false;
        if (allocs.length && !allocs.includes(allocLabel(r.allocation_type))) return false;
        if (companies.length && !companies.includes((s?.company ?? "").trim())) return false;
        if (locations.length && !locations.includes((s?.location ?? "").trim())) return false;
        return true;
      })
      // Newest payment first; id breaks ties so the order is stable across renders.
      .sort((a, b) => (b.payment_date ?? "").localeCompare(a.payment_date ?? "") || b.id - a.id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [rows, search, allocs, companies, locations, snapByGuid]);

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sumShown = view.reduce((s, r) => s + Number(r.amount || 0), 0);

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

  return (
    <div>
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / invoice / ref…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <MultiSelect label="Allocation" options={["Against Invoice", "On Account"]} selected={allocs} onChange={setAllocs} />
            <MultiSelect label="Location" options={locationOptions} selected={locations} onChange={setLocations} />
            <MultiSelect label="Company" options={companyOptions} selected={companies} onChange={setCompanies} />
            <MasterIoBar io={otherPaymentIo(snapByGuid)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({ search, allocs, companies, locations })} onReload={onReload} />
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

      <ScrollableTable className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Customer</TableHead>
              <TableHead className="w-28">Company</TableHead>
              <TableHead className="w-24">Location</TableHead>
              <TableHead className="w-36">Date</TableHead>
              <TableHead className="w-32 text-right">Amount</TableHead>
              <TableHead className="w-40">Allocation</TableHead>
              <TableHead className="w-44">Ref Invoice</TableHead>
              <TableHead className="w-36">Payment Ref</TableHead>
              <TableHead className="min-w-[180px]">Remarks</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20 text-center">Checked</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => {
              const d = cur(r);
              const s = snapByGuid.get(r.ledger_id);
              const dirty = isDirty(r);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{nameOf(r)}</span>
                      {isOrphan(r) && (
                        <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">Orphan</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s?.company ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s?.location ?? "—"}</TableCell>
                  <TableCell>
                    <Input type="date" value={d.payment_date} className="h-8 min-w-[140px]"
                      onChange={(e) => patch(r, { payment_date: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    {/* min-w, not just the column's w-32: 12 columns squeeze the flex layout hard
                        enough that the field collapsed to ~57px and rendered "2000000" as "20" —
                        an unreadable amount is worse than a scrollbar, and ScrollableTable is
                        already here to carry the extra width. */}
                    <Input type="number" inputMode="decimal" min="0" step="0.01" value={d.amount}
                      className="h-8 text-right tabular-nums min-w-[120px]"
                      onChange={(e) => patch(r, { amount: e.target.value })} />
                    <span className="block text-[10px] text-muted-foreground text-right tabular-nums pt-0.5">
                      {fmtINR(Number(d.amount) || 0)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Select value={d.allocation_type} onValueChange={(v) => patch(r, { allocation_type: v })}>
                      <SelectTrigger className="h-8 min-w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALLOC_TYPES.map((t) => <SelectItem key={t} value={t}>{allocLabel(t)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input value={d.ref_invoice} className="h-8 min-w-[150px]"
                      onChange={(e) => patch(r, { ref_invoice: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input value={d.payment_ref} className="h-8 min-w-[120px]"
                      onChange={(e) => patch(r, { payment_ref: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input value={d.remarks} className="h-8 min-w-[200px]"
                      onChange={(e) => patch(r, { remarks: e.target.value })} />
                  </TableCell>
                  <TableCell><StatusBadge checked={r.checked} source={r.source} /></TableCell>
                  <TableCell className="text-center">
                    <Checkbox checked={d.checked} onCheckedChange={(v) => patch(r, { checked: v === true })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || savingId === r.id}
                        onClick={() => save(r)} className="gap-1">
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}
                        className="text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                  No payments {rows.length ? "match the filters" : "recorded yet"}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      <PagerBar
        page={page} totalPages={totalPages}
        rangeStart={(page - 1) * PAGE_SIZE + 1} rangeEnd={Math.min(page * PAGE_SIZE, total)}
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
function AddRedMarkDialog({ open, onOpenChange, snap, onAdded }: {
  open: boolean; onOpenChange: (v: boolean) => void; snap: SnapRow[]; onAdded: () => void;
}) {
  const { toast } = useToast();
  const [ledger, setLedger] = useState<SnapRow | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setLedger(null); setReason(""); } }, [open]);

  const submit = async () => {
    if (!ledger) return;
    setSaving(true);
    try {
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
      toast({ title: "Red Mark added", description: `${ledger.name}` });
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

function RedMarkMuster({ rows, snap, snapByGuid, companyOptions, locationOptions, onReload }: {
  rows: RedMarkRow[]; snap: SnapRow[]; snapByGuid: Map<string, SnapRow>;
  companyOptions: string[]; locationOptions: string[]; onReload: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, RmDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RedMarkRow | null>(null);

  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, companies, locations]);

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

  const view = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows
      .filter((r) => {
        const s = snapByGuid.get(r.ledger_id);
        if (q && !`${nameOf(r)} ${r.salesperson ?? ""} ${r.reason ?? ""}`.toUpperCase().includes(q)) return false;
        if (companies.length && !companies.includes((s?.company ?? r.company ?? "").trim())) return false;
        if (locations.length && !locations.includes((s?.location ?? r.location ?? "").trim())) return false;
        return true;
      })
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [rows, search, companies, locations, snapByGuid]);

  const total = view.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = view.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  return (
    <div>
      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer / salesperson / reason…" className="pl-8" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <MultiSelect label="Location" options={locationOptions} selected={locations} onChange={setLocations} />
            <MultiSelect label="Company" options={companyOptions} selected={companies} onChange={setCompanies} />
            <MasterIoBar io={redMarkIo(snapByGuid)} exportRows={view} existingRows={rows}
              activeFilters={describeFilters({ search, companies, locations })} onReload={onReload} />
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />Add Red Mark
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{total}</span> Red Mark customer{total === 1 ? "" : "s"} shown
        </p>
      </div>

      <ScrollableTable className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Customer</TableHead>
              <TableHead className="w-28">Company</TableHead>
              <TableHead className="w-24">Location</TableHead>
              <TableHead className="w-40">Salesperson</TableHead>
              <TableHead className="min-w-[200px]">Reason</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20 text-center">Checked</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((r) => {
              const d = cur(r);
              const s = snapByGuid.get(r.ledger_id);
              const dirty = isDirty(r);
              return (
                <TableRow key={r.ledger_id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{nameOf(r)}</span>
                      {isOrphan(r) && (
                        <Badge variant="outline" className="border-destructive/40 text-destructive shrink-0">Orphan</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s?.company ?? r.company ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s?.location ?? r.location ?? "—"}</TableCell>
                  <TableCell>
                    <Input value={d.salesperson} className="h-8 min-w-[140px]"
                      onChange={(e) => patch(r, { salesperson: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Input value={d.reason} className="h-8 min-w-[200px]"
                      onChange={(e) => patch(r, { reason: e.target.value })} />
                  </TableCell>
                  <TableCell><StatusBadge checked={r.checked} source={r.source} /></TableCell>
                  <TableCell className="text-center">
                    <Checkbox checked={d.checked} onCheckedChange={(v) => patch(r, { checked: v === true })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || savingId === r.ledger_id}
                        onClick={() => save(r)} className="gap-1">
                        <Save className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}
                        className="text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No Red Mark customers {rows.length ? "match the filters" : "yet"}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollableTable>

      <PagerBar
        page={page} totalPages={totalPages}
        rangeStart={(page - 1) * PAGE_SIZE + 1} rangeEnd={Math.min(page * PAGE_SIZE, total)}
        total={total} noun="customers" onPage={setPage}
      />

      <p className="text-xs text-muted-foreground pt-2">
        Hand-picked customers flagged <span className="font-medium">Red Mark</span>. The flag shows as a
        red badge, a Dashboard KPI, a filter, and the Red Mark report on the Live (Tally) screens.
        Keyed by the Tally GUID, so a rename never loses the flag. Delete a row to un-flag the customer.
      </p>

      <AddRedMarkDialog open={addOpen} onOpenChange={setAddOpen} snap={snap} onAdded={onReload} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this Red Mark?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  {nameOf(confirmDelete)} will no longer be flagged as Red Mark on the Live (Tally) screens.
                  This cannot be undone (you can re-add them).
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
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The Master panel — a self-contained admin section (rendered INSIDE Settings). Reads
 * the ConnectWave musters + snapshot directly; writes go through the muster-write Edge
 * Function. Renders nothing for non-admins (Settings also gates it).
 */
export function MusterPanel() {
  const { isAdmin } = useSession();
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [snap, setSnap] = useState<SnapRow[] | null>(null);
  const [companyMap, setCompanyMap] = useState<CompanyMapRow[] | null>(null);
  const [otherPayments, setOtherPayments] = useState<OtherPaymentRow[] | null>(null);
  const [redMarks, setRedMarks] = useState<RedMarkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([fetchTagRows(), fetchGroupRows(), fetchSnapshot(), fetchCompanyMap(), fetchOtherPaymentRows(), fetchRedMarkRows()])
      .then(([t, g, s, cm, op, rm]) => {
        // Resolve each snapshot row's company/location from the master ONCE, here, so every
        // consumer below (filters, search, columns) sees the same finance-facing pair the reports
        // show — the snapshot itself only carries the raw Tally book name and a blank location.
        const resolve = makeCompanyResolver(cm);
        setTags(t);
        setGroups(g);
        setCompanyMap(cm);
        setOtherPayments(op);
        setRedMarks(rm);
        setSnap(s.map((row) => ({ ...row, ...resolve(row.tenant_id, row.company) })));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin]);

  const snapByGuid = useMemo(() => {
    const m = new Map<string, SnapRow>();
    (snap ?? []).forEach((s) => m.set(s.ledger_id, s));
    return m;
  }, [snap]);
  const companyOptions = useMemo(
    () => [...new Set((snap ?? []).map((s) => (s.company ?? "").trim()).filter(Boolean))].sort(),
    [snap],
  );
  const locationOptions = useMemo(
    () => [...new Set((snap ?? []).map((s) => (s.location ?? "").trim()).filter(Boolean))].sort(),
    [snap],
  );

  // Customers per Tally book — shown in the company master so a mapping's blast radius is visible.
  const custCountByGuid = useMemo(() => {
    const m = new Map<string, number>();
    (snap ?? []).forEach((s) => {
      const g = companyGuidOf(s.tenant_id);
      m.set(g, (m.get(g) ?? 0) + 1);
    });
    return m;
  }, [snap]);

  if (!isAdmin) return null;

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
            </TabsList>
            <TabsContent value="tags" className="mt-4">
              <TagMuster rows={tags} snapByGuid={snapByGuid} companyOptions={companyOptions} locationOptions={locationOptions} onReload={load} />
            </TabsContent>
            <TabsContent value="groups" className="mt-4">
              <GroupMuster rows={groups} snapByGuid={snapByGuid} companyOptions={companyOptions} locationOptions={locationOptions} onReload={load} />
            </TabsContent>
            <TabsContent value="companies" className="mt-4">
              <CompanyMuster rows={companyMap ?? []} custCounts={custCountByGuid} onReload={load} />
            </TabsContent>
            <TabsContent value="other-payments" className="mt-4">
              <OtherPaymentMuster
                rows={otherPayments ?? []} snap={snap ?? []} snapByGuid={snapByGuid}
                companyOptions={companyOptions} locationOptions={locationOptions} onReload={load}
              />
            </TabsContent>
            <TabsContent value="redmark" className="mt-4">
              <RedMarkMuster
                rows={redMarks ?? []} snap={snap ?? []} snapByGuid={snapByGuid}
                companyOptions={companyOptions} locationOptions={locationOptions} onReload={load}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
