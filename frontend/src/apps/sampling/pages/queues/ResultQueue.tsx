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
      title="Result"
      description="Tested samples awaiting the result to be recorded, which closes the request."
      actionLabel="Record result"
      StageModal={ResultModal}
      capturedColumn={capturedColumn}
      completedBlurb="Results you record will appear here. A closed request's result stays correctable — it is the last step, so nothing downstream depends on it."
    />
  );
}
