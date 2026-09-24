import { useCallback, useMemo, useState } from "react";
import { Lock, Plus, Search } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { Input } from "@hub/components/ui/input";
import { Label } from "@hub/components/ui/label";
import { useToast } from "@hub/components/ui/use-toast";
import { cn } from "@hub/lib/utils";
import {
  addMasterName, knownNames, renameMasterName, setMasterNameActive,
  type NameMasterKind, type NameMasterRow,
} from "@hub/lib/nameMasters";
// The sortable header and the column filter were lifted out of this file when the Red Mark master and
// report needed the same two controls. The TABLE around them was lifted the same way once four screens
// had hand-written it — this tab now renders through that shared GridTable rather than its own copy.
import { GridTable, type TableColumn } from "@hub/components/GridTable";
import { useColumnGrid } from "@hub/lib/useColumnGrid";

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

// ── The tab ──────────────────────────────────────────────────────────────────

/** How the values are actually used, so the screen can show it and spot drift. */
export interface NameMasterUsage {
  /** name → how many customer ledgers carry it. */
  counts: Map<string, number>;
  /** Every value in use ANYWHERE, including Red Mark, which the count column does not cover. */
  inUseAnywhere: Set<string>;
}

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
      // ⚠ '' , NOT "—". An em-dash here is a value this component INVENTED, and it reached the filter
      //   dropdown as an option literally spelled "—" where every other hub grid offers "(Blank)".
      //   Left empty, filterValueOf folds it to the shared blank sentinel. See shared/lib/blankFilter.
      updatedBy: row.updated_by ?? "",
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

  /**
   * ⚠ useCallback: useColumnGrid's `base` depends on this identity and would recompute every render.
   *   Applied BEFORE the column filters, so each dropdown's options reflect the search too.
   */
  const prefilter = useCallback((v: ViewRow) =>
    `${v.row.name} ${v.status} ${v.updatedBy} ${v.row.note ?? ""}`
      .toLowerCase().includes(search.trim().toLowerCase()), [search]);

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

  /**
   * ⚠ "Updated" and "Updated by" are TWO columns, not one cell with two lines as this table used to
   *   render. A single column would have to sort on the timestamp and filter on the person, so its
   *   dropdown would list names under a header reading "Updated" — and the export would label that
   *   filter "Updated" too.
   */
  const columns = useMemo<TableColumn<ViewRow>[]>(() => [
    {
      // Every name is unique, so a dropdown here would only restate the table. It still sorts.
      key: "name", label: "Name", head: "min-w-52", filter: false,
      value: (v) => v.row.name,
      cell: (v) => (
        <>
          <span className="inline-flex items-center gap-1.5 font-medium">
            {v.row.name}
            {v.row.is_protected && <Lock className="h-3 w-3 text-muted-foreground" />}
          </span>
          {v.row.note && <p className="mt-0.5 text-xs font-normal text-muted-foreground">{v.row.note}</p>}
        </>
      ),
    },
    {
      key: "status", label: "Status", head: "w-36",
      value: (v) => v.status,
      cell: (v) => (
        <span className={cn(
          "rounded px-1.5 py-0.5 text-xs",
          v.row.is_active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
        )}>
          {v.status}
        </span>
      ),
    },
    {
      // A count: ordered as a number, not as "1,024" the string. No filter — it restates the column.
      key: "customers", label: "Customers", head: "w-28", right: true, filter: false,
      value: (v) => String(v.customers), sortValue: (v) => v.customers,
      cell: (v) => v.customers.toLocaleString("en-IN"),
    },
    {
      // Sorted on the ISO timestamp — the rendered "18-Sep-26" would sort alphabetically, putting
      // September before March. Near-unique, so no filter.
      key: "updated", label: "Updated", head: "w-32", filter: false,
      value: (v) => new Date(v.row.updated_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
      sortValue: (v) => v.row.updated_at,
      cell: (v) => new Date(v.row.updated_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
    },
    {
      key: "updatedBy", label: "Updated by", head: "w-36", cellClass: "text-muted-foreground",
      value: (v) => v.updatedBy,
      cell: (v) => v.updatedBy || "—",
    },
    {
      key: "actions", label: "Actions", head: "w-56 text-right", cellClass: "text-right", sortable: false,
      value: () => "",
      cell: (v) => v.row.is_protected ? (
        <span className="text-xs text-muted-foreground" title={`Every sync writes "${v.row.name}" onto brand-new customers, so it cannot be renamed or switched off.`}>
          Always available
        </span>
      ) : (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm" variant="outline" className="h-7 px-2 text-xs"
            disabled={busy !== null}
            onClick={() => { setRenaming(v.row); setRenameTo(v.row.name); }}
          >
            Rename
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 px-2 text-xs"
            disabled={busy === `active:${v.row.name}`}
            onClick={() => run(
              `active:${v.row.name}`,
              () => setMasterNameActive({ list: kind, name: v.row.name, is_active: !v.row.is_active }),
              v.row.is_active ? `"${v.row.name}" switched off.` : `"${v.row.name}" switched back on.`,
            )}
          >
            {v.row.is_active ? "Switch off" : "Switch on"}
          </Button>
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy, kind]);

  // Alphabetical, the order this list has always opened in.
  const grid = useColumnGrid(all, columns, prefilter, { key: "name", dir: "asc" });
  const clearFilters = () => { grid.clearFilters(); setSearch(""); };

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

          {/* No pagination: these lists are short enough that every row that survives the filters is
              on screen, which is also why there is no pager below. */}
          <GridTable
            columns={columns} grid={grid} pageRows={grid.rows} rowKey={(v) => v.row.name}
            rowClass={(v) => (v.row.is_active ? undefined : "opacity-60")}
            sourceCount={all.length}
            emptyMessage={`No ${title}s in the list yet.`}
            emptyFilteredMessage={`No ${title}s match these filters.`}
            onClearFilters={clearFilters}
            maxHeight="max-h-[60vh]"
          />

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
