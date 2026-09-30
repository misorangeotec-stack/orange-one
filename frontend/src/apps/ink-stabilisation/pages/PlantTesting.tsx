import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CornerDownLeft, Search } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { matchesSearch } from "@/shared/lib/search";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { cn } from "@/shared/lib/cn";
import { addMonths, fmtDate, fmtMonth } from "../lib/schedule";
import { NOT_CATEGORISED } from "../lib/categories";
import {
  canAct, FLOW_START, inPlantScope, joinTests, RESULT_LABEL, STATUS_LABEL, useFlow, useInkLots,
  type FlowStatus, type FlowTest,
} from "../lib/flow";
import { FlowUnavailable } from "../components/FlowParts";
import PlantTestModal from "../components/PlantTestModal";
import TestTable from "../components/TestTable";
import { categoriesIn, categoryLabel, isPending, type CatTab, type TestTab } from "../components/PendingByCategory";
import { Segmented, StackBar, statusCounts, statusParts, TEST_COLOR } from "../components/ui";

/**
 * STEP 2 · PLANT TESTING — the lab's work queue.
 *
 *   left   every category (Ink type from Bushra Central Master) with its progress and
 *          what is still pending — pick one
 *   right  that category's tests: choose the lab test (1st / 2nd / 3rd) and a status,
 *          then open a row to record Approve / Reject, lab person and remarks
 *
 * The list is the tests DUE in the chosen month, plus — by default — anything from an
 * earlier month (since the flow went live) not yet submitted or sent back by Management,
 * so nothing falls off the list when the month turns. Main data's pending table links
 * here with ?cat=&test= already chosen.
 */

type Tab = "todo" | FlowStatus | "all";

function match(t: FlowTest, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "todo") return isPending(t);
  return t.status === tab;
}

