import { dmy } from "./format";
import type { AisRound, ProductionRequest } from "../types";
import type { IssueSlipExport } from "./exportIssueSlip";

/** Match a handover line (by index, else by raw material) to pull its lot no + qty. */
function handoverMatcher<T extends { rawMaterialId: string | null }>(mh: T[], count: number) {
  const byIndex = mh.length === count;
  const used = new Set<number>();
  return (rawMaterialId: string | null, i: number): T | null => {
    if (byIndex) return mh[i] ?? null;
    const idx = mh.findIndex((m, j) => !used.has(j) && m.rawMaterialId === rawMaterialId);
    if (idx >= 0) {
      used.add(idx);
      return mh[idx];
    }
    return null;
  };
}

/**
 * Build the issue-slip view-model shared by the Excel export and the Print view.
 * Uses the BOM (or the legacy single-RM triple for old cards); per-line RM batch
 * no. + actual issued come from the Material Handover step (matched by index,
 * else by raw material) when the card has progressed, else blank.
 */
export function buildIssueSlipExport(
  r: ProductionRequest,
  lookups: {
    fgItemName: (id: string | null) => string;
    rawMaterialName: (id: string | null) => string;
  },
): IssueSlipExport {
  const baseLines =
    r.bomLines.length > 0
      ? r.bomLines.map((l) => ({ rawMaterialId: l.rawMaterialId, requiredQty: l.requiredQty, pct: l.pct }))
      : r.rawMaterialId || r.requiredQty != null
        ? [{ rawMaterialId: r.rawMaterialId, requiredQty: r.requiredQty, pct: null }]
        : [];

  const handoverFor = handoverMatcher(r.mhBomLines, baseLines.length);

  return {
    jobcardNo: r.jobcardNo,
    productName: lookups.fgItemName(r.fgItemId),
    productionQty: r.fgQty,
    requesterName: r.requesterName,
    // The JOB date, not the moment it was keyed in — the slip is a document about
    // the job. Falls back to submittedAt for cards raised before the field existed.
    submittedAtDMY: dmy(r.issueDate ?? r.submittedAt),
    lines: baseLines.map((l, i) => {
      const h = handoverFor(l.rawMaterialId, i);
      return {
        productName: lookups.rawMaterialName(l.rawMaterialId),
        theoreticalKg: l.requiredQty,
        proportionPct: l.pct,
        rmBatchNo: h?.lotNo ?? "",
        actualIssued: h?.qty ?? null,
      };
    }),
  };
}

/**
 * Build the view-model for an ADDITIONAL issue slip (a QC-reject top-up round).
 * Identical format to the original slip, but the FG quantity is the round's
 * additional quantity and the rows are ONLY the additional raw materials added in
 * that round. RM batch no. + actual issued come from that round's top-up handover.
 */
export function buildAisIssueSlipExport(
  r: ProductionRequest,
  round: AisRound,
  lookups: {
    fgItemName: (id: string | null) => string;
    rawMaterialName: (id: string | null) => string;
  },
): IssueSlipExport {
  const handoverFor = handoverMatcher(round.mhLines ?? [], round.aisBomLines.length);

  return {
    jobcardNo: r.jobcardNo,
    productName: lookups.fgItemName(r.fgItemId),
    productionQty: round.aisQty,
    requesterName: r.requesterName,
    submittedAtDMY: dmy(round.issuedAt ?? r.issueDate ?? r.submittedAt),
    lines: round.aisBomLines.map((l, i) => {
      const h = handoverFor(l.rawMaterialId, i);
      return {
        productName: lookups.rawMaterialName(l.rawMaterialId),
        theoreticalKg: l.qty,
        // An additional issue slip is a top-up typed against that round's own
        // quantity, not a BOM, so it keeps the normalised derivation.
        proportionPct: null,
        rmBatchNo: h?.lotNo ?? "",
        actualIssued: h?.qty ?? null,
      };
    }),
  };
}
