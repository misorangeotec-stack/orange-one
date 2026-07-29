import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS, Field, FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { cn } from "@/shared/lib/cn";
import { todayIso, formatDate } from "@/shared/lib/time";
// NOT time.ts's todayIso(): that is documented "local" but is really the UTC
// date, so in IST it reads as yesterday until 05:30 and would reject a dispatch
// entered early in the morning. todayLocalIso() is the genuinely local one.
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useImportStore } from "../store";
import { inr } from "../lib/format";
import PoItemsTable from "./PoItemsTable";
import PoRefPanel, { PoRefDocs } from "./PoRefPanel";
import { PiDocLink, GrnPhotoLink, TallyDocLink, PoDocLink, QcDocLink, ReturnDocLink, GateDocLink } from "./DocLinks";
import type { PurchaseOrder, PoCancelRequest, Pi, Payment, Followup, Grn, QcInspection, TallyBooking } from "../types";

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

/* --------------------------- Step 5: Collect PI --------------------------- */
/**
 * The vendor's proforma invoice against a shared PO. THREE fields: the PI
 * number, the document — both required — and a remark.
 *
 * Deliberately not the old Add-PI dialog. That one made you cover each PO line
 * with a quantity and auto-priced the PI in two currencies, because a PI used to
 * be the base a 100%-advance payment was made against. Import is a quantity
 * requisition now: nothing downstream reads a PI quantity or a PI value, so
 * asking for them was work with no reader. What the desk actually needs from
 * this step is the number and the paperwork.
 *
 * The PO's lines are still shown, read-only, so the collector can check the PI
 * they were sent is for this order.
 */
