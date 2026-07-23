import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import DueChip from "./DueChip";
import type { AttentionRow } from "@/shared/lib/fmsDashboard";

/**
 * The overdue open work-items, most-overdue first — a compact list, not the full
 * filterable table (that heavy widget stays on the coordinator board). Zero-state
 * is a GREEN "all caught up", so an empty backlog reads as success, not emptiness.
 *
 * `actionHref` + `showAction` render a coordinator-only "Open Control Center →"
 * link (the monitoring route is gated, so a plain link would drop a regular user
 * on Access Denied). The value column auto-hides when no row carries a value
 * (no-money FMS).
 */
export default function NeedsAttentionCard({
  rows,
  todayIso,
  actionHref,
  showAction,
}: {
  rows: AttentionRow[];
  todayIso: string;
  actionHref?: string;
  showAction?: boolean;
}) {
  const hasValue = rows.some((r) => r.value !== null);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>Needs attention</h3>
        {showAction && actionHref && (
          <Link to={actionHref} className="text-[12px] font-semibold text-orange hover:underline">
            Open Control Center →
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ryg-green py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-ryg-green" />
          Nothing overdue — all caught up.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-2">
              <Link to={r.href} className="font-semibold text-orange hover:underline whitespace-nowrap">
                {r.ref}
              </Link>
              <span className="min-w-0 flex-1 truncate text-[13px] text-grey" title={r.detail}>
                {r.detail}
              </span>
              <span className="text-[12px] text-grey-2 whitespace-nowrap">{r.stageShort}</span>
              <span className="whitespace-nowrap text-[12.5px]">
                <DueChip dueIso={r.dueIso} todayIso={todayIso} />
              </span>
              {hasValue && (
                <span className="w-24 text-right text-[13px] font-semibold text-navy tabular-nums">
                  {r.value ?? "—"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
