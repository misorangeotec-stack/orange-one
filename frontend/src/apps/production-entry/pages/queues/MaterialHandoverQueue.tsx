import StageQueue from "../../components/StageQueue";
import { useProductionStore } from "../../store";
import { buildIssueSlipExport } from "../../lib/issueSlipVm";
import { printIssueSlip } from "../../lib/printIssueSlip";

export default function MaterialHandoverQueue() {
  const s = useProductionStore();
  // After handover is recorded, the issue slip prints WITH the issued lot numbers
  // (pulled from the handover) in the Raw Material Batch Number column.
  return (
    <StageQueue
      stepKey="material_handover"
      rowPrint={(r) =>
        printIssueSlip(
          buildIssueSlipExport(r, {
            fgItemName: (id) => s.fgItemById(id)?.name ?? "",
            rawMaterialName: (id) => s.rawMaterialById(id)?.name ?? "",
          }),
        )
      }
    />
  );
}
