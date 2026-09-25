import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE, type Tone } from "../lib/format";
import type { Priority, RequestStatus } from "../types";

const TONE_CLASS: Record<Tone, string> = {
  grey: "bg-[#F1F4F9] text-grey-2",
  blue: "bg-[#EAF1FE] text-blue",
  orange: "bg-[#FFF1E8] text-orange",
  green: "bg-[#E8F7EE] text-ryg-green",
  red: "bg-[#FDECEC] text-ryg-red",
  yellow: "bg-[#FFF7E6] text-yellow",
};

const pill = "inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap";

/** A training request's workflow status, as a pill. */
export default function StatusPill({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span className={`${pill} ${TONE_CLASS[STATUS_TONE[status]]} ${className ?? ""}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Priority, as a pill.
 *
 * ⚠ RENDERS NOTHING WHEN PRIORITY IS NULL, rather than a "—" chip. Priority is set
 *   at the PROPOSAL step, so every request before that legitimately has none, and a
 *   grey "Not set" badge on a brand-new request reads as a missing field somebody
 *   forgot rather than a step that has not happened yet.
 */
export function PriorityPill({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  return <span className={`${pill} ${TONE_CLASS[PRIORITY_TONE[priority]]}`}>{PRIORITY_LABEL[priority]}</span>;
}
