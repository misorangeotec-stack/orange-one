import StageQueue from "../../components/StageQueue";

/** Thin route wrapper — every stage screen renders through the one StageQueue. */
export default function DispatchConfirmQueue() {
  return <StageQueue stepKey="dispatch_confirm" />;
}
