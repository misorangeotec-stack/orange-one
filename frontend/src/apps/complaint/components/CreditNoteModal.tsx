import { useRef, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useComplaintStore } from "../store";
import { dmy, formatDateTime } from "../lib/format";
import {
  CREDIT_NOTE_STATUS_LABEL,
  CREDIT_NOTE_STATUS_TONE,
  formatCnAmount,
  type CreditNote,
  type CreditNoteDocSlot,
} from "../types/creditNote";

/**
 * One credit note: everything raised, what management decided, what Tally got —
 * and, for whoever owns the bucket it is in, the form to move it on.
 *
 *   awaiting_cn_approval → Approve / Reject + remark (required to reject)
 *   awaiting_cn_tally    → Tally no. (required) + attachment + remark → closed
 */
export default function CreditNoteModal({ cn, onClose }: { cn: CreditNote; onClose: () => void }) {
  const s = useComplaintStore();
  const canApprove = s.canEdit && cn.status === "awaiting_cn_approval" && s.canActOnCn("cn_approval");
  const canTally = s.canEdit && cn.status === "awaiting_cn_tally" && s.canActOnCn("cn_tally");

  const [decision, setDecision] = useState<"" | "approve" | "reject">("");
  const [note, setNote] = useState("");
  const [tallyNo, setTallyNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submitApproval = async () => {
    setErr("");
    if (!decision) return setErr("Choose Approve or Reject.");
    if (decision === "reject" && !note.trim()) return setErr("Give the reason for rejecting.");
    setBusy(true);
    try {
      await s.approveCreditNote(cn.id, { decision, note: note.trim() });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitTally = async () => {
    setErr("");
    if (!tallyNo.trim()) return setErr("Tally number is required.");
    setBusy(true);
    try {
      await s.recordCreditNoteTally(cn.id, { tallyNo: tallyNo.trim(), remarks: remarks.trim() });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const companyName = cn.companyId ? s.companyName(cn.companyId) : "—";

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={`${cn.cnNo} · ${cn.partyName}`}
      subtitle="Customer credit note"
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${CREDIT_NOTE_STATUS_TONE[cn.status]}`}>
            {CREDIT_NOTE_STATUS_LABEL[cn.status]}
          </span>
        </div>

        {/* ------------------------------ raised ------------------------------ */}
        <section>
          <h3 className="text-[13px] font-bold text-navy mb-2">Raised</h3>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
            <Row label="Customer name" value={cn.partyName} />
            <Row label="Company" value={companyName} />
            <Row label="Salesperson" value={cn.salespersonName} />
            <Row label="Approved by" value={cn.approvedByName} />
            <Row label="Reason for credit note" value={cn.reason} />
            <Row label="Amount" value={formatCnAmount(cn.amount)} strong />
            <Row label="Raised by" value={cn.requesterName || s.personName(cn.raisedBy)} />
            <Row label="Raised on" value={formatDateTime(cn.submittedAt)} />
          </dl>
          <div className="mt-3">
            <div className="text-[11.5px] text-grey-2">Full details</div>
            <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{cn.details}</p>
          </div>
          <div className="mt-3">
            <CnDocs cnId={cn.id} slot="raise" label="Attachments" canAttach={false} />
          </div>
        </section>

        {/* --------------------------- management ---------------------------- */}
        {cn.aprAt && (
          <section className="border-t border-line pt-4">
            <h3 className="text-[13px] font-bold text-navy mb-2">Management approval</h3>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
              <Row label="Decision" value={cn.aprDecision === "approve" ? "Approved" : "Rejected"} strong />
              <Row label="By" value={`${s.personName(cn.aprBy)} · ${formatDateTime(cn.aprAt)}`} />
              {cn.aprNote && <Row label="Remark" value={cn.aprNote} wide />}
            </dl>
          </section>
        )}

        {/* ------------------------------ Tally ------------------------------- */}
        {cn.tallyAt && (
          <section className="border-t border-line pt-4">
            <h3 className="text-[13px] font-bold text-navy mb-2">Tally</h3>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[13px]">
              <Row label="Tally number" value={cn.tallyNo ?? "—"} strong />
              <Row label="By" value={`${s.personName(cn.tallyBy)} · ${formatDateTime(cn.tallyAt)}`} />
              {cn.tallyRemarks && <Row label="Remark" value={cn.tallyRemarks} wide />}
            </dl>
            <div className="mt-3">
              <CnDocs cnId={cn.id} slot="tally" label="Tally attachment" canAttach={false} />
            </div>
          </section>
        )}

        {/* ----------------------------- actions ------------------------------ */}
        {canApprove && (
          <section className="border-t border-line pt-4 space-y-3">
            <h3 className="text-[13px] font-bold text-navy">Management approval</h3>
            <div className="max-w-sm">
              <ChoiceButtons
                ariaLabel="Decision"
                options={[
                  { value: "approve", label: "Approve" },
                  { value: "reject", label: "Reject" },
                ]}
                value={decision}
                onChange={(v) => setDecision(v as "approve" | "reject")}
              />
            </div>
            <FieldLabel label="Remark" required={decision === "reject"} hint={decision === "reject" ? "why it is rejected" : "optional"}>
              <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldLabel>
            <Button onClick={submitApproval} disabled={busy}>
              {busy ? "Saving…" : decision === "reject" ? "Reject credit note" : "Approve — send to Tally"}
            </Button>
          </section>
        )}

        {canTally && (
          <section className="border-t border-line pt-4 space-y-3">
            <h3 className="text-[13px] font-bold text-navy">Tally entry</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel strong label="Tally number" required>
                <TextInput value={tallyNo} onChange={(e) => setTallyNo(e.target.value)} placeholder="voucher no. in Tally" />
              </FieldLabel>
            </div>
            <CnDocs cnId={cn.id} slot="tally" label="Attachment" canAttach />
            <FieldLabel label="Remark" hint="optional">
              <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </FieldLabel>
            <Button onClick={submitTally} disabled={busy}>
              {busy ? "Saving…" : "Submit — close credit note"}
            </Button>
          </section>
        )}

        {err && <p className="text-[12.5px] text-red-600">{err}</p>}
        {cn.closedAt && cn.status !== "rejected" && (
          <p className="text-[12px] text-grey-2">Closed on {dmy(cn.closedAt)}.</p>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value, strong, wide }: { label: string; value: string; strong?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11.5px] text-grey-2">{label}</dt>
      <dd className={`whitespace-pre-wrap ${strong ? "font-semibold text-navy" : "text-ink"}`}>{value || "—"}</dd>
    </div>
  );
}

/** Files on one slot of a credit note. Uploads immediately, like the complaint's EvidenceCapture. */
function CnDocs({
  cnId,
  slot,
  label,
  canAttach,
}: {
  cnId: string;
  slot: CreditNoteDocSlot;
  label: string;
  canAttach: boolean;
}) {
  const s = useComplaintStore();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const docs = s.cnDocsFor(cnId).filter((d) => d.slot === slot);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr("");
    try {
      // Sequential: paths are millisecond-stamped and unique.
      for (const f of Array.from(files)) await s.uploadCreditNoteDoc(cnId, slot, slot === "tally" ? "cn_tally" : "raise", f);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const open = async (path: string) => {
    try {
      window.open(await s.docUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[12.5px] font-bold text-navy">{label}</span>
        {canAttach && (
          <Button size="sm" variant="ghost" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Attach"}
          </Button>
        )}
      </div>
      <input ref={ref} type="file" multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
      {docs.length === 0 ? (
        <p className="text-[12px] text-grey-2">Nothing attached.</p>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void open(d.path)}
                className="text-[12.5px] text-orange hover:underline text-left truncate"
              >
                {d.name}
              </button>
              {canAttach && (
                <button
                  type="button"
                  onClick={() => void s.deleteCreditNoteDoc(d.id).catch((e) => setErr(String(e?.message ?? e)))}
                  className="text-[11.5px] text-grey-2 hover:text-red-600 shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
    </div>
  );
}
