import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { fmtSales } from "@hub/lib/salesReport";
import {
  BLOCK_DEFAULT_ON, BLOCK_SHORT, type CostingGls, type ExpenseBlock, type GlOption,
} from "@hub/lib/productionExpenses";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Pick which ledgers of ONE P&L block go into the cost of a KG. Unlike a filter, an empty pick
 * means "none counted", not "all" — so the trigger always says how many are in.
 *
 * Ledgers are listed under the P&L group Tally prints them in, with what each carried in the
 * selected period; a group's box ticks or clears all of it at once.
 */
export function CostingGlPicker({ block, options, gls, accent }: {
  block: ExpenseBlock;
  /** Every ledger of every block in the period; this picker shows its own block's. */
  options: GlOption[];
  gls: CostingGls;
  accent: string;
}) {
  const [query, setQuery] = useState("");
  const mine = useMemo(() => options.filter((o) => o.block === block), [options, block]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q
      ? mine.filter((o) => o.ledger.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
      : mine;
    const m = new Map<string, GlOption[]>();
    for (const o of shown) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()]
      .map(([group, ledgers]) => ({
        group,
        ledgers: ledgers.sort((a, b) => collator.compare(a.ledger, b.ledger)),
        amount: ledgers.reduce((s, l) => s + l.amount, 0),
      }))
      .sort((a, b) => collator.compare(a.group, b.group));
  }, [mine, query]);

  const shownLedgers = groups.flatMap((g) => g.ledgers);
  const onCount = mine.filter((o) => gls.isOn(o.block, o.ledger)).length;
  const counted = mine.reduce((s, o) => s + (gls.isOn(o.block, o.ledger) ? o.amount : 0), 0);
  const label = !mine.length ? "No ledgers"
    : onCount === mine.length ? `All ${mine.length}`
    : onCount === 0 ? "None"
    : `${onCount} of ${mine.length}`;

  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        {BLOCK_SHORT[block]} GL
      </span>
      <Popover onOpenChange={(open) => !open && setQuery("")}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-8 min-w-[120px] justify-between rounded-input border-border text-[12.5px] font-normal">
            <span className="truncate">{label}</span>
            <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent data-keep-filters className="w-[420px] max-w-[calc(100vw-32px)] p-2" align="start">
          <div className="mb-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
            Ticked ledgers are added to the cost of a KG.
            {block === "Purchase Accounts" && (
              <> Most purchase ledgers are the material already on the batch — tick only what is
                not (e.g. MANUFACTURING COST), or the same rupee counts twice.</>
            )}
          </div>
          {mine.length > 8 && (
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder="Search ledger or group" className="h-8 rounded-input pl-7 text-sm" />
            </div>
          )}
          <div className="max-h-[340px] space-y-1 overflow-y-auto">
            {!groups.length && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                {mine.length ? "No matches." : "Nothing booked here in this period."}
              </div>
            )}
            {groups.map((g) => {
              const on = g.ledgers.filter((l) => gls.isOn(l.block, l.ledger)).length;
              const all = on === g.ledgers.length;
              const single = g.ledgers.length === 1 && g.ledgers[0].ledger === g.group;
              return (
                <div key={g.group} className="rounded-md">
                  <label className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/60">
                    <Checkbox checked={all ? true : on ? "indeterminate" : false}
                              className={on && !all ? "opacity-60" : undefined}
                              onCheckedChange={() => gls.set(g.ledgers, !all)} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground" title={g.group}>{g.group}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtSales(g.amount)}</span>
                  </label>
                  {!single && g.ledgers.map((l) => (
                    <label key={l.ledger}
                           className="ml-5 flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-0.5 hover:bg-muted/60">
                      <Checkbox checked={gls.isOn(l.block, l.ledger)}
                                onCheckedChange={(v) => gls.set([l], v === true)} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={l.ledger}>{l.ledger}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtSales(l.amount)}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="my-1 border-t border-border" />
          <div className="flex items-center gap-1 text-xs">
            <button type="button" disabled={shownLedgers.every((l) => gls.isOn(l.block, l.ledger))}
                    className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                    onClick={() => gls.set(shownLedgers, true)}>
              {query.trim() ? "Tick shown" : "Tick all"}
            </button>
            <button type="button" disabled={shownLedgers.every((l) => !gls.isOn(l.block, l.ledger))}
                    className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                    onClick={() => gls.set(shownLedgers, false)}>
              {query.trim() ? "Clear shown" : "Clear all"}
            </button>
            <button type="button" onClick={() => gls.reset(block)}
                    title={BLOCK_DEFAULT_ON[block] ? "Every ledger ticked" : "Every ledger unticked"}
                    className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
              Default
            </button>
            <span className="ml-auto pr-1 tabular-nums text-muted-foreground">
              Counted <b className="font-semibold text-foreground">{fmtSales(counted)}</b>
            </span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
