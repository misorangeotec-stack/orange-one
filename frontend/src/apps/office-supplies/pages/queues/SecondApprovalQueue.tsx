import RequestQueue from "../../components/RequestQueue";

export default function SecondApprovalQueue() {
  return (
    <RequestQueue
      stepKey="second_approval"
      mode="second"
      title="Second Approval"
      description="Requests that passed the HOD and now need the Management (second) approval."
      actionLabel="Review"
    />
  );
}
