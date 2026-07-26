import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import TestingModal from "../../components/TestingModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "testingDone",
  header: "Testing Done",
  cell: (e) => (
    <span className="text-navy">
      {dmy(e.row.testingCompletedDate)}
      {e.row.internalRef ? <span className="text-grey-2"> · {e.row.internalRef}</span> : null}
    </span>
  ),
  sortValue: (e) => e.row.testingCompletedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.testingCompletedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function TestingQueue() {
  return (
    <RequestQueue
      stepKey="testing"
      title="Testing"
      description="Samples received or confirmed, ready to be tested."
      actionLabel="Record testing"
      StageModal={TestingModal}
      capturedColumn={capturedColumn}
      completedBlurb="Testing you record will appear here, and stays revisable until the result is recorded."
    />
  );
}
