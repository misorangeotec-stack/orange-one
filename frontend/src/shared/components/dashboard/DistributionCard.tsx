import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import ProportionBar from "./ProportionBar";
import type { DistRow } from "@/shared/lib/fmsDashboard";

/**
 * A card of proportion bars — e.g. entities by stage, or requests by status.
 * Counts every live entity (not just due work), so it stays populated even when
 * the open queue is empty. Degrades to a muted `emptyLabel` row, never blank.
 *
 * `hrefFor` (optional) turns each row into a link — e.g. a status bar that opens
 * the job-card list pre-filtered to that status. Rows whose `hrefFor` returns
 * undefined stay non-interactive.
 */
export default function DistributionCard({
  title,
  rows,
  emptyLabel,
  hrefFor,
}: {
  title: string;
  rows: DistRow[];
  emptyLabel: string;
  hrefFor?: (row: DistRow) => string | undefined;
}) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>{title}</h3>
        <span className="text-[12px] text-grey tabular-nums">{total} total</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-grey-2 py-2">{emptyLabel}</p>
      ) : (
        <div className="space-y-1 pt-1">
          {rows.map((r) => {
            const href = hrefFor?.(r);
            const bar = <ProportionBar label={r.label} count={r.count} max={max} badgeCls={r.badgeCls} />;
            return href ? (
              <Link
                key={r.key}
                to={href}
                className="block rounded-lg -mx-1.5 px-1.5 py-1 hover:bg-page/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/30"
              >
                {bar}
              </Link>
            ) : (
              <div key={r.key} className="py-1">
                {bar}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
