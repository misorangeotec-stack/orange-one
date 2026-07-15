import RequestQueue from "../../components/RequestQueue";

export default function HandoverQueue() {
  return (
    <RequestQueue
      stepKey="handover"
      mode="handover"
      title="Handover"
      description="Approved requests, and everything that skipped approvals, ready for final confirmation and delivery."
      actionLabel="Handover"
    />
  );
}
