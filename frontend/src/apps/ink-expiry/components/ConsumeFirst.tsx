/**
 * CONSUME FIRST — in-stock ink lots whose Tally expiry falls in this month or the next two, soonest
 * first. Asked for on 01-10-2026 so management can plan: these are the lots to use or sell before
 * anything newer.
 *
 * Window: from TODAY to the last day of the third month (this month + 2). A lot already past its
 * date is not here — it is on the "Expired, still in stock" card. A lot with no expiry in Tally
 * cannot appear at all, which the panel says.
 *
 * Follows the page's company / category / group / month filters and any chart click; ignores the
 * expiry-state chips, since every lot here is by definition "expiry updated".
 */
import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { daysBetween, fmtDate, type StockLot } from "../lib/expiry";
import { fmtKg, fmtMoney } from "./StockCharts";
import { ActiveFilters, QTY_BANDS, qtyBand, SortFilterBody, SortFilterHead, TableTools, useSortFilter, type Col } from "./SortFilterHead";
import { PurchaseDateCell, purchaseText, ReturnDateCell } from "./LotDates";

export interface PlanRow {
  company: string;
  category: string;
  group: string;
  item: string;
  qty: number;
  value: number;
  lot: StockLot;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const addMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const i = m - 1 + n;
  return `${y + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function DaysPill({ days }: { days: number }) {
  const [bg, fg] = days <= 30 ? ["#e3494822", "#c0302f"] : days <= 60 ? ["#eb683422", "#b8491c"] : ["#eda10026", "#8a5d00"];
  return <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: bg, color: fg }}>{days === 0 ? "today" : `${days} days`}</span>;
}

export default function ConsumeFirst({ rows, today, notDated }: {
  rows: PlanRow[];
  today: string;
  /** Lots in view with no expiry in Tally — they cannot be planned, so the panel says how many. */
  notDated: number;
}) {
  const thisYm = today.slice(0, 7);
  const months = [thisYm, addMonth(thisYm, 1), addMonth(thisYm, 2)];
  const [month, setMonth] = useState<string | null>(null);

  const inWindow = useMemo(() => rows
    .filter((r) => r.lot.expiry && r.lot.expiry >= today && months.includes(r.lot.expiry.slice(0, 7)))
    .sort((a, b) => a.lot.expiry!.localeCompare(b.lot.expiry!) || b.qty - a.qty),
  [rows, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const perMonth = months.map((m) => {
    const list = inWindow.filter((r) => r.lot.expiry!.startsWith(m));
    return { m, lots: list.length, qty: list.reduce((s, r) => s + r.qty, 0), value: list.reduce((s, r) => s + r.value, 0) };
  });
  const all = { lots: inWindow.length, qty: inWindow.reduce((s, r) => s + r.qty, 0), value: inWindow.reduce((s, r) => s + r.value, 0) };
  const shown = useMemo(() => (month ? inWindow.filter((r) => r.lot.expiry!.startsWith(month)) : inWindow), [inWindow, month]);

  const days = (r: PlanRow) => daysBetween(today, r.lot.expiry!);
  const cols: Col<PlanRow>[] = useMemo(() => [
    { key: "inward", label: "Purchase / prod. date", text: (r) => purchaseText(r.lot), sort: (r) => r.lot.inward, filter: false,
      render: (r) => <PurchaseDateCell lot={r.lot} /> },
    { key: "return", label: "Sales return", text: (r) => (r.lot.returnDate ? fmtDate(r.lot.returnDate) : "—"), sort: (r) => r.lot.returnDate, filter: false,
      render: (r) => <ReturnDateCell lot={r.lot} /> },
    { key: "expiry", label: "Expiry date", text: (r) => fmtDate(r.lot.expiry), sort: (r) => r.lot.expiry,
      bucket: (r) => monthName(r.lot.expiry!.slice(0, 7)), render: (r) => <span className="font-semibold text-navy">{fmtDate(r.lot.expiry)}</span> },
    { key: "days", label: "Days left", align: "right", text: (r) => String(days(r)), sort: days, filter: false,
      render: (r) => <DaysPill days={days(r)} /> },
    { key: "company", label: "Company", text: (r) => r.company, sort: (r) => r.company },
    { key: "item", label: "Stock item", text: (r) => r.item, sort: (r) => r.item, render: (r) => <span className="font-medium text-ink">{r.item}</span> },
    { key: "category", label: "Category", text: (r) => r.category, sort: (r) => r.category },
    { key: "group", label: "Group", text: (r) => r.group, sort: (r) => r.group, render: (r) => <span className="text-grey">{r.group}</span> },
    { key: "lot", label: "Lot no.", text: (r) => r.lot.lot, sort: (r) => r.lot.lot, className: "font-mono" },
    { key: "qty", label: "Qty", align: "right", text: (r) => fmtKg(r.qty), sort: (r) => r.qty, bucket: (r) => qtyBand(r.qty), bucketOrder: QTY_BANDS },
    { key: "value", label: "Value", align: "right", text: (r) => fmtMoney(r.value), sort: (r) => r.value, filter: false },
    { key: "godown", label: "Godown", text: (r) => r.lot.godown || "—", sort: (r) => r.lot.godown || null },
  ], [today]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctl = useSortFilter(shown, cols, "consume-first");
  const pg = usePagination(ctl.view, { pageSize: 25, resetKey: `${month}|${shown.length}|${ctl.stamp}` });

  const exportIt = () => exportRowsToXlsx({
    fileName: "Ink_Consume_First_Next_3_Months",
    sheetName: month ? monthName(month) : "Next 3 months",
    title: `Ink to consume first — expiring ${month ? monthName(month) : `${monthName(months[0])} to ${monthName(months[2])}`}`,
    rows: ctl.view,
    notes: [
      `As at ${fmtDate(today)}. In-stock ink lots whose Tally expiry falls between today and the end of ${monthName(months[2])}, soonest first.`,
      "Only lots with an expiry date entered in Tally can appear. Quantities are KGS; value = quantity × the item's Tally closing rate.",
    ],
    columns: [
      { header: "Purchase / prod. date", width: 14, value: (r) => (r.lot.inward ? fmtDate(r.lot.inward) : "") },
      { header: "Purchase / prod. (how, where)", width: 28, value: (r) => purchaseText(r.lot) },
      { header: "Sales return date", width: 14, value: (r) => (r.lot.returnDate ? fmtDate(r.lot.returnDate) : "") },
      { header: "Expiry date", width: 13, value: (r) => fmtDate(r.lot.expiry) },
      { header: "Days left", width: 9, value: days },
      { header: "Company", width: 18, value: (r) => r.company },
      { header: "Stock item", width: 40, value: (r) => r.item },
      { header: "Category", width: 18, value: (r) => r.category },
      { header: "Group", width: 28, value: (r) => r.group },
      { header: "Lot no.", width: 22, value: (r) => r.lot.lot },
      { header: "Qty (KGS)", width: 11, value: (r) => r.qty },
      { header: "Value (₹)", width: 13, value: (r) => Math.round(r.value) },
      { header: "Godown", width: 18, value: (r) => r.lot.godown },
      { header: "Plan / remarks", width: 30, value: () => "" },
    ],
  });

  const chip = (key: string | null, label: string, t: { lots: number; qty: number; value: number }, tone: string) => {
    const on = month === key;
    return (
      <button key={label} onClick={() => setMonth(on && key !== null ? null : key)} aria-pressed={on}
        className={"flex min-w-[170px] flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-left transition " +
          (on ? "border-orange bg-orange/5 ring-2 ring-orange/20" : "border-line bg-white hover:border-orange/50")}>
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: tone }} />
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-grey">{label}</span>
          <span className="block text-[13px] text-navy"><b className="text-[17px]">{t.lots}</b> lots · {fmtKg(t.qty)} · {fmtMoney(t.value)}</span>
        </span>
      </button>
    );
  };

  return (
    <div id="ink-expiry-consume-first" className="scroll-mt-4 rounded-xl border border-line bg-white shadow-sm" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-2.5">
        <div className="flex-1">
          <h3 className="text-[15px] font-bold text-navy">Consume first — expiring in the next 3 months</h3>
          <div className="text-[11.5px] text-grey">
            {monthName(months[0])} to {monthName(months[2])}, soonest first · use or sell these before newer lots
            {notDated > 0 && <> · <span className="text-[#8a5d00]">{notDated.toLocaleString("en-IN")} lots in view have no expiry in Tally and cannot show here</span></>}
          </div>
        </div>
        <TableTools cols={cols} ctl={ctl} />
        <Button variant="outline" size="sm" onClick={exportIt}>Export plan (Excel)</Button>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-2.5">
        {chip(null, "All 3 months", all, "#0B1F3A")}
        {perMonth.map((p, i) => chip(p.m, monthName(p.m), p, ["#e34948", "#eb6834", "#eda100"][i]))}
      </div>

      {inWindow.length === 0 ? (
        <div className="border-t border-line px-4 py-6 text-center text-[13px] text-grey">
          No in-stock lot has an expiry date between today and the end of {monthName(months[2])}.
        </div>
      ) : (
        <>
          <ActiveFilters ctl={ctl} shown={ctl.view.length} total={shown.length} />
          <div className="overflow-x-auto">
            <table className="w-full">
              <SortFilterHead cols={cols} ctl={ctl} />
              <SortFilterBody cols={cols} ctl={ctl} rows={pg.pageItems} rowKey={(r) => `${r.company}|${r.item}|${r.lot.lot}`} empty="Nothing in this month." />
            </table>
          </div>
          <Pagination state={pg} rowsLabel="lots" pageSizeOptions={[25, 50, 100]} />
        </>
      )}
    </div>
  );
}
