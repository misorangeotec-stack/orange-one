import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Upload, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import DraftBar from "@/shared/components/ui/DraftBar";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { FIELD_LABEL_CLASS, SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { cn } from "@/shared/lib/cn";
import { useStepDraft } from "@/shared/lib/useStepDraft";
import { usePoStepDraftKey } from "../lib/draftKeys";
import { todayIso, formatDate } from "@/shared/lib/time";
// NOT time.ts's todayIso(): that is documented "local" but is really the UTC
// date, so in IST it reads as yesterday until 05:30 and would reject a dispatch
// entered early in the morning. todayLocalIso() is the genuinely local one.
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import QtyTotal from "./QtyTotal";
import PoItemsReadout from "./PoItemsReadout";
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

/* ----------------------------- Add PI ------------------------------------ */
export function AddPiModal({ po, open, onClose, editing, readOnly = false, stacked = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: Pi; readOnly?: boolean; /** Opened on top of another step modal — see Modal's `stacked`. */ stacked?: boolean }) {
  const s = useProcurementStore();
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

  // `stacked` is the read-only PI viewer opened from four other step modals —
  // never a form, and it shares `po.id` with the real one, so it must not draft.
  const draftKeyStr = usePoStepDraftKey("collect_pi", open && !readOnly && !stacked, editing?.id ?? po.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { vendorPiNo, qty },
    // Merge onto the freshly seeded map: PO lines added since the draft keep
    // their computed remaining-qty default instead of vanishing.
    apply: (v) => { setVendorPiNo(v.vendorPiNo); setQty((prev) => ({ ...prev, ...v.qty })); },
  });

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
      draft.clear();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} readOnly={readOnly} stacked={stacked} readOnlyHeader={editing ? <PiDocLink pi={editing} /> : undefined} size="2xl" title={editing ? (readOnly ? "PI" : "Edit PI") : "Add PI"}
      subtitle={editing
        ? `${po.poNo} · correct what was recorded. Editable until a payment lands against it or goods arrive.`
        : "Proforma invoice — the items it covers. Payment terms and dispatch date are set on the PO."}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Add PI"}</Button></>}>
      <div className="space-y-3.5">
        <DraftBar draft={draft} />
        <PoRefPanel po={po} readOnly={readOnly} showPoNo showTallyPoNo />
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Vendor PI No." required><TextInput value={vendorPiNo} onChange={(e) => setVendorPiNo(e.target.value)} /></FieldLabel>
          <FieldLabel label="PI Value (incl GST)" hint={<span className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2">Auto</span>}>
            <TextInput type="number" value={String(readOnly && editing ? editing.piValue : piValue)} readOnly title={readOnly ? "The PI value as it was recorded" : "Auto-calculated from the covered lines (Cover Qty × rate incl GST)"} className="bg-page/70 text-grey-2 cursor-not-allowed" />
          </FieldLabel>
        </div>
        {!readOnly && (
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
        )}
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
                        className={`w-28 min-w-[6.5rem] text-right tabular-nums ${locked ? "bg-page/70 text-grey-2 cursor-not-allowed" : ""}`}
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
            {coverage.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-orange-soft/50">
                  <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                  <td className="px-3 py-2 font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={coverage.map(({ pi }) => ({ qty: pi.qty, unit: s.lineById(pi.requestItemId)?.unit }))} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <Err msg={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------- Share PO -------------------------------- */
/**
 * Share a PO, or — with `editing` — correct one already shared.
 *
 * The Tally PO number and the PO PDF are SHOWN, not captured: the PO Desk
 * records both when it generates the PO, and they stay amendable there until
 * the PO is shared. This step owns the commercial terms — payment terms, the
 * expected dispatch date and the remarks — and nothing else.
 *
 * The two modes differ in more than labels. Sharing is the STEP: it moves the
 * stage on and stamps who/when. Editing only amends what was recorded: the
 * original sharer and moment are left alone, and the RPC refuses outright once
 * the next step is done.
 */
export function SharePoModal({ po, open, editing = false, onClose, readOnly = false }: { po: PurchaseOrder; open: boolean; editing?: boolean; onClose: () => void; readOnly?: boolean }) {
  const s = useProcurementStore();
  const [terms, setTerms] = useState("on_delivery");
  const [dispatch, setDispatch] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTerms(po.paymentTerms ?? "on_delivery");
    setDispatch(po.dispatchDate ?? "");
    setRemarks(editing ? po.shareRemarks ?? "" : "");
    setErr(null);
  }, [open, editing, po.id, po.paymentTerms, po.dispatchDate, po.shareRemarks]);

  /**
   * A PO generated BEFORE the Tally number and PDF moved to the PO stage can
   * reach this queue with neither. It is not stranded — the PO stage stays
   * editable until a PO is shared — so point the sharer at where to fix it
   * rather than letting them submit something the server will refuse anyway.
   */
  const missingPoStageData = !po.tallyPoNo || !po.documentPath;

  // `editing` is a bare boolean here, so the create and edit forms of the SAME po
  // would otherwise collide — they seed differently (edit carries shareRemarks).
  const draftKeyStr = usePoStepDraftKey("share_po", open && !readOnly, `${editing ? "edit" : "new"}:${po.id}`);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { terms, dispatch, remarks },
    apply: (v) => { setTerms(v.terms); setDispatch(v.dispatch); setRemarks(v.remarks); },
  });

  const save = async () => {
    setErr(null);
    if (missingPoStageData) return setErr("This PO has no Tally PO number or PDF yet — add them on the PO stage first.");
    if (!dispatch) return setErr("Enter the expected dispatch date.");
    setBusy(true);
    try {
      if (editing) {
        await s.updateSharePo({
          poId: po.id,
          paymentTerms: terms,
          dispatchDate: dispatch,
          remarks: remarks.trim() || null,
        });
      } else {
        await s.sharePo(po.id, { remarks: remarks.trim() || null, paymentTerms: terms, dispatchDate: dispatch });
      }
      draft.clear();
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
        : `${po.poNo} · confirm the terms and dispatch date, then mark it shared with the vendor.`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy || missingPoStageData || !dispatch}>{busy ? (editing ? "Saving…" : "Sharing…") : editing ? "Save Changes" : "Share PO"}</Button></>}>
      <div className="space-y-4">
        <DraftBar draft={draft} />

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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <FieldLabel label="Payment Terms">
            <Combobox value={terms} onChange={setTerms} options={PAYMENT_TERMS} autoAdvance />
            <Hint>Drives whether an advance is due</Hint>
          </FieldLabel>
          <FieldLabel label="Expected Dispatch Date" required>
            <TextInput type="date" value={dispatch} onChange={(e) => setDispatch(e.target.value)} />
            <Hint>Anchors the follow-up due date</Hint>
          </FieldLabel>
        </div>

        <PoItemsReadout po={po} />

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
  const s = useProcurementStore();
  // Payments are recorded against the PO; the whole-PO pending caps the amount.
  //
  // On an EDIT the cap must add back the row's OWN current amount: `pendingAmount`
  // sums every payment including this one, so without this a ₹100 payment could
  // never be nudged to ₹101 — it would look like it exceeded the pending by 100.
  // The server's cap excludes the row the same way; these two must agree.
  const poPending = s.pendingAmount(po) + (editing?.amount ?? 0);

  const [amount, setAmount] = useState("");
  const [piRemarks, setPiRemarks] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** A quick read-only look at a vendor PI, opened from the reference panel. */
  const [viewPi, setViewPi] = useState<Pi | null>(null);

  const isAdvance = kind === "advance";

  useEffect(() => {
    if (!open) return;
    setPaidOn(editing?.paidOn ?? todayIso());
    setUtr(editing?.utrRef ?? "");
    setPiRemarks(editing?.piRemarks ?? "");
    setErr(null);
    // Editing shows the recorded amount. Otherwise: a balance payment defaults to
    // the full remaining, an advance is entered.
    setAmount(editing ? String(editing.amount) : isAdvance ? "" : String(poPending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po.id, kind, editing?.id]);

  // ⚠ `kind` is load-bearing: PoDetail mounts this component TWICE for the same
  // PO — once for the advance, once for the balance — so without it the two
  // dialogs would share one draft.
  const draftKeyStr = usePoStepDraftKey("advance_payment", open && !readOnly, `${kind}:${editing?.id ?? po.id}`);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { amount, piRemarks, paidOn, utr },
    apply: (v) => { setAmount(v.amount); setPiRemarks(v.piRemarks); setPaidOn(v.paidOn); setUtr(v.utr); },
  });

  const save = async () => {
    setErr(null);
    const amt = Number(amount);
    if (!(amt > 0)) return setErr("Enter an amount greater than 0.");
    if (amt > poPending + 0.01) return setErr(`Amount exceeds the pending ${inr(poPending)}.`);
    setBusy(true);
    try {
      if (editing) {
        await s.updatePayment({ paymentId: editing.id, amount: amt, paidOn, utrRef: utr.trim() || null, piRemarks: piRemarks.trim() || null });
      } else {
        await s.recordPayment({ poId: po.id, piId: null, kind, amount: amt, paidOn, utrRef: utr.trim() || null, piRemarks: piRemarks.trim() || null });
      }
      draft.clear();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {/* Two columns: the payment being recorded on the left, the order it is
        being paid against on the right. The dialog is `2xl` like every other PO
        step — a payment used to be entered in a narrow box that named neither the
        company, the vendor, nor a single thing the money was buying. */}
    <Modal open={open} onClose={onClose} readOnly={readOnly} size="2xl" readOnlyHeader={<PoRefDocs po={po} showPi />}
      title={editing ? (readOnly ? "Payment" : "Edit payment") : isAdvance ? "Record advance" : "Record payment"}
      subtitle={editing ? `${po.poNo} · correct what was recorded. Editable until a follow-up is logged.` : `${po.poNo} · Pending ${inr(poPending)}`}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Record"}</Button></>}>
      <div className="space-y-4">
        <DraftBar draft={draft} />
        <PoRefPanel po={po} readOnly={readOnly} showPoNo showTallyPoNo showPi onViewPi={setViewPi} />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3.5">
            <FieldLabel label="Amount (₹)" required hint={`Available on this PO: ${inr(poPending)}`}>
              <TextInput type="number" value={amount} min={0} max={poPending} onChange={(e) => setAmount(e.target.value)} />
            </FieldLabel>
            <div className="grid grid-cols-2 gap-3">
              <FieldLabel label="Date"><TextInput type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></FieldLabel>
              <FieldLabel label="UTR / Ref" hint="optional">
                <TextInput value={utr} onChange={(e) => setUtr(e.target.value)} />
                <Hint>Bank reference</Hint>
              </FieldLabel>
            </div>
            {/* NOT the vendor PI number — that is the real one in the panel above.
                This is a free-text note, kept because rows already carry it. */}
            <FieldLabel label="Note on PI" hint="optional">
              <TextInput value={piRemarks} onChange={(e) => setPiRemarks(e.target.value)} placeholder="e.g. 50% against the PI above" />
              <Hint>A remark only — it is not linked to the PI</Hint>
            </FieldLabel>
          </div>

          <div className="space-y-1.5">
            <div className={SECTION_HEADING_CLASS}>What this PO covers</div>
            <PoItemsReadout po={po} compact />
          </div>
        </div>
        <Err msg={err} />
      </div>
    </Modal>
    {/* Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. */}
    {viewPi && <AddPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
    </>
  );
}

/* ----------------------------- Follow-up --------------------------------- */
export function FollowupModal({ po, open, onClose, editing, readOnly = false }: { po: PurchaseOrder | null; open: boolean; onClose: () => void; editing?: Followup; readOnly?: boolean }) {
  const s = useProcurementStore();
  const [status, setStatus] = useState("pending");
  const [actual, setActual] = useState("");
  const [lr, setLr] = useState("");
  const [transport, setTransport] = useState("");
  const [revised, setRevised] = useState("");
  const [remarks, setRemarks] = useState("");
  const [piRemarks, setPiRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** A quick read-only look at a vendor PI, opened from the reference panel. */
  const [viewPi, setViewPi] = useState<Pi | null>(null);

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

  // `po` is nullable here — the follow-up queue keeps a create slot mounted with
  // `po={null}` — so the key falls to null and drafting simply stays off.
  const draftKeyStr = usePoStepDraftKey("follow_up", open && !readOnly, editing?.id ?? po?.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { status, actual, lr, transport, revised, remarks, piRemarks },
    apply: (v) => {
      setStatus(v.status);
      // Keep `onStatusChange`'s invariant: an actual dispatch date only means
      // anything on a `dispatched` follow-up.
      setActual(v.status === "dispatched" ? v.actual : "");
      setLr(v.lr);
      setTransport(v.transport);
      setRevised(v.revised);
      setRemarks(v.remarks);
      setPiRemarks(v.piRemarks);
    },
  });

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
      draft.clear();
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
        stacked block would have made it scroll badly. The `2xl` width was going
        spare — the new context lives in it rather than below. */}
    <Modal open={open} onClose={onClose} readOnly={readOnly} size="2xl" readOnlyHeader={<PoRefDocs po={po} showPi />}
      title={editing && !readOnly ? `Edit Follow-up — ${po.poNo}` : `Follow-up — ${po.poNo}`}
      subtitle={editing ? "Correct what was recorded. Editable until goods are received." : due ? `Dispatch due ${formatDate(due)}` : undefined}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save Changes" : "Save"}</Button></>}>
      <div className="space-y-4">
        <DraftBar draft={draft} />
        <PoRefPanel po={po} readOnly={readOnly} showPoNo showTallyPoNo showPi onViewPi={setViewPi} />

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3.5">
            <FieldLabel label="Dispatch Status"><ChoiceButtons value={status} onChange={onStatusChange} options={DISPATCH} autoAdvance ariaLabel="Dispatch Status" /></FieldLabel>
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
            {/* NOT the vendor PI number — that is the real one in the panel above.
                This is a free-text note, kept because rows already carry it. */}
            <FieldLabel label="Note on PI" hint="optional">
              <TextInput value={piRemarks} onChange={(e) => setPiRemarks(e.target.value)} placeholder="e.g. part shipment against the PI above" />
              <Hint>A remark only — it is not linked to the PI</Hint>
            </FieldLabel>
            <Err msg={err} />
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <div className={SECTION_HEADING_CLASS}>What this PO covers</div>
              <PoItemsReadout po={po} compact />
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
    {/* Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. */}
    {viewPi && <AddPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
    </>
  );
}

