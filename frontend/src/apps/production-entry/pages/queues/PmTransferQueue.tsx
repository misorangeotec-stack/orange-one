import StageQueue from "../../components/StageQueue";

export default function PmTransferQueue() {
  return (
    <StageQueue
      stepKey="pm_transfer"
      /*
        On a PRODUCTION card this is a pure review-and-confirm step — the packaging
        is carried from the log book and nothing here was typed — so a completed
        entry is View-only.

        A REPACKAGING card is different: it skips Production Entry, so this is
        where its production-entry Tally no. is entered, and a typed number has to
        be correctable. It stays editable until the packing entry is recorded,
        which is the same window every other step's edit uses.
      */
      viewOnlyWhenDone={(r) => r.cardType !== "repackaging"}
    />
  );
}
