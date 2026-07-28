import { SectionHeading } from "@/shared/components/ui/Readout";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import { orderStepRows, plannedText, actualText, type StepRow } from "../lib/orderVm";
import StepDocLink from "./StepDocLink";
import type { DispatchOrder } from "../types";

/**
 * THE SHEET, ON SCREEN.
 *
 * The source spreadsheet's whole structure is a Planned Date / Actual Date /
 * Status / Remarks quartet per step, and that is exactly what this renders — one
 * row per workflow step, so anyone can see where an order is and which step ran
 * late, without opening anything.
 *
 * It shares `lib/orderVm.ts` with the Order Register export, so the screen and the
 * .xlsx can never disagree about whether a step was late.
 */
function LateChip({ row }: { row: StepRow }) {
  if (row.overdue) {
    return (
      <span className="ml-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide bg-[#FDECEC] text-ryg-red rounded-full px-1.5 py-0.5 align-middle">
        Overdue
      </span>
    );
  }
  if (row.lateDays !== null && row.lateDays > 0) {
    return (
      <span className="ml-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide bg-[#FFF7E6] text-yellow rounded-full px-1.5 py-0.5 align-middle">
        {row.lateDays}d late
      </span>
    );
  }
  return null;
}

const STATE_DOT: Record<StepRow["state"], string> = {
  done: "bg-ryg-green",
  current: "bg-orange",
  pending: "bg-line",
};

export default function PlannedVsActualTable({ order }: { order: DispatchOrder }) {
  const s = useDispatchStore();
  const rows = orderStepRows(order, { snap: s.snapshot, ownerNamesFor: s.ownerNamesFor });

  return (
    <section className="space-y-2.5">
      <SectionHeading>Progress</SectionHeading>
      <ScrollableTable>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-grey-2 border-b border-line">
              <th className="py-2 pr-3 font-semibold w-10">#</th>
              <th className="py-2 pr-3 font-semibold min-w-[190px]">Step</th>
              <th className="py-2 pr-3 font-semibold min-w-[150px]">Owner</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Planned</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Actual</th>
              <th className="py-2 pr-3 font-semibold min-w-[140px]">Status</th>
              <th className="py-2 pr-3 font-semibold min-w-[180px]">Remarks</th>
              <th className="py-2 pr-3 font-semibold min-w-[140px]">Document</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stepKey} className="border-b border-line/70 last:border-0 align-top">
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[r.state]}`} />
                    <span className="text-grey-2">{r.index}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  <span className={r.state === "current" ? "font-semibold text-navy" : "text-navy"}>{r.title}</span>
                </td>
                <td className="py-2.5 pr-3 text-grey-2">
                  {r.ownerNames.length ? r.ownerNames.join(", ") : "—"}
                </td>
                <td className="py-2.5 pr-3 whitespace-nowrap text-grey">{plannedText(r)}</td>
                <td className="py-2.5 pr-3 whitespace-nowrap">
                  <span className={r.state === "done" ? "text-navy" : "text-grey-2"}>{actualText(r)}</span>
                  <LateChip row={r} />
                </td>
                <td className="py-2.5 pr-3 text-grey">{r.statusLabel}</td>
                <td className="py-2.5 pr-3 text-grey-2 whitespace-pre-wrap">{r.remarks || "—"}</td>
                <td className="py-2.5 pr-3">
                  {r.doc ? <StepDocLink path={r.doc.path} name={r.doc.name} /> : <span className="text-grey-2">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
