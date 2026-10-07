import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, FlaskConical, PackageSearch, RefreshCw, TriangleAlert } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { cn } from "@/shared/lib/cn";
import { appBasePath, appName } from "../../appInfo";
import {
  addMonths, daysBetween, fmtDate, fmtMonth, nextTest, TEST_MONTHS, type InkLot,
} from "../lib/schedule";
import { inPlantScope, joinTests, useFlow, useInkLots } from "../lib/flow";
import { SURAT_GUID } from "../lib/constants";
import { STOCK_COMPANIES, useClosingStock } from "../lib/closingStock";
import PendingByCategory, { categoriesIn, categoryLabel } from "../components/PendingByCategory";
import UncategorisedTable, { useUncategorised } from "../components/UncategorisedItems";
import LabTestView, { LAB_NAME } from "../components/LabTestView";
import { ColourDot, Legend, SectionTitle, Segmented, StackBar, STATUS_BAR, statusCounts, statusParts, TEST_COLOR } from "../components/ui";
import { colourFromDescription } from "../../bushra-central-master/lib/itemColour";

/**
 * STEP 1 · MAIN DATA — the overview of every ink lot Enterprises Surat made and its
 * three retests (3, 6 and 9 months after production).
 *
 * Laid out top-down in the order a planner reads it:
 *   A · THIS MONTH      how far through this month's tests the lab is, per lab test
 *   B · WHERE THE WORK IS  pending by category, the 12-month load, and data gaps
 *   C · LOT REGISTER    the full list — by lot, by lab test, or as a calendar
 *
 * A and B always describe ALL lots; the search and category filters belong to C only,
 * so the numbers at the top never shift under the reader while they filter the list.
 *
 * mode="stock" is the CLOSING STOCK page (07-10-2026): the same page, but its lots are the ink
 * Enterprises Surat AND Otec Surat hold in Tally today (lib/closingStock.ts), tests counted from
 * each lot's production or purchase date, plus a Company filter. Otec Surat lots are not in the
 * retest flow, so their tests always read Pending.
 */

const APP = appName("ink-stabilisation");
const B = appBasePath("ink-stabilisation");

type View = "lots" | "lab1" | "lab2" | "lab3" | "calendar";
type Stage = "all" | "soon" | "t1" | "t2" | "t3" | "complete";

interface LotRow extends InkLot {
  next: { no: 1 | 2 | 3; date: string } | null;
  days: number | null;
}

interface TestRow {
  date: string;
  month: string;
  no: 1 | 2 | 3;
  lot: LotRow;
}

const TEST_LABEL = (n: number) => `Test ${n} · +${TEST_MONTHS[n - 1]} m`;

/**
 * Rows are NOT tinted by urgency any more: on a day when a whole batch falls due, dozens of
 * pink rows read as an alarm and hide what matters. The "Next test in" badge carries it.
 */
function tone(days: number | null): string {
  return days === null ? "text-grey-2" : "";
}

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-[12px] text-grey-2">all passed</span>;
  const cls = days <= 7 ? "bg-ryg-red/10 text-ryg-red" : days <= 30 ? "bg-orange/10 text-orange" : days <= 60 ? "bg-yellow/20 text-ink" : "bg-page text-grey";
  return <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums", cls)}>{days === 0 ? "today" : `${days} d`}</span>;
}

function TestCell({ date, isNext, today }: { date: string; isNext: boolean; today: string }) {
  const passed = date < today;
  return (
    <span className={isNext ? "font-semibold text-orange" : passed ? "text-grey-2" : "text-ink"}>
      {fmtDate(date)}
    </span>
  );
}

