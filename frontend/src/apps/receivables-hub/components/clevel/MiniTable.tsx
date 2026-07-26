import type { ReactNode } from "react";
import { cn } from "@hub/lib/utils";

/**
 * Dense top-N table (Top Customers / Suppliers / Bank / Loans / Stock groups). Pure body —
 * wrap in a WidgetCard. For the larger searchable/paginated Duties & Taxes table the page uses
 * the shared usePagination + Pagination instead.
 */
export interface MiniColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  className?: string;
}

export interface MiniTableProps<T> {
  columns: MiniColumn<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  maxRows?: number;
  totalRow?: ReactNode;
  emptyMessage?: string;
}

export default function MiniTable<T>({
  columns,
  rows,
  rowKey,
  maxRows = 10,
  totalRow,
  emptyMessage = "No rows",
}: MiniTableProps<T>) {
  const shown = rows.slice(0, maxRows);
  if (shown.length === 0) return <div className="py-6 text-center text-xs text-muted-foreground">{emptyMessage}</div>;
  return (
    <div className="overflow-x-auto -m-1 p-1">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border/70 text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn("py-1 font-medium text-[11px] uppercase tracking-wide", c.align === "right" ? "text-right" : "text-left")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
              {columns.map((c) => (
                <td key={c.key} className={cn("py-1 tabular-nums", c.align === "right" ? "text-right" : "text-left", c.className)}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
          {totalRow}
        </tbody>
      </table>
    </div>
  );
}
