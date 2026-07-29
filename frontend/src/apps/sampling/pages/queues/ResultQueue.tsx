import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import ResultModal from "../../components/ResultModal";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "result",
  header: "Result",
  cell: (e) => <span className="text-navy line-clamp-2">{e.row.resultComment ?? "—"}</span>,
  sortValue: (e) => e.row.resultComment ?? "",
  filter: { kind: "text", get: (e) => e.row.resultComment ?? "" },
};

export default function ResultQueue() {
  return (
    <RequestQueue
      stepKey="result"
      title="Result Received"
      description="Outward samples the party has confirmed receiving, awaiting the result they came back with."
      actionLabel="Record result received"
      StageModal={ResultModal}
      capturedColumn={capturedColumn}
      completedBlurb="Results you record will appear here. A result stays correctable until its handover is recorded."
    />
  );
}
