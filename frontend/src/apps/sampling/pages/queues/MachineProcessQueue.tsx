import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue, { type Row } from "../../components/RequestQueue";
import MachineProcessModal from "../../components/MachineProcessModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

/**
 * The pending side of a TWO-PASS step — the twin of LabProcessQueue's. Both
 * passes share one status, so without this column a sample machine testing has
 * acknowledged and one it has not look identical.
 */
const pendingColumn: QueueColumn<Row> = {
  key: "machineStage",
  header: "In testing",
  cell: ({ request: r }) =>
    r.machineStartedAt ? (
      <span className="text-navy">
        Yes<span className="text-grey-2"> · result due {dmy(r.machineTentativeDate)}</span>
      </span>
    ) : (
      <span className="text-grey-2">Not acknowledged yet</span>
    ),
  sortValue: ({ request }) => (request.machineStartedAt ? "1" : "0"),
  filter: { kind: "select", get: ({ request }) => (request.machineStartedAt ? "In testing" : "Not acknowledged yet") },
  tdClassName: "whitespace-nowrap",
};

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "machineResult",
  header: "Completed · handed to",
  cell: (e) => (
    <span className="text-navy">
      {dmy(e.row.machineCompletedDate)}
      <span className="text-grey-2"> · {e.row.machineResultToName ?? "—"}</span>
    </span>
  ),
  sortValue: (e) => e.row.machineCompletedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.machineCompletedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function MachineProcessQueue() {
  return (
    <RequestQueue
      stepKey="machine_process"
      title="Machine Testing Process"
      description="Samples with machine testing — record the tentative result date, then the result once testing is done."
      actionLabel="Open machine testing"
      pendingActionLabel={(r) => (r.machineStartedAt ? "Record result" : "Record tentative date")}
      pendingColumn={pendingColumn}
      StageModal={MachineProcessModal}
      capturedColumn={capturedColumn}
      completedBlurb="Completed machine testing appears here, and stays revisable until the result is confirmed received."
    />
  );
}
