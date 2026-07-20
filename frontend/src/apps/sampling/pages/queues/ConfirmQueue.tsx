import type { QueueColumn } from "@/shared/components/ui/QueueTable";
import RequestQueue from "../../components/RequestQueue";
import ConfirmModal from "../../components/ConfirmModal";
import { dmy } from "../../lib/format";
import type { StageEntry } from "../../lib/queues";
import type { SamplingRequest } from "../../types";

const capturedColumn: QueueColumn<StageEntry<SamplingRequest>> = {
  key: "partyReceivedOn",
  header: "Party Received On",
  cell: (e) => <span className="text-navy">{dmy(e.row.partyReceivedDate)}</span>,
  sortValue: (e) => e.row.partyReceivedDate ?? "",
  filter: { kind: "date", get: (e) => e.row.partyReceivedDate ?? "" },
  tdClassName: "whitespace-nowrap",
};

export default function ConfirmQueue() {
  return (
    <RequestQueue
      stepKey="confirm_receipt"
      title="Receipt Confirmed"
      description="Outward samples that were dispatched and now await the party's receipt confirmation."
      actionLabel="Confirm receipt"
      StageModal={ConfirmModal}
      capturedColumn={capturedColumn}
      completedBlurb="Confirmations you record will appear here, and stay revisable until testing is recorded."
    />
  );
}
