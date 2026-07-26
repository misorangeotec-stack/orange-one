import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import ResultReceivedModal from "../../components/ResultReceivedModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "receivedOn",
  header: "Received On",
  cell: (e) => <span className="text-navy">{dmy(e.row.resultReceivedDate)}</span>,
  sortValue: (e) => e.row.resultReceivedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.resultReceivedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function ResultReceivedQueue() {
  return (
    <RequestQueue
      stepKey="result_received"
      title="Result Received"
      description="Lab results waiting to be confirmed received. Confirming closes the request."
      actionLabel="Confirm received"
      StageModal={ResultReceivedModal}
      capturedColumn={capturedColumn}
      completedBlurb="Results you confirm appear here, and stay revisable after the request closes."
    />
  );
}
