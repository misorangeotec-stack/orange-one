import { CASE_STATUS_CLASS, CASE_STATUS_LABEL } from "../lib/format";
import type { CaseStatus } from "../types";

/** The exit case's status, as a colour-coded chip. A STATUS — never a step. */
export default function StatusPill({ status }: { status: CaseStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CASE_STATUS_CLASS[status]}`}
    >
      {CASE_STATUS_LABEL[status]}
    </span>
  );
}
