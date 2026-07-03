import { formatDate } from "@/shared/lib/time";
import { dueInfo } from "../lib/sla";

/**
 * Renders an entry's target due date with an overdue / due-today chip. `step`
 * is the workflow step key the entry is currently sitting in (drives the SLA).
 */
export default function DueCell({ createdAt, step }: { createdAt: string; step: string }) {
  const { due, days, overdue, dueToday } = dueInfo(createdAt, step);
  return (
    <span className={overdue ? "text-ryg-red font-semibold" : dueToday ? "text-yellow font-medium" : "text-grey"}>
      {formatDate(due.toISOString())}
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
export const overdueRowClass = (createdAt: string, step: string): string =>
  dueInfo(createdAt, step).overdue ? "bg-[#FDECEC]/40" : "";