export function CollectPiModal({ po, open, onClose, editing, readOnly = false, stacked = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: Pi; readOnly?: boolean; /** Opened on top of another step modal — see Modal's `stacked`. */ stacked?: boolean }) {
  const s = useImportStore();
  const [vendorPiNo, setVendorPiNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVendorPiNo(editing?.vendorPiNo ?? "");
    setRemarks(editing?.remarks ?? "");
    setFile(null);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, editing?.id]);

  const hasExistingDoc = !!editing?.documentPath;
  /**
   * The attachment is mandatory. On an EDIT it is satisfied by the stored file —
   * a typo fix in the PI number must not demand the PDF in hand again — and by a
   * fresh upload either way. `editing` without a stored document is possible only
   * on a row that predates this step's rule.
   */
  const docSatisfied = !!file || hasExistingDoc;
  const ready = !!vendorPiNo.trim() && docSatisfied;

  const save = async () => {
    setErr(null);
    if (!vendorPiNo.trim()) return setErr("The vendor's PI number is required.");
    if (!docSatisfied) return setErr("Attach the vendor's PI document.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadPiDocument(po.id, file);
      if (editing) {
        await s.updateCollectPi({
          piId: editing.id,
          vendorPiNo: vendorPiNo.trim(),
          documentPath: doc?.path ?? null, // null ⇒ the server keeps the stored file
          documentName: doc?.name ?? null,
          remarks: remarks.trim() || null,
        });
      } else {
        await s.collectPi({
          poId: po.id,
          vendorPiNo: vendorPiNo.trim(),
          // Non-null by the `docSatisfied` guard above: a new PI always uploads.
          documentPath: doc!.path,
          documentName: doc!.name,
          remarks: remarks.trim() || null,
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
    <Modal open={open} onClose={onClose} readOnly={readOnly} stacked={stacked}
      readOnlyHeader={editing ? <PiDocLink pi={editing} /> : undefined}
      size="2xl" title={editing ? (readOnly ? "Vendor PI" : "Edit Vendor PI") : "Collect PI"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded. Editable until a follow-up is logged or goods arrive.`
        : `${po.poNo} · record the proforma invoice the vendor sent against this order.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !ready}>{busy ? "Saving…" : editing ? "Save Changes" : "Save PI"}</Button></>}>
      <div className="space-y-4">
        {/* Who this order is for and from, and the references the vendor quoted
            the PI against — the same opening block every PO step form uses. */}
        <PoRefPanel po={po} readOnly={readOnly} showPoNo showTallyPoNo />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3.5">
            <FieldLabel label="Vendor PI No." required>
              <TextInput value={vendorPiNo} onChange={(e) => setVendorPiNo(e.target.value)} placeholder="As printed on the vendor's proforma" />
            </FieldLabel>

            {!readOnly && (
              <FieldLabel label="Vendor PI Document" required
                hint={editing ? (hasExistingDoc ? "leave as-is to keep the attached file" : "PDF or any file · required") : "PDF or any file · required"}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                    <Upload className="h-4 w-4" />
                    {file ? "Change file" : hasExistingDoc ? "Replace file" : "Choose file"}
                    <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {file ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                      <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                      <button type="button" onClick={() => setFile(null)} className="shrink-0 text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ) : hasExistingDoc ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                      Current: <span className="max-w-[220px] truncate text-navy">{editing?.documentName ?? "attached file"}</span>
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-ryg-red">No file selected — the PI cannot be saved without one.</span>
                  )}
                </div>
              </FieldLabel>
            )}

            <FieldLabel label="Remarks" hint="Optional">
              <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. PI covers a partial shipment; balance to follow." />
            </FieldLabel>
            <Err msg={err} />
          </div>

          <div className="space-y-1.5">
            <div className={SECTION_HEADING_CLASS}>What this PO covers</div>
            <PoItemsTable po={po} compact />
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- Share PO -------------------------------- */
/**
 * The Tally PO number and the PO PDF are SHOWN, not captured: the PO Desk
 * records both when it generates the PO, and they stay amendable there until
 * the PO is shared. This step owns the expected dispatch date and the remarks.
 */
export function SharePoModal({ po, open, editing = false, onClose, readOnly = false }: { po: PurchaseOrder; open: boolean; editing?: boolean; onClose: () => void; readOnly?: boolean }) {
  const s = useImportStore();
  const [dispatch, setDispatch] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDispatch(po.dispatchDate ?? "");
    setRemarks(editing ? po.shareRemarks ?? "" : "");
    setErr(null);
  }, [open, editing, po.id, po.dispatchDate, po.shareRemarks]);

  /**
   * A PO generated BEFORE the Tally number and PDF moved to the PO stage can
   * reach this queue with neither. It is not stranded — the PO stage stays
   * editable until a PO is shared — so point the sharer at where to fix it
   * rather than letting them submit something the server will refuse anyway.
   */
  const missingPoStageData = !po.tallyPoNo || !po.documentPath;

  const save = async () => {
    setErr(null);
    if (missingPoStageData) return setErr("This PO has no Tally PO number or PDF yet — add them on the PO stage first.");
    if (!dispatch) return setErr("Enter the expected dispatch date.");
    setBusy(true);
    try {
      if (editing) {
        await s.updateSharePo({
          poId: po.id,
          // Import is always 100% advance; an edit must not quietly re-route the PO
          // off the Payment step, so the terms stay forced here exactly as at share.
          paymentTerms: "full_advance",
          dispatchDate: dispatch,
          remarks: remarks.trim() || null,
        });
      } else {
        // Import is always 100% advance — force full_advance so the PO routes to the Payment step.
        await s.sharePo(po.id, { remarks: remarks.trim() || null, paymentTerms: "full_advance", dispatchDate: dispatch });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} readOnly={readOnly} readOnlyHeader={<PoDocLink po={po} />} size="2xl" title={editing ? (readOnly ? "Share Details" : "Edit Share Details") : "Share PO"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded when this PO was shared. Editable until the next step is done.`
        : `${po.poNo} · confirm the dispatch date, then mark it shared with the vendor. Import is 100% advance.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || missingPoStageData || !dispatch}>{busy ? (editing ? "Saving…" : "Sharing…") : editing ? "Save Changes" : "Share PO"}</Button></>}>
      <div className="space-y-4">
        {/* Who this PO is for and from, plus what was recorded at the PO stage —
            shown here, never edited here. The PDF link is rendered only outside
            read-only mode: Modal puts the body inside a disabled <fieldset>, so a
            button here would be dead. In view mode the same link is already in
            `readOnlyHeader`. */}
        <PoRefPanel po={po} readOnly={readOnly} showTallyPoNo>
          {!readOnly && (
            <div className="min-w-0">
              <div className={FIELD_LABEL_CLASS}>PO PDF</div>
              <div className="mt-1">
                {po.documentPath ? <PoDocLink po={po} /> : <span className="text-[12.5px] text-ryg-red">Not attached</span>}
              </div>
            </div>
          )}
        </PoRefPanel>

        {missingPoStageData && (
          <p className="text-[12.5px] text-ryg-red">
            This PO has no Tally PO number or PDF yet. Add them on the PO stage (PO Workbench → Completed → Edit PO
            Details) — it stays editable until the PO is shared.
          </p>
        )}

        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5">
          <FieldLabel label="Expected Dispatch Date" required>
            <TextInput type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} />
            <Hint>Anchors the follow-up due date</Hint>
          </FieldLabel>
        </div>

        {/* What is actually being shared. The Domestic twin has carried this since
            the Tally PO number moved to the PO stage; Import never had it. */}
        <PoItemsTable po={po} />

        <div className="border-t border-line/70" />

        <FieldLabel label="Remarks" hint="Optional">
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Anything the vendor should know about this PO." />
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* --------------------------- Payment (adv/inst) -------------------------- */
export function PaymentModal({ po, open, onClose, kind, editing, readOnly = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; kind: "advance" | "installment"; editing?: Payment; readOnly?: boolean }) {
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
    <Modal open={open} onClose={onClose} readOnly={readOnly}
      title={editing ? (readOnly ? "Payment" : "Edit payment") : isAdvance ? "Record payment (100% advance)" : "Record payment"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded. Editable until a follow-up is logged against this PO.`
        : `${po.poNo} · ${ccy} ${(po.totalValueFx ?? 0).toLocaleString("en-IN")} · pending ${inr(poPending)}`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Record payment"}</Button></>}>
      <div className="space-y-3.5">
        {/* Import retired its advance step, so nothing renders this today. The
            panel is here anyway to keep the two apps' PoModals a matched pair —
            if the step ever returns it must not return context-blind. */}
        <PoRefPanel po={po} readOnly={readOnly} showPoNo showTallyPoNo showPi />
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
export function FollowupModal({ po, open, onClose, editing, readOnly = false }: { po: PurchaseOrder | null; open: boolean; onClose: () => void; editing?: Followup; readOnly?: boolean }) {
  const s = useImportStore();
  const [status, setStatus] = useState("pending");
  const [actual, setActual] = useState("");
  const [lr, setLr] = useState("");
  const [transport, setTransport] = useState("");
  const [revised, setRevised] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The vendor PI opened for a quick read-only look (from the reference row).
  const [viewPi, setViewPi] = useState<Pi | null>(null);

  // Follow-ups are recorded against the PO; seed from the latest PO-level record.
  const history = po ? s.followupsForPo(po.id) : [];
  const latest = history[0];
  // The date the vendor currently owes us the goods by.
  const due = po ? s.dispatchDueForPo(po.id) : null;
  // The ORIGINAL planned dispatch date, confirmed at Share PO — always shown for
  // reference. `priorRevised` is the most recent revised date from an earlier
  // delay (history is newest-first, and a `dispatched` row never carries a revised
  // date — see onStatusChange — so this always resolves to the last real delay).
  const planned = po?.dispatchDate ?? null;
  const priorRevised = history.find((f) => f.revisedDispatchDate)?.revisedDispatchDate ?? null;

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
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id, editing?.id]);

  if (!po) return null;

  // Each editable date belongs to exactly one status: the actual date to
  // `dispatched`, the revised date to `delayed`. Clear the one that no longer
  // applies on the way out, so a seeded/typed date can't ride along on a status
  // that contradicts it.
  const onStatusChange = (next: string) => {
    setStatus(next);
    // LR number, transport and the actual dispatch date only mean something once
    // the goods have left — clear them when the status says they haven't.
    if (next !== "dispatched") { setActual(""); setLr(""); setTransport(""); }
    if (next !== "delayed") setRevised("");
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
      // piRemarks is no longer collected in the UI (the real vendor PI is shown in
      // the reference row); preserve any value an older record already had.
      const payload = { dispatchStatus: status, actualDispatchDate: actual || null, lrNo: lr.trim() || null, transportDetails: transport.trim() || null, revisedDispatchDate: revised || null, remarks: remarks.trim() || null, piRemarks: editing?.piRemarks ?? null };
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
    <>
    {/* Two columns, deliberately: this dialog already carried the entry fields AND
        the full follow-up history, so dropping the order context in as a third
        stacked block would have made it scroll badly. Widened to `2xl` to match
        the other PO steps, and the new context lives in that width. */}
    <Modal open={open} onClose={onClose} readOnly={readOnly} size="2xl" readOnlyHeader={<PoRefDocs po={po} showPi />}
      title={editing && !readOnly ? `Edit Follow-up — ${po.poNo}` : `Follow-up — ${po.poNo}`}
      subtitle={editing ? "Correct what was recorded. Editable until goods are received." : due ? `Dispatch due ${formatDate(due)}` : undefined}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Save"}</Button></>}>
      <div className="space-y-4">
        {/* Who the order is for and from, plus the references this follow-up is
            about — the vendor-facing Tally PO number and the vendor PI number(s)
            collected on this PO (each opens that PI, and links its document). The
            internal PO number is in the title. */}
        <PoRefPanel po={po} readOnly={readOnly} showTallyPoNo showPi onViewPi={setViewPi} />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3.5">
            <FieldLabel label="Dispatch Status"><Combobox value={status} onChange={onStatusChange} options={DISPATCH} autoAdvance /></FieldLabel>

            {/* Dispatch dates. The PLANNED date (confirmed at Share PO) is always shown
                for reference; the editable field then matches the status — a revised
                promise when `delayed`, the actual dispatch fact when `dispatched`. When
                dispatching after an earlier delay, that revised date is shown too. */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Planned Dispatch Date" value={formatDate(planned)} />
              {status === "delayed" && (
                <FieldLabel label="Revised Dispatch Date" required>
                  {/* A revised promise is always future. */}
                  <TextInput type="date" value={revised} min={todayLocalIso()} onChange={(e) => setRevised(e.target.value)} />
                  <Hint>The new date the vendor promised</Hint>
                </FieldLabel>
              )}
              {status === "dispatched" && (
                <>
                  {priorRevised && <Field label="Revised (delayed) Dispatch Date" value={formatDate(priorRevised)} />}
                  <FieldLabel label="Actual Dispatch Date" required>
                    <TextInput type="date" value={actual} max={todayLocalIso()} onChange={(e) => setActual(e.target.value)} />
                    <Hint>The day the goods actually left — cannot be in the future</Hint>
                  </FieldLabel>
                </>
              )}
            </div>

            {/* LR No. + Transport describe a shipment that has left — only meaningful
                once dispatched. */}
            {status === "dispatched" && (
              <div className="grid grid-cols-2 gap-3">
                <FieldLabel label="LR No."><TextInput value={lr} onChange={(e) => setLr(e.target.value)} /></FieldLabel>
                <FieldLabel label="Transport"><TextInput value={transport} onChange={(e) => setTransport(e.target.value)} /></FieldLabel>
              </div>
            )}
            <FieldLabel label="Remarks" hint="what the vendor said this time · optional">
              <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Vendor confirmed dispatch by Fri; awaiting LR." />
            </FieldLabel>
            <Err msg={err} />
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <div className={SECTION_HEADING_CLASS}>What this PO covers</div>
              <PoItemsTable po={po} compact />
            </div>

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
        </div>
      </div>
    </Modal>
    {/* A quick read-only look at a vendor PI, opened from the reference row.
        Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. `stacked` keeps it
        above the parent and stops Escape closing both at once. */}
    {viewPi && <CollectPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
    </>
  );
}

/* ------------------------------- GRN ------------------------------------- */
export function GrnModal({ po, open, onClose, editing, readOnly = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: Grn; readOnly?: boolean }) {
  const s = useImportStore();
  const items = s.poItemsForPo(po.id);
  // The receipt is booked against the PO. Default to the reference the vendor
  // sees on the shared PO (its Tally number), falling back to the system PO no.
  const defaultPoRef = po.tallyPoNo || po.poNo;
  // The vendor PI(s) on this PO — shown (clickable) as the reference, and kept as
  // the receipt's PI remark so nobody has to re-type a number the PO already holds.
  const pis = s.pisForPo(po.id);
  const defaultPiRef = pis.map((p) => p.vendorPiNo).join(", ");
  const [poRef, setPoRef] = useState(defaultPoRef);
  const [piRef, setPiRef] = useState(defaultPiRef);
  const [gate, setGate] = useState("");
  const [condition, setCondition] = useState("good");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [viewPi, setViewPi] = useState<Pi | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPoRef(editing?.poRef ?? defaultPoRef);
    setPiRef(editing?.piRef ?? defaultPiRef);
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
    <>
    <Modal open={open} onClose={onClose} readOnly={readOnly}
      readOnlyHeader={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {editing && <GrnPhotoLink grn={editing} />}
          <PoRefDocs po={po} showPi />
        </div>
      }
      size="2xl" title={editing ? (readOnly ? "GRN" : "Edit GRN") : "Record GRN"}
      subtitle={editing ? `${po.poNo} · correct what was recorded. Editable until this receipt is booked in Tally.` : `${po.poNo} · goods receipt against the PO — partial receipts allowed.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !poRef.trim()}>{busy ? "Saving…" : editing ? "Save Changes" : "Record receipt"}</Button></>}>
      <div className="space-y-5">
        {/* References panel — the receipt is booked against this PO, so these come
            from the PO itself: who it is for and from, the vendor-facing Tally PO
            No. (links to the PO) and the vendor PI No(s) collected on it (each
            opens that PI, and links its document). */}
        <PoRefPanel po={po} readOnly={readOnly} showTallyPoNo showPi onViewPi={setViewPi} />

        {/* Receipt details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <FieldLabel label="Gate Register No.">
            <TextInput value={gate} onChange={(e) => setGate(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Condition">
            <Combobox value={condition} onChange={setCondition} options={CONDITION} autoAdvance />
          </FieldLabel>
        </div>

        {/* Goods lines — enter how much of each item is landing on this receipt. */}
        <div>
          <div className={`${SECTION_HEADING_CLASS} mb-1.5`}>Goods received</div>
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-grey-2 border-b border-line bg-page/60">
                  <th className="px-4 py-2.5 text-left font-medium">Item</th>
                  <th className="px-4 py-2.5 text-right font-medium w-32">Ordered</th>
                  <th className="px-4 py-2.5 text-right font-medium w-32">Received</th>
                  <th className="px-4 py-2.5 text-right font-medium w-44">Receive Now</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const line = s.lineById(it.requestItemId);
                  const unit = line?.unit ? ` ${line.unit}` : "";
                  return (
                    <tr key={it.id} className="border-b border-line/70 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-navy">{line ? s.itemLabel(line.itemId) : "—"}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">{it.qty}{unit}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">{it.receivedQty}{unit}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <TextInput type="number" className="w-28 text-right" value={qty[it.id] ?? ""} onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} />
                          {line?.unit && <span className="w-10 text-[12.5px] text-grey-2">{line.unit}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <FieldLabel label="Note"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></FieldLabel>
        {!readOnly && (
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
        )}
        <Err msg={err} />
      </div>
    </Modal>
    {/* A quick read-only look at a vendor PI, opened from the reference row.
        Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. `stacked` keeps it
        above the parent and stops Escape closing both at once. */}
    {viewPi && <CollectPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
    </>
  );
}

/* ------------------------------- Tally ----------------------------------- */
export function TallyModal({ po, open, onClose, editing, readOnly = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: TallyBooking; readOnly?: boolean }) {
  const s = useImportStore();
  // One Tally invoice per goods receipt — only receipts not yet booked are offered.
  const unbooked = s.unbookedGrnsForPo(po.id);
  const [grnId, setGrnId] = useState("");
  const [tallyNo, setTallyNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** A quick read-only look at a vendor PI, opened from the reference panel. */
  const [viewPi, setViewPi] = useState<Pi | null>(null);

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

  const hasExistingDoc = !!editing?.documentPath;
  // A Tally entry must carry its invoice document. Edits are exempt: bookings made
  // before this rule have none, and a typo fix must not demand the PDF in hand.
  const docSatisfied = !!editing || !!file;

  const save = async () => {
    setErr(null);
    if (!tallyNo.trim()) return setErr("Tally invoice number is required.");
    if (!editing && unbooked.length > 0 && !grnId) return setErr("Select the goods receipt this invoice is booked against.");
    if (!docSatisfied) return setErr("Attach the Tally invoice document.");
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
    <>
    {/* Two columns at `2xl`, like every other PO step. Booking an invoice used to
        happen in a narrow box that named neither the company, the vendor, the PI
        being invoiced, nor any of the goods the invoice is for. */}
    <Modal open={open} onClose={onClose} readOnly={readOnly} size="2xl"
      readOnlyHeader={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {editing && <TallyDocLink booking={editing} />}
          <PoRefDocs po={po} showPi showTallyInvoice />
        </div>
      }
      title={editing ? (readOnly ? "Tally Booking" : "Edit Tally Booking") : "Book in Tally"}
      subtitle={editing ? `${po.poNo} · correct the invoice details. The receipt it is booked against cannot be changed.` : `${po.poNo} · one invoice per goods receipt — partial receipts included.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !docSatisfied || !tallyNo.trim() || (!editing && unbooked.length > 0 && !grnId)}>{busy ? "Saving…" : editing ? "Save Changes" : "Book"}</Button></>}>
      <div className="space-y-4">
        {/* `showTallyInvoice` without a `grn` lists every invoice already booked on
            this PO — the context for booking the next receipt, and on an edit the
            entry being corrected. */}
        <PoRefPanel po={po} readOnly={readOnly} showPoNo showTallyPoNo showPi showTallyInvoice onViewPi={setViewPi} />

        <div className="grid gap-4 lg:grid-cols-2">
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
            {!readOnly && (
              <FieldLabel label="Tally Invoice Document" required={!editing}
                hint={editing ? (hasExistingDoc ? "leave as-is to keep the attached file" : "optional on this older booking") : "PDF or any file · required"}>
              <div className="flex items-center gap-2.5">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                  <Upload className="h-4 w-4" />
                  {file ? "Change file" : editing && hasExistingDoc ? "Replace file" : "Choose file"}
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                {file ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                    <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ) : editing && hasExistingDoc ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                    Current: <span className="max-w-[220px] truncate text-navy">{editing.documentName ?? "attached file"}</span>
                  </span>
                ) : (
                  <span className="text-[12.5px] text-grey-2">No file selected</span>
                )}
              </div>
            </FieldLabel>
            )}
            <FieldLabel label="Remarks" hint="Optional">
              <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </FieldLabel>
            <Err msg={err} />
          </div>

          <div className="space-y-1.5">
            <div className={SECTION_HEADING_CLASS}>What this PO covers</div>
            <PoItemsTable po={po} compact />
          </div>
        </div>
      </div>
    </Modal>
    {/* Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. */}
    {viewPi && <CollectPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
    </>
  );
}

/* ============ QC inspection + the purchase-return branch ================= */

/**
 * The reference panel every QC-branch modal opens with — now the shared
 * {@link PoRefPanel}, which is where this component ended up: it was the only
 * step form in the app that named the vendor, so the rest of the flow was given
 * the same block and the company was added to it.
 *
 * `grn` narrows the Tally-invoice cell to the booking for THIS receipt (a PO can
 * hold several), which is the paperwork a return is raised against.
 */
function QcRefPanel({ po, grn, readOnly = false }: { po: PurchaseOrder; grn?: Grn; readOnly?: boolean }) {
  return <PoRefPanel po={po} grn={grn} readOnly={readOnly} showPoNo showTallyPoNo showTallyInvoice />;
}

/** A line's verdict. `""` is "not decided yet" — an inspection cannot be saved holding one. */
type QcDecision = "" | "approved" | "rejected";

/**
 * The per-item verdict control.
 *
 * Whole-item by design: a line is either taken or sent back, never part-taken,
 * so this is a two-way choice and not a quantity. Nothing is preselected —
 * an inspection has to be a decision somebody made, not a default nobody changed.
 */
function QcDecisionToggle({ value, onChange }: { value: QcDecision; onChange: (v: QcDecision) => void }) {
  const opts = [
    { value: "approved" as const, label: "Approve", on: "border-ryg-green/40 bg-[#E9F8EF] text-ryg-green" },
    { value: "rejected" as const, label: "Reject", on: "border-ryg-red/40 bg-[#FDECEC] text-ryg-red" },
  ];
  return (
    <div className="inline-flex items-center gap-1.5">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-pill border px-3 py-1.5 text-[12px] font-semibold transition whitespace-nowrap",
            value === o.value ? o.on : "border-line bg-white text-grey-2 hover:border-orange hover:text-orange",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * QC Inspection — the decision is ITEM-WISE and covers ONLY the lines whose
 * category is flagged `qc_required` in Masters (Raw Material today). A receipt of
 * anything else never reaches this modal.
 *
 * Every line must be explicitly approved or rejected before the step can be
 * saved, and a rejection must say why. The inspection's `result` is still
 * DERIVED — one rejected line makes the whole inspection a rejection, which is
 * what opens the return branch — and the chip shows that live.
 *
 * A rejected line is stored as `rejectedQty = receivedQty`, i.e. the whole line
 * goes back. The stored shape is unchanged, so the return and gate-outward steps
 * read it exactly as they always have.
 */
export function QcModal({
  po, grn, open, onClose, editing, readOnly = false,
}: { po: PurchaseOrder; grn?: Grn; open: boolean; onClose: () => void; editing?: QcInspection; readOnly?: boolean }) {
  const s = useImportStore();
  // On edit the receipt comes from the inspection; on create it is passed in (or
  // defaults to the oldest one still awaiting inspection).
  const pending = s.uninspectedGrnsForPo(po.id);
  const target: Grn | undefined = editing
    ? s.grnsForPo(po.id).find((g) => g.id === editing.grnId)
    : grn ?? pending[0];

  const lines = target ? s.qcLinesForGrn(target.id) : [];
  const [decision, setDecision] = useState<Record<string, QcDecision>>({});
  const [remark, setRemark] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const dc: Record<string, QcDecision> = {};
    const rm: Record<string, string> = {};
    const existing = editing ? s.qcItemsFor(editing.id) : [];
    for (const l of lines) {
      const prev = existing.find((x) => x.poItemId === l.poItemId);
      // Recording starts blank. Editing replays what was recorded — a line that
      // carries a rejected quantity was a rejection.
      dc[l.poItemId] = prev ? (prev.rejectedQty > 0 ? "rejected" : "approved") : "";
      rm[l.poItemId] = prev?.remark ?? "";
    }
    setDecision(dc);
    setRemark(rm);
    setRemarks(editing?.remarks ?? "");
    setFile(null);
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, target?.id, editing?.id]);

  const anyRejected = lines.some((l) => decision[l.poItemId] === "rejected");
  const allDecided = lines.length > 0 && lines.every((l) => !!decision[l.poItemId]);
  const missingRemark = lines.some((l) => decision[l.poItemId] === "rejected" && !remark[l.poItemId]?.trim());
  const hasExistingDoc = !!editing?.documentPath;
  const setAll = (v: QcDecision) => setDecision(Object.fromEntries(lines.map((l) => [l.poItemId, v])));

  const save = async () => {
    setErr(null);
    if (!target) return setErr("There is no goods receipt awaiting inspection on this PO.");
    if (!allDecided) return setErr("Approve or reject every item before saving the inspection.");
    if (missingRemark) return setErr("A rejected item needs a remark saying why it was rejected.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadQcDocument(po.id, file);
      // A rejection sends the line back in full, so the quantity the write layer
      // stores against it IS what this receipt delivered.
      const items = lines.map((l) => ({
        poItemId: l.poItemId,
        rejected: decision[l.poItemId] === "rejected",
        receivedQty: l.receivedQty,
        remark: decision[l.poItemId] === "rejected" ? remark[l.poItemId]?.trim() || null : null,
      }));
      if (editing) {
        await s.updateQc({ inspectionId: editing.id, poId: po.id, items, remarks: remarks.trim() || null, documentPath: doc?.path ?? null, documentName: doc?.name ?? null });
      } else {
        await s.recordQc({ grnId: target.id, poId: po.id, items, remarks: remarks.trim() || null, documentPath: doc?.path ?? null, documentName: doc?.name ?? null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} readOnly={readOnly}
      readOnlyHeader={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {editing && <QcDocLink qc={editing} />}
          <PoRefDocs po={po} grn={target} showTallyInvoice />
        </div>
      }
      size="2xl"
      title={editing ? (readOnly ? "QC Inspection" : "Edit QC Inspection") : "Record QC Inspection"}
      subtitle={`${po.poNo} · quality check on the received material. Approve or reject each item — a rejected item needs a remark.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !target || !allDecided || missingRemark}>{busy ? "Saving…" : editing ? "Save Changes" : !allDecided ? "Record inspection" : anyRejected ? "Record rejection" : "Approve"}</Button></>}>
      <div className="space-y-5">
        <QcRefPanel po={po} grn={target} readOnly={readOnly} />

        {!target ? (
          <p className="text-[13px] text-grey-2">Every goods receipt on this PO has already been inspected.</p>
        ) : (
          <>
            <div>
              <div className={`${SECTION_HEADING_CLASS} mb-1.5 flex items-center justify-between gap-3`}>
                <span>Material inspected</span>
                <div className="flex items-center gap-3">
                  {/* Bulk verdicts only earn their space once there is more than one line. */}
                  {!readOnly && lines.length > 1 && (
                    <span className="flex items-center gap-2 text-[11px] font-semibold normal-case tracking-normal">
                      <button type="button" onClick={() => setAll("approved")} className="text-grey-2 transition hover:text-ryg-green">Approve all</button>
                      <span className="text-line">·</span>
                      <button type="button" onClick={() => setAll("rejected")} className="text-grey-2 transition hover:text-ryg-red">Reject all</button>
                    </span>
                  )}
                  <span className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    !allDecided ? "bg-page text-grey-2" : anyRejected ? "bg-[#FDECEC] text-ryg-red" : "bg-[#E9F8EF] text-ryg-green",
                  )}>
                    {!allDecided ? "Awaiting decision" : anyRejected ? "Rejected" : "Approved"}
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-line overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-grey-2 border-b border-line bg-page/60">
                      <th className="px-4 py-2.5 text-left font-medium">Item</th>
                      <th className="px-4 py-2.5 text-right font-medium w-36">Received</th>
                      <th className="px-4 py-2.5 text-center font-medium w-52">Decision</th>
                      <th className="px-4 py-2.5 text-left font-medium w-64">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((gi) => {
                      const poItem = s.poItemsForPo(po.id).find((p) => p.id === gi.poItemId);
                      const line = poItem ? s.lineById(poItem.requestItemId) : undefined;
                      const unit = line?.unit ? ` ${line.unit}` : "";
                      const d = decision[gi.poItemId] ?? "";
                      const needsRemark = d === "rejected" && !remark[gi.poItemId]?.trim();
                      return (
                        <tr key={gi.id} className="border-b border-line/70 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-navy">{line ? s.itemLabel(line.itemId) : "—"}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">{gi.receivedQty}{unit}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex justify-center">
                              <QcDecisionToggle value={d} onChange={(v) => setDecision((p) => ({ ...p, [gi.poItemId]: v }))} />
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            {/* Only a rejection has anything to explain, so the field opens with it. */}
                            <TextInput
                              value={remark[gi.poItemId] ?? ""}
                              disabled={d !== "rejected"}
                              placeholder={d === "rejected" ? "why it was rejected" : "—"}
                              className={cn(needsRemark && "border-ryg-red", d !== "rejected" && "bg-page/70 cursor-not-allowed")}
                              onChange={(e) => setRemark((p) => ({ ...p, [gi.poItemId]: e.target.value }))} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Hint>
                Only Raw Material lines are inspected — anything else on this receipt is not subject to QC.
                {anyRejected
                  ? " A rejected item goes back in full — the whole received quantity flows into the purchase return."
                  : !allDecided ? " Every item needs a decision before this step can be saved." : ""}
              </Hint>
            </div>

            {!readOnly && (
              <FieldLabel label="QC Report" hint={editing && hasExistingDoc ? "leave as-is to keep the attached file" : "optional"}>
                <div className="flex items-center gap-2.5">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                    <Upload className="h-4 w-4" />
                    {file ? "Change file" : editing && hasExistingDoc ? "Replace file" : "Choose file"}
                    <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {file ? (
                    <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                      <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                      <button type="button" onClick={() => setFile(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ) : editing && hasExistingDoc ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                      Current: <span className="max-w-[220px] truncate text-navy">{editing.documentName ?? "attached file"}</span>
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-grey-2">No file selected</span>
                  )}
                </div>
              </FieldLabel>
            )}
            <FieldLabel label="Remarks" hint="Optional">
              <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </FieldLabel>
          </>
        )}
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/** The rejected lines of an inspection, read-only — what the return actually covers. */
function RejectedItemsReadout({ po, inspection }: { po: PurchaseOrder; inspection: QcInspection }) {
  const s = useImportStore();
  const items = s.rejectedItemsFor(inspection.id);
  return (
    <div>
      <div className={`${SECTION_HEADING_CLASS} mb-1.5`}>Items being returned</div>
      <div className="rounded-xl border border-line overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-grey-2 border-b border-line bg-page/60">
              <th className="px-4 py-2.5 text-left font-medium">Item</th>
              <th className="px-4 py-2.5 text-right font-medium w-36">Received</th>
              <th className="px-4 py-2.5 text-right font-medium w-36">Rejected</th>
              <th className="px-4 py-2.5 text-left font-medium">QC remark</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-3 text-grey-2">No rejected items.</td></tr>
            ) : items.map((qi) => {
              const poItem = s.poItemsForPo(po.id).find((p) => p.id === qi.poItemId);
              const line = poItem ? s.lineById(poItem.requestItemId) : undefined;
              const unit = line?.unit ? ` ${line.unit}` : "";
              return (
                <tr key={qi.id} className="border-b border-line/70 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-navy">{line ? s.itemLabel(line.itemId) : "—"}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{qi.receivedQty}{unit}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap font-semibold text-ryg-red">{qi.rejectedQty}{unit}</td>
                  <td className="px-4 py-2.5 text-grey-2">{qi.remark ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Purchase Return Entry in Tally. Both the Tally reference and the document are
 * MANDATORY — and unlike the Book-in-Tally document (which could only ever be a
 * client-side rule, because older bookings have none) the server refuses without
 * them, since this step has no legacy rows.
 */
export function PurchaseReturnModal({
  po, inspection, open, onClose, editing = false, readOnly = false,
}: { po: PurchaseOrder; inspection: QcInspection; open: boolean; onClose: () => void; editing?: boolean; readOnly?: boolean }) {
  const s = useImportStore();
  const grn = s.grnsForPo(po.id).find((g) => g.id === inspection.grnId);
  const [tallyRef, setTallyRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTallyRef(inspection.returnTallyRef ?? "");
    setRemarks(inspection.returnRemarks ?? "");
    setFile(null);
    setErr(null);
  }, [open, inspection.id, inspection.returnTallyRef, inspection.returnRemarks]);

  const hasExistingDoc = !!inspection.returnDocPath;
  // On create the document is required outright; on edit the stored one stands in.
  const docSatisfied = !!file || (editing && hasExistingDoc);

  const save = async () => {
    setErr(null);
    if (!tallyRef.trim()) return setErr("The Tally reference number is required.");
    if (!docSatisfied) return setErr("Attach the purchase return document.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadReturnDocument(po.id, file);
      if (editing) {
        await s.updatePurchaseReturn({ inspectionId: inspection.id, tallyRef: tallyRef.trim(), documentPath: doc?.path ?? null, documentName: doc?.name ?? null, remarks: remarks.trim() || null });
      } else {
        await s.recordPurchaseReturn({ inspectionId: inspection.id, poId: po.id, tallyRef: tallyRef.trim(), documentPath: doc!.path, documentName: doc!.name, remarks: remarks.trim() || null });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} readOnly={readOnly}
      readOnlyHeader={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ReturnDocLink qc={inspection} />
          <PoRefDocs po={po} grn={grn} showTallyInvoice />
        </div>
      }
      size="2xl"
      title={editing ? (readOnly ? "Purchase Return Entry" : "Edit Purchase Return Entry") : "Purchase Return Entry in Tally"}
      subtitle={`${po.poNo} · book the return of the QC-rejected material in Tally.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !tallyRef.trim() || !docSatisfied}>{busy ? "Saving…" : editing ? "Save Changes" : "Record return"}</Button></>}>
      <div className="space-y-5">
        {/* The purchase invoice this material was booked in on — number AND the
            stored invoice, since the return is raised against that document. */}
        <QcRefPanel po={po} grn={grn} readOnly={readOnly} />
        <RejectedItemsReadout po={po} inspection={inspection} />
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <FieldLabel label="Tally Reference No." required>
            <TextInput value={tallyRef} onChange={(e) => setTallyRef(e.target.value)} placeholder="e.g. 2627/PR/0007" />
          </FieldLabel>
          {!readOnly && (
            <FieldLabel label="Return Document" required={!editing}
              hint={editing && hasExistingDoc ? "leave as-is to keep the attached file" : "PDF or any file · required"}>
              <div className="flex items-center gap-2.5">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                  <Upload className="h-4 w-4" />
                  {file ? "Change file" : editing && hasExistingDoc ? "Replace file" : "Choose file"}
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                {file ? (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                    <span className="max-w-[180px] truncate text-navy">{file.name}</span>
                    <button type="button" onClick={() => setFile(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ) : editing && hasExistingDoc ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                    Current: <span className="max-w-[180px] truncate text-navy">{inspection.returnDocName ?? "attached file"}</span>
                  </span>
                ) : (
                  <span className="text-[12.5px] text-grey-2">No file selected</span>
                )}
              </div>
            </FieldLabel>
          )}
        </div>
        <FieldLabel label="Remarks" hint="Optional">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/**
 * Gate Register Outward — the last step of the rejection branch. The outward date
 * cannot be in the future, the same rule the follow-up's actual dispatch date
 * carries: you cannot record a movement that has not happened.
 */
export function GateOutwardModal({
  po, inspection, open, onClose, editing = false, readOnly = false,
}: { po: PurchaseOrder; inspection: QcInspection; open: boolean; onClose: () => void; editing?: boolean; readOnly?: boolean }) {
  const s = useImportStore();
  const grn = s.grnsForPo(po.id).find((g) => g.id === inspection.grnId);
  const [gateNo, setGateNo] = useState("");
  const [outDate, setOutDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setGateNo(inspection.gateRegisterNo ?? "");
    setOutDate(inspection.gateOutDate ?? todayLocalIso());
    setRemarks(inspection.gateRemarks ?? "");
    setFile(null);
    setErr(null);
  }, [open, inspection.id, inspection.gateRegisterNo, inspection.gateOutDate, inspection.gateRemarks]);

  const hasExistingDoc = !!inspection.gateDocPath;

  const save = async () => {
    setErr(null);
    if (!gateNo.trim()) return setErr("The gate register number is required.");
    if (!outDate) return setErr("Enter the outward date.");
    if (outDate > todayLocalIso()) return setErr("The outward date cannot be in the future.");
    setBusy(true);
    try {
      let doc: { path: string; name: string } | null = null;
      if (file) doc = await s.uploadGateDocument(po.id, file);
      const payload = { inspectionId: inspection.id, gateRegisterNo: gateNo.trim(), outDate, remarks: remarks.trim() || null, documentPath: doc?.path ?? null, documentName: doc?.name ?? null };
      if (editing) await s.updateGateOutward(payload);
      else await s.recordGateOutward({ ...payload, poId: po.id });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} readOnly={readOnly}
      readOnlyHeader={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <GateDocLink qc={inspection} />
          <PoRefDocs po={po} grn={grn} showTallyInvoice />
        </div>
      }
      size="2xl"
      title={editing ? (readOnly ? "Gate Register Outward" : "Edit Gate Register Outward") : "Gate Register Outward"}
      subtitle={`${po.poNo} · record the rejected material leaving the premises. This closes the process.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || !gateNo.trim() || !outDate}>{busy ? "Saving…" : editing ? "Save Changes" : "Record gate outward"}</Button></>}>
      <div className="space-y-5">
        <QcRefPanel po={po} grn={grn} readOnly={readOnly} />
        <RejectedItemsReadout po={po} inspection={inspection} />
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <FieldLabel label="Gate Register No." required>
            <TextInput value={gateNo} onChange={(e) => setGateNo(e.target.value)} placeholder="e.g. GRO-0142" />
          </FieldLabel>
          <FieldLabel label="Outward Date" required>
            <TextInput type="date" max={todayLocalIso()} value={outDate} onChange={(e) => setOutDate(e.target.value)} />
            <Hint>Cannot be in the future — record it when the material actually leaves.</Hint>
          </FieldLabel>
        </div>
        {!readOnly && (
          <FieldLabel label="Gate Pass" hint={editing && hasExistingDoc ? "leave as-is to keep the attached file" : "optional"}>
            <div className="flex items-center gap-2.5">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] font-medium text-navy transition hover:border-orange hover:text-orange">
                <Upload className="h-4 w-4" />
                {file ? "Change file" : editing && hasExistingDoc ? "Replace file" : "Choose file"}
                <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {file ? (
                <span className="flex items-center gap-1.5 text-[12.5px] text-grey-2">
                  <span className="max-w-[220px] truncate text-navy">{file.name}</span>
                  <button type="button" onClick={() => setFile(null)} className="text-grey-2 hover:text-ryg-red" aria-label="Remove file"><X className="h-3.5 w-3.5" /></button>
                </span>
              ) : editing && hasExistingDoc ? (
                <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-grey-2">
                  Current: <span className="max-w-[220px] truncate text-navy">{inspection.gateDocName ?? "attached file"}</span>
                </span>
              ) : (
                <span className="text-[12.5px] text-grey-2">No file selected</span>
              )}
            </div>
          </FieldLabel>
        )}
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
