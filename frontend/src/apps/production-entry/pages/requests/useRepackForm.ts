import { useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import { useProductionStore } from "../../store";
import { isPackRowBlank, makeEmptyPackRow, type PackRow } from "../../lib/packLines";
import type { RequestInput } from "../../data/productionWrites";
import type { ProductionMasterType } from "../../types";
import type { MasterValues } from "../../lib/masterFields";

/**
 * The REPACKAGING issue-slip form state.
 *
 * A repackaging card is a traded FG that is only repacked — imported ready-made,
 * put into new packaging, sold. So there is no BOM and no raw material, and
 * critically NO WASTAGE: the packed quantity IS the FG quantity. That single
 * number is what the packaging grid's pack-size auto-fill divides by, and what
 * the server writes into every downstream figure.
 *
 * Deliberately much smaller than useJobCardForm: no BOM autofill, no split
 * percentages, no rescaling. The only shared idiom is the "Request new master"
 * escape hatch, so a missing FG item or packaging item can be raised inline.
 */

/** Seed values to pre-fill the form when EDITING an existing repackaging slip. */
export interface RepackFormInit {
  requestId: string;
  fgQty: string;
  fgItemId: string;
  issueRemarks: string;
  /** yyyy-mm-dd; falls back to today for cards raised before the field existed. */
  issueDate: string;
  packRows: PackRow[];
}

export function useRepackForm(init?: RepackFormInit | null) {
  const s = useProductionStore();
  const session = useSession();

  const [fgQty, setFgQty] = useState("");
  const [fgItemId, setFgItemId] = useState("");
  const [issueRemarks, setIssueRemarks] = useState("");
  // See useJobCardForm: todayLocalIso, not time.ts's UTC todayIso.
  const [issueDate, setIssueDate] = useState(todayLocalIso());
  const [packRows, setPackRows] = useState<PackRow[]>([makeEmptyPackRow()]);
  const [err, setErr] = useState<string | null>(null);

  // Same "raise a missing master" pair as the production form: `raise` drives the
  // RequestMasterModal, `requested` is the confirmation line left behind. Nothing
  // is selected — the entry doesn't exist until its owner approves it.
  const [raise, setRaise] = useState<{ mt: ProductionMasterType; prefill: MasterValues } | null>(null);
  const [requested, setRequested] = useState<string | null>(null);

  // Hydrate from `init` exactly ONCE per request id — a background refetch rebuilds
  // the store and would otherwise wipe in-progress edits. (Same guard as useJobCardForm.)
  const hydratedFor = useRef<string | null>(null);
  if (init && hydratedFor.current !== init.requestId) {
    hydratedFor.current = init.requestId;
    setFgQty(init.fgQty);
    setFgItemId(init.fgItemId);
    setIssueRemarks(init.issueRemarks);
    setIssueDate(init.issueDate);
    setPackRows(init.packRows.length ? init.packRows : [makeEmptyPackRow()]);
  }

  const fgItemOptions: ComboOption[] = s.activeFgItems.map((c) => ({ value: c.id, label: c.name }));

  /** The FG item's own unit name, for the quantity field's suffix. */
  const fgUnitName = s.unitById(s.fgItemById(fgItemId)?.unitId ?? null)?.name ?? null;

  const filledPackRows = packRows.filter((r) => !isPackRowBlank(r));

  const build = (): { input: RequestInput } | { error: string } => {
    if (!fgItemId) return { error: "Finished-good item is required." };
    // Required, not just capped — see useJobCardForm.
    if (!issueDate) return { error: "The job date is required." };
    if (issueDate > todayLocalIso()) return { error: "The job date cannot be in the future." };
    if (!(Number(fgQty) > 0)) return { error: "Enter the quantity to repack." };
    if (filledPackRows.length === 0) return { error: "Add at least one packaging item." };
    if (filledPackRows.some((r) => !r.packagingItemId)) return { error: "Every line needs a packaging item." };
    if (filledPackRows.some((r) => !(Number(r.qty) > 0))) return { error: "Every packaging line needs a quantity greater than 0." };
    return {
      input: {
        cardType: "repackaging",
        // No wastage — the server writes this same number as the packed quantity.
        fgTotalQty: fgQty.trim(),
        fgItemId,
        issueDate,
        bomLines: [],
        packLines: filledPackRows.map((r) => ({
          packagingItemId: r.packagingItemId,
          unitId: r.unitId,
          qty: r.qty.trim(),
          extra: (r.extra ?? "").trim(),
        })),
        issueRemarks: issueRemarks.trim() || null,
        requesterName: session.user?.name ?? "Requester",
      },
    };
  };

  return {
    fgQty, setFgQty,
    fgItemId, setFgItemId,
    issueDate, setIssueDate,
    issueRemarks, setIssueRemarks,
    packRows, setPackRows,
    err, setErr,
    raise, setRaise,
    requested, setRequested,
    fgItemOptions, fgUnitName, filledPackRows,
    build,
  };
}

export type RepackFormApi = ReturnType<typeof useRepackForm>;
