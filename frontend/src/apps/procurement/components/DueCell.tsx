import { formatDate } from "@/shared/lib/time";
import { dueState } from "../lib/sla";

/**
 * Renders an already-computed due date with an overdue / due-today chip.
 *
 * This component is deliberately dumb: it takes the due date rather than a step,
 * because the due date depends on the admin-configured anchor step + working days
 * (and, for `follow_up`, on the vendor's promised dispatch date instead). Only
 * `lib/queues.ts` knows how to derive it — see `lineDueIso` / `poDueIso`.
 */
export default function DueCell({ dueIso }: { dueIso: string | null }) {
  if (!dueIso) return <span className="text-grey-2">—</span>;
  const { days, overdue, dueToday } = dueState(new Date(dueIso));
  return (
    <span className={overdue ? "text-ryg-red font-semibold" : dueToday ? "text-yellow font-medium" : "text-grey"}>
      {formatDate(dueIso)}
      {overdue && (
        <span className="ml-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide bg-[#FDECEC] text-ryg-red rounded-full px-1.5 py-0.5 align-middle">
          {-days}d overdue
        </span>
      )}
      {dueToday && (
        <span className="ml-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide bg-[#FFF7E6] text-yellow rounded-full px-1.5 py-0.5 align-middle">
          Due today
        </span>
      )}
    </span>
  );
}

/** Row tint for an overdue entry (apply to the <tr>). */
export const overdueRowClass = (dueIso: string | null): string =>
  dueIso && dueState(new Date(dueIso)).overdue ? "bg-[#FDECEC]/40" : "";
