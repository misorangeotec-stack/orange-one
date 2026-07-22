import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useProductionStore } from "../store";
import { uploadQualityDocument } from "../data/productionWrites";
import { numOrDash, requestSubject } from "../lib/format";
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
  const isHandover = stepKey === "material_handover";
  const [values, setValues] = useState<Record<string, string>>({});
  const [hoRows, setHoRows] = useState<HandoverRow[]>([]);
  const [qtyFallback, setQtyFallback] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && request) {
      const seed: Record<string, string> = {};
      for (const f of cfg.fields) seed[f.key] = f.get(request);
      setValues(seed);
      setHoRows(isHandover ? seedHandoverRows(request) : []);
      setQtyFallback(isHandover && request.mhBomLines.length === 0 ? (request.mhQty != null ? String(request.mhQty) : "") : "");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setErr(null);
      setBusy(false);
    }
  }, [open, request, cfg, isHandover]);

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));
  const setHoField = (idx: number, key: "qty" | "lotNo", v: string) =>
    setHoRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: v } : r)));

  const save = async () => {
    if (!request) return;
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of cfg.fields) payload[f.key] = values[f.key] ?? "";

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
      subtitle={request ? requestSubject(request) : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {isHandover && request && (
          <>
            <div className="rounded-xl bg-page px-3.5 py-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Job Card</span>
                <Link
                  to={`/production-entry/requests/${request.id}`}
                  onClick={onClose}
                  className="text-[14px] font-bold text-navy hover:text-orange hover:underline"
                >
                  {request.jobcardNo || request.reqNo}
                </Link>
              </div>
              <div className="text-[12.5px] text-grey">
                FG Item: <span className="font-semibold text-navy">{s.fgItemById(request.fgItemId)?.name ?? "—"}</span>
              </div>
            </div>

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
