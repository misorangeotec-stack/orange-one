import { useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { useSession } from "@/core/platform/session";
import { useProductionStore } from "../../store";
import type { RequestInput } from "../../data/productionWrites";
import type { ProductionMasterType } from "../../types";
import type { MasterValues } from "../../lib/masterFields";

/**
 * The issue-slip (step 1) intake form's state for a new job card. One card
 * produces a single FG item but consumes MANY raw materials — a BOM — so the raw
 * material / qty / unit triple is a repeatable line list (the same LineGrid UX as
 * the procurement RM-purchase form), while FG item stays single. The Lot/Batch
 * number is AUTO-generated on save (not typed). FG item + an FG total quantity are
 * required, and the raw-material quantities must SUM to the FG total quantity
 * before the card can be raised.
 */

/** One raw-material row of the BOM grid. `unitId` is not user-picked — it is
 *  derived from the selected raw material's own unit (its master). */
export interface RmLine extends LineGridRow {
  rawMaterialId: string;
  qty: string;
  unitId: string;
}

/** A genuinely empty row — no default qty (LineGrid's "blank means blank"). */
export const makeEmptyRmLine = (): RmLine => ({ uid: newUid(), rawMaterialId: "", qty: "", unitId: "" });

export const isRmLineBlank = (l: RmLine) => !l.rawMaterialId && !l.qty;

/** Seed values to pre-fill the form when EDITING an existing issue slip. */
export interface JobCardFormInit {
  requestId: string;
  fgTotalQty: string;
  fgItemId: string;
  issueRemarks: string;
  lines: RmLine[];
}

export function useJobCardForm(init?: JobCardFormInit | null) {
  const s = useProductionStore();
  const session = useSession();

  const [fgTotalQty, setFgTotalQty] = useState("");
  const [fgItemId, setFgItemId] = useState("");
  const [issueRemarks, setIssueRemarks] = useState("");
  const [lines, setLines] = useState<RmLine[]>([makeEmptyRmLine()]);
  const [err, setErr] = useState<string | null>(null);

  // A missing master is raised from the picker that needed it: `raise` drives the
  // RequestMasterModal (type + the name already typed), `requested` is the
  // confirmation line left behind once it's sent. Nothing is selected on the
  // form — the entry doesn't exist until its owner approves it.
  const [raise, setRaise] = useState<{ mt: ProductionMasterType; prefill: MasterValues } | null>(null);
  const [requested, setRequested] = useState<string | null>(null);

  // Hydrate from `init` exactly ONCE per request id — a background refetch rebuilds
  // the store and would otherwise wipe in-progress edits. (Same guard as Import's
  // useRequestForm.)
  const hydratedFor = useRef<string | null>(null);
  if (init && hydratedFor.current !== init.requestId) {
    hydratedFor.current = init.requestId;
    setFgTotalQty(init.fgTotalQty);
    setFgItemId(init.fgItemId);
    setIssueRemarks(init.issueRemarks);
    setLines(init.lines.length ? init.lines : [makeEmptyRmLine()]);
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  /** Sum of the filled raw-material line quantities (across all units). */
  const rmSum = round3(lines.filter((l) => !isRmLineBlank(l)).reduce((a, l) => a + (Number(l.qty) || 0), 0));
  const fgTotal = round3(Number(fgTotalQty) || 0);
  /** The RM quantities must add up to the FG total before the card can be raised. */
  const sumMatches = fgTotal > 0 && rmSum === fgTotal;

  const fgItemOptions: ComboOption[] = s.activeFgItems.map((c) => ({ value: c.id, label: c.name }));

  /** Raw materials, minus ones another row already picked. */
  const rawMaterialOptionsFor = (line: RmLine): ComboOption[] => {
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.rawMaterialId).map((l) => l.rawMaterialId));
    return s.activeRawMaterials.filter((rm) => !taken.has(rm.id)).map((rm) => ({ value: rm.id, label: rm.name }));
  };

  /** The unit a raw material carries in its master (empty if none set yet). */
  const unitForRawMaterial = (rawMaterialId: string): string => s.rawMaterialById(rawMaterialId)?.unitId ?? "";

  const build = (): { input: RequestInput } | { error: string } => {
    if (!fgItemId) return { error: "Finished-good item is required." };
    if (!(fgTotal > 0)) return { error: "Enter the FG total quantity to produce." };
    const filled = lines.filter((l) => !isRmLineBlank(l));
    if (filled.length === 0) return { error: "Add at least one raw material." };
    if (filled.some((l) => !l.rawMaterialId)) return { error: "Every line needs a raw material." };
    if (filled.some((l) => !(Number(l.qty) > 0))) return { error: "Every line needs a quantity greater than 0." };
    if (!sumMatches) return { error: "The raw-material quantities must add up to the FG total quantity." };
    return {
      input: {
        fgTotalQty: fgTotalQty.trim(),
        bomLines: filled.map((l) => ({ rawMaterialId: l.rawMaterialId, qty: l.qty.trim(), unitId: l.unitId || null })),
        fgItemId,
        issueRemarks: issueRemarks.trim() || null,
        requesterName: session.user?.name ?? "Requester",
      },
    };
  };

  return {
    fgTotalQty, setFgTotalQty,
    fgItemId, setFgItemId,
    issueRemarks, setIssueRemarks,
    lines, setLines,
    err, setErr,
    raise, setRaise,
    requested, setRequested,
    rmSum, fgTotal, sumMatches,
    fgItemOptions, rawMaterialOptionsFor, unitForRawMaterial,
    build,
  };
}

export type JobCardFormApi = ReturnType<typeof useJobCardForm>;
