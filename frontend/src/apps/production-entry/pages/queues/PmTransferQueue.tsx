import StageQueue from "../../components/StageQueue";
export default function PmTransferQueue() {
  // PM Transfer is a pure review-and-confirm step (packaging is carried from the
  // log book; there are no editable fields), so a completed entry is View-only.
  return <StageQueue stepKey="pm_transfer" viewOnlyWhenDone />;
}
