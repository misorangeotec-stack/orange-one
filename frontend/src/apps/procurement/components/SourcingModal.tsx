import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import RequestMasterModal from "./RequestMasterModal";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import type { RequestItem } from "../types";

interface QRow {
  vendorId: string;
  rate: string;
  gstPct: string;
  leadTimeDays: string;
  remark: string;
}

const emptyRow = (): QRow => ({ vendorId: "", rate: "", gstPct: "", leadTimeDays: "", remark: "" });

/**
 * Stage 2 — sourcing for one request line: capture up to 3 vendor quotations,
 * mark one recommended, set final qty/rate/GST, then route to approval. A line
 * value preview shows the amount the approval will route on.
 */
export default function SourcingModal({
  line,
  open,
  onClose,
  onSaved,
}: {
  line: RequestItem | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const s = useProcurementStore();
  const [rows, setRows] = useState<QRow[]>([emptyRow()]);
  const [recommended, setRecommended] = useState("");
  const [finalQty, setFinalQty] = useState("");
  const [finalRate, setFinalRate] = useState("");
  const [gstPct, setGstPct] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  /** Vendor not in the master? Raise it for review without losing this form. */
  const [raiseVendor, setRaiseVendor] = useState<string | null>(null);

  const activeVendors = useMemo(() => s.vendors.filter((v) => v.active), [s.vendors]);
  // A vendor already quoted on another row drops out of this row's dropdown — a
  // vendor can appear on only one quotation. The row's own pick is always kept.
  const vendorOptionsFor = (rowIndex: number): ComboOption[] => {
    const taken = new Set(rows.filter((_, idx) => idx !== rowIndex).map((r) => r.vendorId).filter(Boolean));
    return activeVendors.filter((v) => !taken.has(v.id)).map((v) => ({ value: v.id, label: v.name }));
  };

  const lineId = line?.id ?? null;
  // Initialise from the line / its existing quotations when the modal opens for it.
  useEffect(() => {
    if (!open || !line) return;
    const existing = s.quotationsForLine(line.id);
    setRows(
      existing.length
        ? existing.map((q) => ({
            vendorId: q.vendorId,
            rate: String(q.rate),
            gstPct: q.gstPct === null ? "" : String(q.gstPct),
            leadTimeDays: q.leadTimeDays === null ? "" : String(q.leadTimeDays),
            remark: q.remark ?? "",
          }))
        : [emptyRow()]
    );
    setRecommended(line.finalVendorId ?? existing.find((q) => q.isRecommended)?.vendorId ?? "");
    setFinalQty(String(line.finalQty ?? line.quantity));
    setFinalRate(line.finalRate === null ? "" : String(line.finalRate));
    setGstPct(line.gstPct === null ? "" : String(line.gstPct));
    setReason(line.sourcingReason ?? "");
    setErr(null);
    setRequested(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lineId]);

  if (!line) return null;

  const setRow = (i: number, patch: Partial<QRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => (prev.length >= 3 ? prev : [...prev, emptyRow()]));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  // Auto-fill final rate/GST from the recommended quotation when picked.
  const pickRecommended = (vendorId: string) => {
    setRecommended(vendorId);
    const row = rows.find((r) => r.vendorId === vendorId);
    if (row) {
      if (row.rate) setFinalRate(row.rate);
      if (row.gstPct) setGstPct(row.gstPct);
    }
  };

  const filledRows = rows.filter((r) => r.vendorId && r.rate !== "");
  const qty = Number(finalQty);
  const rate = Number(finalRate);
  const gst = gstPct === "" ? 0 : Number(gstPct);
  const lineValue = qty > 0 && rate >= 0 ? Math.round(qty * rate * (1 + gst / 100) * 100) / 100 : null;

  const save = async () => {
    setErr(null);
    if (filledRows.length === 0) return setErr("Add at least one quotation with a vendor and rate.");
    const vendorIds = filledRows.map((r) => r.vendorId);
    if (new Set(vendorIds).size !== vendorIds.length) return setErr("Each quotation must be a different vendor.");
    if (!recommended) return setErr("Mark one quotation as recommended.");
    if (!vendorIds.includes(recommended)) return setErr("The recommended vendor must be one of the quotations.");
    if (!(qty > 0)) return setErr("Final quantity must be greater than 0.");
    if (!(rate >= 0) || finalRate === "") return setErr("Enter a final rate.");

    setBusy(true);
    try {
      await s.saveSourcing({
        requestItemId: line.id,
        quotations: filledRows.map((r) => ({
          vendorId: r.vendorId,
          rate: Number(r.rate),
          gstPct: r.gstPct === "" ? null : Number(r.gstPct),
          leadTimeDays: r.leadTimeDays === "" ? null : Number(r.leadTimeDays),
          remark: r.remark.trim() || null,
        })),
        recommendedVendorId: recommended,
        finalQty: qty,
        finalRate: rate,
        gstPct: gstPct === "" ? null : gst,
        sourcingReason: reason.trim() || null,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Sourcing — ${s.itemLabel(line.itemId)}`}
      subtitle={`Requested qty ${line.quantity} ${line.unit}. Add quotations, recommend a vendor, set final qty & rate.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Submit for approval"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border border-line p-3 space-y-2.5 bg-page/40">
              <div className="flex items-center justify-between">
                <span className={SECTION_HEADING_CLASS}>Quotation {i + 1}</span>
                <label className="flex items-center gap-1.5 text-[12px] text-navy cursor-pointer">
                  <input
                    type="radio"
                    name="recommended"
                    className="accent-orange"
                    checked={recommended !== "" && recommended === r.vendorId}
                    onChange={() => r.vendorId && pickRecommended(r.vendorId)}
                    disabled={!r.vendorId}
                  />
                  Recommended
                  {rows.length > 1 && (
                    <button type="button" onClick={() => removeRow(i)} className="ml-2 text-grey-2 hover:text-ryg-red" aria-label="Remove">
                      ✕
                    </button>
                  )}
                </label>
              </div>
              <Combobox
                value={r.vendorId}
                onChange={(v) => setRow(i, { vendorId: v })}
                options={vendorOptionsFor(i)}
                placeholder="Select vendor"
                onCreate={(name) => setRaiseVendor(name)}
                createLabel={(q) => `Request new vendor “${q}”`}
                autoAdvance
              />
              <div className="grid grid-cols-3 gap-2">
                <TextInput type="number" placeholder="Rate" value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} />
                <TextInput type="number" placeholder="GST %" value={r.gstPct} onChange={(e) => setRow(i, { gstPct: e.target.value })} />
                <TextInput type="number" placeholder="Lead days" value={r.leadTimeDays} onChange={(e) => setRow(i, { leadTimeDays: e.target.value })} />
              </div>
              <TextInput placeholder="Remark (optional)" value={r.remark} onChange={(e) => setRow(i, { remark: e.target.value })} />
            </div>
          ))}
          {rows.length < 3 && (
            <button type="button" onClick={addRow} className="text-[12.5px] font-semibold text-orange hover:underline">
              + Add quotation
            </button>
          )}
          {requested && (
            <p className="text-[12px] text-teal">Requested vendor “{requested}” — selectable once the vendor master's owner approves it.</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FieldLabel label="Final Qty" required>
            <TextInput type="number" value={finalQty} onChange={(e) => setFinalQty(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Final Rate" required>
            <TextInput type="number" value={finalRate} onChange={(e) => setFinalRate(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="GST %">
            <TextInput type="number" value={gstPct} onChange={(e) => setGstPct(e.target.value)} />
          </FieldLabel>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-orange-soft/50 px-3.5 py-2.5">
          <span className="text-[12.5px] text-grey">Line value (incl. GST) — routes the approval</span>
          <span className="text-[15px] font-bold text-navy">{inr(lineValue)}</span>
        </div>

        {filledRows.length < 3 && (
          <FieldLabel label="Single-source reason" hint="optional — fewer than 3 quotations">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. single-source vendor" />
          </FieldLabel>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the sourcing form intact
          underneath (no scroll unlock, ESC closes only this one). */}
      <RequestMasterModal
        stacked
        open={raiseVendor !== null}
        onClose={() => setRaiseVendor(null)}
        masterType="vendor"
        lockType
        prefill={{ name: raiseVendor ?? "" }}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
    </Modal>
  );
}
