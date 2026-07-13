import { REQ_STATUS_CLASS, REQ_STATUS_LABEL } from "../lib/format";
import type { RequisitionStatus } from "../types";

/** The requisition's status, as a colour-coded chip. */
export default function StatusPill({ status }: { status: RequisitionStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${REQ_STATUS_CLASS[status]}`}
    >
      {REQ_STATUS_LABEL[status]}
    </span>
  );
}
