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
 * NOTHING TAKES EFFECT UNTIL SAVE. Ticking used to write straight through, so a stray click
 * quietly changed every figure on two other screens. The ticks are a draft; Save is what the rest
 * of the app reads, and Discard puts the draft back.
 *
 * HOW THE FIGURE IS WORKED OUT, and why the screen says so: ConnectWave has no godown-wise
 * closing balance. The share each godown holds is taken from the lot balances, and that share is
 * applied to Tally's own item closing, which is authoritative. So the item always ties Tally; the
 * split between godowns is inferred. The reasoning and the measurements are in lib/godowns.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Save, Undo2, Warehouse } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { INK_COMPANIES, fmtQty } from "../lib/inkMis";
import { getConnectwaveSupabase } from "@hub/lib/connectwaveSupabase";
import {
  fmtTallyDate, godownChoiceSig, godownGroupKey, loadGodownChoice, loadGodownFreshness,
  loadGodownSplit, saveGodownChoice,
  type GodownCell, type GodownChoice, type GodownFreshness, type ItemFacts,
} from "../lib/godowns";

export default function InkGodowns() {
  /**
   * `choice` is the DRAFT — what is ticked on screen. `savedChoice` is what the dashboard and the
   * item master are actually reading. They part company the moment a box is ticked, and meet
   * again on Save.
   */
  const [choice, setChoice] = useState<GodownChoice>(() => loadGodownChoice());
  const [savedChoice, setSavedChoice] = useState<GodownChoice>(() => loadGodownChoice());
  const dirty = godownChoiceSig(choice) !== godownChoiceSig(savedChoice);

  const qc = useQueryClient();
  const save = () => {
    saveGodownChoice(choice);
    setSavedChoice(choice);
    // Every loaded position carries the godown filter, so the stock on both other screens is
    // recomputed instead of standing at whatever the last choice produced.
    void qc.invalidateQueries({ queryKey: ["inkMis", "positions"] });
  };

  // The same guard the item master uses: a draft is easy to walk away from by accident.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
        {
          godowns: string[];
          held: Record<string, GodownCell>;
          groups: Record<string, [string, GodownCell][]>;
          fresh: GodownFreshness;
        }
      > = {};
      for (const c of INK_COMPANIES) {
        // Each item's group, Tally closing and base unit. The closing is what turns a lot share
        // into stock, and the unit stops a PCS lot being counted into a KGS item.
        const facts = new Map<string, ItemFacts>();
        const PAGE = 1000;
        for (let offset = 0; ; offset += PAGE) {
          const { data: rows, error: e } = await cw
            .from("rpt_stock_summary_item")
            .select("item,primary_group,closing_qty,opening_qty,base_unit")
            .eq("company_guid", c.guid)
            .eq("tenant_id", `acct_orange::${c.guid}`)
            // Ordered, or paging repeats and drops rows — see the note in lib/godowns.ts.
            .order("item", { ascending: true })
            .range(offset, offset + PAGE - 1)
            .returns<{
              item: string; primary_group: string | null; closing_qty: number | null;
              opening_qty: number | null; base_unit: string | null;
            }[]>();
          if (e) throw new Error(e.message);
          const page = rows ?? [];
          for (const r of page) {
            facts.set(r.item, {
              group: (r.primary_group ?? "").trim().toUpperCase(),
              closing: Number(r.closing_qty) || 0,
              opening: Number(r.opening_qty) || 0,
              unit: (r.base_unit ?? "").trim().toUpperCase(),
            });
          }
          if (page.length < PAGE) break;
        }

        const [split, fresh] = await Promise.all([
          loadGodownSplit(c.guid, facts),
          loadGodownFreshness(c.guid),
        ]);
        const held: Record<string, GodownCell> = {};
        for (const [g, cell] of split.totals) held[g] = cell;
        const groups: Record<string, [string, GodownCell][]> = {};
        for (const [godown, m] of split.groupsByGodown) {
          // A group whose estimated stock rounds away is stale lot history, not stock on a
          // shelf — Tally does not list it under the godown and neither should this.
          groups[godown] = [...m.entries()]
            .filter(([, cell]) => Math.round(cell.qty) !== 0)
            .sort((a, b) => b[1].qty - a[1].qty);
        }
        out[c.key] = { godowns: split.godowns, held, groups, fresh };
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
    () => INK_COMPANIES.filter((c) => (savedChoice[c.key] ?? []).length).length,
    [savedChoice],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Godowns</h1>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
              Not saved yet
            </span>
          )}
          {dirty && (
            <Button size="sm" variant="outline" onClick={() => setChoice(savedChoice)}>
              <Undo2 className="mr-2 h-4 w-4" /> Discard
            </Button>
          )}
          <Button size="sm" disabled={!dirty} onClick={save}>
            <Save className="mr-2 h-4 w-4" /> Save
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Built by walking this year's vouchers godown by godown, the way Tally does. For 103 of
          Enterprises Surat's 126 finished goods that walk lands on Tally's closing exactly.
          What it cannot read is where the OPENING stock sat on 1-Apr, because ConnectWave
          carries the opening per item but not per godown, so that part is reasoned from where
          stock was issued and where the lots rest. Against Tally's Godown Summary for Finished
          Goods-Sachin (30,935) this reads about 6% high. Every item's total ties Tally exactly;
          only the split between godowns carries the estimate. A book with nothing ticked is read
          whole and is unaffected.
        </p>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          Read from the ConnectWave copy of Tally, not from Tally itself. Last copied{" "}
          <strong>
            {(() => {
              const t = Object.values(data)
                .map((d) => d.fresh.builtAt)
                .filter(Boolean)
                .sort()
                .pop();
              return t ? new Date(t).toLocaleString() : "unknown";
            })()}
          </strong>
          ; vouchers up to{" "}
          <strong>
            {fmtTallyDate(
              Object.values(data)
                .map((d) => d.fresh.lastVoucher)
                .filter(Boolean)
                .sort()
                .pop(),
            )}
          </strong>
          . Reopening this tab re-reads it.
        </p>
      )}

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
                {info?.fresh && (
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={
                      info.fresh.builtAt
                        ? `ConnectWave rebuilt this book at ${new Date(info.fresh.builtAt).toLocaleString()}`
                        : "build time unknown"
                    }
                  >
                    to {fmtTallyDate(info.fresh.lastVoucher)}
                  </span>
                )}
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
                        <span className="whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                          {fmtQty(info.held[g]?.qty ?? 0)}
                          <span className="ml-2 opacity-70">
                            {info.held[g]?.items ?? 0} items
                          </span>
                        </span>
                      </div>

                      {isOpen && (
                        <div className="ml-6 mt-1 space-y-1 border-l pl-3">
                          {!groups.length && (
                            <p className="text-xs text-muted-foreground">Nothing held here.</p>
                          )}
                          {groups.map(([group, cell]) => (
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
                              <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                                {fmtQty(cell.qty)}
                                <span className="ml-2 opacity-70">{cell.items} items</span>
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
        {dirty && <strong className="text-amber-700">Save to apply. </strong>}
        {filtered === 0
          ? "Saved: no book is filtered, every company is counted whole."
          : `Saved: ${filtered} book${filtered === 1 ? " is" : "s are"} filtered. The dashboard and item master count only the ticked stock.`}
      </p>
    </div>
  );
}
