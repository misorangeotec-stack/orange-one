import StageQueue from "../../components/StageQueue";
import { useProductionStore } from "../../store";
import { buildAisIssueSlipExport } from "../../lib/issueSlipVm";
import { printIssueSlip } from "../../lib/printIssueSlip";

/** QC-rejected job cards awaiting an additional issue slip (top-up raw material). */
export default function AdditionalIssueSlipQueue() {
  const s = useProductionStore();
  const lookups = {
    fgItemName: (id: string | null) => s.fgItemById(id)?.name ?? "",
    rawMaterialName: (id: string | null) => s.rawMaterialById(id)?.name ?? "",
  };
  return (
    <StageQueue
      stepKey="additional_issue_slip"
      // Print the most recent additional issue slip (additional FG qty + only the
      // additional raw materials), same format as the issue slip.
      rowPrint={(r) => {
        const round = r.aisRounds[r.aisRounds.length - 1];
        if (round) printIssueSlip(buildAisIssueSlipExport(r, round, lookups));
      }}
    />
  );
}
