import { STATUS_LABEL, STATUS_TONE } from "../lib/format";
import type { ProductionStatus } from "../types";

export default function StatusPill({ status }: { status: ProductionStatus }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