export default function RetestSchedule({ mode = "production" }: { mode?: "production" | "stock" }) {
  const stock = mode === "stock";
  const today = todayLocalIso();
  const thisMonth = today.slice(0, 7);
  const prodQ = useInkLots(!stock);
  const cs = useClosingStock(stock);
  const q = stock ? cs.q : prodQ;
  const rawLots = stock ? cs.q.data?.lots : prodQ.data;
  const [done, totalReq] = cs.progress;
  const flow = useFlow().data;
  const navigate = useNavigate();
  const registerRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<View>("lots");
  const [stage, setStage] = useState<Stage>("all");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState<string>(thisMonth);
  /*
    PAGE-WIDE FILTERS (asked 30-09-2026) — they drive EVERY section, Power-BI style:
    the month cards, pending by category, the 12-month chart, data health and the
    register. Clicking a month bar sets fMonth; clicking it again, or any empty space
    on the page, clears it.
  */
  const [fMonth, setFMonth] = useState<string | null>(null);
  const [fCats, setFCats] = useState<string[]>([]);
  const [fGroups, setFGroups] = useState<string[]>([]);
  const [fColours, setFColours] = useState<string[]>([]);
  /** Company guids — Closing stock page only. */
  const [fCos, setFCos] = useState<string[]>([]);
  const anyFilter = !!fMonth || fCats.length > 0 || fGroups.length > 0 || fColours.length > 0 || fCos.length > 0;
  const clearAll = () => { setFMonth(null); setFCats([]); setFGroups([]); setFColours([]); setFCos([]); };
  const [showUncat, setShowUncat] = useState(false);

  const openRegister = (v: View, m?: string) => {
    setView(v);
    if (m) setMonth(m);
    requestAnimationFrame(() => registerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const openPlant = (cat: string, test: 1 | 2 | 3 | "all") =>
    navigate(`${B}/plant?cat=${encodeURIComponent(cat)}&test=${test}`);

  const lots: LotRow[] = useMemo(() => (rawLots ?? []).map((L) => {
    const next = nextTest(L, today);
    return { ...L, next, days: next ? daysBetween(today, next.date) : null };
  }).sort((a, b) =>
    (a.next?.date ?? "9999").localeCompare(b.next?.date ?? "9999") || a.prod.localeCompare(b.prod) ||
    a.item.localeCompare(b.item) || a.lot.localeCompare(b.lot)), [rawLots, today]);

  /* ---------------- the page-wide filters ---------------- */
  const colourOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lots) if (!m.has(l.item)) m.set(l.item, colourFromDescription(l.item) ?? "(No colour in name)");
    return m;
  }, [lots]);
  const groupOf = (l: InkLot) => l.categoryGroup ?? "(Not set)";

  const lotsF = useMemo(() => lots.filter((l) =>
    (!fCos.length || fCos.includes(l.companyGuid ?? SURAT_GUID)) &&
    (!fCats.length || fCats.includes(l.category)) &&
    (!fGroups.length || fGroups.includes(groupOf(l))) &&
    (!fColours.length || fColours.includes(colourOf.get(l.item)!))), [lots, fCos, fCats, fGroups, fColours, colourOf]);

  const filterOpts = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
    return {
      cats: categoriesIn(joinTests(lots, undefined)).map((c) => ({ value: c, label: categoryLabel(c) })),
      groups: uniq(lots.map(groupOf)).map((g) => ({ value: g, label: categoryLabel(g) })),
      colours: uniq([...colourOf.values()]).map((c) => ({ value: c, label: c, icon: <ColourDot colour={c} className="h-3 w-3" /> })),
      companies: STOCK_COMPANIES.map((c) => ({ value: c.guid, label: `${c.name} (${lots.filter((l) => l.companyGuid === c.guid).length})` })),
    };
  }, [lots, colourOf]);

  /* ---------------- A + B: follow the page-wide filters ---------------- */
  const focusMonth = fMonth ?? thisMonth;
  const allTests = useMemo(() => joinTests(lotsF, flow), [lotsF, flow]);
  const monthTests = useMemo(() => allTests.filter((t) => t.month === focusMonth), [allTests, focusMonth]);
  const planTests = useMemo(() => (fMonth
    ? allTests.filter((t) => t.month === fMonth)
    : allTests.filter((t) => inPlantScope(t, thisMonth, true))), [allTests, fMonth, thisMonth]);
  const carried = fMonth ? 0 : planTests.length - monthTests.length;
  const monthSc = statusCounts(monthTests);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(`${thisMonth}-01`, i).slice(0, 7)), [thisMonth]);
  /** Every month any test falls in — the Month filter's list. */
  const allMonths = useMemo(() => [...new Set(joinTests(lots, undefined).map((t) => t.month))].sort(), [lots]);
  const perMonth = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const t of allTests) {
      const c = m.get(t.month) ?? [0, 0, 0];
      c[t.no - 1] += 1;
      m.set(t.month, c);
    }
    return m;
  }, [allTests]);
  const maxMonth = Math.max(1, ...months.map((m) => (perMonth.get(m) ?? [0, 0, 0]).reduce((a, b) => a + b, 0)));

  const uncategorised = useUncategorised(lotsF);
  const uncatLots = uncategorised.reduce((s, i) => s + i.lots, 0);
  const withExpiry = lotsF.filter((l) => l.expiry).length;
  const coOk = (guid: string | undefined) => !fCos.length || fCos.includes(guid ?? "");
  const undated = (cs.q.data?.undated ?? []).filter((l) => coOk(l.companyGuid));
  const nameToGuid = Object.fromEntries(STOCK_COMPANIES.map((c) => [c.name, c.guid]));
  const noLot = (cs.q.data?.noLot ?? []).filter((n) => coOk(nameToGuid[n.company]));
  const stockQty = lotsF.reduce((s, l) => s + l.qty, 0);
  const allPassed = lotsF.filter((l) => !l.next).length;

  /* ---------------- C: the register, filtered ---------------- */
  const base = useMemo(() => lotsF.filter((l) =>
    (!fMonth || l.tests.some((d) => d.slice(0, 7) === fMonth)) &&
    matchesSearch(search, `${l.item} ${l.lot} ${l.family} ${l.category} ${l.company ?? ""} ${l.godown ?? ""} ${l.vouchers.join(" ")}`)), [lotsF, fMonth, search]);

  const stageOf = (l: LotRow): Exclude<Stage, "all" | "soon"> =>
    l.next ? (`t${l.next.no}` as "t1" | "t2" | "t3") : "complete";

  const stageCounts = useMemo(() => {
    const c = { all: base.length, soon: 0, t1: 0, t2: 0, t3: 0, complete: 0 };
    for (const l of base) {
      if (l.days !== null && l.days <= 30) c.soon++;
      c[stageOf(l)]++;
    }
    return c;
  }, [base]);

  const lotRows = useMemo(() => base.filter((l) =>
    stage === "all" ? true : stage === "soon" ? l.days !== null && l.days <= 30 : stageOf(l) === stage), [base, stage]);

  const calRows: TestRow[] = useMemo(() => base.flatMap((l) =>
    l.tests.map((d, i) => ({ date: d, month: d.slice(0, 7), no: (i + 1) as 1 | 2 | 3, lot: l })))
    .filter((t) => t.month === (fMonth ?? month))
    .sort((a, b) => a.date.localeCompare(b.date) || a.lot.item.localeCompare(b.lot.item) || a.lot.lot.localeCompare(b.lot.lot)),
  [base, month, fMonth]);

  const calMonths = useMemo(() => [...new Set([...perMonth.keys(), ...months])].sort(), [perMonth, months]);

  const lotPg = usePagination(lotRows, { pageSize: 25, resetKey: `${stage}|${search}|${`${fCos.join()}|${fCats.join()}|${fGroups.join()}|${fColours.join()}|${fMonth}`}` });
  const calPg = usePagination(calRows, { pageSize: 25, resetKey: `${month}|${search}|${`${fCos.join()}|${fCats.join()}|${fGroups.join()}|${fColours.join()}|${fMonth}`}` });

  const exportLots = () => exportRowsToXlsx({
    fileName: stock ? "Ink_Stabilisation_Closing_Stock" : "Ink_Stabilisation_Surat",
    sheetName: stock ? "Closing stock" : "Retest schedule",
    title: stock ? `${APP} — closing stock retest schedule (Enterprises Surat + Otec Surat), ${fmtDate(today)}` : `${APP} — Enterprises Surat retest schedule`,
    rows: lotRows,
    filters: [
      fCos.length ? `Company: ${STOCK_COMPANIES.filter((c) => fCos.includes(c.guid)).map((c) => c.name).join(", ")}` : "",
      stage !== "all" ? `Stage: ${stage}` : "",
      fMonth ? `Month: ${fmtMonth(fMonth)}` : "",
      fCats.length ? `Category: ${fCats.map(categoryLabel).join(", ")}` : "",
      fGroups.length ? `Group: ${fGroups.join(", ")}` : "",
      fColours.length ? `Colour: ${fColours.join(", ")}` : "",
      search ? `Search: ${search}` : "",
    ].filter(Boolean),
    notes: stock ? [
      "Source: ConnectWave (Tally sync) — ink lots in stock today at Enterprises Surat and Otec Surat, tied to Tally's closing qty per item (Lab godown included).",
      "Tests fall at + 3, + 6 and + 9 months from the lot's production date (in either company), else its purchase date. Category = Ink type from Bushra Central Master. Expiry blank = not entered in Tally.",
    ] : [
      "Source: ConnectWave (Tally sync) — Enterprises Surat, STOCK JOURNAL-PRODUCTION inward finished-ink lines.",
      "Category = Ink type from Bushra Central Master. Tests fall at production + 3, + 6 and + 9 months. Expiry blank = not entered in Tally.",
    ],
    columns: [
      ...(stock ? [{ header: "Company", width: 18, value: (l: LotRow) => l.company ?? "" }] : []),
      { header: "Category", width: 22, value: (l) => categoryLabel(l.category) },
      { header: "Stock item", width: 38, value: (l) => l.item },
      { header: "Lot no.", width: 18, value: (l) => l.lot },
      { header: stock ? "Prod. / purchase date" : "Production date", width: 14, value: (l) => fmtDate(l.prod) },
      ...(stock ? [{ header: "Dated by", width: 24, value: (l: LotRow) => l.dateFrom ?? "" }] : []),
      { header: "Mfg date (Tally)", width: 14, value: (l) => (l.mfd ? fmtDate(l.mfd) : "") },
      { header: "Expiry date (Tally)", width: 14, value: (l) => (l.expiry ? fmtDate(l.expiry) : "") },
      { header: stock ? "Qty in stock" : "Qty produced", width: 12, value: (l) => l.qty },
      { header: "Unit", width: 6, value: (l) => l.uom ?? "" },
      ...[0, 1, 2].map((i) => ({ header: `Test ${i + 1} (+${TEST_MONTHS[i]} m)`, width: 14, value: (l: LotRow) => fmtDate(l.tests[i]) })),
      { header: "Next test", width: 9, value: (l) => (l.next ? `Test ${l.next.no}` : "All passed") },
      { header: "Next test date", width: 14, value: (l) => (l.next ? fmtDate(l.next.date) : "") },
      { header: "Days to next test", width: 10, value: (l) => l.days ?? "" },
      { header: "Tally stock group", width: 26, value: (l) => l.family },
      ...(stock
        ? [{ header: "Last godown", width: 18, value: (l: LotRow) => l.godown ?? "" }]
        : [{ header: "Production voucher(s)", width: 20, value: (l: LotRow) => l.vouchers.join(", ") }]),
    ],
  });

  const exportCalendar = () => exportRowsToXlsx({
    fileName: `Ink_Stabilisation_${stock ? "Closing_Stock_" : ""}Tests_${month}`,
    sheetName: fmtMonth(month),
    title: `${APP} — tests due in ${fmtMonth(month)}`,
    rows: calRows,
    filters: [fCats.length ? `Category: ${fCats.map(categoryLabel).join(", ")}` : "", fGroups.length ? `Group: ${fGroups.join(", ")}` : "", fColours.length ? `Colour: ${fColours.join(", ")}` : "", search ? `Search: ${search}` : ""].filter(Boolean),
    columns: [
      { header: "Test date", width: 13, value: (t) => fmtDate(t.date) },
      { header: "Test", width: 8, value: (t) => `Test ${t.no}` },
      ...(stock ? [{ header: "Company", width: 18, value: (t: TestRow) => t.lot.company ?? "" }] : []),
      { header: "Category", width: 22, value: (t) => categoryLabel(t.lot.category) },
      { header: "Stock item", width: 38, value: (t) => t.lot.item },
      { header: "Lot no.", width: 18, value: (t) => t.lot.lot },
      { header: stock ? "Prod. / purchase date" : "Production date", width: 14, value: (t) => fmtDate(t.lot.prod) },
      { header: "Expiry date (Tally)", width: 14, value: (t) => (t.lot.expiry ? fmtDate(t.lot.expiry) : "") },
      { header: stock ? "Qty in stock" : "Qty produced", width: 12, value: (t) => t.lot.qty },
    ],
  });

  const th = "px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-grey whitespace-nowrap";
  const td = "px-3 py-2.5 text-[12.5px] whitespace-nowrap";

  return (
    <div
      className="mx-auto max-w-[1400px] space-y-6 px-4 py-6"
      onClick={(e) => {
        // Power-BI style: a click on empty space (not a control, table or list) clears the month.
        if (fMonth && !(e.target as HTMLElement).closest("button, a, input, select, label, table, [role=listbox], [data-keep-filter]")) setFMonth(null);
      }}
    >
      {/* ------------------------------------------------------------ header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-orange">{stock ? "Step 1 · Main data · Closing stock" : "Step 1 · Main data"}</div>
          <h1 className="mt-0.5 text-[26px] font-bold leading-tight text-navy">{stock ? `${APP} — Closing stock` : APP}</h1>
          <p className="mt-1 text-[13px] text-grey">
            {stock ? (
              <>
                Enterprises Surat + Otec Surat · <b className="text-ink">{lotsF.length.toLocaleString("en-IN")}</b> ink lots in stock today
                · <b className="text-ink">{stockQty.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</b> KGS{anyFilter ? " (filtered)" : ""},
                each retested 3, 6 and 9 months after production / purchase
              </>
            ) : (
              <>Enterprises Surat · <b className="text-ink">{lots.length.toLocaleString("en-IN")}</b> manufactured ink lots, each retested at 3, 6 and 9 months</>
            )}
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ryg-green/10 px-2 py-0.5 text-[11px] font-semibold text-ryg-green">
              <i className="h-1.5 w-1.5 rounded-full bg-ryg-green" />
              {stock && cs.asOf
                ? `Tally closing stock · read ${cs.asOf.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                : "Live from Tally"}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", q.isFetching && "animate-spin")} />
            {q.isFetching ? (stock && totalReq ? `Reading ${done}/${totalReq}…` : "Loading…") : "Refresh"}
          </Button>
          <Button size="sm" onClick={() => navigate(`${B}/plant`)}>
            Go to Plant testing <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </header>

      <Card className="sticky top-2 z-20 px-4 py-3" data-keep-filter>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11.5px] font-bold uppercase tracking-wide text-grey">Filter</span>
          {stock && (
            <MultiSelect values={fCos} onChange={setFCos} options={filterOpts.companies} placeholder="Both companies" className="w-56" />
          )}
          <select value={fMonth ?? ""} onChange={(e) => setFMonth(e.target.value || null)}
            className={cn("h-9 rounded-lg border bg-white px-3 text-[13px] font-semibold",
              fMonth ? "border-orange text-orange" : "border-line text-navy")}>
            <option value="">All months</option>
            {allMonths.map((m) => <option key={m} value={m}>{fmtMonth(m)}{m === thisMonth ? " (this month)" : ""}</option>)}
          </select>
          <MultiSelect values={fCats} onChange={setFCats} options={filterOpts.cats} placeholder="All categories" searchable className="w-52" />
          <MultiSelect values={fGroups} onChange={setFGroups} options={filterOpts.groups} placeholder="All groups" className="w-44" />
          <MultiSelect values={fColours} onChange={setFColours} options={filterOpts.colours} placeholder="All colours" searchable className="w-44" />
          {anyFilter ? (
            <button onClick={clearAll} className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-orange hover:bg-orange/10">
              Clear all ✕
            </button>
          ) : (
            <span className="text-[11.5px] text-grey-2">Tip: click a month bar to filter the whole page</span>
          )}
          <span className="ml-auto text-[12px] text-grey tabular-nums">
            {lotsF.length.toLocaleString("en-IN")} of {lots.length.toLocaleString("en-IN")} lots
          </span>
        </div>
      </Card>

      {q.isError && (
        <Card className="border-ryg-red/40 p-4 text-[13px] text-ryg-red">
          Could not read {stock ? "closing stock" : "production lots"}: {(q.error as Error).message}
        </Card>
      )}

      {q.isLoading ? (
        <Card className="flex items-center justify-center gap-3 p-14 text-[13px] text-grey">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {stock
            ? `Reading today's closing stock from ConnectWave${totalReq ? ` — ${done} of ${totalReq} requests` : ""}… (about a minute the first time)`
            : "Reading production lots from ConnectWave…"}
        </Card>
      ) : rawLots && (
        <>
          {/* ------------------------------------------------ A · this month */}
          <Card className="p-5">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div>
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-grey">
                  <CalendarClock className="h-4 w-4" /> {fmtMonth(focusMonth)}{fMonth && fMonth !== thisMonth ? " · selected" : ""}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-[40px] font-bold leading-none text-navy tabular-nums">{monthTests.length}</span>
                  <span className="text-[14px] text-grey">tests due {fMonth && fMonth !== thisMonth ? `in ${fmtMonth(fMonth)}` : "this month"}</span>
                </div>
                <StackBar parts={statusParts(monthSc)} height="h-3" className="mt-4" />
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                  {([
                    ["Closed", monthSc.closed, STATUS_BAR.closed],
                    ["Awaiting review", monthSc.submitted, STATUS_BAR.submitted],
                    ["Sent back", monthSc.returned, STATUS_BAR.returned],
                    ["Pending", monthSc.pending, STATUS_BAR.pending],
                  ] as const).map(([label, v, c]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-grey"><i className={cn("h-2 w-2 rounded-full", c)} />{label}</span>
                      <b className="tabular-nums text-ink">{v}</b>
                    </div>
                  ))}
                </div>
                {carried > 0 && (
                  <div className="mt-3 rounded-lg bg-ryg-red/5 px-3 py-2 text-[12px] text-ryg-red">
                    + {carried} still open from earlier months
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {([1, 2, 3] as const).map((n) => {
                  const list = monthTests.filter((t) => t.no === n);
                  const sc = statusCounts(list);
                  const pending = sc.pending + sc.returned;
                  const done = sc.closed + sc.submitted;
                  return (
                    <button key={n} onClick={() => openRegister(`lab${n}` as View)}
                      className="group flex flex-col rounded-xl border border-line p-4 text-left transition hover:border-orange hover:shadow-soft">
                      <div className="flex items-center gap-2">
                        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold text-white", TEST_COLOR[n - 1])}>{n}</span>
                        <div>
                          <div className="text-[13.5px] font-bold text-navy">{LAB_NAME[n - 1]}</div>
                          <div className="text-[11px] text-grey">{TEST_MONTHS[n - 1]} months after production{stock ? " / purchase" : ""}</div>
                        </div>
                      </div>
                      <div className="mt-4 flex items-baseline justify-between">
                        <span className="text-[26px] font-bold leading-none text-navy tabular-nums">{pending}</span>
                        <span className="text-[11.5px] text-grey tabular-nums">{done} / {list.length} done</span>
                      </div>
                      <div className="text-[11.5px] text-grey">pending in {fmtMonth(focusMonth)}</div>
                      <StackBar parts={statusParts(sc)} className="mt-3" />
                      <span className="mt-3 text-[12px] font-semibold text-orange opacity-80 group-hover:opacity-100">
                        See every lot's {n === 1 ? "1st" : n === 2 ? "2nd" : "3rd"} test →
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* ------------------------------------------- B · where the work is */}
          <div className="grid items-start gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <div className="p-5 pb-3">
                <SectionTitle
                  title="Pending testing by category"
                  hint={<>{fMonth ? fmtMonth(fMonth) : `${fmtMonth(thisMonth)} + earlier months still open`} · category = Ink type in Bushra Central Master · click a category to see its items</>}
                />
              </div>
              <PendingByCategory tests={planTests} onPick={openPlant} today={today} />
            </Card>

            <div className="space-y-6">
              <Card className="p-5">
                <SectionTitle title="Next 12 months" hint={fMonth ? "Click the month again, or any empty space, to clear" : "Click a month to filter the whole page"} />
                <div className="mt-4 space-y-1.5">
                  {months.map((m) => {
                    const c = perMonth.get(m) ?? [0, 0, 0];
                    const total = c[0] + c[1] + c[2];
                    return (
                      <button key={m} onClick={() => setFMonth((cur) => (cur === m ? null : m))}
                        className={cn("grid w-full grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 rounded-md px-1 py-0.5 text-left transition",
                          fMonth === m ? "bg-orange/10 ring-2 ring-orange" : "hover:bg-page",
                          fMonth && fMonth !== m && "opacity-35 hover:opacity-70")}
                        title={`${fmtMonth(m)}: Test 1 ${c[0]}, Test 2 ${c[1]}, Test 3 ${c[2]}`}>
                        <span className={cn("text-[12px]", m === thisMonth ? "font-bold text-navy" : "text-grey")}>{fmtMonth(m)}</span>
                        <div style={{ width: `${Math.max(2, (total / maxMonth) * 100)}%` }}>
                          <StackBar height="h-2.5" parts={[0, 1, 2].map((i) => ({ value: c[i], color: TEST_COLOR[i] }))} />
                        </div>
                        <span className="text-right text-[12px] font-semibold tabular-nums text-ink">{total || "—"}</span>
                      </button>
                    );
                  })}
                </div>
                <Legend items={[{ label: "Test 1", color: TEST_COLOR[0] }, { label: "Test 2", color: TEST_COLOR[1] }, { label: "Test 3", color: TEST_COLOR[2] }]} />
              </Card>

              <Card className="p-5">
                <SectionTitle title="Data health" hint="Gaps that make the plan less exact" />
                <div className="mt-3 divide-y divide-line">
                  <button onClick={() => setShowUncat((s) => !s)} className="flex w-full items-center gap-3 py-2.5 text-left">
                    <TriangleAlert className={cn("h-5 w-5 shrink-0", uncategorised.length ? "text-ryg-red" : "text-ryg-green")} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-ink">Items with no category</div>
                      <div className="text-[11.5px] text-grey">{uncategorised.length} items · {uncatLots} lots — no Ink type in Bushra Central Master</div>
                    </div>
                    <span className="text-[12px] font-semibold text-orange">{showUncat ? "Hide" : "View"}</span>
                  </button>
                  <div className="flex items-center gap-3 py-2.5">
                    <PackageSearch className="h-5 w-5 shrink-0 text-yellow" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-ink">Lots with no expiry in Tally</div>
                      <div className="text-[11.5px] text-grey">{(lotsF.length - withExpiry).toLocaleString("en-IN")} of {lotsF.length.toLocaleString("en-IN")} — shown blank, never estimated</div>
                    </div>
                  </div>
                  {stock && (
                    <>
                      <div className="flex items-center gap-3 py-2.5">
                        <CalendarClock className={cn("h-5 w-5 shrink-0", undated.length ? "text-yellow" : "text-ryg-green")} />
                        <div className="flex-1">
                          <div className="text-[13px] font-semibold text-ink">Lots with no production / purchase date</div>
                          <div className="text-[11.5px] text-grey" title={undated.slice(0, 30).map((l) => `${l.company} · ${l.item} · ${l.lot}`).join("\n")}>
                            {undated.length.toLocaleString("en-IN")} lots · {undated.reduce((s, l) => s + l.qty, 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} KGS in stock with no test dates
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 py-2.5">
                        <PackageSearch className={cn("h-5 w-5 shrink-0", noLot.length ? "text-yellow" : "text-ryg-green")} />
                        <div className="flex-1">
                          <div className="text-[13px] font-semibold text-ink">Stock with no lot number</div>
                          <div className="text-[11.5px] text-grey" title={noLot.slice(0, 30).map((x) => `${x.company} · ${x.item} · ${x.qty} ${x.uom}`).join("\n")}>
                            {noLot.length.toLocaleString("en-IN")} items · {/* KGS only — Otec Surat's ink group also holds foil paper in MTR. */}
                            {noLot.filter((x) => /KG/i.test(x.uom)).reduce((s, x) => s + x.qty, 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} KGS
                            {noLot.some((x) => !/KG/i.test(x.uom)) ? " (+ other units)" : ""} in Tally that no lot accounts for
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-3 py-2.5">
                    <FlaskConical className="h-5 w-5 shrink-0 text-grey" />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-ink">Lots past all three test dates</div>
                      <div className="text-[11.5px] text-grey">{allPassed.toLocaleString("en-IN")} lots whose 9-month test date is already behind us</div>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {showUncat && (
            <Card className="border-ryg-red/30">
              <div className="flex items-center justify-between p-5 pb-3">
                <SectionTitle title="Items with no category"
                  hint="Set an Ink type for these in Bushra Central Master, then press Refresh here." />
                <Button variant="outline" size="sm" onClick={() => navigate(
                  `${appBasePath("bushra-central-master")}/items?` + new URLSearchParams({
                    focus: uncategorised.map((i) => i.item).join("\n"),
                    company: fCos.length === 1 ? fCos[0] : SURAT_GUID,
                    from: "ink-stabilisation",
                  }).toString())}>
                  Fix these in Bushra Central Master →
                </Button>
              </div>
              <UncategorisedTable items={uncategorised} />
            </Card>
          )}

          {/* ------------------------------------------------ C · lot register */}
          <div ref={registerRef} className="scroll-mt-4">
            <Card>
              <div className="flex flex-wrap items-end justify-between gap-3 p-5 pb-4">
                <SectionTitle title="Lot register" hint="Every lot and its three test dates. Filters here apply to this list only." />
                <Button variant="outline" size="sm" onClick={view === "calendar" ? exportCalendar : view === "lots" ? exportLots : undefined}
                  disabled={view.startsWith("lab")} title={view.startsWith("lab") ? "Use the export inside the lab-test view" : undefined}>
                  Export Excel
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-y border-line bg-page/50 px-5 py-3">
                <Segmented<View>
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "lots", label: "By lot" },
                    { value: "lab1", label: "1st test", dot: TEST_COLOR[0] },
                    { value: "lab2", label: "2nd test", dot: TEST_COLOR[1] },
                    { value: "lab3", label: "3rd test", dot: TEST_COLOR[2] },
                    { value: "calendar", label: "Calendar" },
                  ]}
                />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search item, lot no., voucher…"
                    className="h-9 w-60 rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-orange"
                  />
                  {view === "calendar" && !fMonth && (
                    <select value={month} onChange={(e) => setMonth(e.target.value)}
                      className="h-9 rounded-lg border border-line bg-white px-2 text-[13px]">
                      {calMonths.map((m) => (
                        <option key={m} value={m}>{fmtMonth(m)} ({(perMonth.get(m) ?? [0, 0, 0]).reduce((a, b) => a + b, 0)})</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {view.startsWith("lab") ? (
                <LabTestView lots={base} no={Number(view.slice(3)) as 1 | 2 | 3} today={today} flow={flow} stock={stock} />
              ) : view === "lots" ? (
                <>
                  <div className="px-5 pt-3">
                    <Segmented<Stage>
                      size="sm"
                      value={stage}
                      onChange={setStage}
                      options={[
                        { value: "all", label: "All", count: stageCounts.all },
                        { value: "soon", label: "Next test ≤ 30 days", count: stageCounts.soon },
                        { value: "t1", label: "Awaiting 1st", count: stageCounts.t1 },
                        { value: "t2", label: "Awaiting 2nd", count: stageCounts.t2 },
                        { value: "t3", label: "Awaiting 3rd", count: stageCounts.t3 },
                        { value: "complete", label: "All 3 passed", count: stageCounts.complete },
                      ]}
                    />
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full">
                      <thead className="border-y border-line bg-page">
                        <tr>
                          {stock && <th className={th}>Company</th>}
                          <th className={th}>Stock item</th><th className={th}>Lot no.</th><th className={th}>{stock ? "Prod. / purchase" : "Produced"}</th>
                          <th className={`${th} text-right`}>{stock ? "In stock" : "Qty"}</th><th className={th}>Expiry</th>
                          <th className={th}>{TEST_LABEL(1)}</th><th className={th}>{TEST_LABEL(2)}</th><th className={th}>{TEST_LABEL(3)}</th>
                          <th className={`${th} text-right`}>Next test in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotPg.pageItems.map((l) => (
                          <tr key={`${l.companyGuid ?? ""}|${l.item}|${l.lot}`} className={cn("border-b border-line transition hover:bg-page/70", tone(l.days))}>
                            {stock && <td className={`${td} text-grey`}>{l.company}</td>}
                            <td className={td}>
                              <div className="font-semibold text-ink">{l.item}</div>
                              <div className="text-[11px] text-grey">{categoryLabel(l.category)}</div>
                            </td>
                            <td className={`${td} font-mono text-[12px]`}>{l.lot}</td>
                            <td className={td} title={l.dateFrom ?? undefined}>{fmtDate(l.prod)}</td>
                            <td className={`${td} text-right tabular-nums`}>{l.qty.toLocaleString("en-IN")} <span className="text-grey">{l.uom}</span></td>
                            <td className={td}>{l.expiry ? fmtDate(l.expiry) : <span className="text-grey-2">—</span>}</td>
                            {l.tests.map((t, i) => (
                              <td key={i} className={td}><TestCell date={t} isNext={l.next?.no === i + 1} today={today} /></td>
                            ))}
                            <td className={`${td} text-right`}><DaysBadge days={l.days} /></td>
                          </tr>
                        ))}
                        {lotPg.pageItems.length === 0 && (
                          <tr><td colSpan={stock ? 10 : 9} className="px-4 py-12 text-center text-[13px] text-grey">No lots match these filters.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Pagination state={lotPg} rowsLabel="lots" pageSizeOptions={[25, 50, 100]} />
                </>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="border-b border-line bg-page">
                        <tr>
                          <th className={th}>Test date</th><th className={th}>Test</th>{stock && <th className={th}>Company</th>}<th className={th}>Stock item</th>
                          <th className={th}>Lot no.</th><th className={th}>{stock ? "Prod. / purchase" : "Produced"}</th><th className={th}>Expiry</th>
                          <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calPg.pageItems.map((t) => {
                          const d = daysBetween(today, t.date);
                          return (
                            <tr key={`${t.lot.companyGuid ?? ""}|${t.lot.item}|${t.lot.lot}|${t.no}`} className={cn("border-b border-line transition hover:bg-page/70", d >= 0 && tone(d))}>
                              <td className={`${td} font-semibold`}>{fmtDate(t.date)}</td>
                              <td className={td}>
                                <span className="inline-flex items-center gap-1.5"><i className={cn("h-2 w-2 rounded-full", TEST_COLOR[t.no - 1])} />Test {t.no}</span>
                              </td>
                              {stock && <td className={`${td} text-grey`}>{t.lot.company}</td>}
                              <td className={td}>
                                <div className="font-semibold text-ink">{t.lot.item}</div>
                                <div className="text-[11px] text-grey">{categoryLabel(t.lot.category)}</div>
                              </td>
                              <td className={`${td} font-mono text-[12px]`}>{t.lot.lot}</td>
                              <td className={td}>{fmtDate(t.lot.prod)}</td>
                              <td className={td}>{t.lot.expiry ? fmtDate(t.lot.expiry) : <span className="text-grey-2">—</span>}</td>
                              <td className={`${td} text-right tabular-nums`}>{t.lot.qty.toLocaleString("en-IN")} <span className="text-grey">{t.lot.uom}</span></td>
                              <td className={`${td} text-right`}>
                                {d < 0 ? <span className="text-[12px] text-grey-2">{-d} d ago</span> : <DaysBadge days={d} />}
                              </td>
                            </tr>
                          );
                        })}
                        {calPg.pageItems.length === 0 && (
                          <tr><td colSpan={stock ? 9 : 8} className="px-4 py-12 text-center text-[13px] text-grey">No tests fall in {fmtMonth(month)}.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Pagination state={calPg} rowsLabel="tests" pageSizeOptions={[25, 50, 100]} />
                </>
              )}
            </Card>
          </div>

          <p className="text-[11.5px] leading-relaxed text-grey">
            {stock && <>Closing stock is Tally's closing qty per item today, split into lots from the voucher lines — the same figures as Ink Expiry Date,
              with the Lab godown included. A lot's date is its production (in either company), else its purchase. Otec Surat lots are not in the
              Plant / Management flow, so their tests read Pending.{" "}</>}
            Production date is the production voucher's date. Expiry comes from the Tally batch where one was entered and is never
            estimated. Category is the Ink type in Bushra Central Master (Central Masters where you have not changed it).
          </p>
        </>
      )}
    </div>
  );
}
