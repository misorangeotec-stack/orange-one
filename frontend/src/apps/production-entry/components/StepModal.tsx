import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import LineGrid, { newUid, type LineCellApi, type LineGridColumn } from "@/shared/components/ui/LineGrid";
import FileCapture from "@/shared/components/ui/FileCapture";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import ExportButtons from "./ExportButtons";
import StepDocLink from "./StepDocLink";
import RequestMasterModal from "./RequestMasterModal";
import PackLinesGrid from "./PackLinesGrid";
import { useProductionStore } from "../store";
import { uploadQualityDocument, uploadStepDocument } from "../data/productionWrites";
import { dmy, numOrDash, packFinalQty } from "../lib/format";
import { packLinePayload, type PackRow } from "../lib/packLines";
import type { MasterValues } from "../lib/masterFields";
import { STATUS_OPTIONS, STEP_CONFIG } from "../lib/stepConfig";
import { isAisLoopBlocked, type QueueStep } from "../lib/queues";
import type { ProductionMasterType, ProductionRequest } from "../types";

/** Today as yyyy-mm-dd in the browser's LOCAL timezone. Deliberately not the
 *  shared (UTC-based) todayIso: on a night shift an IST entry made after
 *  midnight would otherwise still read as "yesterday" and be un-selectable.
 *  Used to default and cap the quality test date. */
function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface StepModalProps {
  open: boolean;
  onClose: () => void;
  request: ProductionRequest | null;
  editing?: boolean;
  readOnly?: boolean;
}

/** A material-handover BOM row being edited: the actual handover qty + issue lot
 *  number per raw material, with the requested qty carried for reference. */
interface HandoverRow {
  rawMaterialId: string | null;
  unitId: string | null;
  requestedQty: number | null;
  qty: string;
  lotNo: string;
}

/** One additional-raw-material row on the Generate Additional Issue Slip form. */
interface AisEditRow {
  uid: string;
  rawMaterialId: string | null;
  qty: string;
  unitId: string | null;
}
const makeEmptyAisRow = (): AisEditRow => ({ uid: newUid(), rawMaterialId: null, qty: "", unitId: null });
const isAisRowBlank = (r: AisEditRow) => !r.rawMaterialId && !(r.qty ?? "").trim();

/** One Log Book Entry row being edited. Existing rows carry the locked requested/
 *  handover/lot from earlier steps with an editable actual use; new rows are added
 *  at this step (master pick or free text) with their own actual use + lot. */
interface LogRow {
  uid: string;
  isNew: boolean;
  rawMaterialId: string | null;
  name: string;
  unitId: string | null;
  requestedQty: number | null;
  handoverQty: number | null;
  actualUse: string;
  lotNo: string;
}
const makeEmptyLogRow = (): LogRow => ({ uid: newUid(), isNew: true, rawMaterialId: null, name: "", unitId: null, requestedQty: null, handoverQty: null, actualUse: "", lotNo: "" });
// Blank = a NEW row with nothing filled. Locked rows carried from the handover
// (isNew:false) are never blank, so LineGrid keeps exactly one trailing new row.
const isLogRowBlank = (r: LogRow) => r.isNew && !r.rawMaterialId && !(r.name ?? "").trim() && !(r.actualUse ?? "").trim() && !(r.lotNo ?? "").trim();

/** Seed the handover rows from the issue slip, pre-filling the handover qty +
 *  lot number from an already-recorded handover when one exists. */
function seedHandoverRows(request: ProductionRequest): HandoverRow[] {
  const recorded = new Map(request.mhBomLines.map((l) => [l.rawMaterialId, l]));
  return request.bomLines.map((b) => {
    const done = recorded.get(b.rawMaterialId);
    return {
      rawMaterialId: b.rawMaterialId,
      unitId: b.unitId,
      requestedQty: b.requiredQty,
      // pre-fill the handover qty from the recorded value, else the requested qty
      qty: done ? (done.qty != null ? String(done.qty) : "") : b.requiredQty != null ? String(b.requiredQty) : "",
      lotNo: done?.lotNo ?? "",
    };
  });
}

/**
 * The ONE modal that records (or corrects) every workflow step. It reads the
 * step's field descriptors from lib/stepConfig, renders them, and calls the store's
 * generic recordStep / updateStep. `editing` corrects the entry until the next step
 * is recorded; the server re-checks that lock and refuses otherwise.
 *
 * Two steps carry extra UI beyond the descriptor fields: Quality Checking has an
 * optional test-report attachment, and Material Handover shows the job-card link +
 * FG item and captures the actual handover qty + issue lot number PER raw material.
 */
