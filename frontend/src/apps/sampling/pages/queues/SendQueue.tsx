import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import SendModal from "../../components/SendModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "sentOn",
  header: "Sent On",
  cell: (e) => <span className="text-navy">{dmy(e.row.sentDate)}</span>,
  sortValue: (e) => e.row.sentDate ?? "",
  filter: { kind: "date", get: (e) => e.row.sentDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function SendQueue() {
  return (
    <RequestQueue
      stepKey="send_sample"
      title="Sample Sent"
      description="Outward sampling requests awaiting the sample to be dispatched."
      actionLabel="Record dispatch"
      StageModal={SendModal}
      capturedColumn={capturedColumn}
      completedBlurb="Dispatches you record will appear here, and stay revisable until receipt is confirmed."
    />
  );
}
