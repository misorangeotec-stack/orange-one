import StageQueue from "../../components/StageQueue";

/** Thin route wrapper — every stage screen renders through the one StageQueue. */
export default function MaterialStatusQueue() {
  return <StageQueue stepKey="material_status" />;
}
