import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import HandoverModal from "../../components/HandoverModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "handover",
  header: "Handed over",
  cell: (e) => <span className="text-navy">{e.row.handoverDate ? dmy(e.row.handoverDate) : "—"}</span>,
  sortValue: (e) => e.row.handoverDate ?? "",
  filter: { kind: "text", get: (e) => e.row.handoverNote ?? "" },
};

export default function HandoverQueue() {
  return (
    <RequestQueue
      stepKey="result_handover"
      title="Result Handover"
      description="Requests whose result is recorded and awaiting the report/handover to be given, which closes the request."
      actionLabel="Record handover"
      StageModal={HandoverModal}
      capturedColumn={capturedColumn}
      completedBlurb="Handovers you record will appear here. A closed request's handover stays correctable — it is the last step, so nothing downstream depends on it."
    />
  );
}
