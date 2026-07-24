import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import ReceiveModal from "../../components/ReceiveModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "receivedOn",
  header: "Received On",
  cell: (e) => <span className="text-navy">{dmy(e.row.receivedDate)}</span>,
  sortValue: (e) => e.row.receivedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.receivedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function ReceiveQueue() {
  return (
    <RequestQueue
      stepKey="receive_sample"
      title="Sample Received at Lab"
      description="Inward samples that need lab testing, awaiting receipt at the lab."
      actionLabel="Record receipt"
      StageModal={ReceiveModal}
      capturedColumn={capturedColumn}
      completedBlurb="Receipts you record will appear here, and stay revisable until testing is recorded."
    />
  );
}