export default function PlantTesting() {
  const today = todayLocalIso();
  const { user, isAdmin, canEditModule } = useSession();
  const lotsQ = useInkLots();
  const flowQ = useFlow();
  const flow = flowQ.data;
  const mayAct = canAct("plant", user.id, isAdmin, canEditModule("ink-stabilisation"), flow);

  const [params] = useSearchParams();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [carry, setCarry] = useState(true);
  const [tab, setTab] = useState<Tab>("todo");
  const [cat, setCat] = useState<CatTab>(params.get("cat") ?? "all");
  const [testNo, setTestNo] = useState<TestTab>(
    (["1", "2", "3"].includes(params.get("test") ?? "") ? Number(params.get("test")) : "all") as TestTab);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<FlowTest | null>(null);

  const all = useMemo(() => joinTests(lotsQ.data ?? [], flow), [lotsQ.data, flow]);

  // Month scope → category → lab test → status, each narrowing the one before.
  const scope = useMemo(() => all.filter((t) => inPlantScope(t, month, carry))
    .sort((a, b) => a.due.localeCompare(b.due) || a.lot.item.localeCompare(b.lot.item)), [all, month, carry]);
  const cats = useMemo(() => categoriesIn(scope), [scope]);
  const inCat = useMemo(() => scope.filter((t) => cat === "all" || t.lot.category === cat), [scope, cat]);
  const inTest = useMemo(() => inCat.filter((t) => testNo === "all" || t.no === testNo), [inCat, testNo]);
  const searched = useMemo(() => inTest.filter((t) => matchesSearch(search, `${t.lot.item} ${t.lot.lot} ${t.lot.family}`)), [inTest, search]);
  const rows = useMemo(() => searched.filter((t) => match(t, tab)), [searched, tab]);

  const catStats = (c: CatTab) => {
    const list = c === "all" ? scope : scope.filter((t) => t.lot.category === c);
    return { list, sc: statusCounts(list), pending: list.filter(isPending).length };
  };
  const cur = catStats(cat);
  const returned = scope.filter((t) => t.status === "returned");

  const months = useMemo(() => {
    const out: string[] = [];
    for (let m = FLOW_START; m <= addMonths(`${today.slice(0, 7)}-01`, 2).slice(0, 7); m = addMonths(`${m}-01`, 1).slice(0, 7)) out.push(m);
    return out;
  }, [today]);

  // Keep the modal pointing at fresh data after a save.
  const current = open ? all.find((t) => t.key === open.key) ?? open : null;

  const exportList = () => exportRowsToXlsx({
    fileName: `Ink_Retest_Plant_${month}`,
    sheetName: fmtMonth(month),
    title: `Ink Stabilisation — Plant testing list, ${fmtMonth(month)}`,
    rows,
    filters: [cat !== "all" ? `Category: ${categoryLabel(cat)}` : "", testNo !== "all" ? `Lab test: ${testNo}` : "", `Status: ${tab}`].filter(Boolean),
    columns: [
      { header: "Due date", width: 13, value: (t) => fmtDate(t.due) },
      { header: "Test", width: 8, value: (t) => `Test ${t.no}` },
      { header: "Category", width: 22, value: (t) => categoryLabel(t.lot.category) },
      { header: "Stock item", width: 38, value: (t) => t.lot.item },
      { header: "Lot no.", width: 18, value: (t) => t.lot.lot },
      { header: "Production date", width: 14, value: (t) => fmtDate(t.lot.prod) },
      { header: "Status", width: 16, value: (t) => STATUS_LABEL[t.status] },
      { header: "Lab result", width: 11, value: (t) => (t.record?.result ? RESULT_LABEL[t.record.result] : "") },
      { header: "Lab person", width: 18, value: (t) => t.record?.labPerson ?? "" },
      { header: "Plant remarks", width: 40, value: (t) => t.record?.plantRemarks ?? "" },
    ],
  });

  const pendingFor = (n: TestTab) => inCat.filter((t) => (n === "all" || t.no === n) && isPending(t)).length;
  const statusCount = (s: Tab) => searched.filter((t) => match(t, s)).length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6">
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-orange">Step 2 · Plant testing</div>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight text-navy">Plant testing</h1>
          <p className="mt-1 text-[13px] text-grey">
            Pick a category, open a test, choose Approve or Reject and submit it to Management.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={month} onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold text-navy">
            {months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-grey">
            <input type="checkbox" className="accent-orange" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
            Include earlier months still open
          </label>
          <Button variant="outline" size="sm" onClick={exportList}>Export Excel</Button>
        </div>
      </header>

      {flowQ.isError && <FlowUnavailable error={flowQ.error} />}
      {lotsQ.isError && <Card className="p-4 text-[13px] text-ryg-red">Could not read lots: {(lotsQ.error as Error).message}</Card>}

      {returned.length > 0 && (
        <button onClick={() => { setCat("all"); setTestNo("all"); setTab("returned"); }}
          className="flex w-full items-center gap-3 rounded-card border border-ryg-red/30 bg-ryg-red/5 px-4 py-3 text-left transition hover:bg-ryg-red/10">
          <CornerDownLeft className="h-5 w-5 text-ryg-red" />
          <span className="text-[13px] text-ink">
            <b className="text-ryg-red">{returned.length} test{returned.length === 1 ? "" : "s"} sent back</b> by Management — read the reason, fix and resubmit.
          </span>
          <span className="ml-auto text-[12.5px] font-semibold text-ryg-red">Show them →</span>
        </button>
      )}

      {lotsQ.isLoading ? (
        <Card className="p-14 text-center text-[13px] text-grey">Reading production lots from ConnectWave…</Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
          {/* -------------------------------------------------- category rail */}
          <Card className="overflow-hidden lg:sticky lg:top-4">
            <div className="border-b border-line px-4 py-3">
              <div className="text-[13px] font-bold text-navy">Categories</div>
              <div className="text-[11.5px] text-grey">Pending to test in {fmtMonth(month)}{carry ? " + open" : ""}</div>
            </div>
            <nav className="max-h-[70vh] overflow-y-auto p-2">
              {(["all", ...cats] as CatTab[]).map((c) => {
                const s = catStats(c);
                const on = cat === c;
                const bad = c === NOT_CATEGORISED;
                return (
                  <button key={c} onClick={() => { setCat(c); setTestNo("all"); setTab("todo"); }}
                    className={cn(
                      "mb-1 w-full rounded-lg border-l-[3px] px-3 py-2.5 text-left transition",
                      on ? "border-orange bg-orange/[0.07]" : "border-transparent hover:bg-page",
                      c === "all" && "mb-2",
                    )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-[13px]", on ? "font-bold text-navy" : "font-semibold text-ink", bad && "text-ryg-red")}>
                        {categoryLabel(c)}
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums",
                        s.pending ? (on ? "bg-orange text-white" : "bg-orange/10 text-orange") : "bg-ryg-green/10 text-ryg-green")}>
                        {s.pending || "✓"}
                      </span>
                    </div>
                    <StackBar parts={statusParts(s.sc)} height="h-1.5" className="mt-2" />
                    <div className="mt-1 text-[11px] text-grey tabular-nums">
                      {s.sc.closed + s.sc.submitted} of {s.list.length} submitted
                    </div>
                  </button>
                );
              })}
              {cats.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-grey">No tests due in {fmtMonth(month)}.</div>}
            </nav>
          </Card>

          {/* ------------------------------------------------------ work area */}
          <Card>
            <div className="p-5 pb-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className={cn("text-[20px] font-bold", cat === NOT_CATEGORISED ? "text-ryg-red" : "text-navy")}>{categoryLabel(cat)}</h2>
                  <p className="text-[12.5px] text-grey">
                    <b className="text-orange">{cur.pending}</b> pending of {cur.list.length} tests · {fmtMonth(month)}{carry ? " + earlier months still open" : ""}
                  </p>
                </div>
                <div className="w-full max-w-xs">
                  <StackBar parts={statusParts(cur.sc)} height="h-2.5" />
                  <div className="mt-1 text-right text-[11px] text-grey tabular-nums">
                    {cur.sc.closed} closed · {cur.sc.submitted} in review · {cur.sc.returned} sent back · {cur.sc.pending} pending
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3 border-y border-line bg-page/50 px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-16 text-[11.5px] font-semibold uppercase tracking-wide text-grey">Lab test</span>
                <Segmented<TestTab>
                  value={testNo}
                  onChange={setTestNo}
                  options={[
                    { value: "all", label: "All tests", count: pendingFor("all") },
                    { value: 1, label: "1st test", dot: TEST_COLOR[0], count: pendingFor(1) },
                    { value: 2, label: "2nd test", dot: TEST_COLOR[1], count: pendingFor(2) },
                    { value: 3, label: "3rd test", dot: TEST_COLOR[2], count: pendingFor(3) },
                  ]}
                />
                <span className="text-[11px] text-grey">counts = pending</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-16 text-[11.5px] font-semibold uppercase tracking-wide text-grey">Status</span>
                <Segmented<Tab>
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "todo", label: "To do", count: statusCount("todo") },
                    { value: "returned", label: "Sent back", count: statusCount("returned") },
                    { value: "submitted", label: "Awaiting review", count: statusCount("submitted") },
                    { value: "closed", label: "Closed", count: statusCount("closed") },
                    { value: "all", label: "All", count: statusCount("all") },
                  ]}
                />
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-grey-2" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item or lot no."
                    className="h-9 w-60 rounded-lg border border-line bg-white pl-8 pr-3 text-[13px] outline-none focus:border-orange" />
                </div>
              </div>
            </div>

            <TestTable rows={rows} flow={flow} today={today} onOpen={setOpen}
              resetKey={`${month}|${tab}|${search}|${carry}|${cat}|${testNo}`}
              actionLabel={(t) => (mayAct && isPending(t) ? "Open & submit" : "View")} />
          </Card>
        </div>
      )}

      {current && (
        <PlantTestModal test={current} flow={flow} canAct={mayAct} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
