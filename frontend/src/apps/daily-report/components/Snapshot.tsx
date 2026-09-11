import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";

/**
 * The compact half of the Daily Report.
 *
 * WHY THIS EXISTS. The first cut stacked ten full grids under the KPI strip —
 * every one with its own filter row, row counter, export button and pagination.
 * On 08-09-2026 that is about nine screens of scrolling to learn five things,
 * and it buried the answer under the machinery for finding it. The sheet this
 * report replaces fits the whole day on one side of A4.
 *
 * So the page now opens on AGGREGATES: what sold by product line, what came in
 * and went out by counterparty, where the bank stands. Nothing here is a table
 * of rows a reader would want to sort or filter — these are totals, the same
 * category as a KPI tile. The row-level detail keeps its full grids, with sort,
 * cascading filters and export intact, one click away behind "Show the detail".
 */

export interface Fact {
  key: string;
  label: string;
  /** Right-hand figure. A ReactNode so a cell can say FOC, or print a dash. */
  value: ReactNode;
  /** Quiet second line under the label — a quantity, a count, a caveat. */
  sub?: string;
  /**
   * Sets this row apart from the ones above it: `rule` draws a hairline over it
   * (a total), `quiet` greys it (a band that is NOT in the headline).
   */
  tone?: "rule" | "quiet";
  /** Makes the row a link — used to send a reader to the entry screen. */
  href?: string;
}

/**
 * A titled block of label/value facts with an optional headline figure.
 *
 * Deliberately NOT a QueueTable. The project rule that every grid sorts and
 * filters on every column is about tables of ROWS someone needs to search; a
 * five-line total block is a readout, and hanging five filter popovers off it
 * would make the summary taller than the detail it summarises.
 */
export default function FactCard({
  title, headline, headlineNote, facts, footer, className,
}: {
  title: string;
  headline?: ReactNode;
  headlineNote?: string;
  facts: Fact[];
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col p-0", className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-navy">{title}</h2>
        {headline != null && (
          <div className="text-right">
            <div className="text-[16px] font-semibold tabular-nums text-navy">{headline}</div>
            {headlineNote && <div className="text-[10.5px] text-grey-2">{headlineNote}</div>}
          </div>
        )}
      </div>

      <div className="px-4 py-1.5">
        {facts.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-grey-2">Nothing today.</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <tbody>
              {facts.map((f) => (
                <tr
                  key={f.key}
                  className={cn(f.tone === "rule" && "border-t border-line")}
                >
                  {/* ⚠ A QUIET ROW IS SET SMALLER AS WELL AS GREYER.
                      Colour alone was not enough: "Bank transfer 89.34" sat
                      beside "Supplier 35.33" at the same size, and the larger
                      number won the eye even though it is the one NOT in the
                      headline. Size is what says which figures the card is
                      actually quoting. */}
                  <td className={cn("py-1.5 pr-2 align-top", f.tone === "quiet" && "text-[11.5px] text-grey-2")}>
                    <span className={cn(f.tone === "rule" && "font-semibold text-navy")}>{f.label}</span>
                    {f.sub && <span className="ml-2 text-[11px] text-grey-2">{f.sub}</span>}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 text-right align-top tabular-nums",
                      f.tone === "rule" && "font-semibold text-navy",
                      f.tone === "quiet" && "text-[11.5px] text-grey-2",
                    )}
                  >
                    {f.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {footer && <div className="mt-auto border-t border-line px-4 py-2 text-[11.5px] text-grey">{footer}</div>}
    </Card>
  );
}

/**
 * The toggle that reveals the row-level grids.
 *
 * Collapsed by DEFAULT, and that is the whole point of the redesign: the page
 * answers the five questions a CFO opens it for before it offers the means to
 * interrogate them. It says how much is behind it, so the click is informed
 * rather than exploratory.
 */
export function DetailToggle({
  open, onToggle, summary,
}: {
  open: boolean;
  onToggle: () => void;
  summary: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-xl border border-line bg-white px-4 py-3 text-left shadow-soft transition hover:border-orange/40"
    >
      <span>
        <span className="text-[13px] font-semibold text-navy">
          {open ? "Hide the detail" : "Show the detail"}
        </span>
        <span className="ml-2 text-[12px] text-grey">{summary}</span>
      </span>
      <span className={cn("text-[13px] text-orange transition-transform", open && "rotate-90")}>›</span>
    </button>
  );
}
