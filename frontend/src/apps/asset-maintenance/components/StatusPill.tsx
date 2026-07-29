import { STATUS_LABEL, STATUS_TONE, type Tone } from "../lib/format";
import type { JobStatus } from "../types";

const TONE_CLASS: Record<Tone, string> = {
  grey: "bg-[#EEF1F6] text-grey",
  blue: "bg-[#E8F0FE] text-[#1A56DB]",
  orange: "bg-[#FFF1E6] text-[#C2410C]",
  green: "bg-[#E7F6EC] text-[#087443]",
  red: "bg-[#FDECEC] text-ryg-red",
  yellow: "bg-[#FEF6E0] text-[#946200]",
};

export default function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE_CLASS[STATUS_TONE[status]]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
