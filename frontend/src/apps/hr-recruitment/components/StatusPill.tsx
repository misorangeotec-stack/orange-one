import { REQ_STATUS_CLASS, REQ_STATUS_LABEL } from "../lib/format";
import type { RequisitionStatus } from "../types";

/**
 * The requisition's status, as a colour-coded chip.
 *
 * `title` is how a list explains a stopped requisition without a detail page: pass
 * `stateNoteText(r, s.personName)` and the reason, the person and the date appear on hover.
 * Optional, because most call sites show a status nobody needs explained.
 */
export default function StatusPill({ status, title }: { status: RequisitionStatus; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${REQ_STATUS_CLASS[status]}`}
    >
      {REQ_STATUS_LABEL[status]}
    </span>
  );
}
