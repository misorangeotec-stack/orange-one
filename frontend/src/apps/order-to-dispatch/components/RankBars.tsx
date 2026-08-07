/**
 * "Who did we ship the most to" — a ranked bar per company or customer.
 *
 * ⚠ NOT `DistributionCard` / `ProportionBar`, and this is not duplication for
 *   its own sake. That pair renders its label as an UPPERCASE PILL in a fixed
 *   150px box and prints exactly ONE number in a 40px column. It is built for a
 *   short, fixed set of statuses — which is what its callers pass it. Here the
 *   label is a company or customer name ("ANGARIKA DIGITEX PRIVATE LIMITED"),
 *   which a 150px pill clips and shouts, and every row has TWO measures to show:
 *   how many consignments and how much of it. Widening the shared pair would
 *   change the four other dashboards that render through it, so the specific
 *   need gets a specific component.
 */
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { qtyLabel, type RankRow } from "../lib/dispatchBoard";

export default function RankBars({
  title,
  rows,
  emptyLabel,
  limit = 10,
}: {
  title: string;
  rows: RankRow[];
  emptyLabel: string;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>{title}</h3>
        <span className="text-[12px] text-grey tabular-nums">{total} total</span>
      </div>

      {shown.length === 0 ? (
        <p className="text-[13px] text-grey-2 py-2">{emptyLabel}</p>
      ) : (
        <div className="space-y-2.5 pt-1">
          {shown.map((r) => (
            <div key={r.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                {/* Truncates rather than wraps: a long customer name must not
                    push every bar in the card out of alignment. */}
                <span className="text-[13px] text-navy truncate" title={r.label}>
                  {r.label}
                </span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums text-navy">
                  {r.count}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-page overflow-hidden">
                  {/* A 4% floor so a single consignment still shows a mark —
                      a bar of zero width reads as no data at all. */}
                  <span
                    className="block h-full rounded-full bg-orange/70"
                    style={{ width: `${max > 0 ? Math.max(4, Math.round((r.count / max) * 100)) : 0}%` }}
                  />
                </div>
                <span className="shrink-0 text-[11.5px] tabular-nums text-grey-2">
                  {qtyLabel(r.qtyByUnit)}
                </span>
              </div>
            </div>
          ))}

          {hidden > 0 && (
            <p className="text-[12px] text-grey-2 pt-0.5">
              +{hidden} more — the full list is in the table below.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
