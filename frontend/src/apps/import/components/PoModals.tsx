import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { cn } from "@/shared/lib/cn";
import { todayIso, formatDate } from "@/shared/lib/time";
// NOT time.ts's todayIso(): that is documented "local" but is really the UTC
// date, so in IST it reads as yesterday until 05:30 and would reject a dispatch
// entered early in the morning. todayLocalIso() is the genuinely local one.
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useImportStore } from "../store";
import { inr } from "../lib/format";
import type { PurchaseOrder, PoCancelRequest, Pi, Payment, Followup, Grn, TallyBooking } from "../types";

const PAYMENT_TERMS: ComboOption[] = [
  { value: "full_advance", label: "100% Advance" },
  { value: "partial_advance", label: "Partial Advance" },
  { value: "credit", label: "Credit" },
  { value: "on_delivery", label: "On Delivery" },
];
const DISPATCH: ComboOption[] = [
  { value: "pending", label: "Pending" },
  { value: "dispatched", label: "Dispatched" },
  { value: "delayed", label: "Delayed" },
];
const CONDITION: ComboOption[] = [
  { value: "good", label: "Good" },
  { value: "damaged", label: "Damaged" },
  { value: "partial_damage", label: "Partial Damage" },
];

function Err({ msg }: { msg: string | null }) {
  return msg ? <p className="text-[12.5px] text-ryg-red">{msg}</p> : null;
}

/**
 * Helper text rendered BELOW a field. FieldLabel's own `hint` sits inline beside
 * the label, which wraps and misaligns inputs in narrow grid columns — so any
 * hint longer than a couple of words goes here instead.
 */