/* ------------------------------- GRN ------------------------------------- */
export function GrnModal({ po, open, onClose, editing, readOnly = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: Grn; readOnly?: boolean }) {
  const s = useProcurementStore();
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
  /** A quick read-only look at a vendor PI, opened from the reference panel. */
  const [viewPi, setViewPi] = useState<Pi | null>(null);

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

  const draftKeyStr = usePoStepDraftKey("inward", open && !readOnly, editing?.id ?? po.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { poRef, piRef, gate, condition, note, qty },
    apply: (v) => {
      setPoRef(v.poRef);
      setPiRef(v.piRef);
      setGate(v.gate);
      setCondition(v.condition);
      setNote(v.note);
      setQty((prev) => ({ ...prev, ...v.qty }));
    },
  });

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
      draft.clear();
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
      <div className="space-y-3.5">
        <DraftBar draft={draft} />
        <PoRefPanel po={po} readOnly={readOnly} showTallyPoNo showPi onViewPi={setViewPi} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3.5">
          <FieldLabel label="PO Ref No." required>
            <TextInput value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="e.g. 2627/PO/0042" />
            <Hint>The PO this receipt is against</Hint>
          </FieldLabel>
          <FieldLabel label="Gate Register No.">
            <TextInput value={gate} onChange={(e) => setGate(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Condition">
            <ChoiceButtons value={condition} onChange={setCondition} options={CONDITION} autoAdvance ariaLabel="Condition" />
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
                    <td className="px-3 py-2"><TextInput type="number" className="w-28 min-w-[6.5rem] text-right tabular-nums" value={qty[it.id] ?? ""} onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} /></td>
                  </tr>
                );
              })}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-orange-soft/50">
                  <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                  <td className="px-3 py-2 font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={items.map((it) => ({ qty: it.qty, unit: s.lineById(it.requestItemId)?.unit }))} />
                  </td>
                  <td className="px-3 py-2 font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={items.map((it) => ({ qty: it.receivedQty, unit: s.lineById(it.requestItemId)?.unit }))} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {/* NOT the vendor PI number — that is the real one, with its attachment,
            in the panel at the top. This is a free-text note, kept because
            receipts already carry it. */}
        <FieldLabel label="Note on PI" hint="optional">
          <TextInput value={piRef} onChange={(e) => setPiRef(e.target.value)} placeholder="e.g. balance quantity of the PI above" />
          <Hint>A remark only — it is not linked to the PI</Hint>
        </FieldLabel>
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
    {/* Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. */}
    {viewPi && <AddPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
    </>
  );
}

