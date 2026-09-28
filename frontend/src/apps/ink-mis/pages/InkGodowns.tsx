/**
 * INK IMS — which godowns count.
 *
 * Otec's books are read whole. Enterprises Surat is not: its ink sits in Finished Goods Sachin
 * and Hojiwala, and its other godowns — Production, Lab, Warehouse, job work — hold material the
 * planner cannot sell, so counting them overstates that book on every line.
 *
 * Tick nothing for a book and it is read whole, which is what every book did before this screen
 * existed. Tick something and only that part of its stock reaches the sheet.
 *
 * TWO LEVELS. A godown can be taken whole, or opened to take only some of the stock groups
 * inside it — Main Location holds printing ink beside machinery parts and packing material, and
 * only the first is ink the planner plans. An item belongs to exactly one group, so a group tick
 * simply decides which items that godown contributes.
 *
 * HOW THE FIGURE IS WORKED OUT, and why the screen says so: ConnectWave has no godown-wise
 * closing balance. The share each godown holds is taken from the lot balances, and that share is
 * applied to Tally's own item closing, which is authoritative. So the item always ties Tally; the
 * split between godowns is inferred. The reasoning and the measurements are in lib/godowns.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Warehouse } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { INK_COMPANIES, fmtQty } from "../lib/inkMis";
import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";
import {
  godownGroupKey, loadGodownChoice, loadGodownSplit, saveGodownChoice, type GodownChoice,
} from "../lib/godowns";

export default function InkGodowns() {
  const [choice, setChoice] = useState<GodownChoice>(() => loadGodownChoice());
  useEffect(() => saveGodownChoice(choice), [choice]);

  /**
   * Every book's godowns, read once. The lot table is small — about 4,600 rows for the largest
   * book — and the planner needs to see all four to decide, not one at a time.
   */
  const { data, isLoading, error } = useQuery({
    queryKey: ["inkMis", "godowns"],
    queryFn: async () => {
      const cw = getConnectwaveSupabase();
      const out: Record<
        string,
        { godowns: string[]; held: Record<string, number>; groups: Record<string, [string, number][]> }
      > = {};
      for (const c of INK_COMPANIES) {
        // Which group each item belongs to, so a godown can be broken down. Two columns for the
        // whole book, which is small beside the lot table it is joined to.
        const groupOf = new Map<string, string>();
        const PAGE = 1000;
        for (let offset = 0; ; offset += PAGE) {
          const { data: rows, error: e } = await cw
            .from("rpt_stock_summary_item")
            .select("item,primary_group")
            .eq("company_guid", c.guid)
            .eq("tenant_id", `acct_orange::${c.guid}`)
            .range(offset, offset + PAGE - 1)
            .returns<{ item: string; primary_group: string | null }[]>();
          if (e) throw new Error(e.message);
          const page = rows ?? [];
          for (const r of page) groupOf.set(r.item, (r.primary_group ?? "").trim().toUpperCase());
          if (page.length < PAGE) break;
        }

        const split = await loadGodownSplit(c.guid, groupOf);
        const held: Record<string, number> = {};
        for (const m of split.byItem.values()) {
          for (const [g, qty] of m) held[g] = (held[g] ?? 0) + qty;
        }
        const groups: Record<string, [string, number][]> = {};
        for (const [godown, m] of split.groupsByGodown) {
          groups[godown] = [...m.entries()].sort((a, b) => b[1] - a[1]);
        }
        out[c.key] = { godowns: split.godowns, held, groups };
      }
      return out;
    },
    staleTime: 10 * 60 * 1000,
  });

  const [open, setOpen] = useState<string | null>(null);

  /**
   * Ticking one entry — a whole godown, or one group inside it.
   *
   * Taking a godown whole clears any group ticks it already had: "all of it" and "these parts of
   * it" are two answers to one question, and leaving both would leave the sheet reading one while
   * the screen shows the other.
   */
  const toggle = (companyKey: string, entry: string, godownOfEntry?: string) =>
    setChoice((prev) => {
      const cur = prev[companyKey] ?? [];
      let next: string[];
      if (cur.includes(entry)) {
        next = cur.filter((g) => g !== entry);
      } else if (godownOfEntry) {
        next = [...cur.filter((g) => g !== godownOfEntry), entry];
      } else {
        next = [...cur.filter((g) => !g.startsWith(`${entry}||`)), entry];
      }
      const out = { ...prev, [companyKey]: next };
      if (!next.length) delete out[companyKey];
      return out;
    });

  const filtered = useMemo(
    () => INK_COMPANIES.filter((c) => (choice[c.key] ?? []).length).length,
    [choice],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Godowns</h1>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Tally does not keep a closing balance per godown, so the share each godown holds is
          taken from the lot balances and applied to Tally's item total. Each item still ties
          Tally exactly; the split between godowns is an estimate. Tick nothing for a book to
          read it whole.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Could not read the godowns: {error instanceof Error ? error.message : "unknown error"}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Reading godowns…</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {INK_COMPANIES.map((c) => {
          const info = data?.[c.key];
          const chosen = choice[c.key] ?? [];
          return (
            <div key={c.key} className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">
                  {chosen.length
                    ? `${chosen.filter((x) => !x.includes("||")).length} godown${
                        chosen.filter((x) => !x.includes("||")).length === 1 ? "" : "s"
                      }, ${chosen.filter((x) => x.includes("||")).length} group${
                        chosen.filter((x) => x.includes("||")).length === 1 ? "" : "s"
                      } counted`
                    : "whole book"}
                </span>
                {chosen.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() =>
                      setChoice((prev) => {
                        const out = { ...prev };
                        delete out[c.key];
                        return out;
                      })
                    }
                  >
                    Use whole book
                  </Button>
                )}
              </div>

              <div className="mt-2 space-y-1">
                {!info?.godowns.length && !isLoading && (
                  <p className="text-xs text-muted-foreground">No godowns found for this book.</p>
                )}
                {info?.godowns.map((g) => {
                  const key = `${c.key}|${g}`;
                  const isOpen = open === key;
                  const groups = info.groups[g] ?? [];
                  const picked = chosen.filter((x) => x.startsWith(`${g}||`)).length;
                  return (
                    <div key={g}>
                      <div className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={chosen.includes(g)}
                          onChange={() => toggle(c.key, g)}
                        />
                        <button
                          type="button"
                          className="flex-1 truncate text-left hover:underline"
                          title="Show the stock groups in this godown"
                          onClick={() => setOpen(isOpen ? null : key)}
                        >
                          {isOpen ? "▾" : "▸"} {g}
                          {picked > 0 && !chosen.includes(g) && (
                            <span className="ml-1 text-xs text-primary">
                              {picked} group{picked === 1 ? "" : "s"}
                            </span>
                          )}
                        </button>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {fmtQty(info.held[g])}
                        </span>
                      </div>

                      {isOpen && (
                        <div className="ml-6 mt-1 space-y-1 border-l pl-3">
                          {!groups.length && (
                            <p className="text-xs text-muted-foreground">Nothing held here.</p>
                          )}
                          {groups.map(([group, qty]) => (
                            <label key={group} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={chosen.includes(godownGroupKey(g, group))}
                                disabled={chosen.includes(g)}
                                onChange={() => toggle(c.key, godownGroupKey(g, group), g)}
                              />
                              <span className="flex-1 truncate" title={group}>
                                {group}
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {fmtQty(qty)}
                              </span>
                            </label>
                          ))}
                          {chosen.includes(g) && (
                            <p className="text-[11px] text-muted-foreground">
                              The whole godown is counted, so every group in it is included.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered === 0
          ? "No book is filtered: every company is counted whole, as before."
          : `${filtered} book${filtered === 1 ? " is" : "s are"} filtered. Reload the dashboard to see the change.`}
      </p>
    </div>
  );
}
