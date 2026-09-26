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
import {
  loadGodownChoice, loadGodownSplit, saveGodownChoice, type GodownChoice,
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
      const out: Record<string, { godowns: string[]; held: Record<string, number> }> = {};
      for (const c of INK_COMPANIES) {
        const split = await loadGodownSplit(c.guid);
        const held: Record<string, number> = {};
        for (const m of split.byItem.values()) {
          for (const [g, qty] of m) held[g] = (held[g] ?? 0) + qty;
        }
        out[c.key] = { godowns: split.godowns, held };
      }
      return out;
    },
    staleTime: 10 * 60 * 1000,
  });

  const toggle = (companyKey: string, godown: string) =>
    setChoice((prev) => {
      const cur = prev[companyKey] ?? [];
      const next = cur.includes(godown) ? cur.filter((g) => g !== godown) : [...cur, godown];
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
                  {chosen.length ? `${chosen.length} godown${chosen.length === 1 ? "" : "s"} counted` : "whole book"}
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
                {info?.godowns.map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.includes(g)}
                      onChange={() => toggle(c.key, g)}
                    />
                    <span className="flex-1 truncate" title={g}>
                      {g}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {fmtQty(info.held[g])}
                    </span>
                  </label>
                ))}
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
