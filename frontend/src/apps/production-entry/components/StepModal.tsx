import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import LineGrid, { newUid, type LineGridColumn } from "@/shared/components/ui/LineGrid";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useProductionStore } from "../store";
import { uploadQualityDocument, uploadStepDocument } from "../data/productionWrites";
import { dmy, numOrDash } from "../lib/format";
import { STATUS_OPTIONS, STEP_CONFIG } from "../lib/stepConfig";
import type { QueueStep } from "../lib/queues";
import type { ProductionRequest } from "../types";

export interface StepModalProps {
  open: boolean;
  onClose: () => void;
  request: ProductionRequest | null;
  editing?: boolean;
  readOnly?: boolean;
}

/** Opens the stored quality document via a fresh short-lived signed URL. */
function QcDocLink({ path, name }: { path: string; name: string | null }) {
  const s = useProductionStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.qcDocumentUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced elsewhere */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex max-w-[240px] items-center gap-1.5 text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-60"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{busy ? "Opening…" : name || "View attachment"}</span>
    </button>
  );
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

/** One packing-material handover row being edited: the picked packaging item (with
 *  its own unit, auto-shown) and the quantity handed over. Drives the shared LineGrid. */
interface PackRow {
  uid: string;
  packagingItemId: string | null;
  unitId: string | null;
  qty: string;
}
const makeEmptyPackRow = (): PackRow => ({ uid: newUid(), packagingItemId: null, unitId: null, qty: "" });
// Blank means blank — no default qty here (see LineGrid's trailing-blank invariant).
const isPackRowBlank = (r: PackRow) => !r.packagingItemId && !(r.qty ?? "").trim();

/** Suggested packaging qty from the item's numeric name PREFIX (its pack size):
 *  FG packed qty ÷ prefix, rounded. e.g. "10 Kg Can" → fgQty/10; "5 Ltr" → fgQty/5.
 *  Blank when there is no numeric prefix or no FG packed qty yet. The user can override. */
