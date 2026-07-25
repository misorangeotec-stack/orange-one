import StageQueue from "../../components/StageQueue";
import { useProductionStore } from "../../store";
import { buildBatchCardExport, exportBatchCardXlsx, printBatchCard } from "../../lib/batchCard";

export default function TransferSlipQueue() {
  const s = useProductionStore();
  // Once the log book is recorded, each completed row can export/print the Batch
  // Card (the MCT-style job batch card). This lives on the grid, not the modal.
  const lookups = {
    fgItemName: (id: string | null) => s.fgItemById(id)?.name ?? "",
    rawMaterialName: (id: string | null) => s.rawMaterialById(id)?.name ?? "",
    packagingItemName: (id: string | null) => s.packagingItemById(id)?.name ?? "",
  };
  return (
    <StageQueue
      stepKey="transfer_slip"
      rowExcel={(r) => exportBatchCardXlsx(buildBatchCardExport(r, lookups))}
      rowPrint={(r) => printBatchCard(buildBatchCardExport(r, lookups))}
    />
  );
}
