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
   * Sets this row apart from the ones above it:
   *   `rule`  — a hairline above: a total.
   *   `quiet` — smaller and greyer: a band that is NOT in the headline.
   *   `sep`   — not a row at all, but a captioned divider introducing the quiet
   *             block. Without it a reader has to infer from the type size
   *             alone that the greyed lines are excluded, which is asking a lot
   *             of a colour difference.
   */
  tone?: "rule" | "quiet" | "sep";
  /** Makes the row a link — used to send a reader to the entry screen. */
  href?: string;
  /** Makes the row open the detail behind it. Ignored when `href` is set. */
  onSelect?: () => void;
  /** What the click does, for a screen reader and for the hover tooltip. */
  action?: string;
}

/**
 * A titled block of label/value facts with an optional headline figure.
 *
 * Deliberately NOT a QueueTable. The project rule that every grid sorts and
 * filters on every column is about tables of ROWS someone needs to search; a
 * five-line total block is a readout, and hanging five filter popovers off it
 * would make the summary taller than the detail it summarises.
 */
/** A row does something when it carries a handler or a link. */
const interactive = (f: Fact): boolean => Boolean(f.onSelect || f.href);

export default function FactCard({
  title, headline, headlineNote, facts, footer, className, loading, onRow,
}: {
  title: string;
  headline?: ReactNode;
  headlineNote?: string;
  facts: Fact[];
  footer?: ReactNode;
  className?: string;
  /** Draws the card's shape in grey while the figures are still being fetched. */
  loading?: boolean;
  onRow?: (f: Fact) => void;
}) {
  return (
    <Card className={cn("flex flex-col p-0", className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-navy">{title}</h2>
        {/* ⚠ NO FIGURE WHILE LOADING. The card's own state starts at zero, so a
            headline rendered during the fetch says "₹0.00 L" — which is not a
            placeholder, it is a wrong answer that a reader can glance at and
            believe. A grey bar cannot be misread. */}
        {loading ? (
          <div className="h-6 w-24 animate-pulse rounded bg-line" aria-hidden />
        ) : headline != null ? (
          <div className="text-right">
            <div className="text-[16px] font-semibold tabular-nums text-navy">{headline}</div>
            {headlineNote && <div className="text-[10.5px] text-grey-2">{headlineNote}</div>}
          </div>
        ) : null}
      </div>

      <div className="px-4 py-1.5">
        {loading ? (
          <SkeletonRows n={4} />
        ) : facts.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-grey-2">Nothing today.</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <tbody>
              {facts.map((f) =>
                f.tone === "sep" ? (
                  <tr key={f.key}>
                    <td colSpan={2} className="pb-1 pt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-grey-2">
                          {f.label}
                        </span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    </td>
                  </tr>
                ) : (
                <tr
                  key={f.key}
                  // ⚠ CLICKABILITY IS SIGNALLED THREE WAYS AT ONCE — cursor, a
                  //   hover tint across the whole row, and a chevron that only
                  //   appears on hover. One signal alone is not enough on a
                  //   dense readout: an underline would read as a link in a
                  //   column of figures, and a permanent chevron on every row
                  //   would be visual noise on a card meant to be glanced at.
                  className={cn(
                    f.tone === "rule" && "border-t border-line",
                    interactive(f) && "group cursor-pointer transition-colors hover:bg-page",
                  )}
                  onClick={interactive(f) ? () => onRow?.(f) : undefined}
                  title={f.action}
                >
                  {/* ⚠ A QUIET ROW IS SET SMALLER AS WELL AS GREYER.
                      Colour alone was not enough: "Bank transfer 89.34" sat
                      beside "Supplier 35.33" at the same size, and the larger
                      number won the eye even though it is the one NOT in the
                      headline. Size is what says which figures the card is
                      actually quoting. */}
                  <td className={cn("py-1.5 pr-2 align-top", f.tone === "quiet" && "text-[11.5px] text-grey-2")}>
                    <span className={cn(f.tone === "rule" && "font-semibold text-navy",
                      interactive(f) && "group-hover:text-orange")}>{f.label}</span>
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
                    {interactive(f) && (
                      <span className="ml-1.5 inline-block w-2 text-orange opacity-0 transition-opacity group-hover:opacity-100">›</span>
                    )}
                  </td>
                </tr>
                ),
              )}
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

/**
 * The shape of the answer, drawn in grey, while the answer is being fetched.
 *
 * ⚠ A BLANK SCREEN IS NOT A LOADING STATE. The ConnectWave fan-out is five
 *   parallel round trips and takes a few seconds; for all of it the page showed
 *   nothing at all, and a reader cannot tell that from a page that has finished
 *   and found nothing. Drawing the layout first also stops everything jumping
 *   when the figures land.
 */
function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-2 py-2" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          {/* Staggered widths, so it reads as a list of different things rather
              than as a broken grid of identical bars. */}
          <div className="h-3 animate-pulse rounded bg-line" style={{ width: `${52 - i * 7}%` }} />
          <div className="h-3 w-14 animate-pulse rounded bg-line" />
        </div>
      ))}
    </div>
  );
}

/** The KPI strip's own skeleton — same five tiles, same heights, no figures. */
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-white p-4 shadow-soft">
          <div className="h-2.5 w-20 animate-pulse rounded bg-line" />
          <div className="mt-3 h-6 w-24 animate-pulse rounded bg-line" />
          <div className="mt-3 h-2 w-28 animate-pulse rounded bg-line" />
        </div>
      ))}
    </div>
  );
}

/** Said out loud, so the wait is explained rather than merely animated. */
export function LoadingNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-grey">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-orange" />
      {children}
    </p>
  );
}