export default function StepModal({
  stepKey,
  open,
  onClose,
  request,
  editing = false,
  readOnly = false,
}: StepModalProps & { stepKey: QueueStep }) {
  const s = useProductionStore();
  const cfg = STEP_CONFIG[stepKey];
  // The FG item + its own unit (shown automatically wherever the FG appears).
  const fgItem = request ? s.fgItemById(request.fgItemId) : undefined;
  const fgName = fgItem?.name ?? "—";
  const fgUnit = fgItem ? s.unitById(fgItem.unitId)?.name ?? null : null;
  const isHandover = stepKey === "material_handover";
  const isRmTransfer = stepKey === "rm_transfer";
  const isLogBook = stepKey === "transfer_slip";
  const isProduction = stepKey === "production_entry";
  const isQuality = stepKey === "quality_check";
  const isAis = stepKey === "additional_issue_slip";
  const isMc = stepKey === "mc_testing";
  const isPmTransfer = stepKey === "pm_transfer";
  const isPacking = stepKey === "packing_entry";
  const isFgTransfer = stepKey === "fg_transfer";
  /**
   * A repackaging card bypasses the Production Entry step, so its production-entry
   * Tally no. has nowhere to be captured — the packing-material transfer takes it
   * instead. On a production card that field is filled at its own step and stays
   * READ-ONLY here (the RPC ignores the key for those cards too).
   */
  const isRepackCard = request?.cardType === "repackaging";
  const pmtNeedsTally = isPmTransfer && isRepackCard;
  /**
   * A repackaging card has no log book, so its packed quantity was assumed to be
   * the whole FG quantity at intake. Reality can differ — some of the drums go out
   * loose — so the packing entry is where the split is actually made: you type
   * Packed, and Loose is whatever is left of the net quantity. A production card
   * still carries both figures down from the log book, read-only.
   */
  const pkEditsQty = isPacking && isRepackCard;
  // A rejected lot re-issuing an Additional Issue Slip is shown in Quality Check for
  // tracking, but can't be approved/rejected until its top-up raw material has been
  // transferred to production (i.e. it returns to `awaiting_quality`). Block + explain.
  const qcBlocked = isQuality && !editing && !!request && isAisLoopBlocked(request);
  const [values, setValues] = useState<Record<string, string>>({});
  const [hoRows, setHoRows] = useState<HandoverRow[]>([]);
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  // Output metrics are captured at the LOG BOOK now (scrap/lab/packed are entered;
  // expected/actual/loose derive). Production entry only captures the Tally entry.
  const [logScrap, setLogScrap] = useState("");
  const [logLoss, setLogLoss] = useState("");
  const [logLab, setLogLab] = useState("");
  const [logPacked, setLogPacked] = useState("");
  const [prodTally, setProdTally] = useState("");
  /** Packing entry, repackaging only — see `pkEditsQty`. */
  const [pkPacked, setPkPacked] = useState("");
  // FG transfer: the two Tally-entry confirmations that gate Save.
  const [fgProdTick, setFgProdTick] = useState(false);
  const [fgHojiwalaTick, setFgHojiwalaTick] = useState(false);
  // Packing material rows (captured at the log book now) + the additional-issue-slip form.
  const [packRows, setPackRows] = useState<PackRow[]>([]);
  const [aisQty, setAisQty] = useState("");
  const [aisRows, setAisRows] = useState<AisEditRow[]>([]);
  const [qcResult, setQcResult] = useState<"approved" | "rejected" | "">("");
  const [qcRemarks, setQcRemarks] = useState("");
  const [qcTestDate, setQcTestDate] = useState("");
  const [qcFile, setQcFile] = useState<File | null>(null);
  const [mcResult, setMcResult] = useState<"approved" | "rejected" | "bypassed" | "">("");
  const [mcRemarks, setMcRemarks] = useState("");
  const [mcTestDate, setMcTestDate] = useState("");
  const [mcFile, setMcFile] = useState<File | null>(null);
  const [qtyFallback, setQtyFallback] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [logFile, setLogFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A master missing mid-step is raised from the picker that needed it. The modal
  // it drives is rendered OUTSIDE this dialog (see the return) — a stacked child
  // inside a read-only Modal's <fieldset disabled> comes up inert.
  const [raise, setRaise] = useState<{ mt: ProductionMasterType; prefill: MasterValues } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Seed the log-book rows from the recorded entry when editing, else from the
   *  handover (existing items, locked) with actual use defaulting to handover qty. */
  const seedLogRows = (r: ProductionRequest): LogRow[] => {
    if (r.tsBomLines.length > 0) {
      return r.tsBomLines.map((l) => ({
        uid: newUid(),
        isNew: l.isNew,
        rawMaterialId: l.rawMaterialId,
        name: l.rawMaterialName || s.rawMaterialById(l.rawMaterialId)?.name || "—",
        unitId: l.unitId,
        requestedQty: l.requestedQty,
        handoverQty: l.handoverQty,
        actualUse: l.actualUse != null ? String(l.actualUse) : "",
        lotNo: l.lotNo ?? "",
      }));
    }
    // No log book yet: combine the ORIGINAL BOM + every additional issue slip into
    // one requested map, and the base handover + every additional handover into one
    // handed-over map (summed per raw material) — so the log book shows ONE entry.
    const requestedByRm = new Map<string, number>();
    const addReq = (rmId: string | null, q: number | null) => {
      if (!rmId) return;
      requestedByRm.set(rmId, (requestedByRm.get(rmId) ?? 0) + (q ?? 0));
    };
    for (const b of r.bomLines) addReq(b.rawMaterialId, b.requiredQty);
    for (const round of r.aisRounds) for (const l of round.aisBomLines) addReq(l.rawMaterialId, l.qty);

    const handover = new Map<string, { unitId: string | null; qty: number; lotNo: string | null }>();
    const handoverSets = [r.mhBomLines, ...r.aisRounds.map((rd) => rd.mhLines ?? [])];
    for (const set of handoverSets) {
      for (const l of set) {
        if (!l.rawMaterialId) continue;
        const cur = handover.get(l.rawMaterialId);
        handover.set(l.rawMaterialId, {
          unitId: l.unitId ?? cur?.unitId ?? null,
          qty: (cur?.qty ?? 0) + (l.qty ?? 0),
          lotNo: l.lotNo ?? cur?.lotNo ?? null,
        });
      }
    }
    return [...handover.entries()].map(([rmId, h]) => ({
      uid: newUid(),
      isNew: false,
      rawMaterialId: rmId,
      name: s.rawMaterialById(rmId)?.name || "—",
      unitId: h.unitId,
      requestedQty: requestedByRm.has(rmId) ? requestedByRm.get(rmId)! : null,
      handoverQty: h.qty,
      actualUse: h.qty != null ? String(h.qty) : "",
      lotNo: h.lotNo ?? "",
    }));
  };

  /** True while an additional issue slip's top-up is still awaiting its handover —
   *  the handover step then hands over the ADDITIONAL raw material, not the original. */
  const aisHandoverOpen = (r: ProductionRequest): boolean => {
    const last = r.aisRounds[r.aisRounds.length - 1];
    return !!last && !last.mhDone && r.status === "awaiting_material_handover";
  };

  /** The AIS round whose handover is editable-until-next: its handover is recorded
   *  (mhDone) but its RM transfer hasn't happened yet (rmtDone) — so an Edit corrects
   *  THAT round's additional handover, not the original base handover. */
  const aisHandoverEditRound = (r: ProductionRequest) => {
    const last = r.aisRounds[r.aisRounds.length - 1];
    return last && last.mhDone && !last.rmtDone ? last : null;
  };

  /** Seed the handover rows from the latest additional-issue-slip round's top-up RM —
   *  pre-filling the handover qty + lot from the round's ALREADY-RECORDED lines when
   *  present (an Edit), else from the round's additional BOM (a fresh handover). */
  const seedAisHandoverRows = (r: ProductionRequest): HandoverRow[] => {
    const round = r.aisRounds[r.aisRounds.length - 1];
    if (!round) return [];
    const recorded = new Map((round.mhLines ?? []).map((l) => [l.rawMaterialId, l]));
    return round.aisBomLines.map((b) => {
      const done = recorded.get(b.rawMaterialId);
      return {
        rawMaterialId: b.rawMaterialId,
        unitId: b.unitId,
        requestedQty: b.qty,
        qty: done ? (done.qty != null ? String(done.qty) : "") : b.qty != null ? String(b.qty) : "",
        lotNo: done?.lotNo ?? "",
      };
    });
  };

  /** Seed the packing rows from a recorded log book (FILLED rows only — LineGrid
   *  appends the trailing blank row itself). */
  const seedPackRows = (r: ProductionRequest): PackRow[] =>
    r.pmhBomLines.map((l) => ({
      uid: newUid(),
      packagingItemId: l.packagingItemId,
      unitId: l.unitId,
      qty: l.qty != null ? String(l.qty) : "",
      extra: l.extra != null ? String(l.extra) : "",
    }));

  useEffect(() => {
    if (open && request) {
      const seed: Record<string, string> = {};
      for (const f of cfg.fields) seed[f.key] = f.get(request);
      setValues(seed);
      // Handover rows come from the AIS round when we're either recording its fresh
      // top-up handover, or editing that round's already-recorded handover — otherwise
      // from the original base handover.
      const useAisHandover = isHandover && (aisHandoverOpen(request) || (editing && !!aisHandoverEditRound(request)));
      setHoRows(isHandover ? (useAisHandover ? seedAisHandoverRows(request) : seedHandoverRows(request)) : []);
      setLogRows(isLogBook ? seedLogRows(request) : []);
      setPackRows(isLogBook ? seedPackRows(request) : []);
      setLogScrap(isLogBook && request.scrapQty != null ? String(request.scrapQty) : "");
      setLogLoss(isLogBook && request.tsProductionLoss != null ? String(request.tsProductionLoss) : "");
      setLogLab(isLogBook && request.peLabQty != null ? String(request.peLabQty) : "");
      setLogPacked(isLogBook && request.tsPackedQty != null ? String(request.tsPackedQty) : "");
      // Shared by the production entry step and, on a repackaging card, by the
      // packing-material transfer that stands in for it.
      setProdTally(isProduction || isPmTransfer ? request.peTallyEntry ?? "" : "");
      setPkPacked(isPacking && request.tsPackedQty != null ? String(request.tsPackedQty) : "");
      setFgProdTick(isFgTransfer ? request.fgProdToFg : false);
      setFgHojiwalaTick(isFgTransfer ? request.fgToHojiwala : false);
      // Additional Issue Slip: fresh form when recording, else the last round's top-up.
      if (isAis) {
        const lastAis = editing ? request.aisRounds[request.aisRounds.length - 1] : undefined;
        setAisQty(lastAis?.aisQty != null ? String(lastAis.aisQty) : "");
        setAisRows(
          lastAis
            ? lastAis.aisBomLines.map((l) => ({ uid: newUid(), rawMaterialId: l.rawMaterialId, qty: l.qty != null ? String(l.qty) : "", unitId: l.unitId }))
            : [makeEmptyAisRow()],
        );
      } else {
        setAisQty("");
        setAisRows([]);
      }
      // Quality: when editing correct the last round; when recording start a fresh one.
      const lastQc = request.qcRounds[request.qcRounds.length - 1];
      setQcResult(editing && lastQc?.result ? lastQc.result : "");
      setQcRemarks(editing ? lastQc?.remarks ?? "" : "");
      // Default a fresh test to today; when correcting, keep the recorded date.
      setQcTestDate(editing ? (lastQc?.testDate ?? "").slice(0, 10) : todayLocalIso());
      setQcFile(null);
      // M/C testing: a single approve/reject. When editing, show the recorded
      // result read-only; when recording, start blank (a prior rejection is shown
      // for context but the result is re-picked).
      setMcResult(editing && (request.mcStatus === "approved" || request.mcStatus === "rejected" || request.mcStatus === "bypassed") ? request.mcStatus : "");
      setMcRemarks(editing ? request.mcRemarks ?? "" : "");
      setMcTestDate(editing ? (request.mcActualDate ?? "").slice(0, 10) : "");
      setMcFile(null);
      setQtyFallback(isHandover && request.mhBomLines.length === 0 ? (request.mhQty != null ? String(request.mhQty) : "") : "");
      setFile(null);
      setLogFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request, cfg, isHandover, isLogBook, isProduction, isPmTransfer, isPacking, isQuality, isMc, isAis, editing]);

  /** Net quantity available for packing = Actual Output − Lab Testing Qty. */
  const packNet =
    request?.actualQty != null ? Math.round((request.actualQty - (request.peLabQty ?? 0)) * 1000) / 1000 : null;
  const pkPackedNum = Number(pkPacked);
  const pkPackedValid =
    pkPacked.trim() !== "" && Number.isFinite(pkPackedNum) && pkPackedNum >= 0 && (packNet == null || pkPackedNum <= packNet);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));
  const setHoField = (idx: number, key: "qty" | "lotNo", v: string) =>
    setHoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: v } : r)));

  // Per-new-row raw-material options: active materials + a synthetic entry for a
  // free-text name already typed, so the Combobox can display it.
  const rmOptionsFor = (row: LogRow): ComboOption[] => {
    const opts = s.activeRawMaterials.map((rm) => ({ value: rm.id, label: rm.name }));
    if (!row.rawMaterialId && row.name) opts.unshift({ value: `free:${row.name}`, label: row.name });
    return opts;
  };

  // Additional Issue Slip: the extra RM quantities must sum to the extra qty
  // before the slip can be issued (same rule as the Generate Issue Slip form).
  const aisFilled = aisRows.filter((r) => !isAisRowBlank(r));
  const aisSum = Math.round(aisFilled.reduce((a, r) => a + (Number(r.qty) || 0), 0) * 1000) / 1000;
  const aisTotal = Math.round((Number(aisQty) || 0) * 1000) / 1000;
  const aisMatches = aisTotal > 0 && aisSum === aisTotal;

  const save = async () => {
    if (!request) return;
    // Log Book Entry requires an attachment (a new file, or one already on file).
    if (isLogBook && !logFile && !request.tsAttachmentPath) {
      setErr("An attachment is required for the log book entry.");
      return;
    }
    if (qcBlocked) { setErr("This lot's Additional Issue Slip must be transferred to production before it can be approved or rejected."); return; }
    if (isQuality && !editing && !qcResult) { setErr("Choose Approve or Reject."); return; }
    if (isQuality && qcTestDate && qcTestDate > todayLocalIso()) { setErr("The test date can't be in the future."); return; }
    if (isMc && !editing && !mcResult) { setErr("Choose an outcome — Approve, Reject or Bypass."); return; }
    if (isAis) {
      const r3 = (x: number) => Math.round(x * 1000) / 1000;
      const filled = aisRows.filter((r) => !isAisRowBlank(r));
      const total = r3(Number(aisQty) || 0);
      const sum = r3(filled.reduce((a, r) => a + (Number(r.qty) || 0), 0));
      if (!(total > 0)) { setErr("Enter the additional quantity to produce."); return; }
      if (filled.length === 0) { setErr("Add at least one additional raw material."); return; }
      if (filled.some((r) => !r.rawMaterialId)) { setErr("Every additional line needs a raw material."); return; }
      if (sum !== total) { setErr("The additional raw-material quantities must add up to the additional quantity."); return; }
    }
    if (isFgTransfer && !(fgProdTick && fgHojiwalaTick)) {
      setErr("Confirm both Tally entries — Production → Finished Goods and Finished Goods → Hojiwala — before saving.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of cfg.fields) payload[f.key] = values[f.key] ?? "";

      if (isFgTransfer) {
        payload.fg_prod_to_fg = fgProdTick;
        payload.fg_to_hojiwala = fgHojiwalaTick;
      }

      if (isHandover) {
        if (hoRows.length > 0) {
          payload.mh_bom_lines = hoRows.map((r) => ({
            raw_material_id: r.rawMaterialId,
            unit_id: r.unitId,
            qty: r.qty ?? "",
            lot_no: r.lotNo ?? "",
          }));
        } else {
          payload.mh_qty = qtyFallback;
        }
      }

      if (isLogBook) {
        // Drop LineGrid's trailing blank row before saving.
        const logLines = logRows.filter((r) => !isLogRowBlank(r));
        payload.ts_bom_lines = logLines.map((r) => ({
          raw_material_id: r.rawMaterialId,
          raw_material_name: r.name || null,
          unit_id: r.unitId,
          requested_qty: r.requestedQty ?? "",
          handover_qty: r.handoverQty ?? "",
          actual_use: r.actualUse ?? "",
          lot_no: r.lotNo ?? "",
          is_new: r.isNew,
        }));
        // Output metrics: Expected = Σ actual use; Actual Output = Expected −
        // Production Loss − Scrap; Loose = Actual Output − Lab − Packed.
        const r3 = (x: number) => Math.round(x * 1000) / 1000;
        const expected = r3(logLines.reduce((sm, r) => sm + (Number(r.actualUse) || 0), 0));
        const actual = r3(expected - (Number(logLoss) || 0) - (Number(logScrap) || 0));
        const loose = r3(actual - (Number(logLab) || 0) - (Number(logPacked) || 0));
        payload.pe_expected_qty = String(expected);
        payload.ts_production_loss = logLoss;
        payload.scrap_qty = logScrap;
        payload.actual_qty = String(actual);
        payload.pe_lab_qty = logLab;
        payload.ts_packed_qty = logPacked;
        payload.ts_loose_qty = String(loose);
        // Packing material used (captured here now) — base qty + extra (total = qty + extra).
        payload.pmh_bom_lines = packLinePayload(packRows);
        if (logFile) {
          const up = await uploadStepDocument(request.id, "logbook", logFile);
          payload.ts_attachment_path = up.path;
          payload.ts_attachment_name = up.name;
        }
        // else editing with an existing attachment: omit the keys → RPC keeps it.
      }

      if (isQuality) {
        if (qcFile) {
          const up = await uploadStepDocument(request.id, "quality", qcFile);
          payload.qc_attachment_path = up.path;
          payload.qc_attachment_name = up.name;
        }
        payload.qc_remarks = qcRemarks;
        if (editing) {
          payload.qc_actual_date = qcTestDate; // update the last round's date
        } else {
          payload.qc_result = qcResult;
          payload.qc_test_date = qcTestDate; // blank → server uses today (required only on Test 3)
        }
      }

      if (isMc) {
        if (mcFile) {
          const up = await uploadStepDocument(request.id, "mctesting", mcFile);
          payload.mc_attachment_path = up.path;
          payload.mc_attachment_name = up.name;
        }
        payload.mc_remarks = mcRemarks;
        if (editing) {
          payload.mc_actual_date = mcTestDate; // correct the recorded test's date
        } else {
          payload.mc_result = mcResult;
          payload.mc_test_date = mcTestDate; // blank → server uses today
        }
      }

      if (isAis) {
        payload.ais_qty = aisQty;
        payload.ais_bom_lines = aisRows
          .filter((r) => !isAisRowBlank(r))
          .map((r) => ({ raw_material_id: r.rawMaterialId, qty: r.qty ?? "", unit_id: r.unitId }));
      }

      if (isProduction) {
        // Production entry is now a Tally-posting step; the output metrics were
        // captured at the log book and are shown read-only here.
        payload.pe_tally_entry = prodTally;
      }

      // Repackaging only — the step that stands in for the bypassed production
      // entry. The RPC ignores this key on a production card, so a stale value
      // could never overwrite one recorded at the real step.
      if (pmtNeedsTally) {
        payload.pe_tally_entry = prodTally;
      }

      // Repackaging only. Loose is NOT sent — the server derives it as net − packed
      // from its own figures, so the two can never drift apart.
      if (pkEditsQty) {
        payload.ts_packed_qty = pkPacked;
      }

      if (cfg.hasAttachment && file) {
        const up = await uploadQualityDocument(request.id, file);
        payload.qc_attachment_path = up.path;
        payload.qc_attachment_name = up.name;
      }
      // On create with no file, seed empty attachment keys (a fresh row has none).
      // On edit with no file, OMIT them so the current file is kept (RPC keys on presence).
      if (cfg.hasAttachment && !file && !editing) {
        payload.qc_attachment_path = "";
        payload.qc_attachment_name = "";
      }

      if (editing) await s.updateStep(stepKey, request, payload);
      else await s.recordStep(stepKey, request, payload);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const existing =
    cfg.hasAttachment && request?.qcAttachmentPath ? (
      <StepDocLink path={request.qcAttachmentPath} name={request.qcAttachmentName} />
    ) : isLogBook && request?.tsAttachmentPath ? (
      <StepDocLink path={request.tsAttachmentPath} name={request.tsAttachmentName} />
    ) : isMc && request?.mcAttachmentPath ? (
      <StepDocLink path={request.mcAttachmentPath} name={request.mcAttachmentName} />
    ) : null;

  const titlePrefix = editing && !readOnly ? `Edit ${cfg.title.toLowerCase()}` : readOnly ? cfg.title : cfg.actionLabel;

  // Grand total of a numeric column (sum across all rows, all units) + the list of
  // units present — for the column-aligned totals row shown under each grid.
  const gsum = (vals: Array<number | null | undefined>) => Math.round(vals.reduce<number>((a, v) => a + (v ?? 0), 0) * 1000) / 1000;
  const unitsList = (unitIds: Array<string | null>) => {
    const names: string[] = [];
    for (const id of unitIds) {
      const n = s.unitById(id)?.name;
      if (n && !names.includes(n)) names.push(n);
    }
    return names.join(" · ");
  };

  // Log Book line-item columns (shared LineGrid). Existing handover rows are
  // locked: only Actual Use is editable — their name/lot cells register no focus
  // ref, so Tab skips straight to the next editable cell / row.
  const logColumns: LineGridColumn<LogRow>[] = [
    {
      key: "rm",
      header: "Raw Material",
      className: "min-w-[200px]",
      cell: (row, api) =>
        row.isNew ? (
          <Combobox
            ref={api.focusRef as (el: ComboboxHandle | null) => void}
            value={row.rawMaterialId ?? (row.name ? `free:${row.name}` : "")}
            onChange={(v) => {
              if (v.startsWith("free:")) {
                api.patch({ rawMaterialId: null, name: v.slice(5) });
              } else {
                const rm = s.rawMaterialById(v);
                api.patch({ rawMaterialId: v, name: rm?.name ?? "", unitId: rm?.unitId ?? null });
              }
              api.advance();
            }}
            options={rmOptionsFor(row)}
            placeholder="Pick or type a material…"
            searchable
            triggerClassName="px-2 py-1.5 text-[13px]"
            onTriggerKeyDown={api.keyHandler}
            onCreate={(name) => { api.patch({ rawMaterialId: null, name, unitId: null }); api.advance(); }}
            createLabel={(q) => `Use “${q}”`}
          />
        ) : (
          <span className="text-navy">{row.name}</span>
        ),
    },
    {
      key: "requested",
      header: <span className="block text-right">Requested</span>,
      className: "w-24",
      skipFocus: true,
      cell: (row) => <span className="block text-right tabular-nums text-grey-2">{row.isNew ? "—" : numOrDash(row.requestedQty)}</span>,
    },
    {
      key: "handover",
      header: <span className="block text-right">Handover</span>,
      className: "w-24",
      skipFocus: true,
      cell: (row) => <span className="block text-right tabular-nums text-grey-2">{row.isNew ? "—" : numOrDash(row.handoverQty)}</span>,
    },
    {
      key: "unit",
      header: "Unit",
      className: "w-16",
      skipFocus: true,
      cell: (row) => <span className="text-grey">{s.unitById(row.unitId)?.name ?? "—"}</span>,
    },
    {
      key: "actualUse",
      header: <span className="block text-right">Actual Use</span>,
      className: "w-28",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2 py-1.5 text-[13px] text-right tabular-nums"
          value={row.actualUse}
          onChange={(e) => api.patch({ actualUse: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "lot",
      header: "Issue Lot No.",
      className: "min-w-[140px]",
      cell: (row, api) =>
        row.isNew ? (
          <TextInput
            ref={api.focusRef as (el: HTMLInputElement | null) => void}
            className="w-full px-2 py-1.5 text-[13px]"
            placeholder="Lot no."
            value={row.lotNo}
            onChange={(e) => api.patch({ lotNo: e.target.value })}
            onKeyDown={api.keyHandler}
          />
        ) : (
          <span className="text-grey">{row.lotNo || "—"}</span>
        ),
    },
  ];

  /*
    THE PHONE LAYOUT OF THE SAME ROW. The log book is filled in on the floor with
    the paper book open, so it has to work on a handset — and six columns cannot.
    Below `sm` each raw material becomes a card: its name as the heading, the
    numbers it was issued against as a quiet meta line, and only the two things
    the operator actually types (Actual Use, and the Lot no. on a material they
    added themselves) as full-width fields.

    ⚠ 16px INPUTS, NOT THE TABLE'S 13px. iOS Safari zooms the whole page in when
      a focused input's font-size is under 16px and does not zoom back out — so
      the cheapest way to make a form unusable on an iPhone is to make it neat.
  */
  const mInput = "w-full px-3 py-2 text-[16px] tabular-nums";
  const mLabel = "block mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey-2";
  const logMobileCard = (row: LogRow, api: LineCellApi<LogRow>) => {
    const unit = s.unitById(row.unitId)?.name;
    return (
      <div className="space-y-2.5">
        {row.isNew ? (
          <Combobox
            value={row.rawMaterialId ?? (row.name ? `free:${row.name}` : "")}
            onChange={(v) => {
              if (v.startsWith("free:")) {
                api.patch({ rawMaterialId: null, name: v.slice(5) });
              } else {
                const rm = s.rawMaterialById(v);
                api.patch({ rawMaterialId: v, name: rm?.name ?? "", unitId: rm?.unitId ?? null });
              }
            }}
            options={rmOptionsFor(row)}
            placeholder="Pick or type a material…"
            searchable
            triggerClassName="px-3 py-2 text-[15px]"
            onCreate={(name) => api.patch({ rawMaterialId: null, name, unitId: null })}
            createLabel={(q) => `Use “${q}”`}
          />
        ) : (
          <div className="text-[14px] font-semibold leading-snug text-navy">{row.name}</div>
        )}

        {!row.isNew && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-grey-2">
            <span>Requested <span className="tabular-nums font-semibold text-navy">{numOrDash(row.requestedQty)}</span></span>
            <span>Handover <span className="tabular-nums font-semibold text-navy">{numOrDash(row.handoverQty)}</span></span>
            {unit && <span>{unit}</span>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className={mLabel}>Actual Use{unit ? ` (${unit})` : ""}</span>
            <TextInput
              type="number"
              inputMode="decimal"
              className={mInput}
              value={row.actualUse}
              onChange={(e) => api.patch({ actualUse: e.target.value })}
            />
          </div>
          <div>
            <span className={mLabel}>Issue Lot No.</span>
            {row.isNew ? (
              <TextInput
                className={mInput}
                placeholder="Lot no."
                value={row.lotNo}
                onChange={(e) => api.patch({ lotNo: e.target.value })}
              />
            ) : (
              <span className="block py-2 text-[14px] text-grey">{row.lotNo || "—"}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      // Match the Generate Issue Slip width so multi-column steps (the handover
      // grid especially) show every column without wrapping.
      size="3xl"
      /* The log book is the one step recorded on the floor, on a phone, with the
         paper book open — so below `sm` it becomes a full-height bottom sheet
         with Save under the thumb rather than a card in the middle of the
         screen. Opt-in per step; every other dialog is unchanged. */
      mobileFull={isLogBook}
      title={`${titlePrefix} — ${request?.reqNo ?? ""}`}
      // The Lot/Batch Card number is shown ONCE per step, always with a proper
      // label — either the shared header box below (every step) or the 4-col grid
      // inside Quality / M/C. Never repeated as an unlabeled subtitle.
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy || qcBlocked || (isFgTransfer && !(fgProdTick && fgHojiwalaTick)) || (isAis && !aisMatches) || (isRmTransfer && !(values["rmt_tally_entry"] ?? "").trim()) || ((isProduction || pmtNeedsTally) && !prodTally.trim()) || (pkEditsQty && !pkPackedValid)}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {/* Shared labeled header: the ONE Lot/Batch Card number for every step
            except Quality / M/C, which carry it in their own 4-col grid. */}
        {!isQuality && !isMc && request && (
          <div className="rounded-xl bg-page px-3.5 py-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Lot/Batch Card</span>
              <Link
                to={`/production-entry/requests/${request.id}`}
                onClick={onClose}
                className="text-[14px] font-bold text-navy hover:text-orange hover:underline"
              >
                {request.jobcardNo || request.reqNo}
              </Link>
            </div>
            <div className="text-[12.5px] text-grey">
              FG Item: <span className="font-semibold text-navy">{fgName}</span>
              {fgUnit && <span className="text-grey-2"> · {fgUnit}</span>}
            </div>
          </div>
        )}

        {isHandover && request && (
          <>
            {hoRows.length > 0 ? (
              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">
                  {aisHandoverOpen(request) || aisHandoverEditRound(request) ? "Additional raw materials to hand over (top-up)" : "Raw materials handed over"}
                </span>
                {(aisHandoverOpen(request) || aisHandoverEditRound(request)) && (
                  <p className="text-[12px] text-grey-2">
                    This is the additional raw material from the Additional Issue Slip — the original was already handed over.
                  </p>
                )}
                <div className="rounded-xl border border-line overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                        <th className="font-medium px-3 py-2 min-w-[220px]">Raw Material</th>
                        <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Requested</th>
                        <th className="font-medium px-2 py-2 text-right w-32 whitespace-nowrap">Handover Qty</th>
                        <th className="font-medium px-2 py-2 w-20">Unit</th>
                        <th className="font-medium px-2 py-2 w-48 whitespace-nowrap">Issue Lot No.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hoRows.map((row, i) => (
                        <tr key={i} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-2 text-navy">{s.rawMaterialById(row.rawMaterialId)?.name ?? "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(row.requestedQty)}</td>
                          <td className="px-1.5 py-1.5">
                            <TextInput
                              type="number"
                              disabled={readOnly}
                              className="w-full px-2 py-1.5 text-[13px] text-right tabular-nums"
                              value={row.qty}
                              onChange={(e) => setHoField(i, "qty", e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-2 text-grey">{s.unitById(row.unitId)?.name ?? "—"}</td>
                          <td className="px-1.5 py-1.5">
                            <TextInput
                              disabled={readOnly}
                              className="w-full px-2 py-1.5 text-[13px]"
                              placeholder="Lot no."
                              value={row.lotNo}
                              onChange={(e) => setHoField(i, "lotNo", e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-page/50 text-navy">
                        <td className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(hoRows.map((r) => r.requestedQty))}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(hoRows.map((r) => Number(r.qty) || 0))}</td>
                        <td className="px-2 py-2 text-[12px] text-grey-2">{unitsList(hoRows.map((r) => r.unitId))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <FieldLabel label="Qty">
                <TextInput inputMode="decimal" disabled={readOnly} value={qtyFallback} onChange={(e) => setQtyFallback(e.target.value)} />
              </FieldLabel>
            )}
          </>
        )}

        {isLogBook && request && (
          <>
            {/* The raw-material line items come FIRST (shared LineGrid: auto-append + Tab);
                the Output block follows below. */}
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-navy">Actual use per raw material</span>
              {readOnly ? (
                <div className="rounded-xl border border-line overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                        <th className="font-medium px-3 py-2 min-w-[200px]">Raw Material</th>
                        <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Requested</th>
                        <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Handover</th>
                        <th className="font-medium px-2 py-2 w-16">Unit</th>
                        <th className="font-medium px-2 py-2 text-right w-28 whitespace-nowrap">Actual Use</th>
                        <th className="font-medium px-2 py-2 w-40 whitespace-nowrap">Issue Lot No.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logRows.map((row) => (
                        <tr key={row.uid} className="border-b border-line/70 last:border-0">
                          <td className="px-3 py-2 text-navy">{row.name || "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-grey-2">{row.isNew ? "—" : numOrDash(row.requestedQty)}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-grey-2">{row.isNew ? "—" : numOrDash(row.handoverQty)}</td>
                          <td className="px-2 py-2 text-grey">{s.unitById(row.unitId)?.name ?? "—"}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-navy">{row.actualUse || "—"}</td>
                          <td className="px-2 py-2 text-grey">{row.lotNo || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line bg-page/50 text-navy">
                        <td className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(logRows.map((r) => (r.isNew ? null : r.requestedQty)))}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(logRows.map((r) => (r.isNew ? null : r.handoverQty)))}</td>
                        <td className="px-2 py-2 text-[12px] text-grey-2">{unitsList(logRows.map((r) => r.unitId))}</td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(logRows.map((r) => Number(r.actualUse) || 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <LineGrid
                  rows={logRows}
                  onRowsChange={setLogRows}
                  columns={logColumns}
                  makeEmptyRow={makeEmptyLogRow}
                  isRowBlank={isLogRowBlank}
                  canRemove={(r) => r.isNew}
                  mobileCard={logMobileCard}
                  mobileFooter={
                    <div className="flex items-center justify-between bg-page/50 px-3 py-2.5 text-[12.5px]">
                      <span className="font-semibold uppercase tracking-wide text-grey-2">Total actual use</span>
                      <span className="tabular-nums font-bold text-navy">
                        {gsum(logRows.map((r) => Number(r.actualUse) || 0))}
                        <span className="ml-1 font-normal text-grey-2">{unitsList(logRows.map((r) => r.unitId))}</span>
                      </span>
                    </div>
                  }
                  footer={
                    <tfoot>
                      <tr className="border-t border-line bg-page/50 text-navy">
                        <td className="px-2.5 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                        <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{gsum(logRows.map((r) => (r.isNew ? null : r.requestedQty)))}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{gsum(logRows.map((r) => (r.isNew ? null : r.handoverQty)))}</td>
                        <td className="px-2.5 py-2 text-[12px] text-grey-2">{unitsList(logRows.map((r) => r.unitId))}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{gsum(logRows.map((r) => Number(r.actualUse) || 0))}</td>
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  }
                />
              )}
            </div>

            {/* Output metrics — shown AFTER the actual-use block, before packing. */}
            {(() => {
              const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
              const val = "text-[15px] font-bold text-navy tabular-nums";
              const unit = fgUnit ? <span className="text-[11px] font-normal text-grey-2"> {fgUnit}</span> : null;
              const r3 = (x: number) => Math.round(x * 1000) / 1000;
              const expected = r3(logRows.reduce((sm, r) => sm + (Number(r.actualUse) || 0), 0));
              const actual = r3(expected - (Number(logLoss) || 0) - (Number(logScrap) || 0));
              const loose = r3(actual - (Number(logLab) || 0) - (Number(logPacked) || 0));
              return (
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-medium text-navy">Output</span>
                  {/* Expected − Production Loss − Scrap = Actual Output; then the split
                      (Lab, Packed → Loose = Actual − Lab − Packed). */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 rounded-xl bg-page px-3.5 py-3 items-start">
                    <div><div className={cap}>Expected Qty</div><div className={`${val} pt-0.5`}>{expected}{unit}</div></div>
                    <div><div className={cap}>Production Loss</div><TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logLoss} onChange={(e) => setLogLoss(e.target.value)} placeholder="0" /></div>
                    <div><div className={cap}>Scrap Qty</div><TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logScrap} onChange={(e) => setLogScrap(e.target.value)} placeholder="0" /></div>
                    <div><div className={cap}>Actual Output</div><div className={`${val} pt-0.5`}>{actual}{unit}</div></div>
                    <div><div className={cap}>Lab Testing Qty</div><TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logLab} onChange={(e) => setLogLab(e.target.value)} placeholder="0" /></div>
                    <div><div className={cap}>Packed Qty</div><TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logPacked} onChange={(e) => setLogPacked(e.target.value)} placeholder="0" /></div>
                    <div><div className={cap}>Loose Qty</div><div className={`${val} pt-0.5`}>{loose}{unit}</div></div>
                  </div>
                  <p className="text-[11.5px] text-grey-2">
                    Actual Output = Expected − Production Loss − Scrap · Loose = Actual Output − Lab − Packed{fgUnit ? ` · all quantities in ${fgUnit}` : ""}
                  </p>
                </div>
              );
            })()}

            {/* Packing material used — captured at the log book. Base qty auto-fills
                from the item's pack size ÷ Packed Qty. Extra is manual, except CAP
                items which auto-fill Extra = 7% of qty (rounded). Total = qty + extra. */}
            <PackLinesGrid
              rows={packRows}
              onRowsChange={setPackRows}
              packedQty={logPacked}
              readOnly={readOnly}
              lines={request.pmhBomLines}
              onRaiseMaster={(name) => setRaise({ mt: "packaging_item", prefill: { name } })}
            />

            {/* Photograph the log book page, or attach a scan. The entry is made
                on the floor with the book open, so the camera is the primary path. */}
            <FieldLabel label="Attachment" required hint={editing ? "photograph or choose a file to replace it" : "required — a photo of the log book page, or a file"}>
              <FileCapture value={logFile} onChange={setLogFile} disabled={readOnly} />
              {request.tsAttachmentPath && (
                <div className="mt-1 text-[12px] text-grey-2">
                  Current file: <StepDocLink path={request.tsAttachmentPath} name={request.tsAttachmentName} />
                </div>
              )}
            </FieldLabel>
            {/* Batch Card export/print lives on the Log Book queue's Completed rows
                (TransferSlipQueue) — it belongs to a recorded entry, not this form. */}
          </>
        )}

        {isQuality && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          // FG quantity may have grown via Additional Issue Slip top-ups: show the
          // original, the additional total, and their sum when any top-up exists.
          const aisAdditional = request.aisRounds.reduce((a, rd) => a + (rd.aisQty ?? 0), 0);
          const totalFg = (request.fgQty ?? 0) + aisAdditional;
          const uSuffix = fgUnit ? <span className="text-[12px] font-normal text-grey-2"> {fgUnit}</span> : null;
          const round = request.qcRounds.length + (editing ? 0 : 1);
          const roundLabel = round === 1 ? "Test 1 — first test" : `Test ${round} — retest`;
          // Where the blocked lot's top-up currently sits — for the message.
          const loopStageLabel =
            request.status === "awaiting_material_handover" ? "Material Handover Confirmation"
            : request.status === "awaiting_rm_transfer" ? "RM Transfer to Production"
            : "Generate Additional Issue Slip";
          const btn = (v: "approved" | "rejected", label: string, on: string, off: string) => (
            <button
              type="button"
              disabled={readOnly || editing || qcBlocked}
              onClick={() => setQcResult(v)}
              className={`flex-1 rounded-xl border px-3 py-2 text-[13px] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${qcResult === v ? on : off}`}
            >
              {label}
            </button>
          );
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className={cap}>Lot/Batch Card</div><div className="text-[14px] font-semibold text-navy leading-tight">{request.jobcardNo || "—"}</div></div>
                <div><div className={cap}>FG Item</div><div className="text-[14px] font-semibold text-navy leading-tight">{fgName}{fgUnit && <span className="text-[12px] font-normal text-grey-2"> · {fgUnit}</span>}</div></div>
                {aisAdditional > 0 ? (
                  <>
                    <div><div className={cap}>Original Qty</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.fgQty)}{uSuffix}</div></div>
                    <div><div className={cap}>Additional Qty</div><div className="text-[15px] font-bold text-orange tabular-nums">+{Math.round(aisAdditional * 1000) / 1000}{uSuffix}</div></div>
                    <div><div className={cap}>Total FG Qty</div><div className="text-[15px] font-bold text-navy tabular-nums">{Math.round(totalFg * 1000) / 1000}{uSuffix}</div></div>
                  </>
                ) : (
                  <div><div className={cap}>FG Quantity</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.fgQty)}{uSuffix}</div></div>
                )}
              </div>

              {qcBlocked && (
                <div className="rounded-xl border border-ryg-red/40 bg-[#FDECEC] px-3.5 py-2.5 text-[12.5px] text-ryg-red">
                  <span className="font-semibold">Can't approve or reject yet.</span> This lot was rejected and its
                  Additional Issue Slip is still at the <span className="font-semibold">{loopStageLabel}</span> stage.
                  The additional raw material must be transferred to production before this lot can be re-tested — approve,
                  reject and save stay disabled until then.
                </div>
              )}

              {request.qcRounds.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-medium text-navy">Test history</span>
                  <div className="rounded-xl border border-line divide-y divide-line/70">
                    {request.qcRounds.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                        <span className="text-navy font-medium">Test {r.round}</span>
                        <span className={r.result === "approved" ? "text-ryg-green font-semibold" : "text-ryg-red font-semibold"}>
                          {r.result === "approved" ? "Approved" : "Rejected"}
                        </span>
                        <span className="text-grey-2">{dmy(r.testDate)}</span>
                        <span className="flex-1 text-grey truncate">{r.remarks || ""}</span>
                        {r.attachmentPath && <StepDocLink path={r.attachmentPath} name={r.attachmentName} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {request.qcRetestDue && !editing && (
                <div className="rounded-xl bg-orange-soft px-3.5 py-2 text-[12.5px] text-orange font-medium">
                  Retest due by {dmy(request.qcRetestDue)}
                </div>
              )}

              <div className="space-y-3">
                <div className="text-[13px] font-semibold text-navy">{roundLabel}</div>
                {editing ? (
                  <div className="text-[12.5px] text-grey">
                    Result: <span className={qcResult === "approved" ? "text-ryg-green font-semibold" : "text-ryg-red font-semibold"}>{qcResult === "approved" ? "Approved" : "Rejected"}</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {btn("approved", "Approve", "border-ryg-green bg-[#E9F8EF] text-ryg-green", "border-line text-grey hover:border-ryg-green/50")}
                    {btn("rejected", "Reject", "border-ryg-red bg-[#FDECEC] text-ryg-red", "border-line text-grey hover:border-ryg-red/50")}
                  </div>
                )}
                {!editing && (
                  <p className="text-[12px] text-grey-2">A rejection raises an Additional Issue Slip and re-tests in 2 days.</p>
                )}

                <FieldLabel label="Test date" hint="defaults to today · no future dates">
                  <TextInput type="date" max={todayLocalIso()} disabled={readOnly} value={qcTestDate} onChange={(e) => setQcTestDate(e.target.value)} />
                </FieldLabel>

                <FieldLabel label="Remarks">
                  <TextArea rows={2} disabled={readOnly} value={qcRemarks} onChange={(e) => setQcRemarks(e.target.value)} placeholder="Testing remarks" />
                </FieldLabel>

                <FieldLabel label="Attachment of testing" hint={editing ? "choose a file to replace it" : "optional"}>
                  <input
                    type="file"
                    disabled={readOnly}
                    onChange={(e) => setQcFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
                  />
                </FieldLabel>
              </div>
            </>
          );
        })()}

        {isMc && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const priorReject = !editing && request.mcStatus === "rejected";
          const mcLabel = mcResult ? mcResult[0].toUpperCase() + mcResult.slice(1) : "";
          const btn = (v: "approved" | "rejected" | "bypassed", label: string, on: string, off: string) => (
            <button
              type="button"
              disabled={readOnly || editing}
              onClick={() => setMcResult(v)}
              className={`flex-1 rounded-xl border px-3 py-2 text-[13px] font-semibold transition ${mcResult === v ? on : off}`}
            >
              {label}
            </button>
          );
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className={cap}>Lot/Batch Card</div><div className="text-[14px] font-semibold text-navy leading-tight">{request.jobcardNo || "—"}</div></div>
                <div><div className={cap}>FG Item</div><div className="text-[14px] font-semibold text-navy leading-tight">{fgName}{fgUnit && <span className="text-[12px] font-normal text-grey-2"> · {fgUnit}</span>}</div></div>
                <div><div className={cap}>Lab Testing Qty</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.peLabQty)}</div></div>
                <div><div className={cap}>Actual Output</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.actualQty)}</div></div>
              </div>

              {priorReject && (
                <div className="rounded-xl bg-[#FDECEC] px-3.5 py-2 text-[12.5px] text-ryg-red font-medium">
                  A previous M/C test was rejected{request.mcActualDate ? ` on ${dmy(request.mcActualDate)}` : ""} — record the re-test below.
                </div>
              )}

              <div className="space-y-3">
                {editing ? (
                  <div className="text-[12.5px] text-grey">
                    Result: <span className={mcResult === "approved" ? "text-ryg-green font-semibold" : mcResult === "bypassed" ? "text-orange font-semibold" : "text-ryg-red font-semibold"}>{mcLabel}</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {btn("approved", "Approve", "border-ryg-green bg-[#E9F8EF] text-ryg-green", "border-line text-grey hover:border-ryg-green/50")}
                    {btn("rejected", "Reject", "border-ryg-red bg-[#FDECEC] text-ryg-red", "border-line text-grey hover:border-ryg-red/50")}
                    {s.isAdmin && btn("bypassed", "Bypass", "border-orange bg-orange-soft text-orange", "border-line text-grey hover:border-orange/50")}
                  </div>
                )}
                {!editing && s.isAdmin && (
                  <p className="text-[12px] text-grey-2">Bypass is admin-only — it skips the machine test and is recorded as a bypass.</p>
                )}

                {editing ? (
                  <FieldLabel label="Test date">
                    <TextInput type="date" disabled={readOnly} value={mcTestDate} onChange={(e) => setMcTestDate(e.target.value)} />
                  </FieldLabel>
                ) : (
                  <p className="text-[12px] text-grey-2">Test date is captured automatically as today.</p>
                )}

                <FieldLabel label="Remarks">
                  <TextArea rows={2} disabled={readOnly} value={mcRemarks} onChange={(e) => setMcRemarks(e.target.value)} placeholder="M/C testing remarks" />
                </FieldLabel>

                <FieldLabel label="Attachment of testing" hint={editing ? "choose a file to replace it" : "optional"}>
                  <input
                    type="file"
                    disabled={readOnly}
                    onChange={(e) => setMcFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
                  />
                  {request.mcAttachmentPath && (
                    <div className="mt-1 text-[12px] text-grey-2">
                      Current file: <StepDocLink path={request.mcAttachmentPath} name={request.mcAttachmentName} />
                    </div>
                  )}
                </FieldLabel>
              </div>
            </>
          );
        })()}

        {isProduction && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const val = "text-[15px] font-bold text-navy tabular-nums";
          const unit = fgUnit ? <span className="text-[11px] font-normal text-grey-2"> {fgUnit}</span> : null;
          const metric = (n: number | null) => (n != null ? <>{n}{unit}</> : "—");
          return (
            <>
              {/* Output metrics are captured at the log book and shown read-only
                  here (this is the Tally-posting step). */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 rounded-xl bg-page px-3.5 py-3 items-start">
                <div><div className={cap}>Expected Qty</div><div className={`${val} pt-0.5`}>{metric(request.peExpectedQty)}</div></div>
                <div><div className={cap}>Production Loss</div><div className={`${val} pt-0.5`}>{metric(request.tsProductionLoss)}</div></div>
                <div><div className={cap}>Scrap Qty</div><div className={`${val} pt-0.5`}>{metric(request.scrapQty)}</div></div>
                <div><div className={cap}>Actual Output</div><div className={`${val} pt-0.5`}>{metric(request.actualQty)}</div></div>
                <div><div className={cap}>Lab Testing Qty</div><div className={`${val} pt-0.5`}>{metric(request.peLabQty)}</div></div>
                <div><div className={cap}>Packed Qty</div><div className={`${val} pt-0.5`}>{metric(request.tsPackedQty)}</div></div>
                <div><div className={cap}>Loose Qty</div><div className={`${val} pt-0.5`}>{metric(request.tsLooseQty)}</div></div>
              </div>

              <FieldLabel label="Tally Entry" required hint="Tally entry number for the production posting">
                <TextInput disabled={readOnly} value={prodTally} onChange={(e) => setProdTally(e.target.value)} placeholder="e.g. voucher / entry no." />
              </FieldLabel>

              {request.tsBomLines.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-medium text-navy">Raw materials (from log book)</span>
                  <div className="rounded-xl border border-line overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                          <th className="font-medium px-3 py-2 min-w-[200px]">Raw Material</th>
                          <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Requested</th>
                          <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Handover</th>
                          <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Actual Use</th>
                          <th className="font-medium px-2 py-2 w-16">Unit</th>
                          <th className="font-medium px-3 py-2 min-w-[160px] whitespace-nowrap">Issue Lot Number</th>
                        </tr>
                      </thead>
                      <tbody>
                        {request.tsBomLines.map((l, i) => (
                          <tr key={i} className="border-b border-line/70 last:border-0">
                            <td className="px-3 py-2 text-navy">{l.rawMaterialName || s.rawMaterialById(l.rawMaterialId)?.name || "—"}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.requestedQty)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.handoverQty)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-navy">{numOrDash(l.actualUse)}</td>
                            <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                            <td className="px-3 py-2 text-navy whitespace-nowrap">{l.lotNo || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-line bg-page/50 text-navy">
                          <td className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(request.tsBomLines.map((l) => l.requestedQty))}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(request.tsBomLines.map((l) => l.handoverQty))}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(request.tsBomLines.map((l) => l.actualUse))}</td>
                          <td className="px-2 py-2 text-[12px] text-grey-2">{unitsList(request.tsBomLines.map((l) => l.unitId))}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {isAis && request && (() => {
          const filled = aisFilled;
          const sum = aisSum;
          const total = aisTotal;
          const matches = aisMatches;
          const aisRmOptionsFor = (row: AisEditRow): ComboOption[] => {
            const taken = new Set(aisRows.filter((l) => l.uid !== row.uid && l.rawMaterialId).map((l) => l.rawMaterialId));
            return s.activeRawMaterials.filter((rm) => !taken.has(rm.id)).map((rm) => ({ value: rm.id, label: rm.name }));
          };
          const aisColumns: LineGridColumn<AisEditRow>[] = [
            {
              key: "rm",
              header: "Additional Raw Material",
              className: "min-w-[240px]",
              cell: (row, api) => (
                <Combobox
                  ref={api.focusRef as (el: ComboboxHandle | null) => void}
                  value={row.rawMaterialId ?? ""}
                  onChange={(v) => { api.patch({ rawMaterialId: v, unitId: s.rawMaterialById(v)?.unitId ?? null, qty: row.qty || "1" }); api.advance(); }}
                  options={aisRmOptionsFor(row)}
                  placeholder="Select raw material…"
                  searchable
                  triggerClassName="px-2.5 py-1.5 text-[13.5px]"
                  onTriggerKeyDown={api.keyHandler}
                  onCreate={(name) => setRaise({ mt: "raw_material", prefill: { name } })}
                  createLabel={(q) => `Request new raw material “${q}”`}
                />
              ),
            },
            {
              key: "qty",
              header: <span className="block text-right">Qty</span>,
              className: "w-28 min-w-[6.5rem]",
              cell: (row, api) => (
                <TextInput ref={api.focusRef as (el: HTMLInputElement | null) => void} type="number" className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums" value={row.qty} onChange={(e) => api.patch({ qty: e.target.value })} onKeyDown={api.keyHandler} />
              ),
            },
            {
              key: "unit",
              header: "Unit",
              className: "w-20",
              skipFocus: true,
              cell: (row) => <span className="text-grey">{s.unitById(row.unitId)?.name ?? "—"}</span>,
            },
          ];
          return (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1">FG Item</div><div className="text-[14px] font-semibold text-navy leading-tight">{fgName}{fgUnit && <span className="text-[12px] font-normal text-grey-2"> · {fgUnit}</span>}</div></div>
                <div><div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1">Original FG Qty</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.fgQty)}</div></div>
                <div><div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1">Retest due</div><div className="text-[14px] font-semibold text-navy">{request.qcRetestDue ? dmy(request.qcRetestDue) : "—"}</div></div>
              </div>

              <FieldLabel label="Additional FG Quantity" required hint="the additional raw materials below must add up to this">
                <TextInput type="number" disabled={readOnly} className="text-right tabular-nums" value={aisQty} onChange={(e) => setAisQty(e.target.value)} placeholder="e.g. 50" />
              </FieldLabel>

              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">Additional raw materials</span>
                <LineGrid
                  rows={aisRows}
                  onRowsChange={setAisRows}
                  columns={aisColumns}
                  makeEmptyRow={makeEmptyAisRow}
                  isRowBlank={isAisRowBlank}
                  footer={
                    <tfoot>
                      <tr className="border-t border-line bg-page/50 text-navy">
                        <td className="px-2.5 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                        <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{sum}</td>
                        <td className="px-2.5 py-2 text-[12px] text-grey-2">{unitsList(aisRows.map((r) => r.unitId))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  }
                />
                {filled.length > 0 && (
                  <div className={`text-[12.5px] font-medium ${matches ? "text-ryg-green" : "text-ryg-red"}`}>
                    Additional RM total: <span className="tabular-nums">{sum}</span>
                    {total > 0 && <> / additional qty <span className="tabular-nums">{total}</span></>}
                    {total > 0 && !matches && " — must match to issue the slip"}
                  </div>
                )}
              </div>

              <div className="pt-1 border-t border-line">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1.5">Export additional issue slip</div>
                <ExportButtons label="additional issue slip" />
              </div>
            </>
          );
        })()}

        {isPmTransfer && request && (() => {
          const lines = request.pmhBomLines;
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          return (
            <>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-page px-3.5 py-3">
                {/* On a repackaging card the number is ENTERED below, not shown
                    here — repeating it read-only above its own input reads as two
                    different fields. */}
                {!pmtNeedsTally && (
                  <div><div className={cap}>Production Entry Tally No.</div><div className="text-[14px] font-semibold text-navy leading-tight">{request.peTallyEntry || "—"}</div></div>
                )}
                <div><div className={cap}>FG Packed Qty</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.pmhQty)}</div></div>
              </div>

              {pmtNeedsTally && (
                <FieldLabel
                  label="Production Entry Tally No."
                  required
                  hint="a repackaging card skips the production entry step, so its Tally number is recorded here"
                >
                  <TextInput disabled={readOnly} value={prodTally} onChange={(e) => setProdTally(e.target.value)} placeholder="e.g. voucher / entry no." />
                </FieldLabel>
              )}

              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">Packaging items (from log book)</span>
                <div className="rounded-xl border border-line overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                        <th className="font-medium px-3 py-2 min-w-[220px]">Packaging Item</th>
                        <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Base Qty</th>
                        <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Extra</th>
                        <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Total</th>
                        <th className="font-medium px-2 py-2 w-20">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-3 text-grey-2">No packaging items were recorded in the log book.</td></tr>
                      ) : (
                        lines.map((l, i) => (
                          <tr key={i} className="border-b border-line/70 last:border-0">
                            <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.qty)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.extra)}</td>
                            <td className="px-2 py-2 text-right tabular-nums font-semibold text-navy">{numOrDash(packFinalQty(l))}</td>
                            <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {lines.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-line bg-page/50 text-navy">
                          <td className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(lines.map((l) => l.qty))}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(lines.map((l) => l.extra))}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(lines.map(packFinalQty))}</td>
                          <td className="px-2 py-2 text-[12px] text-grey-2">{unitsList(lines.map((l) => l.unitId))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          );
        })()}

        {isRmTransfer && request && (() => {
          // After an Additional Issue Slip top-up, RM Transfer moves the ADDITIONAL
          // raw material of the open round — the original RM was already transferred
          // in the first pass. Show that round's handover lines (its "requested" is
          // the round's additional BOM), not the base ones.
          const lastRound = request.aisRounds[request.aisRounds.length - 1];
          const aisRound = lastRound && lastRound.mhDone && !lastRound.rmtDone ? lastRound : null;
          const lines = aisRound ? (aisRound.mhLines ?? []) : request.mhBomLines;
          if (lines.length === 0) return null;
          const requestedFor = (rmId: string | null): number | null =>
            aisRound
              ? aisRound.aisBomLines.find((b) => b.rawMaterialId === rmId)?.qty ?? null
              : request.bomLines.find((b) => b.rawMaterialId === rmId)?.requiredQty ?? null;
          return (
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-navy">
                {aisRound ? "Additional raw materials to transfer (top-up)" : "Raw materials handed over"}
              </span>
              {aisRound && (
                <p className="text-[12px] text-grey-2">
                  The original raw material was already transferred; only this top-up's additional raw material is transferred now.
                </p>
              )}
              <div className="rounded-xl border border-line overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                      <th className="font-medium px-3 py-2 min-w-[200px]">Raw Material</th>
                      <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Requested</th>
                      <th className="font-medium px-2 py-2 text-right w-24 whitespace-nowrap">Handover</th>
                      <th className="font-medium px-2 py-2 w-16">Unit</th>
                      <th className="font-medium px-2 py-2 w-40 whitespace-nowrap">Issue Lot No.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-2 text-navy">{s.rawMaterialById(l.rawMaterialId)?.name ?? "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(requestedFor(l.rawMaterialId))}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.qty)}</td>
                        <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                        <td className="px-2 py-2 text-grey">{l.lotNo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-page/50 text-navy">
                      <td className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(lines.map((l) => requestedFor(l.rawMaterialId)))}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(lines.map((l) => l.qty))}</td>
                      <td className="px-2 py-2 text-[12px] text-grey-2">{unitsList(lines.map((l) => l.unitId))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })()}

        {isPacking && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const val = "text-[15px] font-bold text-navy tabular-nums";
          const unit = fgUnit ? <span className="text-[11px] font-normal text-grey-2"> {fgUnit}</span> : null;
          const metric = (n: number | null) => (n != null ? <>{n}{unit}</> : "—");
          const net = packNet;
          const lines = request.pmhBomLines;
          // Repackaging: Loose follows the typed Packed figure. Blank input → show
          // nothing rather than the full net, which would read as a real number.
          const looseNow =
            net == null || !pkPackedValid ? null : Math.round((net - pkPackedNum) * 1000) / 1000;
          // Matches the TextInput's box height (py-1.5 + 14px text + border).
          const valRow = pkEditsQty ? "min-h-[35px] flex items-center" : "";
          return (
            <>
              {/* Lot/Batch Card + FG item are in the shared header above. */}
              {/* One value ROW across all four cells, not four differently-sized
                  boxes. An input is ~34px tall and centres its text; a bare <div>
                  of text is ~20px and sits at the top of the cell — so next to the
                  editable Packed Qty the read-only figures read as a line above it.
                  Giving every value the input's height puts them all on one line.
                  Only when the input is actually there; a production card keeps the
                  tighter row it has always had. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className={cap}>Net Qty for Packing</div><div className={`${val} ${valRow}`}>{metric(net)}</div></div>
                <div>
                  <div className={cap}>Packed Qty{pkEditsQty && <span className="text-orange"> *</span>}</div>
                  {pkEditsQty ? (
                    <TextInput
                      type="number"
                      inputMode="decimal"
                      disabled={readOnly}
                      className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums"
                      value={pkPacked}
                      onChange={(e) => setPkPacked(e.target.value)}
                      placeholder="0"
                    />
                  ) : (
                    <div className={`${val} ${valRow}`}>{metric(request.tsPackedQty)}</div>
                  )}
                </div>
                <div>
                  <div className={cap}>Loose Qty</div>
                  <div className={`${val} ${valRow}`}>{metric(pkEditsQty ? looseNow : request.tsLooseQty)}</div>
                </div>
                <div><div className={cap}>Production Tally Entry</div><div className={`text-[14px] font-semibold text-navy leading-tight ${valRow}`}>{request.peTallyEntry || "—"}</div></div>
              </div>

              {pkEditsQty && (
                <p className="text-[11.5px] text-grey-2">
                  Loose Qty = Net Qty for Packing − Packed Qty
                  {net != null && <> · the packed quantity cannot be more than {net}{fgUnit ? ` ${fgUnit}` : ""}</>}.
                </p>
              )}

              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">Packaging items (from log book)</span>
                <div className="rounded-xl border border-line overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                        <th className="font-medium px-3 py-2 min-w-[220px]">Packaging Item</th>
                        <th className="font-medium px-2 py-2 text-right w-28 whitespace-nowrap">Qty</th>
                        <th className="font-medium px-2 py-2 w-20">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 ? (
                        <tr><td colSpan={3} className="px-3 py-3 text-grey-2">No packaging items were recorded in the log book.</td></tr>
                      ) : (
                        lines.map((l, i) => (
                          <tr key={i} className="border-b border-line/70 last:border-0">
                            <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-navy">{numOrDash(packFinalQty(l))}</td>
                            <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {lines.length > 0 && (
                      <tfoot>
                        <tr className="border-t border-line bg-page/50 text-navy">
                          <td className="px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">{gsum(lines.map(packFinalQty))}</td>
                          <td className="px-2 py-2 text-[12px] text-grey-2">{unitsList(lines.map((l) => l.unitId))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              <p className="text-[12px] text-grey-2">
                {pkEditsQty
                  ? "Enter the quantity actually packed, then Save to log this packing entry in Tally."
                  : "Review the details above, then Save to log this packing entry in Tally."}
              </p>
            </>
          );
        })()}

        {isFgTransfer && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const val = "text-[15px] font-bold text-navy tabular-nums";
          const unit = fgUnit ? <span className="text-[11px] font-normal text-grey-2"> {fgUnit}</span> : null;
          const tick = (
            checked: boolean,
            set: (v: boolean) => void,
            title: string,
            sub: string,
          ) => (
            <label
              className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 transition ${readOnly ? "cursor-default" : "cursor-pointer"} ${checked ? "border-ryg-green bg-[#E9F8EF]" : "border-line hover:border-orange/50"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={readOnly}
                onChange={(e) => set(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-ryg-green"
              />
              <span className="leading-tight">
                <span className="block text-[13.5px] font-semibold text-navy">{title}</span>
                <span className="block text-[12px] text-grey-2">{sub}</span>
              </span>
            </label>
          );
          return (
            <>
              {/* Lot/Batch Card + FG item are in the shared header above. */}
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className={cap}>Packed Qty</div><div className={val}>{request.tsPackedQty != null ? <>{request.tsPackedQty}{unit}</> : "—"}</div></div>
                <div><div className={cap}>Production Tally Entry</div><div className="text-[14px] font-semibold text-navy leading-tight">{request.peTallyEntry || "—"}</div></div>
              </div>

              <div className="space-y-2">
                <span className="block text-[13px] font-medium text-navy">Confirm both Tally entries</span>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {tick(fgProdTick, setFgProdTick, "Production → Finished Goods", "Tally entry made")}
                  {tick(fgHojiwalaTick, setFgHojiwalaTick, "Finished Goods → Hojiwala", "Tally entry made")}
                </div>
                {!readOnly && (
                  <p className="text-[12px] text-grey-2">
                    Both entries must be made in Tally and ticked here before you can Save — saving closes the job card.
                  </p>
                )}
              </div>
            </>
          );
        })()}

        {cfg.fields.map((f) => (
          <FieldLabel key={f.key} label={f.label} hint={f.hint} required={f.required}>
            {f.kind === "status" ? (
              <Combobox
                value={values[f.key] ?? ""}
                onChange={(v) => setField(f.key, v)}
                options={STATUS_OPTIONS}
                placeholder="Select status"
              />
            ) : f.kind === "textarea" ? (
              <TextArea rows={2} value={values[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder} />
            ) : f.kind === "date" ? (
              <TextInput type="date" value={values[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} />
            ) : (
              <TextInput
                value={values[f.key] ?? ""}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
          </FieldLabel>
        ))}

        {cfg.hasAttachment && (
          <FieldLabel label="Attachment of testing" hint={editing ? "choose a file to replace it" : "optional lab report"}>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
            />
            {editing && existing && <div className="mt-1 text-[12px] text-grey-2">Current file: {existing}</div>}
          </FieldLabel>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>

    {/* Sibling of the dialog, never its child: in read-only mode the body sits
        inside a <fieldset disabled>, which would render this inert. */}
    <RequestMasterModal
      open={raise !== null}
      onClose={() => setRaise(null)}
      masterType={raise?.mt ?? null}
      lockType
      stacked
      prefill={raise?.prefill}
    />
    </>
  );
}