const packQtyFromPrefix = (name: string | undefined, fgPackedQty: string): string => {
  const m = (name ?? "").trim().match(/^(\d+)/);
  const div = m ? Number(m[1]) : 0;
  const fg = Number(fgPackedQty);
  if (!div || !fg || !Number.isFinite(fg)) return "";
  return String(Math.round(fg / div));
};

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
  const isMc = stepKey === "mc_testing";
  const isPmHandover = stepKey === "pm_handover";
  const isPmTransfer = stepKey === "pm_transfer";
  const isPacking = stepKey === "packing_entry";
  const isFgTransfer = stepKey === "fg_transfer";
  const [values, setValues] = useState<Record<string, string>>({});
  const [hoRows, setHoRows] = useState<HandoverRow[]>([]);
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  // Output metrics are captured at the LOG BOOK now (scrap/lab/packed are entered;
  // expected/actual/loose derive). Production entry only captures the Tally entry.
  const [logScrap, setLogScrap] = useState("");
  const [logLab, setLogLab] = useState("");
  const [logPacked, setLogPacked] = useState("");
  const [prodTally, setProdTally] = useState("");
  // FG transfer: the two Tally-entry confirmations that gate Save.
  const [fgProdTick, setFgProdTick] = useState(false);
  const [fgHojiwalaTick, setFgHojiwalaTick] = useState(false);
  const [packRows, setPackRows] = useState<PackRow[]>([]);
  const [pmhQty, setPmhQty] = useState("");
  const [qcResult, setQcResult] = useState<"approved" | "rejected" | "">("");
  const [qcRemarks, setQcRemarks] = useState("");
  const [qcTestDate, setQcTestDate] = useState("");
  const [qcFile, setQcFile] = useState<File | null>(null);
  const [mcResult, setMcResult] = useState<"approved" | "rejected" | "">("");
  const [mcRemarks, setMcRemarks] = useState("");
  const [mcTestDate, setMcTestDate] = useState("");
  const [mcFile, setMcFile] = useState<File | null>(null);
  const [qtyFallback, setQtyFallback] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [logFile, setLogFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logFileRef = useRef<HTMLInputElement>(null);

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
    const requestedByRm = new Map(r.bomLines.map((b) => [b.rawMaterialId, b.requiredQty]));
    return r.mhBomLines.map((l) => ({
      uid: newUid(),
      isNew: false,
      rawMaterialId: l.rawMaterialId,
      name: s.rawMaterialById(l.rawMaterialId)?.name || "—",
      unitId: l.unitId,
      requestedQty: requestedByRm.get(l.rawMaterialId) ?? null,
      handoverQty: l.qty,
      actualUse: l.qty != null ? String(l.qty) : "",
      lotNo: l.lotNo ?? "",
    }));
  };

  /** Seed the packing rows from an already-recorded handover (FILLED rows only —
   *  LineGrid appends the trailing blank row itself). */
  const seedPackRows = (r: ProductionRequest): PackRow[] =>
    r.pmhBomLines.map((l) => ({
      uid: newUid(),
      packagingItemId: l.packagingItemId,
      unitId: l.unitId,
      qty: l.qty != null ? String(l.qty) : "",
    }));

  useEffect(() => {
    if (open && request) {
      const seed: Record<string, string> = {};
      for (const f of cfg.fields) seed[f.key] = f.get(request);
      setValues(seed);
      setHoRows(isHandover ? seedHandoverRows(request) : []);
      setLogRows(isLogBook ? seedLogRows(request) : []);
      setPackRows(isPmHandover ? seedPackRows(request) : []);
      setPmhQty(isPmHandover && request.pmhQty != null ? String(request.pmhQty) : "");
      setLogScrap(isLogBook && request.scrapQty != null ? String(request.scrapQty) : "");
      setLogLab(isLogBook && request.peLabQty != null ? String(request.peLabQty) : "");
      setLogPacked(isLogBook && request.tsPackedQty != null ? String(request.tsPackedQty) : "");
      setProdTally(isProduction ? request.peTallyEntry ?? "" : "");
      setFgProdTick(isFgTransfer ? request.fgProdToFg : false);
      setFgHojiwalaTick(isFgTransfer ? request.fgToHojiwala : false);
      // Quality: when editing correct the last round; when recording start a fresh one.
      const lastQc = request.qcRounds[request.qcRounds.length - 1];
      setQcResult(editing && lastQc?.result ? lastQc.result : "");
      setQcRemarks(editing ? lastQc?.remarks ?? "" : "");
      setQcTestDate(editing ? (lastQc?.testDate ?? "").slice(0, 10) : "");
      setQcFile(null);
      // M/C testing: a single approve/reject. When editing, show the recorded
      // result read-only; when recording, start blank (a prior rejection is shown
      // for context but the result is re-picked).
      setMcResult(editing && (request.mcStatus === "approved" || request.mcStatus === "rejected") ? request.mcStatus : "");
      setMcRemarks(editing ? request.mcRemarks ?? "" : "");
      setMcTestDate(editing ? (request.mcActualDate ?? "").slice(0, 10) : "");
      setMcFile(null);
      setQtyFallback(isHandover && request.mhBomLines.length === 0 ? (request.mhQty != null ? String(request.mhQty) : "") : "");
      setFile(null);
      setLogFile(null);
      if (fileRef.current) fileRef.current.value = "";
      if (logFileRef.current) logFileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request, cfg, isHandover, isLogBook, isProduction, isQuality, isMc, isPmHandover, editing]);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));
  const setHoField = (idx: number, key: "qty" | "lotNo", v: string) =>
    setHoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: v } : r)));
  const setLogField = (uid: string, patch: Partial<LogRow>) =>
    setLogRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const addLogRow = () =>
    setLogRows((prev) => [
      ...prev,
      { uid: newUid(), isNew: true, rawMaterialId: null, name: "", unitId: null, requestedQty: null, handoverQty: null, actualUse: "", lotNo: "" },
    ]);
  const removeLogRow = (uid: string) => setLogRows((prev) => prev.filter((r) => r.uid !== uid));

  // Per-new-row raw-material options: active materials + a synthetic entry for a
  // free-text name already typed, so the Combobox can display it.
  const rmOptionsFor = (row: LogRow): ComboOption[] => {
    const opts = s.activeRawMaterials.map((rm) => ({ value: rm.id, label: rm.name }));
    if (!row.rawMaterialId && row.name) opts.unshift({ value: `free:${row.name}`, label: row.name });
    return opts;
  };

  const save = async () => {
    if (!request) return;
    // Log Book Entry requires an attachment (a new file, or one already on file).
    if (isLogBook && !logFile && !request.tsAttachmentPath) {
      setErr("An attachment is required for the log book entry.");
      return;
    }
    if (isQuality && !editing) {
      const round = request.qcRounds.length + 1;
      if (!qcResult) { setErr("Choose Approve or Reject."); return; }
      if (round === 3 && !qcTestDate.trim()) { setErr("Enter the test date for the final test."); return; }
    }
    if (isMc && !editing && !mcResult) { setErr("Choose Approve or Reject."); return; }
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
        payload.ts_bom_lines = logRows.map((r) => ({
          raw_material_id: r.rawMaterialId,
          raw_material_name: r.name || null,
          unit_id: r.unitId,
          requested_qty: r.requestedQty ?? "",
          handover_qty: r.handoverQty ?? "",
          actual_use: r.actualUse ?? "",
          lot_no: r.lotNo ?? "",
          is_new: r.isNew,
        }));
        // Output metrics: Expected = Σ actual use; Actual Output = Expected − Scrap;
        // Loose = Actual Output − Lab − Packed.
        const r3 = (x: number) => Math.round(x * 1000) / 1000;
        const expected = r3(logRows.reduce((sm, r) => sm + (Number(r.actualUse) || 0), 0));
        const actual = r3(expected - (Number(logScrap) || 0));
        const loose = r3(actual - (Number(logLab) || 0) - (Number(logPacked) || 0));
        payload.pe_expected_qty = String(expected);
        payload.scrap_qty = logScrap;
        payload.actual_qty = String(actual);
        payload.pe_lab_qty = logLab;
        payload.ts_packed_qty = logPacked;
        payload.ts_loose_qty = String(loose);
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

      if (isPmHandover) {
        payload.pmh_qty = pmhQty;
        payload.pmh_bom_lines = packRows
          .filter((r) => r.packagingItemId)
          .map((r) => ({ packaging_item_id: r.packagingItemId, unit_id: r.unitId, qty: r.qty ?? "" }));
      }

      if (isProduction) {
        // Production entry is now a Tally-posting step; the output metrics were
        // captured at the log book and are shown read-only here.
        payload.pe_tally_entry = prodTally;
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
      <QcDocLink path={request.qcAttachmentPath} name={request.qcAttachmentName} />
    ) : isLogBook && request?.tsAttachmentPath ? (
      <QcDocLink path={request.tsAttachmentPath} name={request.tsAttachmentName} />
    ) : isMc && request?.mcAttachmentPath ? (
      <QcDocLink path={request.mcAttachmentPath} name={request.mcAttachmentName} />
    ) : null;

  const titlePrefix = editing && !readOnly ? `Edit ${cfg.title.toLowerCase()}` : readOnly ? cfg.title : cfg.actionLabel;

  return (
    <Modal
      open={open}
      onClose={onClose}
      readOnly={readOnly}
      readOnlyHeader={existing ?? undefined}
      // Match the Generate Issue Slip width so multi-column steps (the handover
      // grid especially) show every column without wrapping.
      size="3xl"
      title={`${titlePrefix} — ${request?.reqNo ?? ""}`}
      // The Lot/Batch Card number is shown ONCE per step, always with a proper
      // label — either the shared header box below (every step) or the 4-col grid
      // inside Quality / M/C. Never repeated as an unlabeled subtitle.
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy || (isFgTransfer && !(fgProdTick && fgHojiwalaTick))}>{busy ? "Saving…" : "Save"}</Button>
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
                <span className="block text-[13px] font-medium text-navy">Raw materials handed over</span>
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
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-navy">Actual use per raw material</span>
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
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {logRows.map((row) => (
                      <tr key={row.uid} className="border-b border-line/70 last:border-0 align-top">
                        <td className="px-3 py-2 text-navy">
                          {row.isNew ? (
                            <Combobox
                              value={row.rawMaterialId ?? (row.name ? `free:${row.name}` : "")}
                              onChange={(v) => {
                                if (v.startsWith("free:")) return setLogField(row.uid, { rawMaterialId: null, name: v.slice(5) });
                                const rm = s.rawMaterialById(v);
                                setLogField(row.uid, { rawMaterialId: v, name: rm?.name ?? "", unitId: rm?.unitId ?? null });
                              }}
                              options={rmOptionsFor(row)}
                              placeholder="Pick or type a material…"
                              searchable
                              triggerClassName="px-2 py-1.5 text-[13px]"
                              onCreate={(name) => setLogField(row.uid, { rawMaterialId: null, name, unitId: null })}
                              createLabel={(q) => `Use “${q}”`}
                            />
                          ) : (
                            row.name
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey-2">{row.isNew ? "—" : numOrDash(row.requestedQty)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey-2">{row.isNew ? "—" : numOrDash(row.handoverQty)}</td>
                        <td className="px-2 py-2 text-grey">{s.unitById(row.unitId)?.name ?? "—"}</td>
                        <td className="px-1.5 py-1.5">
                          <TextInput
                            type="number"
                            disabled={readOnly}
                            className="w-full px-2 py-1.5 text-[13px] text-right tabular-nums"
                            value={row.actualUse}
                            onChange={(e) => setLogField(row.uid, { actualUse: e.target.value })}
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          {row.isNew ? (
                            <TextInput
                              disabled={readOnly}
                              className="w-full px-2 py-1.5 text-[13px]"
                              placeholder="Lot no."
                              value={row.lotNo}
                              onChange={(e) => setLogField(row.uid, { lotNo: e.target.value })}
                            />
                          ) : (
                            <span className="text-grey">{row.lotNo || "—"}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {row.isNew && !readOnly && (
                            <button
                              type="button"
                              onClick={() => removeLogRow(row.uid)}
                              className="text-grey-2 hover:text-ryg-red transition"
                              aria-label="Remove item"
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={addLogRow}
                  className="text-[12.5px] font-semibold text-orange hover:underline"
                >
                  + Add item
                </button>
              )}
            </div>

            {(() => {
              const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
              const val = "text-[15px] font-bold text-navy tabular-nums";
              const unit = fgUnit ? <span className="text-[11px] font-normal text-grey-2"> {fgUnit}</span> : null;
              const r3 = (x: number) => Math.round(x * 1000) / 1000;
              const expected = r3(logRows.reduce((sm, r) => sm + (Number(r.actualUse) || 0), 0));
              const actual = r3(expected - (Number(logScrap) || 0));
              const loose = r3(actual - (Number(logLab) || 0) - (Number(logPacked) || 0));
              return (
                <div className="space-y-1.5">
                  <span className="block text-[13px] font-medium text-navy">Output</span>
                  {/* Row 1: the output calc (Expected − Scrap = Actual Output).
                      Row 2: the split (Lab, Packed → Loose = Actual − Lab − Packed). */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 rounded-xl bg-page px-3.5 py-3 items-start">
                    <div>
                      <div className={cap}>Expected Qty</div>
                      <div className={`${val} pt-0.5`}>{expected}{unit}</div>
                    </div>
                    <div>
                      <div className={cap}>Scrap Qty</div>
                      <TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logScrap} onChange={(e) => setLogScrap(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <div className={cap}>Actual Output</div>
                      <div className={`${val} pt-0.5`}>{actual}{unit}</div>
                    </div>
                    <div>
                      <div className={cap}>Lab Testing Qty</div>
                      <TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logLab} onChange={(e) => setLogLab(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <div className={cap}>Packed Qty</div>
                      <TextInput type="number" disabled={readOnly} className="w-full px-2.5 py-1.5 text-[14px] text-right tabular-nums" value={logPacked} onChange={(e) => setLogPacked(e.target.value)} placeholder="0" />
                    </div>
                    <div>
                      <div className={cap}>Loose Qty</div>
                      <div className={`${val} pt-0.5`}>{loose}{unit}</div>
                    </div>
                  </div>
                  <p className="text-[11.5px] text-grey-2">
                    Actual Output = Expected − Scrap · Loose = Actual Output − Lab − Packed{fgUnit ? ` · all quantities in ${fgUnit}` : ""}
                  </p>
                </div>
              );
            })()}

            <FieldLabel label="Attachment" required hint={editing ? "choose a file to replace it" : "required — e.g. the log book page"}>
              <input
                ref={logFileRef}
                type="file"
                onChange={(e) => setLogFile(e.target.files?.[0] ?? null)}
                className="block w-full text-[12.5px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line"
              />
              {request.tsAttachmentPath && (
                <div className="mt-1 text-[12px] text-grey-2">
                  Current file: <QcDocLink path={request.tsAttachmentPath} name={request.tsAttachmentName} />
                </div>
              )}
            </FieldLabel>
          </>
        )}

        {isQuality && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const round = request.qcRounds.length + (editing ? 0 : 1);
          const roundLabel = round === 1 ? "Test 1 — first test" : round === 2 ? "Test 2 — retest" : "Test 3 — final test";
          const canRecord = editing || round <= 3;
          const manualDate = round === 3 || editing; // Test 3 (and any edit) uses a manual date
          const btn = (v: "approved" | "rejected", label: string, on: string, off: string) => (
            <button
              type="button"
              disabled={readOnly || editing}
              onClick={() => setQcResult(v)}
              className={`flex-1 rounded-xl border px-3 py-2 text-[13px] font-semibold transition ${qcResult === v ? on : off}`}
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
                        {r.attachmentPath && <QcDocLink path={r.attachmentPath} name={r.attachmentName} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {request.qcRetestDue && !editing && round <= 3 && (
                <div className="rounded-xl bg-orange-soft px-3.5 py-2 text-[12.5px] text-orange font-medium">
                  Retest due by {dmy(request.qcRetestDue)}
                </div>
              )}

              {canRecord ? (
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

                  {manualDate ? (
                    <FieldLabel label="Test date" hint={round === 3 ? "enter the final test date" : undefined}>
                      <TextInput type="date" disabled={readOnly} value={qcTestDate} onChange={(e) => setQcTestDate(e.target.value)} />
                    </FieldLabel>
                  ) : (
                    <p className="text-[12px] text-grey-2">Test date is captured automatically as today.</p>
                  )}

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
              ) : (
                <p className="text-[12.5px] text-ryg-red">The final test has been recorded — no further retests are allowed.</p>
              )}
            </>
          );
        })()}

        {isMc && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const priorReject = !editing && request.mcStatus === "rejected";
          const btn = (v: "approved" | "rejected", label: string, on: string, off: string) => (
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
                    Result: <span className={mcResult === "approved" ? "text-ryg-green font-semibold" : "text-ryg-red font-semibold"}>{mcResult === "approved" ? "Approved" : "Rejected"}</span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {btn("approved", "Approve", "border-ryg-green bg-[#E9F8EF] text-ryg-green", "border-line text-grey hover:border-ryg-green/50")}
                    {btn("rejected", "Reject", "border-ryg-red bg-[#FDECEC] text-ryg-red", "border-line text-grey hover:border-ryg-red/50")}
                  </div>
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
                      Current file: <QcDocLink path={request.mcAttachmentPath} name={request.mcAttachmentName} />
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 rounded-xl bg-page px-3.5 py-3 items-start">
                <div><div className={cap}>Expected Qty</div><div className={`${val} pt-0.5`}>{metric(request.peExpectedQty)}</div></div>
                <div><div className={cap}>Scrap Qty</div><div className={`${val} pt-0.5`}>{metric(request.scrapQty)}</div></div>
                <div><div className={cap}>Actual Output</div><div className={`${val} pt-0.5`}>{metric(request.actualQty)}</div></div>
                <div><div className={cap}>Lab Testing Qty</div><div className={`${val} pt-0.5`}>{metric(request.peLabQty)}</div></div>
                <div><div className={cap}>Packed Qty</div><div className={`${val} pt-0.5`}>{metric(request.tsPackedQty)}</div></div>
                <div><div className={cap}>Loose Qty</div><div className={`${val} pt-0.5`}>{metric(request.tsLooseQty)}</div></div>
              </div>

              <FieldLabel label="Tally Entry" hint="Tally entry number for the production posting">
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
                    </table>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {isPmHandover && request && (() => {
          // Per-unit totals of the filled packaging rows.
          const totals = new Map<string, number>();
          for (const r of packRows) {
            if (!r.packagingItemId) continue;
            const q = Number(r.qty);
            if (!q) continue;
            const uname = s.unitById(r.unitId)?.name ?? "—";
            totals.set(uname, (totals.get(uname) ?? 0) + q);
          }
          const totalText = [...totals.entries()].map(([u, q]) => `${Math.round(q * 1000) / 1000} ${u}`).join(" · ");
          const packOptions: ComboOption[] = s.activePackagingItems.map((p) => ({ value: p.id, label: p.name }));
          const columns: LineGridColumn<PackRow>[] = [
            {
              key: "item",
              header: "Packaging Item",
              className: "min-w-[240px]",
              cell: (row, api) => (
                <Combobox
                  ref={api.focusRef as (el: ComboboxHandle | null) => void}
                  value={row.packagingItemId ?? ""}
                  onChange={(v) => {
                    // The unit follows the item's own master unit; qty auto-fills
                    // from the item's pack-size prefix (÷ FG packed qty), overridable.
                    const pi = s.packagingItemById(v);
                    api.patch({
                      packagingItemId: v,
                      unitId: pi?.unitId ?? null,
                      qty: packQtyFromPrefix(pi?.name, pmhQty) || row.qty,
                    });
                    api.advance();
                  }}
                  options={packOptions}
                  placeholder="Pick a packaging item…"
                  searchable
                  triggerClassName="px-2.5 py-1.5 text-[13.5px]"
                  onTriggerKeyDown={api.keyHandler}
                />
              ),
            },
            {
              key: "qty",
              header: <span className="block text-right">Qty</span>,
              className: "w-32",
              cell: (row, api) => (
                <TextInput
                  ref={api.focusRef as (el: HTMLInputElement | null) => void}
                  type="number"
                  className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
                  value={row.qty}
                  onChange={(e) => api.patch({ qty: e.target.value })}
                  onKeyDown={api.keyHandler}
                />
              ),
            },
            {
              key: "unit",
              header: "Unit",
              className: "w-24",
              skipFocus: true,
              cell: (row) => <span className="text-grey">{s.unitById(row.unitId)?.name ?? "—"}</span>,
            },
          ];
          return (
            <>
              <FieldLabel label="FG Packed Qty">
                <TextInput type="number" disabled={readOnly} value={pmhQty} onChange={(e) => setPmhQty(e.target.value)} placeholder="0" />
              </FieldLabel>

              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">Packaging items used</span>
                {readOnly ? (
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
                        {request.pmhBomLines.length === 0 ? (
                          <tr><td colSpan={3} className="px-3 py-3 text-grey-2">No packaging items were recorded.</td></tr>
                        ) : (
                          request.pmhBomLines.map((l, i) => (
                            <tr key={i} className="border-b border-line/70 last:border-0">
                              <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                              <td className="px-2 py-2 text-right tabular-nums text-navy">{numOrDash(l.qty)}</td>
                              <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <LineGrid
                    rows={packRows}
                    onRowsChange={setPackRows}
                    columns={columns}
                    makeEmptyRow={makeEmptyPackRow}
                    isRowBlank={isPackRowBlank}
                  />
                )}
                <div className="flex items-start justify-between gap-3">
                  {!readOnly ? (
                    <p className="text-[12px] text-grey-2">
                      Pick an item and a fresh line appears automatically. Qty auto-fills from the item's pack size (its name prefix ÷ FG packed qty) — edit if needed.
                    </p>
                  ) : <span />}
                  {totalText && (
                    <div className="text-[12.5px] text-grey-2 whitespace-nowrap">Total: <span className="font-semibold text-navy">{totalText}</span></div>
                  )}
                </div>
              </div>
            </>
          );
        })()}

        {isPmTransfer && request && (() => {
          const lines = request.pmhBomLines;
          const totals = new Map<string, number>();
          for (const l of lines) {
            if (l.qty == null) continue;
            const uname = s.unitById(l.unitId)?.name ?? "—";
            totals.set(uname, (totals.get(uname) ?? 0) + l.qty);
          }
          const totalText = [...totals.entries()].map(([u, q]) => `${Math.round(q * 1000) / 1000} ${u}`).join(" · ");
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          return (
            <>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className={cap}>Production Entry Tally No.</div><div className="text-[14px] font-semibold text-navy leading-tight">{request.peTallyEntry || "—"}</div></div>
                <div><div className={cap}>FG Packed Qty</div><div className="text-[15px] font-bold text-navy tabular-nums">{numOrDash(request.pmhQty)}</div></div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">Packaging items (from handover)</span>
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
                        <tr><td colSpan={3} className="px-3 py-3 text-grey-2">No packaging items were recorded at handover.</td></tr>
                      ) : (
                        lines.map((l, i) => (
                          <tr key={i} className="border-b border-line/70 last:border-0">
                            <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-navy">{numOrDash(l.qty)}</td>
                            <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {totalText && (
                  <div className="text-right text-[12.5px] text-grey-2">Total: <span className="font-semibold text-navy">{totalText}</span></div>
                )}
              </div>
            </>
          );
        })()}

        {isRmTransfer && request && request.mhBomLines.length > 0 && (
          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-navy">Raw materials handed over</span>
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
                  {request.mhBomLines.map((l, i) => {
                    const requested = request.bomLines.find((b) => b.rawMaterialId === l.rawMaterialId)?.requiredQty ?? null;
                    return (
                      <tr key={i} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-2 text-navy">{s.rawMaterialById(l.rawMaterialId)?.name ?? "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(requested)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-grey-2">{numOrDash(l.qty)}</td>
                        <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                        <td className="px-2 py-2 text-grey">{l.lotNo || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {isPacking && request && (() => {
          const cap = "text-[11px] font-semibold uppercase tracking-wide text-grey-2 mb-1";
          const val = "text-[15px] font-bold text-navy tabular-nums";
          const unit = fgUnit ? <span className="text-[11px] font-normal text-grey-2"> {fgUnit}</span> : null;
          const metric = (n: number | null) => (n != null ? <>{n}{unit}</> : "—");
          // Net qty available for packing = Actual Output − Lab Testing Qty.
          const net = request.actualQty != null ? Math.round((request.actualQty - (request.peLabQty ?? 0)) * 1000) / 1000 : null;
          const lines = request.pmhBomLines;
          const totals = new Map<string, number>();
          for (const l of lines) {
            if (l.qty == null) continue;
            const uname = s.unitById(l.unitId)?.name ?? "—";
            totals.set(uname, (totals.get(uname) ?? 0) + l.qty);
          }
          const totalText = [...totals.entries()].map(([u, q]) => `${Math.round(q * 1000) / 1000} ${u}`).join(" · ");
          return (
            <>
              {/* Lot/Batch Card + FG item are in the shared header above. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-page px-3.5 py-3">
                <div><div className={cap}>Net Qty for Packing</div><div className={val}>{metric(net)}</div></div>
                <div><div className={cap}>Packed Qty</div><div className={val}>{metric(request.tsPackedQty)}</div></div>
                <div><div className={cap}>Loose Qty</div><div className={val}>{metric(request.tsLooseQty)}</div></div>
                <div><div className={cap}>Production Tally Entry</div><div className="text-[14px] font-semibold text-navy leading-tight">{request.peTallyEntry || "—"}</div></div>
              </div>

              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-navy">Packaging items (from handover)</span>
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
                        <tr><td colSpan={3} className="px-3 py-3 text-grey-2">No packaging items were recorded at handover.</td></tr>
                      ) : (
                        lines.map((l, i) => (
                          <tr key={i} className="border-b border-line/70 last:border-0">
                            <td className="px-3 py-2 text-navy">{s.packagingItemById(l.packagingItemId)?.name ?? "—"}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-navy">{numOrDash(l.qty)}</td>
                            <td className="px-2 py-2 text-grey">{s.unitById(l.unitId)?.name ?? "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {totalText && (
                  <div className="text-right text-[12.5px] text-grey-2">Total: <span className="font-semibold text-navy">{totalText}</span></div>
                )}
              </div>

              <p className="text-[12px] text-grey-2">Review the details above, then Save to log this packing entry in Tally.</p>
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
          <FieldLabel key={f.key} label={f.label} hint={f.hint}>
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
  );
}
