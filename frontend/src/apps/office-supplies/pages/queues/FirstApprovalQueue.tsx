import RequestQueue from "../../components/RequestQueue";

export default function FirstApprovalQueue() {
  return (
    <RequestQueue
      stepKey="first_approval"
      mode="first"
      title="First Approval"
      description="Computer & tech accessory requests raised under your department, awaiting the HOD's approval."
      actionLabel="Review"
    />
  );
}
