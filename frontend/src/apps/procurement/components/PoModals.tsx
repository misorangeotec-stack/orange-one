import { useEffect, useMemo, useState } from "react";
import { Upload, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { todayIso, formatDate } from "@/shared/lib/time";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import type { PurchaseOrder, Pi } from "../types";

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

/* ----------------------------- Add PI ------------------------------------ */
export function AddPiModal({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const s = useProcurementStore();
  const items = s.poItemsForPo(po.id);
  const [vendorPiNo, setVendorPiNo] = useState("");
  const [terms, setTerms] = useState("on_delivery");
  const [dispatch, setDispatch] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Per-line coverage: how much of each PO line is already on an existing PI, how
  // much is still to collect, and its per-unit (incl-GST) value.
  const coverage = items.map((pi) => {
    const covered = s.piItems.filter((x) => x.poItemId === pi.id).reduce((a, x) => a + x.qty, 0);
    return { pi, covered, remaining: Math.max(0, pi.qty - covered), unit: pi.qty > 0 ? pi.lineValue / pi.qty : 0 };
  });
  const unitById = new Map(coverage.map((c) => [c.pi.id, c.unit]));
  // PI value auto-matches the lines this PI covers (Σ coverQty × per-unit incl GST).
  const piValue = Math.round(items.reduce((sum, pi) => sum + (Number(qty[pi.id]) || 0) * (unitById.get(pi.id) ?? 0), 0) * 100) / 100;

  useEffect(() => {
    if (!open) return;
    setVendorPiNo("");
    setTerms("on_delivery");
    setDispatch("");
    setFile(null);
    const init: Record<string, string> = {};
    for (const pi of items) {
      const covered = s.piItems.filter((x) => x.poItemId === pi.id).reduce((a, x) => a + x.qty, 0);
      init[pi.id] = String(Math.max(0, pi.qty - covered));
    }
    setQty(init);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id]);

  const save = async () => {
    setErr(null);
    if (!vendorPiNo.trim()) return setErr("Vendor PI number is required.");
    const lines = items.filter((pi) => Number(qty[pi.id]) > 0).map((pi) => ({ poItemId: pi.id, qty: Number(qty[pi.id]) }));
    if (lines.length === 0) return setErr("Cover at least one item with a quantity.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadPiDocument(po.id, file);
      await s.addPi({ poId: po.id, vendorPiNo: vendorPiNo.trim(), paymentTerms: terms, piValue, dispatchDate: dispatch || null, items: lines, documentPath: doc?.path ?? null, documentName: doc?.name ?? null });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Add PI" subtitle="Proforma invoice — covered items, terms and dispatch date."
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Add PI"}</Button></>}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Vendor PI No." required><TextInput value={vendorPiNo} onChange={(e) => setVendorPiNo(e.target.value)} /></FieldLabel>
          <FieldLabel label="PI Value (incl GST)" hint={<span className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2">Auto</span>}>
            <TextInput type="number" value={String(piValue)} readOnly title="Auto-calculated from the covered lines (Cover Qty × rate incl GST)" className="bg-page/70 text-grey-2 cursor-not-allowed" />
          </FieldLabel>
          <FieldLabel label="Payment Terms"><Combobox value={terms} onChange={setTerms} options={PAYMENT_TERMS} autoAdvance /></FieldLabel>
          <FieldLabel label="Dispatch Date"><TextInput type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} /></FieldLabel>
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
export function SharePoModal({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const s = useProcurementStore();
  const [tallyPoNo, setTallyPoNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTallyPoNo("");
    setRemarks("");
    setFile(null);
    setErr(null);
  }, [open, po.id]);

  const save = async () => {
    setErr(null);
    if (!tallyPoNo.trim()) return setErr("Enter the PO number generated in Tally.");
    if (!file) return setErr("Attach the PO PDF to mark it shared.");
    setBusy(true);
    try {
      const doc = await s.uploadPoDocument(po.id, file);
      await s.sharePo(po.id, { path: doc.path, name: doc.name, tallyPoNo: tallyPoNo.trim(), remarks: remarks.trim() || null });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Share PO" subtitle={`${po.poNo} · attach the PO PDF and Tally PO number, then mark it shared with the vendor.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !file || !tallyPoNo.trim()}>{busy ? "Sharing…" : "Share PO"}</Button></>}>
      <div className="space-y-3.5">
        <FieldLabel label="Tally PO Number" required hint="The PO number generated in Tally/ERP">
          <TextInput value={tallyPoNo} onChange={(e) => setTallyPoNo(e.target.value)} placeholder="e.g. 2627/PO/0042" />
        </FieldLabel>
        <FieldLabel label="PO PDF" required hint="PDF or any file — required to share">
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

/* --------------------------- Payment (adv/inst) -------------------------- */
export function PaymentModal({ po, pi = null, open, onClose, kind }: { po: PurchaseOrder; pi?: Pi | null; open: boolean; onClose: () => void; kind: "advance" | "installment" }) {
  const s = useProcurementStore();
  // The PO's PIs that still carry a balance — payment can be allocated across them.
  const eligible = s.pisForPo(po.id).filter((p) => s.pendingForPi(p) > 0);
  const hasPis = eligible.length > 0;
  const poPending = s.pendingAmount(po);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [poAmount, setPoAmount] = useState(""); // used only when the PO has no PIs
  const [paidOn, setPaidOn] = useState(todayIso());
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const termLabel = (t: string) => PAYMENT_TERMS.find((o) => o.value === t)?.label ?? t;

  useEffect(() => {
    if (!open) return;
    setPaidOn(todayIso());
    setUtr("");
    setErr(null);
    setPoAmount(kind === "installment" ? String(poPending) : "");
    // Preselect: the PI we were opened for, else the only PI if there's exactly one.
    const preId = pi?.id ?? (eligible.length === 1 ? eligible[0].id : null);
    const sel = new Set<string>();
    const amt: Record<string, string> = {};
    if (preId) {
      const p = eligible.find((e) => e.id === preId);
      if (p) { sel.add(p.id); amt[p.id] = String(s.pendingForPi(p)); }
    }
    setSelected(sel);
    setAmounts(amt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, pi?.id, kind]);

  const toggle = (p: Pi) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(p.id) ? next.delete(p.id) : next.add(p.id);
      return next;
    });
    setAmounts((a) => (a[p.id] !== undefined ? a : { ...a, [p.id]: String(s.pendingForPi(p)) }));
  };

  const total = eligible.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + (Number(amounts[p.id]) || 0), 0);

  const save = async () => {
    setErr(null);
    let rows: { piId: string | null; amount: number }[] = [];
    if (hasPis) {
      const chosen = eligible.filter((p) => selected.has(p.id));
      if (chosen.length === 0) return setErr("Select at least one PI this payment is against.");
      for (const p of chosen) {
        const amt = Number(amounts[p.id]);
        if (!(amt > 0)) return setErr(`Enter an amount for PI ${p.vendorPiNo}.`);
        if (amt > s.pendingForPi(p) + 0.01) return setErr(`Amount for PI ${p.vendorPiNo} exceeds its pending ${inr(s.pendingForPi(p))}.`);
        rows.push({ piId: p.id, amount: amt });
      }
    } else {
      const amt = Number(poAmount);
      if (!(amt > 0)) return setErr("Enter an amount greater than 0.");
      if (amt > poPending + 0.01) return setErr(`Amount exceeds the pending ${inr(poPending)}.`);
      rows = [{ piId: null, amount: amt }];
    }
    setBusy(true);
    try {
      // One payment row per PI — each advance/installment stays tagged to its PI.
      for (const row of rows) {
        await s.recordPayment({ poId: po.id, piId: row.piId, kind, amount: row.amount, paidOn, utrRef: utr.trim() || null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isAdvance = kind === "advance";

  return (
    <Modal open={open} onClose={onClose} size={hasPis ? "lg" : "md"} title={isAdvance ? "Record advance" : "Record payment"} subtitle={`${po.poNo} · Pending ${inr(poPending)}`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record"}</Button></>}>
      <div className="space-y-3.5">
        {hasPis ? (
          <>
            <p className="text-[12.5px] text-grey-2">Select the PI(s) this {isAdvance ? "advance" : "payment"} is against{eligible.length === 1 ? " (only one on this PO)" : ""}, and set the amount per PI.</p>
            <div className="rounded-xl border border-line overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                    <th className="px-3 py-2 font-medium w-8"></th>
                    <th className="px-3 py-2 font-medium">PI</th>
                    <th className="px-3 py-2 font-medium">Pending</th>
                    <th className="px-3 py-2 font-medium w-32">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {eligible.map((p) => {
                    const sel = selected.has(p.id);
                    const piPending = s.pendingForPi(p);
                    return (
                      <tr key={p.id} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-2"><input type="checkbox" className="w-4 h-4 accent-orange" checked={sel} onChange={() => toggle(p)} /></td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-navy">{p.vendorPiNo}</div>
                          <div className="text-[11px] text-grey-2">{termLabel(p.paymentTerms)} · Value {inr(p.piValue)}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{inr(piPending)}</td>
                        <td className="px-3 py-2">
                          <TextInput
                            type="number"
                            className={`w-28 ${sel ? "" : "bg-page/70 text-grey-2 cursor-not-allowed"}`}
                            value={sel ? (amounts[p.id] ?? "") : ""}
                            min={0}
                            max={piPending}
                            disabled={!sel}
                            onChange={(e) =>
                              setAmounts((a) => ({ ...a, [p.id]: e.target.value === "" ? "" : String(Math.max(0, Math.min(piPending, Number(e.target.value)))) }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 text-[13px]">
              <span className="text-grey-2">Total {isAdvance ? "advance" : "payment"}:</span>
              <span className="font-semibold text-navy">{inr(total)}</span>
            </div>
          </>
        ) : (
          <FieldLabel label="Amount (₹)" required><TextInput type="number" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} /></FieldLabel>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Date"><TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></FieldLabel>
          <FieldLabel label="UTR / Ref" hint="one reference for this batch · optional"><TextInput value={utr} onChange={(e) => setUtr(e.target.value)} /></FieldLabel>
        </div>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* ----------------------------- Follow-up --------------------------------- */
export function FollowupModal({ pi, open, onClose }: { pi: Pi | null; open: boolean; onClose: () => void }) {
  const s = useProcurementStore();
  const [status, setStatus] = useState("pending");
  const [actual, setActual] = useState("");
  const [lr, setLr] = useState("");
  const [transport, setTransport] = useState("");
  const [revised, setRevised] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !pi) return;
    setStatus(pi.dispatchStatus);
    // Default the dispatch date to the PI's planned dispatch date (recorded on Add PI).
    setActual(pi.actualDispatchDate ?? pi.dispatchDate ?? "");
    setLr(pi.lrNo ?? "");
    setTransport(pi.transportDetails ?? "");
    setRevised(pi.revisedDispatchDate ?? "");
    setRemarks("");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pi?.id]);

  if (!pi) return null;
  const po = s.poById(pi.poId);
  const poPis = s.pisForPo(pi.poId);
  // Follow-up is a PO-level call — it's logged against every PI still awaiting dispatch.
  const pendingPis = poPis.filter((p) => p.status !== "received" && p.dispatchStatus !== "dispatched");
  const targets = pendingPis.length > 0 ? pendingPis : [pi];
  // Item names a PI covers — shown so the caller can ask about every PI's goods.
  const piItemNames = (p: Pi): string =>
    s
      .piItemsForPi(p.id)
      .map((x) => {
        const poItem = s.poItemsForPo(pi.poId).find((it) => it.id === x.poItemId);
        const line = poItem ? s.lineById(poItem.requestItemId) : undefined;
        return line ? s.itemById(line.itemId)?.name ?? s.itemLabel(line.itemId) : null;
      })
      .filter(Boolean)
      .join(", ");
  // Full follow-up history across all of the PO's PIs, newest first.
  const history = s.followups.filter((f) => f.poId === pi.poId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      for (const t of targets) {
        await s.recordFollowup({ piId: t.id, dispatchStatus: status, actualDispatchDate: actual || null, lrNo: lr.trim() || null, transportDetails: transport.trim() || null, revisedDispatchDate: revised || null, remarks: remarks.trim() || null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Follow-up — ${po?.poNo ?? "PO"}`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></>}>
      <div className="space-y-3.5">
        {poPis.length > 0 && (
          <div className="rounded-xl border border-line bg-page/40 p-3">
            <div className="text-[12px] font-semibold text-grey-2 mb-2">
              {poPis.length === 1 ? "PI on this PO" : `PIs on this PO · ${poPis.length}`}
              <span className="font-normal"> — {poPis.length === 1 ? "follow up on its item(s)" : "this follow-up is logged against every pending PI"}</span>
            </div>
            <div className="space-y-1.5">
              {poPis.map((p) => {
                const due = p.revisedDispatchDate ?? p.dispatchDate;
                return (
                  <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-navy">{p.vendorPiNo}</span>
                      <div className="text-grey-2" title={piItemNames(p)}>{piItemNames(p) || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="capitalize text-navy">{p.dispatchStatus}</div>
                      {due && <div className="text-grey-2 text-[11px]">plan {formatDate(due)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <FieldLabel label="Dispatch Status"><Combobox value={status} onChange={setStatus} options={DISPATCH} autoAdvance /></FieldLabel>
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Actual Dispatch Date"><TextInput type="date" value={actual} onChange={(e) => setActual(e.target.value)} /></FieldLabel>
          {status === "delayed" && <FieldLabel label="Revised Dispatch Date"><TextInput type="date" value={revised} onChange={(e) => setRevised(e.target.value)} /></FieldLabel>}
          <FieldLabel label="LR No."><TextInput value={lr} onChange={(e) => setLr(e.target.value)} /></FieldLabel>
          <FieldLabel label="Transport"><TextInput value={transport} onChange={(e) => setTransport(e.target.value)} /></FieldLabel>
        </div>
        <FieldLabel label="Remarks" hint="what the vendor said this time · optional">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Vendor confirmed dispatch by Fri; awaiting LR." />
        </FieldLabel>
        <Err msg={err} />

        <div>
          <div className="text-[12px] font-semibold text-grey-2 mb-1.5">Follow-up history{history.length ? ` · ${history.length}` : ""}</div>
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
                ].filter(Boolean);
                return (
                  <div key={f.id} className="px-3 py-2 text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold capitalize text-navy">{f.dispatchStatus}<span className="ml-2 text-[11px] font-normal normal-case text-grey-2">{poPis.find((x) => x.id === f.piId)?.vendorPiNo ?? ""}</span></span>
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
export function GrnModal({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const s = useProcurementStore();
  const items = s.poItemsForPo(po.id);
  const pis = s.pisForPo(po.id);
  const [piId, setPiId] = useState("");
  const [gate, setGate] = useState("");
  const [condition, setCondition] = useState("good");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPiId("");
    setGate("");
    setCondition("good");
    setNote("");
    setPhoto(null);
    const init: Record<string, string> = {};
    for (const it of items) init[it.id] = String(Math.max(0, it.qty - it.receivedQty));
    setQty(init);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id]);

  const damaged = condition === "damaged" || condition === "partial_damage";

  const piOptions: ComboOption[] = [{ value: "", label: "— No specific PI —" }, ...pis.map((p) => ({ value: p.id, label: p.vendorPiNo }))];

  const save = async () => {
    setErr(null);
    const lines = items.filter((it) => Number(qty[it.id]) > 0).map((it) => ({ poItemId: it.id, receivedQty: Number(qty[it.id]), condition }));
    if (lines.length === 0) return setErr("Enter a received quantity for at least one item.");
    setBusy(true);
    try {
      let photoDoc: { path: string; name: string } | null = null;
      if (photo) photoDoc = await s.uploadGrnPhoto(po.id, photo);
      await s.recordGrn({ poId: po.id, piId: piId || null, gateRegisterNo: gate.trim() || null, condition, note: note.trim() || null, items: lines, photoPath: photoDoc?.path ?? null, photoName: photoDoc?.name ?? null });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title="Record GRN" subtitle="Goods receipt — partial receipts allowed."
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Record receipt"}</Button></>}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-3 gap-3">
          <FieldLabel label="Against PI"><Combobox value={piId} onChange={setPiId} options={piOptions} autoAdvance /></FieldLabel>
          <FieldLabel label="Gate Register No."><TextInput value={gate} onChange={(e) => setGate(e.target.value)} /></FieldLabel>
          <FieldLabel label="Condition"><Combobox value={condition} onChange={setCondition} options={CONDITION} autoAdvance /></FieldLabel>
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
export function TallyModal({ po, open, onClose }: { po: PurchaseOrder; open: boolean; onClose: () => void }) {
  const s = useProcurementStore();
  const grns = s.grnsForPo(po.id);
  const [grnId, setGrnId] = useState("");
  const [tallyNo, setTallyNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGrnId("");
    setTallyNo("");
    setRemarks("");
    setFile(null);
    setErr(null);
  }, [open, po.id]);

  const grnOptions: ComboOption[] = [{ value: "", label: "— No specific GRN —" }, ...grns.map((g) => ({ value: g.id, label: g.gateRegisterNo || g.id.slice(0, 8) }))];

  const save = async () => {
    setErr(null);
    if (!tallyNo.trim()) return setErr("Tally invoice number is required.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadTallyDocument(po.id, file);
      await s.bookTally({ poId: po.id, grnId: grnId || null, tallyPiNo: tallyNo.trim(), documentPath: doc?.path ?? null, documentName: doc?.name ?? null, remarks: remarks.trim() || null });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Book in Tally" subtitle="Record the vendor invoice as entered in Tally."
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Book"}</Button></>}>
      <div className="space-y-3.5">
        <FieldLabel label="Against GRN"><Combobox value={grnId} onChange={setGrnId} options={grnOptions} autoAdvance /></FieldLabel>
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