function Hint({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-[11px] leading-snug text-grey-2">{children}</span>;
}

/* ----------------------------- Add PI ------------------------------------ */
export function AddPiModal({ po, open, onClose, editing }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: Pi }) {
  const s = useImportStore();
  const items = s.poItemsForPo(po.id);
  const [vendorPiNo, setVendorPiNo] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Per-line coverage: how much of each PO line is already on an existing PI, how
  // much is still to collect, and its per-unit (incl-GST) value.
  //
  // When EDITING, this PI's own lines are excluded from `covered` — they are what
  // we are replacing, so counting them would show a line as fully covered and
  // leave nothing editable. The server's cap excludes the same rows.
  const coverage = items.map((pi) => {
    const covered = s.piItems
      .filter((x) => x.poItemId === pi.id && (!editing || x.piId !== editing.id))
      .reduce((a, x) => a + x.qty, 0);
    return { pi, covered, remaining: Math.max(0, pi.qty - covered), unit: pi.qty > 0 ? pi.lineValue / pi.qty : 0 };
  });
  const unitById = new Map(coverage.map((c) => [c.pi.id, c.unit]));
  // PI value auto-matches the lines this PI covers (Σ coverQty × per-unit incl GST).
  const piValue = Math.round(items.reduce((sum, pi) => sum + (Number(qty[pi.id]) || 0) * (unitById.get(pi.id) ?? 0), 0) * 100) / 100;

  useEffect(() => {
    if (!open) return;
    setVendorPiNo(editing?.vendorPiNo ?? "");
    setFile(null);
    const init: Record<string, string> = {};
    for (const pi of items) {
      if (editing) {
        // Editing seeds THIS PI's own recorded qty — not the remaining, which is
        // what a new PI would be seeded with.
        init[pi.id] = String(s.piItemsForPi(editing.id).find((x) => x.poItemId === pi.id)?.qty ?? 0);
      } else {
        const covered = s.piItems.filter((x) => x.poItemId === pi.id).reduce((a, x) => a + x.qty, 0);
        init[pi.id] = String(Math.max(0, pi.qty - covered));
      }
    }
    setQty(init);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, editing?.id]);

  const save = async () => {
    setErr(null);
    if (!vendorPiNo.trim()) return setErr("Vendor PI number is required.");
    const lines = items.filter((pi) => Number(qty[pi.id]) > 0).map((pi) => ({ poItemId: pi.id, qty: Number(qty[pi.id]) }));
    if (lines.length === 0) return setErr("Cover at least one item with a quantity.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadPiDocument(po.id, file);
      if (editing) {
        await s.updatePi({ piId: editing.id, vendorPiNo: vendorPiNo.trim(), piValue, items: lines, documentPath: doc?.path ?? null, documentName: doc?.name ?? null });
      } else {
        await s.addPi({ poId: po.id, vendorPiNo: vendorPiNo.trim(), piValue, items: lines, documentPath: doc?.path ?? null, documentName: doc?.name ?? null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? "Edit PI" : "Add PI"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded. Editable until a payment lands against it or goods arrive.`
        : "Proforma invoice — the items it covers. Payment terms and dispatch date are set on the PO."}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Add PI"}</Button></>}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Vendor PI No." required><TextInput value={vendorPiNo} onChange={(e) => setVendorPiNo(e.target.value)} /></FieldLabel>
          <FieldLabel label="PI Value (incl GST)" hint={<span className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2">Auto</span>}>
            <TextInput type="number" value={String(piValue)} readOnly title="Auto-calculated from the covered lines (Cover Qty × rate incl GST)" className="bg-page/70 text-grey-2 cursor-not-allowed" />
          </FieldLabel>
        </div>
        <FieldLabel label="Vendor PI Document" hint="PDF or any file · optional">
          <div className="flex items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
              <Upload className="h-4 w-4" />
              {file ? "Change file" : "Choose file"}
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file ? (
              <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <span className="text-[12.5px] text-grey-2">No file selected</span>
            )}
          </div>
        </FieldLabel>
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-grey-2 border-b border-line bg-page/60"><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Ordered</th><th className="px-3 py-2 font-medium w-32">Cover Qty</th></tr></thead>
            <tbody>
              {coverage.map(({ pi, covered, remaining }) => {
                const line = s.lineById(pi.requestItemId);
                const locked = remaining === 0;
                return (
                  <tr key={pi.id} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2 font-medium text-navy">{line ? s.itemLabel(line.itemId) : "—"}</td>
                    <td className="px-3 py-2">{pi.qty}</td>
                    <td className="px-3 py-2">
                      <TextInput
                        type="number"
                        className={`w-24 ${locked ? "bg-page/70 text-grey-2 cursor-not-allowed" : ""}`}
                        value={qty[pi.id] ?? ""}
                        min={0}
                        max={remaining}
                        disabled={locked}
                        title={locked ? "Already fully collected on an earlier PI" : undefined}
                        onChange={(e) =>
                          setQty((p) => ({
                            ...p,
                            [pi.id]: e.target.value === "" ? "" : String(Math.max(0, Math.min(remaining, Number(e.target.value)))),
                          }))
                        }
                      />
                      {covered > 0 && (
                        <div className="mt-1 text-[11px] text-grey-2">
                          {locked ? "Fully collected" : `${covered} already collected · ${remaining} left`}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* --------------------------- Share PO (upload PDF) ------------------------ */
export function SharePoModal({ po, open, editing = false, onClose }: { po: PurchaseOrder; open: boolean; editing?: boolean; onClose: () => void }) {
  const s = useImportStore();
  const [tallyPoNo, setTallyPoNo] = useState("");
  const [dispatch, setDispatch] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Editing shows what was actually recorded; sharing starts blank. Seeding the
    // Tally number when sharing would invite blind-accepting a stale value.
    setTallyPoNo(editing ? po.tallyPoNo ?? "" : "");
    setDispatch(po.dispatchDate ?? "");
    setRemarks(editing ? po.shareRemarks ?? "" : "");
    setFile(null);
    setErr(null);
  }, [open, editing, po.id, po.dispatchDate, po.tallyPoNo, po.shareRemarks]);

  const hasExistingDoc = !!po.documentPath;
  // Sharing requires the PDF. Editing does not: no new file simply means "keep the
  // one already attached".
  const docSatisfied = editing ? hasExistingDoc || !!file : !!file;

  const save = async () => {
    setErr(null);
    if (!tallyPoNo.trim()) return setErr("Enter the PO number generated in Tally.");
    if (!dispatch) return setErr("Enter the expected dispatch date.");
    if (!docSatisfied) return setErr(editing ? "Attach the PO PDF." : "Attach the PO PDF to mark it shared.");
    setBusy(true);
    try {
      // Upload first, so a failed upload never half-writes the row. The superseded
      // file is left in storage on purpose — uploads are immutable timestamped
      // keys, and the document's history is part of what this stage records.
      const doc = file ? await s.uploadPoDocument(po.id, file) : null;
      if (editing) {
        await s.updateSharePo({
          poId: po.id,
          tallyPoNo: tallyPoNo.trim(),
          // Import is always 100% advance; an edit must not quietly re-route the PO
          // off the Payment step, so the terms stay forced here exactly as at share.
          paymentTerms: "full_advance",
          dispatchDate: dispatch,
          remarks: remarks.trim() || null,
          documentPath: doc?.path ?? null, // null ⇒ server keeps the existing document
          documentName: doc?.name ?? null,
        });
      } else {
        // Import is always 100% advance — force full_advance so the PO routes to the Payment step.
        await s.sharePo(po.id, { path: doc!.path, name: doc!.name, tallyPoNo: tallyPoNo.trim(), remarks: remarks.trim() || null, paymentTerms: "full_advance", dispatchDate: dispatch });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? "Edit Share Details" : "Share PO"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded when this PO was shared. Editable until the next step is done.`
        : `${po.poNo} · confirm the dispatch date, attach the PO PDF, then mark it shared with the vendor. Import is 100% advance.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !docSatisfied || !tallyPoNo.trim() || !dispatch}>{busy ? (editing ? "Saving…" : "Sharing…") : editing ? "Save Changes" : "Share PO"}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <FieldLabel label="Tally PO Number" required>
            <TextInput value={tallyPoNo} onChange={(e) => setTallyPoNo(e.target.value)} placeholder="e.g. 2627/PO/0042" />
            <Hint>Generated in Tally/ERP</Hint>
          </FieldLabel>
          <FieldLabel label="Expected Dispatch Date" required>
            <TextInput type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} />
            <Hint>Anchors the follow-up due date</Hint>
          </FieldLabel>
        </div>

        <div className="border-t border-line/70" />

        <FieldLabel label="PO PDF" required={!editing}>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
              <Upload className="h-4 w-4" />
              {file ? "Change file" : editing && hasExistingDoc ? "Replace file" : "Choose file"}
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                <span className="max-w-[260px] truncate text-navy">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="shrink-0 text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
              </span>
            ) : editing && hasExistingDoc ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                Current: <span className="max-w-[260px] truncate text-navy">{po.documentName ?? "attached file"}</span>
              </span>
            ) : (
              <span className="text-[12.5px] text-grey-2">No file selected</span>
            )}
          </div>
          <Hint>{editing ? "Leave as-is to keep the attached file — the previous version is retained either way." : "PDF or any file — required to share"}</Hint>
        </FieldLabel>

        <FieldLabel label="Remarks" hint="Optional">
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Anything the vendor should know about this PO." />
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* --------------------------- Payment (adv/inst) -------------------------- */
export function PaymentModal({ po, open, onClose, kind, editing }: { po: PurchaseOrder; open: boolean; onClose: () => void; kind: "advance" | "installment"; editing?: Payment }) {
  const s = useImportStore();
  // Import pays 100% advance in the vendor's currency; INR (via the FX rate) caps
  // against the PO's INR pending so approval/booking stay consistent.
  //
  // When EDITING, this payment's own INR amount is added back: `pendingAmount`
  // already subtracts it, so without this a ₹100 → ₹101 nudge would look like it
  // exceeds the pending by ₹100. (The server's real cap is on the FOREIGN amount —
  // see `pendingFx` below — and excludes this row the same way.)
  const poPending = s.pendingAmount(po) + (editing?.amount ?? 0);
  const ccy = (editing?.currency ?? po.currency) || "USD";

  const [amountFx, setAmountFx] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [fxBusy, setFxBusy] = useState(false);
  const [details, setDetails] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [utr, setUtr] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isAdvance = kind === "advance";

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // Editing shows THIS payment's own recorded values — not the PO's full value,
      // which is what a new 100% advance would be seeded with.
      setPaidOn(editing.paidOn);
      setUtr(editing.utrRef ?? "");
      setDetails(editing.details ?? "");
      setFile(null);
      setErr(null);
      setAmountFx(editing.amountFx !== null ? String(editing.amountFx) : "");
      setFxRate(editing.fxRate !== null ? String(editing.fxRate) : "");
      return;
    }
    setPaidOn(todayIso());
    setUtr("");
    setDetails("");
    setFile(null);
    setErr(null);
    // 100% advance → prefill the full PO foreign value; balance payments prefill nothing.
    setAmountFx(isAdvance ? (po.totalValueFx ? String(po.totalValueFx) : "") : "");
    setFxRate(po.fxRate ? String(po.fxRate) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, kind, editing?.id]);

  const loadFx = async () => {
    setFxBusy(true);
    setErr(null);
    try {
      const r = await s.fetchFxRate(ccy, "INR");
      setFxRate(String(r.rate));
    } catch (e) {
      setErr(`Couldn't fetch a live ${ccy}→INR rate — enter it manually. (${(e as Error).message})`);
    } finally {
      setFxBusy(false);
    }
  };

  const fx = Number(fxRate) || 0;
  const amtFx = Number(amountFx) || 0;
  const inrAmount = Math.round(amtFx * fx * 100) / 100;
  // Cap on the FOREIGN value (the FX rate at payment is independent of the request rate).
  // Editing excludes this payment's own row from the running total — mirroring the
  // server's `and id <> p_payment_id`. Without it, re-saving an unchanged 100%
  // advance would count itself twice and reject.
  const paidFx = s.payments
    .filter((p) => p.poId === po.id && (!editing || p.id !== editing.id))
    .reduce((a, p) => a + (p.amountFx ?? 0), 0);
  const pendingFx = Math.max(0, (po.totalValueFx ?? 0) - paidFx);

  const save = async () => {
    setErr(null);
    if (!(amtFx > 0)) return setErr(`Enter the ${ccy} amount paid.`);
    if (!(fx > 0)) return setErr("Enter a valid exchange rate.");
    if (amtFx > pendingFx + 0.01) return setErr(`Amount exceeds the PO value pending: ${ccy} ${pendingFx.toLocaleString("en-IN")}.`);
    setBusy(true);
    try {
      let advice: { path: string; name: string } | null = null;
      if (file) advice = await s.uploadPaymentAdvice(po.id, file);
      if (editing) {
        await s.updatePayment({
          paymentId: editing.id,
          amount: inrAmount,
          amountFx: amtFx,
          currency: ccy,
          fxRate: fx,
          details: details.trim() || null,
          advicePath: advice?.path ?? null, // null ⇒ server keeps the existing advice
          adviceName: advice?.name ?? null,
          paidOn,
          utrRef: utr.trim() || null,
        });
      } else {
        await s.recordPayment({
          poId: po.id,
          piId: null,
          kind,
          amount: inrAmount,
          amountFx: amtFx,
          currency: ccy,
          fxRate: fx,
          details: details.trim() || null,
          advicePath: advice?.path ?? null,
          adviceName: advice?.name ?? null,
          paidOn,
          utrRef: utr.trim() || null,
        });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}
      title={editing ? "Edit payment" : isAdvance ? "Record payment (100% advance)" : "Record payment"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded. Editable until a follow-up is logged against this PO.`
        : `${po.poNo} · ${ccy} ${(po.totalValueFx ?? 0).toLocaleString("en-IN")} · pending ${inr(poPending)}`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Record payment"}</Button></>}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label={`Amount (${ccy})`} required>
            <TextInput type="number" value={amountFx} min={0} onChange={(e) => setAmountFx(e.target.value)} />
          </FieldLabel>
          <FieldLabel label={`Exchange rate (1 ${ccy} → ₹)`} required>
            <div className="flex items-center gap-2">
              <TextInput type="number" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder={fxBusy ? "fetching…" : "e.g. 83.20"} />
              <button type="button" onClick={loadFx} disabled={fxBusy} className="shrink-0 text-[12px] text-teal underline disabled:opacity-50">{fxBusy ? "…" : "Live"}</button>
            </div>
            <Hint>from xe.com · editable</Hint>
          </FieldLabel>
        </div>
        <div className="rounded-lg bg-page/60 px-3 py-2 text-[13px] text-grey-2">
          INR value: <span className="font-semibold text-navy">{inr(inrAmount)}</span>
          <span className="text-grey-2"> · pending {inr(poPending)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Date"><TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></FieldLabel>
          <FieldLabel label="UTR / Ref" hint="optional">
            <TextInput value={utr} onChange={(e) => setUtr(e.target.value)} />
            <Hint>Bank reference</Hint>
          </FieldLabel>
        </div>
        <FieldLabel label="Payment details" hint="optional">
          <TextArea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. remitting bank, SWIFT ref, advice number…" />
        </FieldLabel>
        <FieldLabel label="Payment advice" hint="optional — attach the bank advice / SWIFT copy">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
              <Upload className="h-4 w-4" />
              {file ? "Change file" : "Choose file"}
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file ? (
              <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="shrink-0 text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <span className="text-[12.5px] text-grey-2">No file selected</span>
            )}
          </div>
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* ----------------------------- Follow-up --------------------------------- */
export function FollowupModal({ po, open, onClose, editing }: { po: PurchaseOrder | null; open: boolean; onClose: () => void; editing?: Followup }) {
  const s = useImportStore();
  const [status, setStatus] = useState("pending");
  const [actual, setActual] = useState("");
  const [lr, setLr] = useState("");
  const [transport, setTransport] = useState("");
  const [revised, setRevised] = useState("");
  const [remarks, setRemarks] = useState("");
  const [piRemarks, setPiRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Follow-ups are recorded against the PO; seed from the latest PO-level record.
  const history = po ? s.followupsForPo(po.id) : [];
  const latest = history[0];
  // The date the vendor currently owes us the goods by.
  const due = po ? s.dispatchDueForPo(po.id) : null;

  useEffect(() => {
    if (!open || !po) return;
    if (editing) {
      // Editing shows THIS row exactly as recorded — including its own revised
      // date and remarks, which a NEW follow-up deliberately starts blank.
      setStatus(editing.dispatchStatus);
      setActual(editing.actualDispatchDate ?? "");
      setLr(editing.lrNo ?? "");
      setTransport(editing.transportDetails ?? "");
      setRevised(editing.revisedDispatchDate ?? "");
      setRemarks(editing.remarks ?? "");
      setPiRemarks(editing.piRemarks ?? "");
      setErr(null);
      return;
    }
    setStatus(latest?.dispatchStatus ?? "pending");
    // Actual dispatch is a FACT — the day the goods really left — so it seeds
    // ONLY from a prior follow-up that actually recorded a dispatch. It must
    // never seed from the dispatch DUE date: that is a future promise, and
    // copying it in here is how a future actual dispatch date reached the
    // database (PO-2627-0011 was booked as dispatched on 10-08-2026, three
    // weeks out). The due date lives in the modal subtitle instead.
    setActual(latest?.dispatchStatus === "dispatched" ? latest.actualDispatchDate ?? "" : "");
    setLr(latest?.lrNo ?? "");
    setTransport(latest?.transportDetails ?? "");
    setRevised("");
    setRemarks("");
    setPiRemarks("");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id, editing?.id]);

  if (!po) return null;

  // The actual dispatch date only means anything on a `dispatched` follow-up:
  // clear it on the way out so a seeded date can't ride along on a status that
  // says the goods have NOT left.
  const onStatusChange = (next: string) => {
    setStatus(next);
    if (next !== "dispatched") setActual("");
  };

  const save = async () => {
    setErr(null);
    if (status === "dispatched" && !actual) return setErr("Enter the date the goods actually left the vendor.");
    // `max` on the input only constrains the picker — save runs from a button,
    // not a form submit, so a typed or pasted date arrives unchecked. This is
    // the guard that actually holds; the trigger behind the RPC is the backstop.
    if (actual && actual > todayLocalIso()) return setErr("Enter a dispatch date on or before today.");
    if (status === "delayed" && !revised) return setErr("Enter the revised dispatch date the vendor promised.");
    setBusy(true);
    try {
      const payload = { dispatchStatus: status, actualDispatchDate: actual || null, lrNo: lr.trim() || null, transportDetails: transport.trim() || null, revisedDispatchDate: revised || null, remarks: remarks.trim() || null, piRemarks: piRemarks.trim() || null };
      if (editing) await s.updateFollowup({ followupId: editing.id, ...payload });
      else await s.recordFollowup({ poId: po.id, ...payload });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit Follow-up — ${po.poNo}` : `Follow-up — ${po.poNo}`}
      subtitle={editing ? "Correct what was recorded. Editable until goods are received." : due ? `Dispatch due ${formatDate(due)}` : undefined}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Save"}</Button></>}>
      <div className="space-y-3.5">
        <FieldLabel label="Dispatch Status"><Combobox value={status} onChange={onStatusChange} options={DISPATCH} autoAdvance /></FieldLabel>
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Actual Dispatch Date" required={status === "dispatched"}>
            <TextInput type="date" value={actual} max={todayLocalIso()} onChange={(e) => setActual(e.target.value)} />
            <Hint>The day the goods actually left — cannot be in the future</Hint>
          </FieldLabel>
          {status === "delayed" && (
            <FieldLabel label="Revised Dispatch Date" required>
              {/* Was min={actual}. `actual` is now empty on a `delayed` follow-up,
                  which would leave this unbounded — a revised promise is future. */}
              <TextInput type="date" value={revised} min={todayLocalIso()} onChange={(e) => setRevised(e.target.value)} />
              <Hint>The new date the vendor promised</Hint>
            </FieldLabel>
          )}
          <FieldLabel label="LR No."><TextInput value={lr} onChange={(e) => setLr(e.target.value)} /></FieldLabel>
          <FieldLabel label="Transport"><TextInput value={transport} onChange={(e) => setTransport(e.target.value)} /></FieldLabel>
        </div>
        <FieldLabel label="Remarks" hint="what the vendor said this time · optional">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Vendor confirmed dispatch by Fri; awaiting LR." />
        </FieldLabel>
        <FieldLabel label="PI ref / remarks" hint="the vendor PI this dispatch relates to · optional">
          <TextInput value={piRemarks} onChange={(e) => setPiRemarks(e.target.value)} placeholder="e.g. PI-8841" />
        </FieldLabel>
        <Err msg={err} />

        <div>
          <div className={cn(SECTION_HEADING_CLASS, "mb-1.5")}>
            Follow-up history{history.length ? ` · ${history.length}` : ""}
          </div>
          {history.length === 0 ? (
            <p className="text-[12.5px] text-grey-2">No follow-ups recorded yet.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-line divide-y divide-line/70">
              {history.map((f) => {
                const who = f.createdBy ? s.profileById(f.createdBy)?.name ?? "Someone" : "System";
                const bits = [
                  f.actualDispatchDate ? `Dispatch ${formatDate(f.actualDispatchDate)}` : null,
                  f.revisedDispatchDate ? `Revised ${formatDate(f.revisedDispatchDate)}` : null,
                  f.lrNo ? `LR ${f.lrNo}` : null,
                  f.transportDetails ? f.transportDetails : null,
                  f.piRemarks ? `PI ${f.piRemarks}` : null,
                ].filter(Boolean);
                return (
                  <div key={f.id} className="px-3 py-2 text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold capitalize text-navy">{f.dispatchStatus}</span>
                      <span className="text-grey-2">{formatDate(f.createdAt)} · {who}</span>
                    </div>
                    {bits.length > 0 && <div className="text-grey mt-0.5">{bits.join(" · ")}</div>}
                    {f.remarks && <div className="text-navy mt-0.5">{f.remarks}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- GRN ------------------------------------- */
export function GrnModal({ po, open, onClose, editing }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: Grn }) {
  const s = useImportStore();
  const items = s.poItemsForPo(po.id);
  // The receipt is booked against the PO. Default to the reference the vendor
  // sees on the shared PO (its Tally number), falling back to the system PO no.
  const defaultPoRef = po.tallyPoNo || po.poNo;
  const [poRef, setPoRef] = useState(defaultPoRef);
  const [piRef, setPiRef] = useState("");
  const [gate, setGate] = useState("");
  const [condition, setCondition] = useState("good");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPoRef(editing?.poRef ?? defaultPoRef);
    setPiRef(editing?.piRef ?? "");
    setGate(editing?.gateRegisterNo ?? "");
    setCondition(editing?.condition ?? "good");
    setNote(editing?.note ?? "");
    setPhoto(null);
    const init: Record<string, string> = {};
    for (const it of items) {
      // Editing seeds THIS receipt's own recorded qty; a new receipt seeds the
      // outstanding balance. `it.receivedQty` is the rolled-up total across every
      // GRN, so it is the wrong number to show when correcting one of them.
      init[it.id] = editing
        ? String(s.grnItemsForGrn(editing.id).find((g) => g.poItemId === it.id)?.receivedQty ?? 0)
        : String(Math.max(0, it.qty - it.receivedQty));
    }
    setQty(init);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, editing?.id]);

  const damaged = condition === "damaged" || condition === "partial_damage";

  const save = async () => {
    setErr(null);
    if (!poRef.trim()) return setErr("Enter the PO reference number this receipt is against.");
    const lines = items.filter((it) => Number(qty[it.id]) > 0).map((it) => ({ poItemId: it.id, receivedQty: Number(qty[it.id]), condition }));
    if (lines.length === 0) return setErr("Enter a received quantity for at least one item.");
    setBusy(true);
    try {
      let photoDoc: { path: string; name: string } | null = null;
      if (photo) photoDoc = await s.uploadGrnPhoto(po.id, photo);
      if (editing) {
        await s.updateGrn({ grnId: editing.id, poRef: poRef.trim(), piRef: piRef.trim() || null, gateRegisterNo: gate.trim() || null, condition, note: note.trim() || null, items: lines, photoPath: photoDoc?.path ?? null, photoName: photoDoc?.name ?? null });
      } else {
        await s.recordGrn({ poId: po.id, piId: null, poRef: poRef.trim(), piRef: piRef.trim() || null, gateRegisterNo: gate.trim() || null, condition, note: note.trim() || null, items: lines, photoPath: photoDoc?.path ?? null, photoName: photoDoc?.name ?? null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? "Edit GRN" : "Record GRN"}
      subtitle={editing ? `${po.poNo} · correct what was recorded. Editable until this receipt is booked in Tally.` : `${po.poNo} · goods receipt against the PO — partial receipts allowed.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !poRef.trim()}>{busy ? "Saving…" : editing ? "Save Changes" : "Record receipt"}</Button></>}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3.5">
          <FieldLabel label="PO Ref No." required>
            <TextInput value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="e.g. 2627/PO/0042" />
            <Hint>The PO this receipt is against</Hint>
          </FieldLabel>
          <FieldLabel label="Gate Register No.">
            <TextInput value={gate} onChange={(e) => setGate(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Condition">
            <Combobox value={condition} onChange={setCondition} options={CONDITION} autoAdvance />
          </FieldLabel>
        </div>
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-grey-2 border-b border-line bg-page/60"><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Ordered</th><th className="px-3 py-2 font-medium">Received</th><th className="px-3 py-2 font-medium w-28">Receive Now</th></tr></thead>
            <tbody>
              {items.map((it) => {
                const line = s.lineById(it.requestItemId);
                return (
                  <tr key={it.id} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2 font-medium text-navy">{line ? s.itemLabel(line.itemId) : "—"}</td>
                    <td className="px-3 py-2">{it.qty}</td>
                    <td className="px-3 py-2">{it.receivedQty}</td>
                    <td className="px-3 py-2"><TextInput type="number" className="w-24" value={qty[it.id] ?? ""} onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <FieldLabel label="PI Ref" hint="optional">
          <TextInput value={piRef} onChange={(e) => setPiRef(e.target.value)} placeholder="e.g. PI-8841" />
          <Hint>Vendor PI number, kept as a remark only</Hint>
        </FieldLabel>
        <FieldLabel label="Note"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FieldLabel>
        <FieldLabel label="Photo" hint={damaged ? "recommended — capture the damage for records" : "optional"}>
          <div className="flex items-center gap-2.5">
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium transition ${damaged && !photo ? "border-orange text-orange" : "border-line text-navy hover:border-orange hover:text-orange"}`}>
              <Upload className="h-4 w-4" />
              {photo ? "Change photo" : "Add photo"}
              <input type="file" className="hidden" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </label>
            {photo ? (
              <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                <span className="max-w-[220px] truncate text-navy">{photo.name}</span>
                <button type="button" onClick={() => setPhoto(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <span className={`text-[12.5px] ${damaged ? "text-ryg-red" : "text-grey-2"}`}>{damaged ? "Attach a photo of the damaged goods" : "No photo"}</span>
            )}
          </div>
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------- Tally ----------------------------------- */
export function TallyModal({ po, open, onClose, editing }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: TallyBooking }) {
  const s = useImportStore();
  // One Tally invoice per goods receipt — only receipts not yet booked are offered.
  const unbooked = s.unbookedGrnsForPo(po.id);
  const [grnId, setGrnId] = useState("");
  const [tallyNo, setTallyNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGrnId(editing?.grnId ?? unbooked[0]?.id ?? "");
    setTallyNo(editing?.tallyPiNo ?? "");
    setRemarks(editing?.remarks ?? "");
    setFile(null);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, editing?.id]);

  /** Received qty on a GRN, so the user can tell partial consignments apart. */
  const grnLabel = (g: (typeof unbooked)[number]): string => {
    const qty = s.grnItemsForGrn(g.id).reduce((a, x) => a + x.receivedQty, 0);
    const ref = g.gateRegisterNo || g.poRef || g.id.slice(0, 8);
    return `${ref} · ${formatDate(g.createdAt)} · ${qty.toLocaleString("en-IN")} recd`;
  };
  const grnOptions: ComboOption[] = unbooked.map((g) => ({ value: g.id, label: grnLabel(g) }));

  const save = async () => {
    setErr(null);
    if (!tallyNo.trim()) return setErr("Tally invoice number is required.");
    if (!editing && unbooked.length > 0 && !grnId) return setErr("Select the goods receipt this invoice is booked against.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadTallyDocument(po.id, file);
      if (editing) {
        // grnId is deliberately not sent: which receipt an invoice belongs to is
        // not a typo, and moving it would silently un-book the old one.
        await s.updateTally({ bookingId: editing.id, tallyPiNo: tallyNo.trim(), documentPath: doc?.path ?? null, documentName: doc?.name ?? null, remarks: remarks.trim() || null });
      } else {
        await s.bookTally({ poId: po.id, grnId: grnId || null, tallyPiNo: tallyNo.trim(), documentPath: doc?.path ?? null, documentName: doc?.name ?? null, remarks: remarks.trim() || null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // On edit the booking's own GRN is no longer in `unbooked` (it IS booked), so
  // offer it explicitly — read-only, purely so the user can see what they are
  // correcting against.
  const editedGrn = editing?.grnId ? s.grnsForPo(po.id).find((g) => g.id === editing.grnId) : undefined;

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit Tally Booking" : "Book in Tally"}
      subtitle={editing ? `${po.poNo} · correct the invoice details. The receipt it is booked against cannot be changed.` : `${po.poNo} · one invoice per goods receipt — partial receipts included.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Book"}</Button></>}>
      <div className="space-y-3.5">
        <FieldLabel label="Against GRN" required={!editing && unbooked.length > 0}>
          {editing ? (
            <>
              <TextInput value={editedGrn ? grnLabel(editedGrn) : "—"} readOnly className="bg-page/70 text-grey-2 cursor-not-allowed" />
              <Hint>Fixed — delete and re-book if the invoice is against the wrong receipt.</Hint>
            </>
          ) : (
            <>
              <Combobox value={grnId} onChange={setGrnId} options={grnOptions} autoAdvance />
              <Hint>
                {unbooked.length === 0
                  ? "Every goods receipt on this PO is already booked."
                  : `${unbooked.length} receipt${unbooked.length === 1 ? "" : "s"} awaiting an invoice.`}
              </Hint>
            </>
          )}
        </FieldLabel>
        <FieldLabel label="Tally Invoice No." required><TextInput value={tallyNo} onChange={(e) => setTallyNo(e.target.value)} placeholder="e.g. 2627/PUR/0123" /></FieldLabel>
        <FieldLabel label="Tally Invoice Document" hint="PDF or any file · optional">
          <div className="flex items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
              <Upload className="h-4 w-4" />
              {file ? "Change file" : "Choose file"}
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {file ? (
              <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
              </span>
            ) : (
              <span className="text-[12.5px] text-grey-2">No file selected</span>
            )}
          </div>
        </FieldLabel>
        <FieldLabel label="Remarks" hint="Optional">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* -------------------- PO cancellation (vendor-requested) ------------------ */

/** A PO-side step owner logs the vendor's request to cancel a PO. */
export function RequestCancelModal({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const s = useImportStore();
  const [reason, setReason] = useState("");
  const [vendorRef, setVendorRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setVendorRef("");
    setErr(null);
  }, [open, po.id]);

  const save = async () => {
    setErr(null);
    if (!reason.trim()) return setErr("A reason for the cancellation is required.");
    setBusy(true);
    try {
      await s.requestPoCancel(po.id, reason.trim(), vendorRef.trim() || null);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Request PO cancellation" subtitle={`${po.poNo} · the approver will review and decide.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button><Button size="sm" onClick={save} disabled={busy || !reason.trim()}>{busy ? "Sending…" : "Send to approver"}</Button></>}>
      <div className="space-y-3.5">
        <FieldLabel label="Reason (vendor's request)" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vendor can no longer supply at the agreed rate" />
        </FieldLabel>
        <FieldLabel label="Vendor reference" hint="optional — the vendor's cancellation note / mail ref">
          <TextInput value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} placeholder="e.g. mail dated 14-Jul" />
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/** Approver-only — cancel the PO, optionally resolving a logged request. */
export function CancelPoModal({ po, request, open, onClose }: { po: PurchaseOrder; request: PoCancelRequest | null; open: boolean; onClose: () => void }) {
  const s = useImportStore();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(request?.reason ?? "");
    setErr(null);
  }, [open, po.id, request?.id]);

  const save = async () => {
    setErr(null);
    if (!reason.trim()) return setErr("A reason for the cancellation is required.");
    setBusy(true);
    try {
      await s.cancelPo(po.id, reason.trim(), request?.id ?? null);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Cancel this PO" subtitle={`${po.poNo} · this cannot be undone — a re-order is a fresh PO.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button><Button size="sm" variant="ghost" className="!text-ryg-red hover:!border-ryg-red" onClick={save} disabled={busy || !reason.trim()}>{busy ? "Cancelling…" : "Cancel PO"}</Button></>}>
      <div className="space-y-3.5">
        {po.advancePaid > 0 && (
          <p className="rounded-xl border border-ryg-red/30 bg-[#FDECEC] px-3 py-2 text-[12.5px] text-ryg-red">
            An advance of {inr(po.advancePaid)} has already been paid on this PO — arrange the refund with the vendor separately. Note it in the reason below.
          </p>
        )}
        <FieldLabel label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this PO being cancelled?" />
        </FieldLabel>
        <p className="text-[12.5px] text-grey-2">Cancelling marks the PO and its order lines cancelled and removes it from all work queues.</p>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/** Approver-only — decline a cancellation request; the PO stays open. */
export function DeclineCancelModal({ request, open, onClose }: { request: PoCancelRequest | null; open: boolean; onClose: () => void }) {
  const s = useImportStore();
  const po = s.poById(request?.poId ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setErr(null);
  }, [open, request?.id]);

  const save = async () => {
    if (!request) return;
    setErr(null);
    setBusy(true);
    try {
      await s.declinePoCancel(request.id, note.trim() || null);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Decline cancellation" subtitle={po ? `${po.poNo} · the PO stays active.` : undefined}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Close</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Decline request"}</Button></>}>
      <div className="space-y-3.5">
        {request?.reason && <p className="rounded-xl border border-line bg-page/60 px-3 py-2 text-[12.5px] text-grey-2">Requested reason: <span className="text-navy">{request.reason}</span></p>}
        <FieldLabel label="Note" hint="optional — why the cancellation is declined">
          <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Goods already dispatched; proceeding with the order" />
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}
