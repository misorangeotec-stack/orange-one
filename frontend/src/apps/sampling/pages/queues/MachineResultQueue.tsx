import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import MachineResultModal from "../../components/MachineResultModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "receivedOn",
  header: "Received On",
  cell: (e) => <span className="text-navy">{dmy(e.row.machineResultReceivedDate)}</span>,
  sortValue: (e) => e.row.machineResultReceivedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.machineResultReceivedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function MachineResultQueue() {
  return (
    <RequestQueue
      stepKey="machine_result"
      title="Machine Result Received"
      description="Machine testing results waiting to be confirmed received. Confirming closes the request."
      actionLabel="Confirm received"
      StageModal={MachineResultModal}
      capturedColumn={capturedColumn}
      completedBlurb="Results you confirm appear here, and stay revisable after the request closes."
    />
  );
}
