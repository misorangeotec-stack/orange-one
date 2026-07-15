import type { ReactNode } from "react";
import Pagination from "@/shared/components/ui/Pagination";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";

/**
 * A read-only roll-up table for the dashboard: 25/page, arrow-key scrolling, and an
 * Excel button — the three standing portal rules, in one place.
 *
 * Distinct from the shared `QueueTable`, which exists for WORK: it groups, filters,
 * sorts and hands you an action per row. A dashboard roll-up has none of that — it is an
 * answer, already sorted, with nothing to do to it. Bending QueueTable into that shape
 * would mean a fake `groupBy` on every panel.
 *
 * (The same component as HR Recruitment's. Kept per-app rather than promoted to
 * `shared/` in this phase: promoting it is a change to HR's dashboard, and a monitoring
 * phase has no business editing a shipped app's screens to save forty lines.)
 */

export interface ReportColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  /** Plain value for Excel. Never a ReactNode — Excel cannot render one. */
  value: (row: T) => string | number;
  width?: number;
}

export default function ReportTable<T>({
  rows,
  rowKey,
  columns,
  rowsLabel = "rows",
  emptyMessage,
  exportName,
  exportTitle,
  exportNotes,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: ReportColumn<T>[];
  rowsLabel?: string;
  emptyMessage: string;
  exportName: string;
  exportTitle: string;
  /** The definitions a reader needs so the spreadsheet cannot be misread later. */
  exportNotes?: string[];
}) {
  const pg = usePagination(rows);

  const exportNow = () =>
    exportRowsToXlsx<T>({
      fileName: exportName,
      sheetName: exportTitle,
      title: exportTitle,
      columns: columns.map((c) => ({ header: c.header, width: c.width ?? 20, value: c.value })) as ExportColumn<T>[],
      rows,
      notes: exportNotes,
    });

  if (rows.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed border-line bg-page/40 px-4 text-center">
        <p className="text-[12.5px] text-grey-2 max-w-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          onClick={exportNow}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 text-[12px] font-semibold text-grey-2 rounded-lg border border-line bg-white hover:text-orange hover:border-orange/50"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Excel
        </button>
      </div>
      <ScrollableTable>
        <table className="w-full text-[13px] border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-grey-2">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`font-semibold text-[11.5px] uppercase tracking-wide px-3 pt-2 pb-2 border-b border-line ${
                    c.align === "right" ? "text-right" : ""
                  }`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-page/60">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2.5 border-b border-line/70 ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      <Pagination state={pg} rowsLabel={rowsLabel} showPageSize={false} />
    </div>
  );
}
