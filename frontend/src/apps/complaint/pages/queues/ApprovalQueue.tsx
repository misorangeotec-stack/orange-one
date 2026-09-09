import StepQueue from "../../components/StepQueue";

/** Thin: every queue is the same screen with a different step key. */
export default function ApprovalQueue() {
  return <StepQueue step="approval" />;
}
