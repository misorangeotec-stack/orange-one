import { useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useSession } from "@/core/platform/session";
import { useProductionStore } from "../../store";
import type { RequestInput } from "../../data/productionWrites";

/**
 * The issue-slip (step 1) intake form's state + derivation for a new job card.
 * Category / Raw material / Unit / FG item are picked from the managed masters;
 * Job Card No. / Required Qty / remarks are free text. Raw material + FG item are
 * required (they identify what is being made); the rest are optional.
 */
export function useJobCardForm() {
  const s = useProductionStore();
  const session = useSession();

  const [jobcardNo, setJobcardNo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [rawMaterialId, setRawMaterialId] = useState("");
  const [requiredQty, setRequiredQty] = useState("");
  const [unitId, setUnitId] = useState("");
  const [fgItemId, setFgItemId] = useState("");
  const [issueRemarks, setIssueRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const categoryOptions: ComboOption[] = s.activeCategories.map((c) => ({ value: c.id, label: c.name }));
  const rawMaterialOptions: ComboOption[] = s.activeRawMaterials.map((c) => ({ value: c.id, label: c.name }));
  const unitOptions: ComboOption[] = s.activeUnits.map((c) => ({ value: c.id, label: c.name }));
  const fgItemOptions: ComboOption[] = s.activeFgItems.map((c) => ({ value: c.id, label: c.name }));

  const build = (): { input: RequestInput } | { error: string } => {
    if (!jobcardNo.trim()) return { error: "Job card number is required." };
    if (!rawMaterialId) return { error: "Raw material is required." };
    if (!fgItemId) return { error: "Finished-good item is required." };
    return {
      input: {
        jobcardNo: jobcardNo.trim(),
        categoryId: categoryId || null,
        rawMaterialId,
        requiredQty: requiredQty.trim(),
        unitId: unitId || null,
        fgItemId,
        issueRemarks: issueRemarks.trim() || null,
        requesterName: session.user?.name ?? "Requester",
      },
    };
  };

  return {
    jobcardNo, setJobcardNo,
    categoryId, setCategoryId,
    rawMaterialId, setRawMaterialId,
    requiredQty, setRequiredQty,
    unitId, setUnitId,
    fgItemId, setFgItemId,
    issueRemarks, setIssueRemarks,
    err, setErr,
    categoryOptions, rawMaterialOptions, unitOptions, fgItemOptions,
    build,
  };
}

export type JobCardFormApi = ReturnType<typeof useJobCardForm>;
