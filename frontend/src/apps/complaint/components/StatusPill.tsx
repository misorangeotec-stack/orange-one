import { STATUS_LABEL, STATUS_TONE } from "../lib/format";
import type { RequestStatus } from "../types";

/**
 * ⚠ A COMPONENT IN A CELL LOSES ITS SORT AND ITS FILTER — `nodeText` cannot walk
 *   an unrendered element. Every column that renders this MUST declare its own
 *   `sortValue` and `filter.get` off STATUS_LABEL.
 */
export default function StatusPill({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
