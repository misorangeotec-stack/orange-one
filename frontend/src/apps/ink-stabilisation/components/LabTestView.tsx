import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { daysBetween, fmtDate, TEST_MONTHS, type InkLot } from "../lib/schedule";
import { RESULT_LABEL, STATUS_LABEL, testKey, type FlowData, type FlowStatus, type LabResult } from "../lib/flow";
import { SURAT_GUID } from "../lib/constants";
import { ResultPill, StatusPill } from "./FlowParts";

/**
 * ONE LAB TEST ACROSS EVERY LOT — "First lab testing" is Test 1 (+3 months) of each lot,
 * and so on. The Main data page's By-lot view reads a lot across; this reads a test down.
 */

export const LAB_NAME = ["First lab testing", "Second lab testing", "Third lab testing"] as const;

type Scope = "month" | "soon" | "upcoming" | "passed" | "all";

interface Row {
  lot: InkLot;
  date: string;
  days: number;
  status: FlowStatus;
  result: LabResult | null;
}

export default function LabTestView({
  lots, no, today, flow, stock = false,
}: {
  lots: InkLot[];
  no: 1 | 2 | 3;
  today: string;
  flow: FlowData | undefined;
  /** Closing stock page: qty is stock today, the date is production OR purchase, lots carry a company. */
  stock?: boolean;
}) {
  const QTY = stock ? "Qty in stock" : "Qty produced";
  const DATE = stock ? "Prod. / purchase" : "Production";
  const [scope, setScope] = useState<Scope>("upcoming");
  const month = today.slice(0, 7);

  const all: Row[] = useMemo(() => lots.map((lot) => {
    const date = lot.tests[no - 1];
    // Another company's lot (Closing stock page) never borrows Enterprises Surat's flow records.
    const rec = lot.companyGuid && lot.companyGuid !== SURAT_GUID ? undefined : flow?.tests.get(testKey(lot.item, lot.lot, no));
    return { lot, date, days: daysBetween(today, date), status: rec?.status ?? "pending", result: rec?.result ?? null };
  }), [lots, no, today, flow]);

  const inScope = (r: Row, s: Scope) =>
    s === "all" ? true
      : s === "month" ? r.date.slice(0, 7) === month
      : s === "soon" ? r.days >= 0 && r.days <= 30
      : s === "upcoming" ? r.days >= 0
      : r.days < 0;

  // Upcoming reads soonest first; passed reads most recent first.
  const rows = useMemo(() => all.filter((r) => inScope(r, scope)).sort((a, b) =>
    (scope === "passed" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) ||
    a.lot.item.localeCompare(b.lot.item) || a.lot.lot.localeCompare(b.lot.lot)),
  [all, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const pg = usePagination(rows, { pageSize: 50, resetKey: `${no}|${scope}|${lots.length}` });
  const qty = rows.reduce((s, r) => s + r.lot.qty, 0);

  const exportRows = () => exportRowsToXlsx({
    fileName: `Ink_${LAB_NAME[no - 1].replace(/ /g, "_")}`,
    sheetName: LAB_NAME[no - 1],
    title: `Ink Stabilisation — ${LAB_NAME[no - 1]} (Test ${no}, +${TEST_MONTHS[no - 1]} months)`,
    rows,
    filters: [`Showing: ${SCOPES.find((s) => s.key === scope)!.label}`],
    columns: [
      { header: "Test date", width: 13, value: (r) => fmtDate(r.date) },
      { header: "Days from today", width: 10, value: (r) => r.days },
      { header: "Stock item", width: 38, value: (r) => r.lot.item },
      { header: "Ink family", width: 26, value: (r) => r.lot.family },
      { header: "Lot no.", width: 18, value: (r) => r.lot.lot },
      ...(stock ? [{ header: "Company", width: 18, value: (r: Row) => r.lot.company ?? "" }] : []),
      { header: QTY, width: 12, value: (r) => r.lot.qty },
      { header: "Unit", width: 6, value: (r) => r.lot.uom ?? "" },
      { header: `${DATE} date`, width: 14, value: (r) => fmtDate(r.lot.prod) },
      { header: "Mfg date (Tally)", width: 14, value: (r) => (r.lot.mfd ? fmtDate(r.lot.mfd) : "") },
      { header: "Expiry date (Tally)", width: 14, value: (r) => (r.lot.expiry ? fmtDate(r.lot.expiry) : "") },
      { header: stock ? "Dated by" : "Production voucher(s)", width: 20, value: (r) => r.lot.vouchers.join(", ") },
      { header: "Lab result", width: 11, value: (r) => (r.result ? RESULT_LABEL[r.result] : "") },
      { header: "Flow status", width: 16, value: (r) => STATUS_LABEL[r.status] },
    ],
  });

  const th = "px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-grey whitespace-nowrap";
  const td = "px-3 py-2 text-[12.5px] whitespace-nowrap";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        {SCOPES.map((s) => (
          <button key={s.key} onClick={() => setScope(s.key)} aria-pressed={scope === s.key}
            className={"rounded-full border px-3 py-1 text-[12.5px] font-medium transition " +
              (scope === s.key ? "border-orange bg-orange/10 text-orange" : "border-line text-grey hover:border-orange hover:text-orange")}>
            {s.label} <span className="ml-1 opacity-70">{all.filter((r) => inScope(r, s.key)).length}</span>
          </button>
        ))}
        <span className="ml-auto text-[12px] text-grey">
          {rows.length.toLocaleString("en-IN")} lots · {qty.toLocaleString("en-IN")} {rows[0]?.lot.uom ?? ""} {stock ? "in stock" : "produced"}
        </span>
        <Button variant="outline" size="sm" onClick={exportRows}>Export Excel</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-y border-line bg-page">
            <tr>
              <th className={th}>Test date</th><th className={`${th} text-right`}>Days</th><th className={th}>Stock item</th>
              <th className={th}>Lot no.</th><th className={`${th} text-right`}>{QTY}</th><th className={th}>{DATE}</th>
              <th className={th}>Mfg (Tally)</th><th className={th}>Expiry (Tally)</th><th className={th}>{stock ? "Dated by" : "Voucher"}</th><th className={th}>Lab result</th><th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((r) => (
              <tr key={`${r.lot.companyGuid ?? ""}|${r.lot.item}|${r.lot.lot}`} className={`border-b border-line ${
                r.days < 0 ? "" : r.days <= 7 ? "bg-ryg-red/10" : r.days <= 30 ? "bg-orange/10" : r.days <= 60 ? "bg-yellow/15" : ""}`}>
                <td className={`${td} font-semibold ${r.days < 0 ? "text-grey-2" : "text-ink"}`}>{fmtDate(r.date)}</td>
                <td className={`${td} text-right ${r.days < 0 ? "text-grey-2" : "font-semibold"}`}>
                  {r.days === 0 ? "today" : r.days < 0 ? `${-r.days} ago` : r.days}
                </td>
                <td className={td}>
                  <div className="font-medium text-ink">{r.lot.item}</div>
                  <div className="text-[11px] text-grey">{stock ? `${r.lot.company} · ${r.lot.family}` : r.lot.family}</div>
                </td>
                <td className={`${td} font-mono`}>{r.lot.lot}</td>
                <td className={`${td} text-right`}>{r.lot.qty.toLocaleString("en-IN")} <span className="text-grey">{r.lot.uom}</span></td>
                <td className={td}>{fmtDate(r.lot.prod)}</td>
                <td className={td}>{r.lot.mfd ? fmtDate(r.lot.mfd) : <span className="text-grey-2">—</span>}</td>
                <td className={td}>{r.lot.expiry ? fmtDate(r.lot.expiry) : <span className="text-grey-2">not in Tally</span>}</td>
                <td className={`${td} text-grey`}>{r.lot.vouchers.join(", ")}</td>
                <td className={td}><ResultPill result={r.result} /></td>
                <td className={td}><StatusPill status={r.status} /></td>
              </tr>
            ))}
            {pg.pageItems.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-10 text-center text-[13px] text-grey">No lots here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination state={pg} rowsLabel="lots" pageSizeOptions={[50, 100, 250]} />
    </>
  );
}

const SCOPES: { key: Scope; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "soon", label: "Next 30 days" },
  { key: "upcoming", label: "All upcoming" },
  { key: "passed", label: "Date passed" },
  { key: "all", label: "All" },
];
