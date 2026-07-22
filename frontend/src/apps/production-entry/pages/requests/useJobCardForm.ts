import { useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { useSession } from "@/core/platform/session";
import { useProductionStore } from "../../store";
import type { RequestInput } from "../../data/productionWrites";

/**
 * The issue-slip (step 1) intake form's state for a new job card. One card
 * produces a single FG item but consumes MANY raw materials — a BOM — so the raw
 * material / qty / unit triple is a repeatable line list (the same LineGrid UX as
 * the procurement RM-purchase form), while FG item + Job Card No. stay single.
 * Job Card No. and FG item are required; each filled BOM line needs a raw
 * material and a quantity > 0 (its unit is optional).
 */

/** One raw-material row of the BOM grid. */
export interface RmLine extends LineGridRow {
  rawMaterialId: string;
  qty: string;
  unitId: string;
}

/** A genuinely empty row — no default qty (LineGrid's "blank means blank"). */
export const makeEmptyRmLine = (): RmLine => ({ uid: newUid(), rawMaterialId: "", qty: "", unitId: "" });

export const isRmLineBlank = (l: RmLine) => !l.rawMaterialId && !l.qty && !l.unitId;

export function useJobCardForm() {
  const s = useProductionStore();
  const session = useSession();

  const [jobcardNo, setJobcardNo] = useState("");
  const [fgItemId, setFgItemId] = useState("");
  const [issueRemarks, setIssueRemarks] = useState("");
  const [lines, setLines] = useState<RmLine[]>([makeEmptyRmLine()]);
  const [err, setErr] = useState<string | null>(null);

  const fgItemOptions: ComboOption[] = s.activeFgItems.map((c) => ({ value: c.id, label: c.name }));
  const unitOptions: ComboOption[] = s.activeUnits.map((c) => ({ value: c.id, label: c.name }));

  /** Raw materials, minus ones another row already picked. */
  const rawMaterialOptionsFor = (line: RmLine): ComboOption[] => {
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.rawMaterialId).map((l) => l.rawMaterialId));
    return s.activeRawMaterials.filter((rm) => !taken.has(rm.id)).map((rm) => ({ value: rm.id, label: rm.name }));
  };

  const build = (): { input: RequestInput } | { error: string } => {
    if (!jobcardNo.trim()) return { error: "Job card number is required." };
    if (!fgItemId) return { error: "Finished-good item is required." };
    const filled = lines.filter((l) => !isRmLineBlank(l));
    if (filled.length === 0) return { error: "Add at least one raw material." };
    if (filled.some((l) => !l.rawMaterialId)) return { error: "Every line needs a raw material." };
    if (filled.some((l) => !(Number(l.qty) > 0))) return { error: "Every line needs a quantity greater than 0." };
    return {
      input: {
        jobcardNo: jobcardNo.trim(),
        bomLines: filled.map((l) => ({ rawMaterialId: l.rawMaterialId, qty: l.qty.trim(), unitId: l.unitId || null })),
        fgItemId,
        issueRemarks: issueRemarks.trim() || null,
        requesterName: session.user?.name ?? "Requester",
      },
    };
  };

  return {
    jobcardNo, setJobcardNo,
    fgItemId, setFgItemId,
    issueRemarks, setIssueRemarks,
    lines, setLines,
    err, setErr,
    fgItemOptions, unitOptions, rawMaterialOptionsFor,
    build,
  };
}

export type JobCardFormApi = ReturnType<typeof useJobCardForm>;
