import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Lock, Plus, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { useToast } from "@hub/components/ui/use-toast";
import { cn } from "@hub/lib/utils";
import {
  addMasterName, knownNames, renameMasterName, setMasterNameActive,
  type NameMasterKind, type NameMasterRow,
} from "@hub/lib/nameMasters";

/**
 * The two managed vocabularies, as a Masters tab: Salespersons and Collection Teams (RC-15).
 *
 * One component, used twice. The lists are structurally identical — a name, whether it is offered,
 * and how many customers carry it — so a second copy would only be a second place to fix things.
 *
 * ⚠ NOTHING HERE DELETES. Switching a name off means "not offered for NEW mappings"; the customers
 *   already carrying it keep reading it on every screen and in every report. A name disappearing
 *   from a report because somebody left is worse than the typo this feature exists to prevent.
 *
 * ⚠ THE LIST IS EDITED ONE ROW AT A TIME, through the Edge Function, and then reloaded. There is
 *   deliberately no "save the whole list" form seeded from a store value: that shape has twice saved
 *   an empty list over a live permission list when the tab was opened before the fetch landed.
 */

// ── Small local controls ─────────────────────────────────────────────────────

/**
 * A searchable, multi-value column filter.
 *
 * Searchable is not optional — the repo rule is that a table filter is never a bare dropdown, and
 * "Updated by" already runs to every steward who has ever touched a row.
 */
