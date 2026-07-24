import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import SampleToLabModal from "../../components/SampleToLabModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "internalRef",
  header: "Internal ref · sent",
  cell: (e) => (
    <span className="text-navy">
      {e.row.internalRef ?? "—"}
      <span className="text-grey-2"> · {dmy(e.row.labSentDate)}</span>
    </span>
  ),
  sortValue: (e) => e.row.labSentDate ?? "",
  filter: { kind: "text", get: (e) => e.row.internalRef ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function SampleToLabQueue() {
  return (
    <RequestQueue
      stepKey="sample_to_lab"
      title="Sample Received & Sent to Lab"
      description="Collected samples that need lab testing — confirm receipt and send them to the lab."
      actionLabel="Confirm & send to lab"
      StageModal={SampleToLabModal}
      capturedColumn={capturedColumn}
      completedBlurb="Samples you send to the lab appear here, and stay revisable until the lab finishes."
    />
  );
}
