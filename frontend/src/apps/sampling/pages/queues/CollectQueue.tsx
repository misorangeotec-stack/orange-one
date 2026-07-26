import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import CollectModal from "../../components/CollectModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "collectedOn",
  header: "Collected On",
  cell: (e) => <span className="text-navy">{dmy(e.row.collectedDate)}</span>,
  sortValue: (e) => e.row.collectedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.collectedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function CollectQueue() {
  return (
    <RequestQueue
      stepKey="sample_collect"
      title="Sample Collect & Handover"
      description="Inward samples (no lab testing) awaiting collection and handover."
      actionLabel="Record collection"
      StageModal={CollectModal}
      capturedColumn={capturedColumn}
      completedBlurb="Collections you record will appear here, and stay revisable until the sample is received."
    />
  );
}