function ColumnFilter({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded border px-1.5 py-0.5 text-[11px]",
            selected.length
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          <span className="truncate">
            {selected.length === 0 ? label : selected.length === 1 ? selected[0] : `${selected.length} selected`}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-2" align="start">
        <div className="relative pb-2">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-7 pl-7 text-xs" />
        </div>
        <div className="flex items-center justify-between px-1 pb-1.5 text-[11px]">
          <button className="underline text-muted-foreground hover:text-foreground" onClick={() => onChange([...options])}>Select all</button>
          <button className="underline text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>Clear</button>
        </div>
        <div className="max-h-56 space-y-0.5 overflow-auto">
          {shown.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">Nothing matches.</p>}
          {shown.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
              <Checkbox checked={selected.includes(o)} onCheckedChange={() => toggle(o)} />
              <span className="truncate" title={o}>{o}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SortDir = "asc" | "desc" | null;

function SortHead({ label, dir, onToggle, className }: {
  label: string; dir: SortDir; onToggle: () => void; className?: string;
}) {
  return (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={onToggle}>
        {label}
        {dir === "asc" ? <ArrowUp className="h-3 w-3" />
          : dir === "desc" ? <ArrowDown className="h-3 w-3" />
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

/** How the values are actually used, so the screen can show it and spot drift. */
export interface NameMasterUsage {
  /** name → how many customer ledgers carry it. */
  counts: Map<string, number>;
  /** Every value in use ANYWHERE, including Red Mark, which the count column does not cover. */
  inUseAnywhere: Set<string>;
}

type SortKey = "name" | "status" | "customers" | "updated";

interface ViewRow {
  row: NameMasterRow;
  status: string;
  customers: number;
  updatedBy: string;
}

const STATUS_ACTIVE = "Active";
const STATUS_OFF = "Switched off";

export default function NameMasterTab({ kind, title, rows, usage, onReload }: {
  kind: NameMasterKind;
  /** Singular, lower case — "salesperson", "collection team". Used in every message. */
  title: string;
  rows: NameMasterRow[];
  usage: NameMasterUsage;
  onReload: () => void;
}) {
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fUpdatedBy, setFUpdatedBy] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [busy, setBusy] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addNote, setAddNote] = useState("");
  const [renaming, setRenaming] = useState<NameMasterRow | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const all: ViewRow[] = useMemo(
    () => rows.map((row) => ({
      row,
      status: row.is_active ? STATUS_ACTIVE : STATUS_OFF,
      customers: usage.counts.get(row.name) ?? 0,
      updatedBy: row.updated_by ?? "—",
    })),
    [rows, usage],
  );

  /**
   * Values in use on customers (or on Red Mark) that the list does not contain.
   *
   * There is deliberately no foreign key on those columns — a cron in ConnectWave tops the muster up
   * on every sync, and a rejected insert there would take the nightly refresh down with it. So drift
   * is possible by design, and this is the thing that makes it visible instead of silent.
   */
  const missing = useMemo(() => {
    const known = knownNames(rows);
    return [...usage.inUseAnywhere].filter((n) => !known.has(n)).sort((a, b) => a.localeCompare(b));
  }, [rows, usage]);

  // Search first, then each filter — so a column's own options come from the rows the OTHER
  // filters still allow, and no combination a reader can assemble here returns an empty table.
  const bySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((v) =>
      `${v.row.name} ${v.status} ${v.updatedBy} ${v.row.note ?? ""}`.toLowerCase().includes(q));
  }, [all, search]);

  const passStatus = (v: ViewRow) => fStatus.length === 0 || fStatus.includes(v.status);
  const passUpdatedBy = (v: ViewRow) => fUpdatedBy.length === 0 || fUpdatedBy.includes(v.updatedBy);

  const distinct = (list: ViewRow[], get: (v: ViewRow) => string) =>
    [...new Set(list.map(get))].sort((a, b) => a.localeCompare(b));

  // Each column is excluded from its OWN option list; narrowing to one value must still leave a way
  // to widen again.
  const statusOptions = distinct(bySearch.filter(passUpdatedBy), (v) => v.status);
  const updatedByOptions = distinct(bySearch.filter(passStatus), (v) => v.updatedBy);

  const filtered = bySearch.filter((v) => passStatus(v) && passUpdatedBy(v));

  const view = useMemo(() => {
    if (!sortDir) return filtered;
    const sign = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "customers": return sign * (a.customers - b.customers);
        case "status": return sign * a.status.localeCompare(b.status);
        case "updated": return sign * a.row.updated_at.localeCompare(b.row.updated_at);
        default: return sign * a.row.name.localeCompare(b.row.name);
      }
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    setSortDir(sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc");
  };
  const dirFor = (key: SortKey): SortDir => (sortKey === key ? sortDir : null);

  const anyFilter = search.trim() !== "" || fStatus.length > 0 || fUpdatedBy.length > 0;
  const clearFilters = () => { setSearch(""); setFStatus([]); setFUpdatedBy([]); };

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast({ title: ok });
      onReload();
    } catch (e) {
      toast({ variant: "destructive", title: "Couldn't save", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const add = (name: string, note: string) =>
    run(`add:${name}`, async () => {
      await addMasterName({ list: kind, name, note: note.trim() || null });
      setAddOpen(false); setAddName(""); setAddNote("");
    }, `Added "${name}".`);

  const doRename = async () => {
    const row = renaming;
    if (!row) return;
    const to = renameTo.trim();
    if (!to || to === row.name) return;
    setBusy(`rename:${row.name}`);
    try {
      const { counts } = await renameMasterName({ list: kind, from: row.name, to });
      const parts = [
        `${counts.ledgers} customer${counts.ledgers === 1 ? "" : "s"}`,
        counts.redmark ? `${counts.redmark} red mark${counts.redmark === 1 ? "" : "s"}` : "",
        counts.userTags ? `${counts.userTags} user tag${counts.userTags === 1 ? "" : "s"}` : "",
        counts.recipients ? `${counts.recipients} report recipient${counts.recipients === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      toast({
        title: `Renamed to "${to}"`,
        description: `Moved with it: ${parts.join(", ")}.`,
      });
      setRenaming(null); setRenameTo("");
      onReload();
    } catch (e) {
      toast({ variant: "destructive", title: "Rename failed", description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <>
      {/* The list has no rows at all — a different thing from a filter matching none. */}
      {rows.length === 0 ? (
        <div className="rounded-md border border-border px-4 py-12 text-center">
          <p className="text-sm font-medium">No {title}s in the list yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Until a name is on this list it cannot be mapped to a customer. Add the first one.
          </p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add {title}
          </Button>
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">
                {missing.length} value{missing.length === 1 ? " is" : "s are"} in use on customers but
                not on this list.
              </p>
              <p className="mt-0.5 text-amber-800">
                They still read normally everywhere. They reached the data outside this screen — a
                sync, or a spreadsheet load — so they cannot be picked for anything new until they are
                added here.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {missing.map((n) => (
                  <Button
                    key={n} size="sm" variant="outline"
                    className="h-6 gap-1 border-amber-400 bg-white px-2 text-[11px]"
                    disabled={busy === `add:${n}`}
                    onClick={() => add(n, "Added from a value already in use on customers")}
                  >
                    <Plus className="h-3 w-3" /> {n}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${title}s…`} className="h-8 pl-8"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {activeCount} active of {rows.length}
              </span>
              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add {title}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead label="Name" dir={dirFor("name")} onToggle={() => toggleSort("name")} className="min-w-52" />
                  <SortHead label="Status" dir={dirFor("status")} onToggle={() => toggleSort("status")} className="w-36" />
                  <SortHead label="Customers" dir={dirFor("customers")} onToggle={() => toggleSort("customers")} className="w-28 text-right" />
                  <SortHead label="Updated" dir={dirFor("updated")} onToggle={() => toggleSort("updated")} className="w-40" />
                  <TableHead className="w-56 text-right">Actions</TableHead>
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  {/* Name and Customers offer no filter: every name is unique and the count is a
                      restatement of the column, so a dropdown of either would only repeat the table. */}
                  <TableHead className="py-1" />
                  <TableHead className="py-1">
                    <ColumnFilter label="Any status" options={statusOptions} selected={fStatus} onChange={setFStatus} />
                  </TableHead>
                  <TableHead className="py-1" />
                  <TableHead className="py-1">
                    <ColumnFilter label="Anyone" options={updatedByOptions} selected={fUpdatedBy} onChange={setFUpdatedBy} />
                  </TableHead>
                  <TableHead className="py-1" />
                </TableRow>
              </TableHeader>

              <TableBody>
                {/* A filter matching nothing keeps the table, its sort toggles and its filter row
                    standing. Swapping in a full empty state would remove the only control that could
                    undo it. */}
                {view.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center">
                      <p className="text-sm text-muted-foreground">No {title}s match these filters.</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : view.map((v) => {
                  const r = v.row;
                  const locked = r.is_protected;
                  return (
                    <TableRow key={r.name} className={cn(!r.is_active && "opacity-60")}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {r.name}
                          {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                        </span>
                        {r.note && (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground">{r.note}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-xs",
                          r.is_active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
                        )}>
                          {v.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v.customers.toLocaleString("en-IN")}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(r.updated_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                        <span className="block">{v.updatedBy}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {locked ? (
                          <span className="text-xs text-muted-foreground" title={`Every sync writes "${r.name}" onto brand-new customers, so it cannot be renamed or switched off.`}>
                            Always available
                          </span>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="outline" className="h-7 px-2 text-xs"
                              disabled={busy !== null}
                              onClick={() => { setRenaming(r); setRenameTo(r.name); }}
                            >
                              Rename
                            </Button>
                            <Button
                              size="sm" variant="outline" className="h-7 px-2 text-xs"
                              disabled={busy === `active:${r.name}`}
                              onClick={() => run(
                                `active:${r.name}`,
                                () => setMasterNameActive({ list: kind, name: r.name, is_active: !r.is_active }),
                                r.is_active ? `"${r.name}" switched off.` : `"${r.name}" switched back on.`,
                              )}
                            >
                              {r.is_active ? "Switch off" : "Switch on"}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="pt-2 text-xs text-muted-foreground">
            Switching a name off removes it from the pickers. Customers already mapped to it keep
            reading it, on every screen and in every report — nothing is reassigned and nothing is
            deleted.
          </p>
        </>
      )}

      {/* ── Add ─────────────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {title}</DialogTitle>
            <DialogDescription>
              Spelling matters and is never corrected automatically: this is matched exactly, so
              "{title === "salesperson" ? "Others" : "vijay"}" and
              "{title === "salesperson" ? "OTHERS" : "Vijay"}" would be two different people
              everywhere else. Two names differing only in capitalisation are refused.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nm-name">Name</Label>
              <Input id="nm-name" value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nm-note">Note <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="nm-note" value={addNote} onChange={(e) => setAddNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              disabled={!addName.trim() || busy !== null}
              onClick={() => add(addName.trim(), addNote)}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename ──────────────────────────────────────────────────────── */}
      <Dialog open={renaming !== null} onOpenChange={(o) => { if (!o) { setRenaming(null); setRenameTo(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename "{renaming?.name}"</DialogTitle>
            <DialogDescription>
              Every row holding this name moves with it — the customers mapped to it, the red marks,
              the users tagged with it in Admin → Users, and the scheduled-report recipient list.
              Nothing keeps the old spelling.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nm-rename">New name</Label>
              <Input id="nm-rename" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} autoFocus />
            </div>
            {renaming && (usage.counts.get(renaming.name) ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {usage.counts.get(renaming.name)?.toLocaleString("en-IN")} customer
                {usage.counts.get(renaming.name) === 1 ? "" : "s"} will be updated.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRenaming(null); setRenameTo(""); }}>Cancel</Button>
            <Button
              disabled={!renameTo.trim() || renameTo.trim() === renaming?.name || busy !== null}
              onClick={doRename}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
