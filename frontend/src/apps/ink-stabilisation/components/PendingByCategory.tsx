import { Fragment, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { NOT_CATEGORISED } from "../lib/categories";
import { daysBetween, fmtDate } from "../lib/schedule";
import type { FlowTest } from "../lib/flow";
import { StatusPill } from "./FlowParts";
import { ColourDot, Legend, Segmented, StackBar, STATUS_BAR, statusCounts, statusParts, TEST_COLOR } from "./ui";
import { colourFromDescription } from "../../bushra-central-master/lib/itemColour";

/**
 * PENDING TESTING BY CATEGORY — one row per category (Ink type from Bushra Central
 * Master): how far through it the lab is, and what is still pending per lab test.
 *
 * Clicking a category — or one of its numbers — OPENS ITS ITEM LIST RIGHT THERE, under
 * the row (asked 30-09-2026), filtered to that lab test. From the open list, "Open in
 * Plant testing" takes the same selection to the work queue.
 *
 * "Pending" is not yet submitted, or sent back by Management. The caller decides which
 * tests are in scope, so Main data and Plant testing show the same numbers.
 */

export type CatTab = string; // an ink type, or "all"
export type TestTab = 1 | 2 | 3 | "all";

export const isPending = (t: FlowTest) => t.status === "pending" || t.status === "returned";

/** Categories present in these tests: biggest first, "Not categorised" always last. */
export function categoriesIn(tests: FlowTest[]): string[] {
  const n = new Map<string, number>();
  for (const t of tests) n.set(t.lot.category, (n.get(t.lot.category) ?? 0) + 1);
  return [...n.keys()].sort((a, b) =>
    Number(a === NOT_CATEGORISED) - Number(b === NOT_CATEGORISED) || n.get(b)! - n.get(a)! || a.localeCompare(b));
}

export function usePendingCounts(tests: FlowTest[]) {
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tests) {
      if (!isPending(t)) continue;
      for (const k of [`${t.lot.category}|${t.no}`, `${t.lot.category}|all`, `all|${t.no}`, "all|all"]) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return (c: CatTab, n: TestTab) => m.get(`${c}|${n}`) ?? 0;
  }, [tests]);
}

/** "KY REACTIVE PRO" → "KY Reactive Pro"; keeps the acronyms the plant uses. */
export function categoryLabel(s: string): string {
  if (s === NOT_CATEGORISED || s === "all") return s === "all" ? "All categories" : s;
  return s.toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .replace(/\b(Hd|Ky|Kn|Kna|Ep|Epn|Ri|Mct|Bib)\b/g, (w) => w.toUpperCase())
    .replace(/\bX- ?Series\b/i, "X-Series");
}

/** One item (colour) inside a category, with its tests. */
interface ItemGroup {
  item: string;
  colour: string | null;
  tests: FlowTest[];
  perTest: [number, number, number];
  earliest: string;
  late: boolean;
  qty: number;
  uom: string | null;
}

/**
 * The item list that opens under a category row — GROUPED BY ITEM (asked 30-09-2026):
 * every lot of "KY REACTIVE INK PRO MAGENTA" sits under one line, items A→Z, and a
 * line opens to its lots only when clicked.
 */
