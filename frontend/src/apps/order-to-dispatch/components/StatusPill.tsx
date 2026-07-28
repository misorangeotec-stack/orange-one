import { STATUS_LABEL, STATUS_TONE, type Tone } from "../lib/format";
import type { DispatchStatus } from "../types";

const TONE_CLASS: Record<Tone, string> = {
  grey: "bg-[#F1F4F9] text-grey-2",
  blue: "bg-[#EAF1FE] text-blue",
  orange: "bg-[#FFF1E8] text-orange",
  green: "bg-[#E8F7EE] text-ryg-green",
  red: "bg-[#FDECEC] text-ryg-red",
  yellow: "bg-[#FFF7E6] text-yellow",
};

/** The order's workflow status, as a pill. One place decides the words and colour. */
export default function StatusPill({ status, className }: { status: DispatchStatus; className?: string }) {
  return (
    <span
      className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${
        TONE_CLASS[STATUS_TONE[status]]
      } ${className ?? ""}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A generic chip for the per-step outcome values (credit / material / delivery). */
export function OutcomePill({ label, tone = "grey" }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {label}
    </span>
  );
}
