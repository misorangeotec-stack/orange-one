import { useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import { useProductionStore } from "../../store";
import { pctFromQty, qtyForPct, round3, round6 } from "../../lib/bomMath";
import type { RequestInput } from "../../data/productionWrites";
import type { ProductionMasterType } from "../../types";
import type { MasterValues } from "../../lib/masterFields";

/**
 * The issue-slip (step 1) intake form's state for a new job card. One card
 * produces a single FG item but consumes MANY raw materials — a BOM — so the raw
 * material / qty / unit triple is a repeatable line list (the same LineGrid UX as
 * the procurement RM-purchase form), while FG item stays single. The Lot/Batch
 * number is AUTO-generated on save (not typed).
 *
 * BOM AUTOFILL. Picking an FG loads that FG's default BOM from the master and
 * fills the grid, each line scaled to the FG quantity by its split percentage.
 * This is an ACCELERATOR, NEVER A GATE: an FG with no BOM behaves exactly as it
 * always did (empty grid, type what you like), and even an FG that has BOMs can
 * be switched to "enter manually". Every line stays deletable and editable.
 *
 * ⚠ Every line carries its own `pct`. That is what makes the grid stay coherent:
 * change the FG quantity and each line rescales through its percentage; type a
 * quantity and the percentage follows. It is NEVER written back to the BOM
 * master — one card's typo must not silently rewrite the recipe for every future
 * card.
 *
 * ⚠ The raw-material quantities are NOT required to sum to the FG quantity. Real
 * formulations legitimately fall short (two of the six in the source data total
 * 33.3% and 42.8%), so the mismatch is surfaced as a warning and never blocks.
 */

/** One raw-material row of the BOM grid. `unitId` is not user-picked — it is
 *  derived from the selected raw material's own unit (its master). */
export interface RmLine extends LineGridRow {
  rawMaterialId: string;
  qty: string;
  unitId: string;
  /** This line's share of the FG quantity. Drives rescaling. */
  pct: string;
  /** Came from the BOM master rather than being typed — used only to tell
   *  whether the grid still matches the BOM (for the Reset link). */
  fromBom: boolean;
}

/** A genuinely empty row — no default qty, no default pct (LineGrid's "blank
 *  means blank"; a truthy default the blank test misses appends rows forever). */
export const makeEmptyRmLine = (): RmLine => ({
  uid: newUid(),
  rawMaterialId: "",
  qty: "",
  unitId: "",
  pct: "",
  fromBom: false,
});

/** ⚠ Must test EVERY user-editable field. Leave `pct` out and a row with only a
 *  percentage typed counts as blank: it loses its ✕, gains a sibling below it,
 *  and is silently dropped on save. `fromBom` is metadata, never emptiness. */
export const isRmLineBlank = (l: RmLine) => !l.rawMaterialId && !l.qty && !l.pct;

/** Seed values to pre-fill the form when EDITING an existing issue slip. */
export interface JobCardFormInit {
  requestId: string;
  fgTotalQty: string;
  fgItemId: string;
  bomId: string;
  issueRemarks: string;
  /** yyyy-mm-dd; falls back to today for cards raised before the field existed. */
  issueDate: string;
  lines: RmLine[];
}

export function useJobCardForm(init?: JobCardFormInit | null) {
  const s = useProductionStore();
  const session = useSession();

  const [fgTotalQty, setFgTotalQtyRaw] = useState("");
  const [fgItemId, setFgItemIdRaw] = useState("");
  const [bomId, setBomIdRaw] = useState("");
  const [issueRemarks, setIssueRemarks] = useState("");
  // The job date — today unless the user back-dates it. todayLocalIso (NOT
  // time.ts's UTC todayIso) because this is a date a person picks off a
  // calendar: in IST the UTC date reads as yesterday until 05:30.
  const [issueDate, setIssueDate] = useState(todayLocalIso());
  const [lines, setLines] = useState<RmLine[]>([makeEmptyRmLine()]);
  const [err, setErr] = useState<string | null>(null);
  /** Components the BOM carries that could not be loaded (raw material since
   *  deactivated) — reported rather than dropped into an unselectable row. */
  const [skipped, setSkipped] = useState<number>(0);

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
    setFgTotalQtyRaw(init.fgTotalQty);
    setFgItemIdRaw(init.fgItemId);
    setBomIdRaw(init.bomId);
    setIssueRemarks(init.issueRemarks);
    setIssueDate(init.issueDate);
    setLines(init.lines.length ? init.lines : [makeEmptyRmLine()]);
  }

  /** Sum of the filled raw-material line quantities (across all units). */
  const rmSum = round3(lines.filter((l) => !isRmLineBlank(l)).reduce((a, l) => a + (Number(l.qty) || 0), 0));
  const fgTotal = round3(Number(fgTotalQty) || 0);
  /** Do the quantities add up to the FG total? Shown, never enforced — see the
   *  header note. Kept as a named value because the UI colours the readout by it. */
  const sumMatches = fgTotal > 0 && rmSum === fgTotal;
  /** The grid's combined share of the FG quantity. */
  const pctTotal = round3(lines.filter((l) => !isRmLineBlank(l)).reduce((a, l) => a + (Number(l.pct) || 0), 0));

  const fgItemOptions: ComboOption[] = s.activeFgItems.map((c) => ({ value: c.id, label: c.name }));

  /** That FG's BOMs, plus the always-present manual escape hatch. */
  const bomOptions: ComboOption[] = [
    { value: "", label: "No BOM — enter manually" },
    ...s.bomsForFg(fgItemId).map((b) => ({ value: b.id, label: b.isDefault ? `${b.name} (default)` : b.name })),
  ];
  const fgHasBoms = s.bomsForFg(fgItemId).length > 0;

  /** Raw materials, minus ones another row already picked. */
  const rawMaterialOptionsFor = (line: RmLine): ComboOption[] => {
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.rawMaterialId).map((l) => l.rawMaterialId));
    return s.activeRawMaterials.filter((rm) => !taken.has(rm.id)).map((rm) => ({ value: rm.id, label: rm.name }));
  };

  /** The unit a raw material carries in its master (empty if none set yet). */
  const unitForRawMaterial = (rawMaterialId: string): string => s.rawMaterialById(rawMaterialId)?.unitId ?? "";

  /**
   * Build the grid from a BOM, scaled to `qty`.
   *
   * Components whose raw material has since been deactivated are SKIPPED, not
   * loaded: the picker only offers active materials, so such a row would hold an
   * id the Combobox cannot render — an invisible line the user can neither see
   * nor fix. The count is surfaced instead.
   */
  const linesFromBom = (id: string, qty: number): { rows: RmLine[]; skipped: number } => {
    const active = new Set(s.activeRawMaterials.map((rm) => rm.id));
    const comps = s.bomComponentsFor(id);
    const usable = comps.filter((c) => active.has(c.rawMaterialId));
    return {
      rows: usable.map((c) => ({
        uid: newUid(),
        rawMaterialId: c.rawMaterialId,
        qty: qty > 0 ? String(qtyForPct(qty, c.pct)) : "",
        unitId: unitForRawMaterial(c.rawMaterialId),
        pct: String(c.pct),
        fromBom: true,
      })),
      skipped: comps.length - usable.length,
    };
  };

  /**
   * Load a BOM into the grid — or, with an empty id, take it back out again.
   *
   * ⚠ THE EMPTY BRANCH MUST CLEAR THE ROWS. It used to return early, so picking
   *   "No BOM — enter manually" left every loaded row behind and the user deleted
   *   them one ✕ at a time. Selecting no BOM is a request for an empty grid, not
   *   for the last BOM's rows with the label taken off.
   *
   * What it clears is deliberately narrow: only a grid the BOM filled in. A grid
   * the user typed themselves never came from a BOM and is theirs to keep.
   */
  const applyBom = (id: string, qty: number = fgTotal) => {
    setBomIdRaw(id);
    if (!id) {
      setSkipped(0);
      setLines((prev) => (prev.some((l) => l.fromBom) ? [makeEmptyRmLine()] : prev));
      return;
    }
    const { rows, skipped: n } = linesFromBom(id, qty);
    setSkipped(n);
    setLines([...rows, makeEmptyRmLine()]);
  };

  /**
   * Picking an FG loads its default BOM when the choice is unambiguous (an
   * explicit default, or a lone BOM); otherwise it clears to manual entry and
   * lets the user choose.
   *
   * ⚠ BOTH OUTCOMES GO THROUGH `applyBom`, including "none". This branch used to
   *   carry its own copy of the clearing logic, and the copy is what let the two
   *   paths drift: it cleared the grid while the BOM picker's own "No BOM" did
   *   not, so the same intent gave two different results depending on which
   *   control you reached for. One path, one behaviour.
   */
  const setFgItemId = (id: string) => {
    setFgItemIdRaw(id);
    applyBom(s.defaultBomForFg(id)?.id ?? "");
  };

  /**
   * ⚠ The rescale lives HERE, in the setter — not in an effect on [fgTotalQty,
   * lines]. An effect that reads and writes `lines` ping-pongs with LineGrid's
   * own trailing-blank effect, and writing a qty into the blank row makes it
   * non-blank, which appends another, forever. Blank rows are skipped for the
   * same reason.
   */
  const setFgTotalQty = (next: string) => {
    setFgTotalQtyRaw(next);
    const qty = round3(Number(next) || 0);
    setLines((prev) =>
      prev.map((l) => {
        if (isRmLineBlank(l)) return l;
        const pct = Number(l.pct) || 0;
        if (pct > 0) return { ...l, qty: qty > 0 ? String(qtyForPct(qty, pct)) : "" };
        // No percentage yet (a hand-typed line entered before any FG quantity):
        // derive one from what is already there so it rescales from now on.
        return { ...l, pct: qty > 0 ? String(pctFromQty(qty, Number(l.qty) || 0)) : "" };
      }),
    );
  };

  /** Editing a line's quantity re-derives its share; editing its share re-derives
   *  the quantity. Both only ever touch this card, never the BOM master. */
  // ⚠ Clearing the quantity must clear the share too, not leave a "0" behind: pct
  // counts towards isRmLineBlank, so a stray "0" would keep an emptied row alive —
  // it would hold the trailing blank open and then fail the save with "every line
  // needs a raw material" for a row the user thought they had already erased.
  const patchLineQty = (qty: string): Partial<RmLine> => ({
    qty,
    pct: qty !== "" && fgTotal > 0 ? String(pctFromQty(fgTotal, Number(qty) || 0)) : "",
  });
  const patchLinePct = (pct: string): Partial<RmLine> => ({
    pct,
    qty: fgTotal > 0 && pct !== "" ? String(qtyForPct(fgTotal, Number(pct) || 0)) : "",
  });

  /** Has the grid drifted from the BOM it was loaded from? Drives "Reset to BOM". */
  const bomDirty = (() => {
    if (!bomId) return false;
    const filled = lines.filter((l) => !isRmLineBlank(l));
    const comps = s.bomComponentsFor(bomId).filter((c) => s.activeRawMaterials.some((rm) => rm.id === c.rawMaterialId));
    if (filled.length !== comps.length) return true;
    return comps.some((c) => {
      const row = filled.find((l) => l.rawMaterialId === c.rawMaterialId);
      return !row || round6(Number(row.pct) || 0) !== round6(c.pct);
    });
  })();

  const build = (): { input: RequestInput } | { error: string } => {
    if (!fgItemId) return { error: "Finished-good item is required." };
    // Required, not just capped: the edit RPC coalesces a blank to the stored
    // value, so without this a cleared field would save silently doing nothing.
    if (!issueDate) return { error: "The job date is required." };
    if (issueDate > todayLocalIso()) return { error: "The job date cannot be in the future." };
    if (!(fgTotal > 0)) return { error: "Enter the FG total quantity to produce." };
    const filled = lines.filter((l) => !isRmLineBlank(l));
    if (filled.length === 0) return { error: "Add at least one raw material." };
    if (filled.some((l) => !l.rawMaterialId)) return { error: "Every line needs a raw material." };
    if (filled.some((l) => !(Number(l.qty) > 0))) return { error: "Every line needs a quantity greater than 0." };
    return {
      input: {
        fgTotalQty: fgTotalQty.trim(),
        bomLines: filled.map((l) => ({
          rawMaterialId: l.rawMaterialId,
          qty: l.qty.trim(),
          unitId: l.unitId || null,
          // Persisted so the printed slip's Proportion Dosage shows the split
          // actually used, rather than re-deriving one that assumes 100%.
          pct: l.pct === "" ? String(pctFromQty(fgTotal, Number(l.qty) || 0)) : String(round6(Number(l.pct) || 0)),
          bomId: bomId || null,
        })),
        fgItemId,
        issueDate,
        issueRemarks: issueRemarks.trim() || null,
        requesterName: session.user?.name ?? "Requester",
      },
    };
  };

  return {
    fgTotalQty, setFgTotalQty,
    fgItemId, setFgItemId,
    issueDate, setIssueDate,
    bomId, applyBom, bomOptions, fgHasBoms, bomDirty, skipped,
    issueRemarks, setIssueRemarks,
    lines, setLines,
    err, setErr,
    raise, setRaise,
    requested, setRequested,
    rmSum, fgTotal, sumMatches, pctTotal,
    fgItemOptions, rawMaterialOptionsFor, unitForRawMaterial,
    patchLineQty, patchLinePct,
    build,
  };
}

export type JobCardFormApi = ReturnType<typeof useJobCardForm>;