function CategoryItems({
  tests, test, onTest, onOpenPlant, today,
}: {
  tests: FlowTest[];
  test: TestTab;
  onTest: (n: TestTab) => void;
  onOpenPlant: () => void;
  today: string;
}) {
  const [onlyPending, setOnlyPending] = useState(true);
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  const visible = useMemo(() => tests.filter((t) => (test === "all" || t.no === test) && (!onlyPending || isPending(t))),
    [tests, test, onlyPending]);
  const count = (n: TestTab) => tests.filter((t) => (n === "all" || t.no === n) && (!onlyPending || isPending(t))).length;

  const groups: ItemGroup[] = useMemo(() => {
    const m = new Map<string, FlowTest[]>();
    for (const t of visible) m.set(t.lot.item, [...(m.get(t.lot.item) ?? []), t]);
    return [...m.entries()].map(([item, list]) => {
      list.sort((a, b) => a.due.localeCompare(b.due) || a.no - b.no || a.lot.lot.localeCompare(b.lot.lot));
      const perTest: [number, number, number] = [0, 0, 0];
      for (const t of list) perTest[t.no - 1]++;
      const lots = new Map(list.map((t) => [t.lot.lot, t.lot]));
      return {
        item, colour: colourFromDescription(item), tests: list, perTest,
        earliest: list[0].due, late: list.some((t) => isPending(t) && t.due < today),
        qty: [...lots.values()].reduce((s, l) => s + l.qty, 0), uom: list[0].lot.uom,
      };
    }).sort((a, b) => a.item.localeCompare(b.item));
  }, [visible, today]);

  const toggleItem = (item: string) => setOpenItems((s) => {
    const n = new Set(s);
    if (n.has(item)) n.delete(item); else n.add(item);
    return n;
  });
  const allOpen = groups.length > 0 && groups.every((g) => openItems.has(g.item));

  const th = "px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-grey";
  const td = "px-3 py-1.5 text-[12px]";

  return (
    <div className="border-l-[3px] border-orange bg-orange/[0.03] px-3 py-3 sm:px-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented<TestTab>
          size="sm"
          value={test}
          onChange={onTest}
          options={[
            { value: "all", label: "All tests", count: count("all") },
            { value: 1, label: "1st", dot: TEST_COLOR[0], count: count(1) },
            { value: 2, label: "2nd", dot: TEST_COLOR[1], count: count(2) },
            { value: 3, label: "3rd", dot: TEST_COLOR[2], count: count(3) },
          ]}
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-grey">
          <input type="checkbox" className="accent-orange" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Pending only
        </label>
        <button onClick={() => setOpenItems(allOpen ? new Set() : new Set(groups.map((g) => g.item)))}
          className="text-[12px] font-semibold text-grey hover:text-navy">
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
        <button onClick={onOpenPlant}
          className="ml-auto rounded-button bg-orange px-3 py-1.5 text-[12px] font-bold text-white shadow-cta transition hover:brightness-105">
          Open in Plant testing →
        </button>
      </div>

      <div className="max-h-[440px] overflow-y-auto rounded-lg border border-line bg-white">
        {groups.length === 0 && (
          <div className="px-4 py-8 text-center text-[12.5px] text-grey">{onlyPending ? "Nothing pending here. ✓" : "No tests here."}</div>
        )}
        {groups.map((g) => {
          const open = openItems.has(g.item);
          return (
            <div key={g.item} className="border-b border-line last:border-b-0">
              {/* the item (colour) line */}
              <button onClick={() => toggleItem(g.item)}
                className={cn("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-left transition",
                  open ? "bg-orange/[0.06]" : "hover:bg-page")}>
                <span className="flex min-w-0 flex-1 basis-64 items-center gap-2.5">
                  <ChevronRight className={cn("h-4 w-4 shrink-0 text-grey transition-transform", open && "rotate-90 text-orange")} />
                  <ColourDot colour={g.colour} />
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[13px] font-semibold", open ? "text-orange" : "text-ink")}>{g.item}</span>
                    <span className="block text-[11px] text-grey">
                      {g.tests.length} {g.tests.length === 1 ? "test" : "tests"} · {new Set(g.tests.map((t) => t.lot.lot)).size} lots · {g.qty.toLocaleString("en-IN")} {g.uom ?? ""}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-3 text-[12px] font-semibold tabular-nums">
                  {g.perTest.map((n, i) => (
                    <span key={i} className={cn("flex items-center gap-1", n === 0 && "opacity-30")}>
                      <i className={cn("h-2 w-2 rounded-full", TEST_COLOR[i])} />{n}
                    </span>
                  ))}
                </span>
                <span className="w-28 text-right text-[11.5px]">
                  <span className="text-grey">from </span>
                  <b className={g.late ? "text-ryg-red" : "text-ink"}>{fmtDate(g.earliest)}</b>
                </span>
              </button>

              {/* its lots — only when opened */}
              {open && (
                <div className="bg-page/40 px-3 pb-3 pt-1">
                  <table className="w-full">
                    <thead>
                      <tr><th className={th}>Due</th><th className={th}>Test</th><th className={th}>Lot no.</th>
                        <th className={`${th} text-right`}>Qty</th><th className={th}>Produced</th><th className={th}>Status</th></tr>
                    </thead>
                    <tbody>
                      {g.tests.map((t) => {
                        const late = isPending(t) && t.due < today;
                        return (
                          <tr key={t.key} className="border-t border-line/70">
                            <td className={td}>
                              <span className="font-semibold text-ink">{fmtDate(t.due)}</span>
                              {late && <span className="ml-1.5 text-[10.5px] text-ryg-red">{daysBetween(t.due, today)} d late</span>}
                            </td>
                            <td className={td}>
                              <span className="inline-flex items-center gap-1.5"><i className={cn("h-2 w-2 rounded-full", TEST_COLOR[t.no - 1])} />Test {t.no}</span>
                            </td>
                            <td className={`${td} break-all font-mono text-[11.5px]`}>{t.lot.lot}</td>
                            <td className={`${td} text-right tabular-nums`}>{t.lot.qty.toLocaleString("en-IN")}</td>
                            <td className={`${td} text-grey`}>{fmtDate(t.lot.prod)}</td>
                            <td className={td}><StatusPill status={t.status} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 text-[11px] text-grey">
        {groups.length} {groups.length === 1 ? "item" : "items"} · {visible.length} tests · click an item to see its lots
      </div>
    </div>
  );
}

export default function PendingByCategory({
  tests, onPick, today,
}: {
  tests: FlowTest[];
  /** Take a category + lab test to the Plant testing work queue. */
  onPick: (cat: CatTab, test: TestTab) => void;
  today: string;
}) {
  const pend = usePendingCounts(tests);
  const cats = useMemo(() => categoriesIn(tests), [tests]);
  const byCat = useMemo(() => {
    const m = new Map<string, FlowTest[]>();
    for (const t of tests) m.set(t.lot.category, [...(m.get(t.lot.category) ?? []), t]);
    return m;
  }, [tests]);

  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openTest, setOpenTest] = useState<TestTab>("all");

  /** A click on the same row (and same test) closes it; anything else opens / switches. */
  const toggle = (c: string, n: TestTab) => {
    if (openCat === c && openTest === n) setOpenCat(null);
    else { setOpenCat(c); setOpenTest(n); }
  };

  const cell = (c: CatTab, n: TestTab) => {
    const v = pend(c, n);
    const on = openCat === c && openTest === n;
    return (
      <button
        disabled={v === 0}
        onClick={(e) => { e.stopPropagation(); toggle(c, n); }}
        className={cn(
          "inline-flex min-w-[2.75rem] items-center justify-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold tabular-nums transition",
          v === 0 ? "text-grey-2/70" : on ? "bg-orange text-white" : "text-navy hover:bg-orange/10 hover:text-orange",
        )}
        title={v ? `Show ${v} pending` : undefined}
      >
        {n !== "all" && v > 0 && <i className={cn("inline-block h-1.5 w-1.5 rounded-full", on ? "bg-white" : TEST_COLOR[n - 1])} />}
        {v === 0 ? "—" : v}
      </button>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
            <th className="py-2 pl-4 pr-3">Category</th>
            <th className="w-[28%] px-3 py-2">Progress</th>
            <th className="px-2 py-2 text-center">1st test</th>
            <th className="px-2 py-2 text-center">2nd test</th>
            <th className="px-2 py-2 text-center">3rd test</th>
            <th className="py-2 pl-2 pr-4 text-right">Pending</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => {
            const list = byCat.get(c) ?? [];
            const sc = statusCounts(list);
            const done = sc.closed + sc.submitted;
            const bad = c === NOT_CATEGORISED;
            const open = openCat === c;
            return (
              <Fragment key={c}>
                <tr onClick={() => toggle(c, open ? openTest : "all")}
                  className={cn("cursor-pointer border-t border-line transition",
                    open ? "bg-orange/[0.06]" : bad ? "bg-yellow/10 hover:bg-yellow/20" : "hover:bg-page")}>
                  <td className="py-2 pl-3 pr-3">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={cn("h-4 w-4 shrink-0 text-grey transition-transform", open && "rotate-90 text-orange")} />
                      <div>
                        <div className={cn("text-[13px] font-semibold", bad ? "text-ryg-red" : open ? "text-orange" : "text-ink")}>{categoryLabel(c)}</div>
                        <div className="text-[11px] text-grey">{list.length} tests in scope</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StackBar parts={statusParts(sc)} />
                    <div className="mt-1 text-[11px] text-grey tabular-nums">
                      {done} of {list.length} submitted{list.length ? ` · ${Math.round((done / list.length) * 100)}%` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center">{cell(c, 1)}</td>
                  <td className="px-2 py-2 text-center">{cell(c, 2)}</td>
                  <td className="px-2 py-2 text-center">{cell(c, 3)}</td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[13px] font-bold tabular-nums",
                      pend(c, "all") ? "bg-orange/10 text-orange" : "text-grey-2")}>
                      {pend(c, "all") || "—"}
                    </span>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <CategoryItems
                        tests={list}
                        test={openTest}
                        onTest={setOpenTest}
                        onOpenPlant={() => onPick(c, openTest)}
                        today={today}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          <tr className="border-t-2 border-line bg-page/60">
            <td className="py-2 pl-4 pr-3 text-[13px] font-bold text-navy">All categories</td>
            <td className="px-3 py-2"><StackBar parts={statusParts(statusCounts(tests))} /></td>
            {([1, 2, 3] as const).map((n) => (
              <td key={n} className="px-2 py-2 text-center text-[13px] font-bold tabular-nums text-navy">{pend("all", n) || "—"}</td>
            ))}
            <td className="py-2 pl-2 pr-4 text-right">
              <span className="rounded-full bg-orange px-2.5 py-0.5 text-[13px] font-bold text-white tabular-nums">{pend("all", "all")}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <span className="text-[11.5px] text-grey">Click a category or a number to see its items here.</span>
        <Legend items={[
          { label: "Closed", color: STATUS_BAR.closed },
          { label: "Awaiting review", color: STATUS_BAR.submitted },
          { label: "Sent back", color: STATUS_BAR.returned },
          { label: "Pending", color: STATUS_BAR.pending },
        ]} />
      </div>
    </div>
  );
}
