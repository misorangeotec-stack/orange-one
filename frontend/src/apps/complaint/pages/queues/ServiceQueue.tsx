import StepQueue from "../../components/StepQueue";

/** Thin: every queue is the same screen with a different step key. */
export default function ServiceQueue() {
  return <StepQueue step="service" />;
}
