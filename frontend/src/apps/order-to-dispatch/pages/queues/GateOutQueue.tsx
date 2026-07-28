import StageQueue from "../../components/StageQueue";

/** Thin route wrapper — every stage screen renders through the one StageQueue. */
export default function GateOutQueue() {
  return <StageQueue stepKey="gate_out" />;
}
