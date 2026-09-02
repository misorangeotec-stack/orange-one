import ExportButtons, { type ExportFormat } from "./ExportButtons";
import { useProductionStore } from "../store";
import { downloadCoaPdf } from "../lib/coaPdf";
import { exportCoaXlsx } from "../lib/coaXlsx";
import { printCoa } from "../lib/printCoa";
import type { Coa, CoaAudience } from "../types";

/**
 * The two COA copies, side by side — one row of export actions each.
 *
 * ⚠ TWO ROWS, NOT ONE TOGGLE. Which copy you are downloading is the single most
 *   consequential thing about this control: one goes to a customer and one does
 *   not. A shared toolbar behind an audience switch would let a mis-set toggle
 *   send the internal copy, with its four extra parameters, out of the building.
 *   Two labelled rows cannot be got wrong by forgetting to look.
 *
 * Which FORMATS each row offers comes from Setup → COA. Print is always there:
 * it is the browser dialog, not a generated file.
 */

const AUDIENCES: { audience: CoaAudience; label: string }[] = [
  { audience: "customer", label: "Customer copy" },
  { audience: "internal", label: "Internal copy" },
];

export default function CoaExports({ coa }: { coa: Coa }) {
  const { coaOutput } = useProductionStore();
  const formats: ExportFormat[] =
    coaOutput === "pdf" ? ["pdf", "print"]
    : coaOutput === "excel" ? ["excel", "print"]
    : ["pdf", "excel", "print"];

  return (
    <div className="space-y-2">
      {AUDIENCES.map(({ audience, label }) => (
        <div key={audience} className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] font-semibold text-navy w-28 shrink-0">{label}</span>
          <ExportButtons
            label={`the ${label.toLowerCase()}`}
            formats={formats}
            onDownloadPdf={() => void downloadCoaPdf(coa, audience)}
            onDownloadExcel={() => exportCoaXlsx(coa, audience)}
            onPrint={() => printCoa(coa, audience)}
          />
        </div>
      ))}
    </div>
  );
}
