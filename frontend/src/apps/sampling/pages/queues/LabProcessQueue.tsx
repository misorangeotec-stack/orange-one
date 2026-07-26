import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue, { type Row } from "../../components/RequestQueue";
import LabProcessModal from "../../components/LabProcessModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

/**
 * The pending side of a TWO-PASS step. Both passes share one status, so without
 * this column a sample the lab has acknowledged and one it has not look identical.
 */
const pendingColumn: QueueColumn<Row> = {
  key: "labStage",
  header: "At lab",
  cell: ({ request: r }) =>
    r.labStartedAt ? (
      <span className="text-navy">
        Yes<span className="text-grey-2"> · result due {dmy(r.labTentativeDate)}</span>
      </span>
    ) : (
      <span className="text-grey-2">Not acknowledged yet</span>
    ),
  sortValue: ({ request }) => (request.labStartedAt ? "1" : "0"),
  filter: { kind: "select", get: ({ request }) => (request.labStartedAt ? "At lab" : "Not acknowledged yet") },
  tdClassName: "whitespace-nowrap",
};

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "labResult",
  header: "Completed · handed to",
  cell: (e) => (
    <span className="text-navy">
      {dmy(e.row.labCompletedDate)}
      <span className="text-grey-2"> · {e.row.labResultToName ?? "—"}</span>
    </span>
  ),
  sortValue: (e) => e.row.labCompletedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.labCompletedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function LabProcessQueue() {
  return (
    <RequestQueue
      stepKey="lab_process"
      title="Lab Process"
      description="Samples with the lab — record the tentative result date, then the result once testing is done."
      actionLabel="Open lab process"
      pendingActionLabel={(r) => (r.labStartedAt ? "Record result" : "Record tentative date")}
      pendingColumn={pendingColumn}
      StageModal={LabProcessModal}
      capturedColumn={capturedColumn}
      completedBlurb="Completed lab processes appear here, and stay revisable until the result is confirmed received."
    />
  );
}