/* ------------------------------- Tally ----------------------------------- */
export function TallyModal({ po, open, onClose, editing, readOnly = false }: { po: PurchaseOrder; open: boolean; onClose: () => void; editing?: TallyBooking; readOnly?: boolean }) {
  const s = useProcurementStore();
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

  // `fileHint` on the bar: a new booking cannot be saved without the invoice
  // document, and a draft cannot carry a File — so say so rather than leave the
  // Save button looking broken after a restore.
  const draftKeyStr = usePoStepDraftKey("tally", open && !readOnly, editing?.id ?? po.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { grnId, tallyNo, remarks },
    apply: (v) => { setGrnId(v.grnId); setTallyNo(v.tallyNo); setRemarks(v.remarks); },
  });

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
      draft.clear();
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
        <DraftBar draft={draft} fileHint={!editing} />

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
            <PoItemsReadout po={po} compact />
          </div>
        </div>
      </div>
    </Modal>
    {/* Sibling, not child: a modal rendered inside the parent's body would land
        inside its read-only fieldset and come up disabled. */}
    {viewPi && <AddPiModal po={po} open stacked editing={viewPi} readOnly onClose={() => setViewPi(null)} />}
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
  const s = useProcurementStore();
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

  // Keyed on the RECEIPT, not the PO: one PO can hold several uninspected GRNs,
  // and `target` resolves implicitly to the first of them.
  const draftKeyStr = usePoStepDraftKey("qc_inspection", open && !readOnly, editing?.id ?? target?.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { decision, remark, remarks },
    apply: (v) => {
      setDecision((prev) => ({ ...prev, ...v.decision }));
      setRemark((prev) => ({ ...prev, ...v.remark }));
      setRemarks(v.remarks);
    },
  });

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
      draft.clear();
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
        <DraftBar draft={draft} />
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
  const s = useProcurementStore();
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
  const s = useProcurementStore();
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

  const draftKeyStr = usePoStepDraftKey("purchase_return", open && !readOnly, inspection.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { tallyRef, remarks },
    apply: (v) => { setTallyRef(v.tallyRef); setRemarks(v.remarks); },
  });

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
      draft.clear();
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
        <DraftBar draft={draft} fileHint={!editing || !hasExistingDoc} />

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
  const s = useProcurementStore();
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

  const draftKeyStr = usePoStepDraftKey("gate_outward", open && !readOnly, inspection.id);
  const draft = useStepDraft({
    key: draftKeyStr,
    values: { gateNo, outDate, remarks },
    apply: (v) => { setGateNo(v.gateNo); setOutDate(v.outDate); setRemarks(v.remarks); },
  });

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
      draft.clear();
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
        <DraftBar draft={draft} />
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
  const s = useProcurementStore();
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
  const s = useProcurementStore();
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
  const s = useProcurementStore();
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
