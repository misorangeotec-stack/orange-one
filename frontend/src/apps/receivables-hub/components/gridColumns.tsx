import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, Search } from "lucide-react";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { TableHead } from "@hub/components/ui/table";
import { cn } from "@hub/lib/utils";

/**
 * The two controls every hub grid needs: a sortable header, and a searchable column filter.
 *
 * Both were written inside pages/NameMasterTab.tsx and lifted here unchanged (bar the keyboard
 * guard below) when the Red Mark master and the Red Mark report needed the same thing — the repo
 * rule is that EVERY grid sorts on every column and filters under every column, so a third copy was
 * the wrong answer. RC-13's disputed-bills screen is the fourth caller.
 *
 * These are hub-styled (shadcn tokens). The portal's QueueTable does all of this and more, but it
 * is painted in the portal's navy/orange tokens, which `.hub-root` does not remap — see
 * components/customerOnboarding/RequestTable.tsx for the same finding.
 */

export type SortDir = "asc" | "desc" | null;

/**
 * A searchable, multi-value column filter.
 *
 * Searchable is not optional — a live grid's customer / salesperson / updated-by lists run to
 * dozens of values, and a scroll-only dropdown is unusable.
 */
export function ColumnFilter({ label, options, selected, onChange, labelOf }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
  /**
   * How an option VALUE is drawn. Filter values carry a sentinel for "this row has nothing here"
   * (shared/lib/blankFilter), which must read as "(Blank)" rather than as an invisible NUL — pass
   * `optionLabel` from useColumnGrid and both halves agree.
   */
  labelOf?: (v: string) => string;
}) {
  const [q, setQ] = useState("");
  const draw = labelOf ?? ((v: string) => v);
  const shown = options.filter((o) => draw(o).toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (o: string) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          onKeyDown={(e) => {
            // ⚠ ScrollableTable claims the arrow keys and only bails for INPUT/TEXTAREA/SELECT,
            //   never for a button. Without this, ↓ on a column filter scrolls the table instead of
            //   opening the menu. Mirrors the guard in the portal's Combobox / MultiSelect — and it
            //   is why this control could not simply be copied out of NameMasterTab, which renders
            //   outside a ScrollableTable and never hit it.
            if (e.key === "ArrowDown" || e.key === "ArrowUp") e.stopPropagation();
          }}
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded border px-1.5 py-0.5 text-[11px]",
            selected.length
              ? "border-primary/40 bg-primary/5 text-foreground"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          <span className="truncate">
            {selected.length === 0 ? label : selected.length === 1 ? draw(selected[0]) : `${selected.length} selected`}
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
              <span className="truncate" title={draw(o)}>{draw(o)}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A header cell that cycles asc → desc → unsorted. */
export function SortHead({ label, dir, onToggle, className }: {
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
