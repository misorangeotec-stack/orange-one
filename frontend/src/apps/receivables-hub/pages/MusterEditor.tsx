import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Save, RefreshCw, Search, ArrowUpDown, ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
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
import { useToast } from "@hub/hooks/use-toast";
import { useSession } from "@/core/platform/session";
import {
  fetchTagRows, fetchGroupRows, fetchSnapshot, saveTag, saveGroup,
  type TagRow, type GroupRow, type SnapRow,
} from "@hub/lib/musterApi";

const PAGE_SIZE = 25;
type FilterMode = "all" | "unchecked" | "new";
type SortDir = "desc" | "asc" | null;

/** ₹ with Indian grouping; blank when zero. */
function fmtINR(n: number): string {
  if (!n) return "—";
  const s = Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${n < 0 ? "-" : ""}₹${s}`;
}

/**
 * Location for a Tally company. ConnectWave doesn't carry a location field, but the
 * company name encodes it (the finance company→location mapping): any "…NOIDA…" book
 * is Noida, everything else (Surat books + COLORIX) is Surat.
 */
function locationForCompany(company?: string | null): string {
  const c = (company ?? "").toUpperCase();
  if (!c) return "";
  return c.includes("NOIDA") ? "Noida" : "Surat";
}

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
      if (f.locations.length && !f.locations.includes(locationForCompany(s?.company))) return false;
      if (q) {
        const hay = `${s?.name ?? r.tally_name ?? ""} ${r.salesperson ?? ""} ${s?.company ?? ""} ${locationForCompany(s?.company)}`.toLowerCase();
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
                  <TableCell className="text-muted-foreground whitespace-nowrap">{locationForCompany(s?.company) || "—"}</TableCell>
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
      if (f.locations.length && !f.locations.includes(locationForCompany(s?.company))) return false;
      if (q) {
        const hay = `${s?.name ?? r.tally_name ?? ""} ${r.group_name ?? ""} ${r.collection_team ?? ""} ${s?.company ?? ""} ${locationForCompany(s?.company)}`.toLowerCase();
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
                  <TableCell className="text-muted-foreground whitespace-nowrap">{locationForCompany(s?.company) || "—"}</TableCell>
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
 * The Master panel — a self-contained admin section (rendered INSIDE Settings). Reads
 * the ConnectWave musters + snapshot directly; writes go through the muster-write Edge
 * Function. Renders nothing for non-admins (Settings also gates it).
 */
export function MusterPanel() {
  const { isAdmin } = useSession();
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [snap, setSnap] = useState<SnapRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([fetchTagRows(), fetchGroupRows(), fetchSnapshot()])
      .then(([t, g, s]) => { setTags(t); setGroups(g); setSnap(s); })
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
    () => [...new Set((snap ?? []).map((s) => locationForCompany(s.company)).filter(Boolean))].sort(),
    [snap],
  );

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
            </TabsList>
            <TabsContent value="tags" className="mt-4">
              <TagMuster rows={tags} snapByGuid={snapByGuid} companyOptions={companyOptions} locationOptions={locationOptions} onReload={load} />
            </TabsContent>
            <TabsContent value="groups" className="mt-4">
              <GroupMuster rows={groups} snapByGuid={snapByGuid} companyOptions={companyOptions} locationOptions={locationOptions} onReload={load} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
