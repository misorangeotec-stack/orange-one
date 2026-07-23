import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import SampleReceivedModal from "../../components/SampleReceivedModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "receivedOn",
  header: "Received On",
  cell: (e) => <span className="text-navy">{dmy(e.row.sampleReceivedDate)}</span>,
  sortValue: (e) => e.row.sampleReceivedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.sampleReceivedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function SampleReceivedQueue() {
  return (
    <RequestQueue
      stepKey="sample_received"
      title="Sample Received (Handover)"
      description="Handed-over samples awaiting the recipient to confirm receipt."
      actionLabel="Confirm received"
      StageModal={SampleReceivedModal}
      capturedColumn={capturedColumn}
      completedBlurb="Receipts you confirm will appear here, and stay revisable after the request closes."
    />
  );
}
