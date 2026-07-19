import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { Field } from "@/shared/components/ui/Readout";
import { useImportStore } from "../store";
import { inr, LINE_STATUS_LABEL } from "../lib/format";
import type { RequestItem } from "../types";

/**
 * Stage 3 — approval decision for one line. Shows the 3 quotes + recommendation
 * and lets the matched approver Approve · Override (pick another quoted vendor) ·
 * Reject (reason required) · On Hold (or Resume if held).
 */
export default function ApprovalModal({
  line,
  open,
  onClose,
  onSaved,
  editing = false,
  readOnly = false,
}: {
  line: RequestItem | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  editing?: boolean;
  /**
   * Show the decision that was made instead of offering to make one. This
   * dialog's Approve / Override / Reject / Hold controls sit in the BODY, not a
   * footer, so leaving them in place would render a row of dead grey buttons
   * under Modal's disabled read-only fieldset.
   *
   * Unlike procurement's request-scoped twin there is no lines filter to widen:
   * this modal is LINE-scoped, and the line it is given is the entry itself.
   */
  readOnly?: boolean;
}) {
  const s = useImportStore();
  const [mode, setMode] = useState<"none" | "override" | "reject" | "hold">("none");
  const [overrideVendor, setOverrideVendor] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const quotes = useMemo(() => (line ? s.quotationsForLine(line.id) : []), [line, s]);
  const overrideOptions: ComboOption[] = useMemo(
    () => quotes.map((q) => ({ value: q.vendorId, label: s.vendorById(q.vendorId)?.name ?? "Vendor", sublabel: inr(q.rate) })),
    [quotes, s]
  );

  if (!line) return null;

  const run = async (
    decision: "approve" | "override" | "reject" | "hold" | "resume",
    extra?: { overrideVendorId?: string; reason?: string }
  ) => {
    setErr(null);
    setBusy(true);
    try {
      if (editing) {
        await s.updateApproval({ lineId: line.id, decision, overrideVendorId: extra?.overrideVendorId ?? null, reason: extra?.reason ?? null });
      } else {
        await s.decideApproval({ requestItemId: line.id, decision, ...extra });
      }
      setMode("none");
      setOverrideVendor("");
      setReason("");
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
      readOnly={readOnly}
      title={`${readOnly ? "Approval" : editing ? "Edit approval" : "Approve"} — ${s.itemLabel(line.itemId)}`}
      subtitle={`${s.vendorById(line.finalVendorId)?.name ?? "—"} · ${inr(line.lineValue)}${
        editing && !readOnly ? " · revisable until the PO is generated" : ""
      }`}
    >
      <div className="space-y-4">
        {/* Quotes */}
        <div className="rounded-xl border border-line overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                <th className="font-medium px-3 py-2">Vendor</th>
                <th className="font-medium px-3 py-2">Rate</th>
                <th className="font-medium px-3 py-2">Lead</th>
                <th className="font-medium px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2 font-medium text-navy">{s.vendorById(q.vendorId)?.name ?? "—"}</td>
                  <td className="px-3 py-2">{inr(q.rate)}</td>
                  <td className="px-3 py-2">{q.leadTimeDays ?? "—"}d</td>
                  <td className="px-3 py-2 text-right">
                    {q.isRecommended && (
                      <span className="text-[11px] font-semibold text-orange bg-orange-soft rounded-full px-2 py-0.5">Recommended</span>
                    )}
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-grey-2 text-[12.5px]">No quotations.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-3 gap-3 text-[13px]">
          <Info label="Final Qty" value={`${line.finalQty ?? "—"} ${line.unit}`} />
          <Info label="Final Rate" value={inr(line.finalRate)} />
          <Info label="Line Value" value={inr(line.lineValue)} />
        </div>

        {/* The decision: what was made, or the controls to make one */}
        {readOnly ? (
          <div className="space-y-1.5 rounded-xl bg-page px-3.5 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Decision</span>
              <span className="text-[13px] font-semibold text-navy">{LINE_STATUS_LABEL[line.status]}</span>
              {line.approvalTier && <span className="text-[11.5px] text-grey-2">tier {line.approvalTier}</span>}
            </div>
            {line.rejectReason && (
              <p className="text-[12.5px] text-grey">
                <strong className="text-navy">Reason:</strong> {line.rejectReason}
              </p>
            )}
          </div>
        ) : mode === "override" ? (
          <div className="space-y-2.5">
            <FieldLabel label="Override vendor (from quotations)" required>
              <Combobox value={overrideVendor} onChange={setOverrideVendor} options={overrideOptions} placeholder="Pick a quoted vendor" autoAdvance />
            </FieldLabel>
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for overriding the recommendation…" />
            </FieldLabel>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => overrideVendor ? run("override", { overrideVendorId: overrideVendor, reason: reason.trim() || undefined }) : setErr("Pick a vendor.")} disabled={busy}>
                Confirm override
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode("none")} disabled={busy}>Back</Button>
            </div>
          </div>
        ) : mode === "reject" ? (
          <div className="space-y-2.5">
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being rejected?" />
            </FieldLabel>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run("reject", { reason: reason.trim() || undefined })} disabled={busy}>
                Confirm reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode("none")} disabled={busy}>Back</Button>
            </div>
          </div>
        ) : mode === "hold" ? (
          <div className="space-y-2.5">
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for putting this line on hold…" />
            </FieldLabel>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run("hold", { reason: reason.trim() || undefined })} disabled={busy}>
                Confirm hold
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode("none")} disabled={busy}>Back</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run("approve")} disabled={busy}>{editing ? "Re-approve" : "Approve"}</Button>
            {/* Override swaps to another QUOTED vendor, and Import has no quotations
                (its vendor comes from the request header + price master, and nothing
                routes to save_sourcing). The button is already a dead end on the
                create path — pre-existing — but the edit RPC refuses it outright, so
                it is not offered here. */}
            {!editing && (
              <Button variant="ghost" size="sm" onClick={() => { setErr(null); setReason(""); setMode("override"); }} disabled={busy}>Override</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setErr(null); setReason(""); setMode("reject"); }} disabled={busy}>Reject</Button>
            {/* Hold/Resume are decisions on an UNDECIDED line — meaningless once
                one has been made, so they're absent when revising. */}
            {!editing &&
              (line.status === "on_hold" ? (
                <Button variant="ghost" size="sm" onClick={() => run("resume")} disabled={busy}>Resume</Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => { setErr(null); setReason(""); setMode("hold"); }} disabled={busy}>On Hold</Button>
              ))}
          </div>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/** The boxed read-only stat. The shared Field carries the typography; the tint is local. */
function Info({ label, value }: { label: string; value: string }) {
  return <Field label={label} value={value} className="rounded-xl bg-page/60 px-3 py-2" />;
}
