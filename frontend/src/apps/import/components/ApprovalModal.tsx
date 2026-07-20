import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useImportStore } from "../store";
import { inr, fxMoney } from "../lib/format";
import QtyTotal from "./QtyTotal";
import type { PurchaseRequest, RequestItem } from "../types";

/**
 * Stage 3 — one approval decision for a WHOLE requisition.
 *
 * The band is picked on the requisition TOTAL, not per item: five ₹40k items are
 * one ₹200k decision. Approve · Override rates · Reject (reason required) · On
 * Hold / Resume.
 *
 * OVERRIDE = the approver revises the rate on some/all lines (e.g. a negotiated
 * price) and approves in one step. Import has no quoted alternative vendor to
 * switch to — the vendor comes from the request header + price master — so the
 * only thing to override is the rate. Rates are in the vendor's FOREIGN currency;
 * the INR line values (the approval basis) are recomputed server-side from the
 * request-time FX rate.
 *
 * `editing` routes to a different RPC on purpose. `decideApprovalRequest` only
 * accepts a requisition still awaiting a decision; revising an already-approved
 * one is `updateApprovalRequest`, which refuses once any PO exists. Hold/Resume
 * are not offered when editing — the requisition is past the point where holding
 * it means anything.
 */
export default function ApprovalModal({
  request,
  open,
  onClose,
  onSaved,
  editing = false,
  readOnly = false,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  editing?: boolean;
  /**
   * Show the decision that was made instead of offering to make one. This
   * dialog's Approve / Override / Reject / Hold controls sit in the BODY, not a
   * footer, so leaving them in place would render a row of dead grey buttons
   * under Modal's disabled read-only fieldset.
   */
  readOnly?: boolean;
}) {
  const s = useImportStore();
  const [mode, setMode] = useState<"none" | "override" | "reject" | "hold">("none");
  const [reason, setReason] = useState("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requestId = request?.id ?? null;
  const allLines = useMemo(() => (requestId ? s.itemsForRequest(requestId) : []), [requestId, s]);
  /** Exactly the lines the server will act on — keep the two in step. */
  const lines = useMemo(
    () =>
      // A VIEW shows every line. The narrowed filters below track what the server
      // will act on, but a decision is locked precisely BECAUSE the PO was
      // generated — by then the lines have moved past `approved_pending_po` and
      // the filter yields nothing, so a view built on it would claim the
      // requisition had no items and a total of ₹0.
      readOnly
        ? allLines
        : allLines.filter((l) =>
            editing ? l.status === "approved_pending_po" : l.status === "approval" || l.status === "on_hold"
          ),
    [allLines, editing, readOnly]
  );

  useEffect(() => {
    if (!open) return;
    setMode("none");
    setReason("");
    setRates({});
    setErr(null);
  }, [open, requestId]);

  if (!request) return null;

  const overriding = mode === "override";
  const qtyOf = (l: RequestItem) => l.finalQty ?? l.quantity ?? 0;
  /** The rate a line shows right now — the edited value while overriding, else the stored one. */
  const rateNum = (l: RequestItem) => (overriding ? Number(rates[l.id]) || 0 : l.finalRate ?? 0);
  /** INR line value = qty × rate × request-time FX. Recomputed live while overriding. */
  const lineInr = (l: RequestItem) =>
    overriding ? qtyOf(l) * rateNum(l) * (l.fxRateAtRequest ?? 1) : l.lineValue ?? 0;
  /** Foreign line value = qty × rate. Recomputed live while overriding. */
  const lineFx = (l: RequestItem) => (overriding ? qtyOf(l) * rateNum(l) : l.lineValueFx ?? 0);
  const total = Math.round(lines.reduce((sum, l) => sum + lineInr(l), 0) * 100) / 100;
  const totalFx = Math.round(lines.reduce((sum, l) => sum + lineFx(l), 0) * 100) / 100;
  // Single currency per requisition (the vendor's) — take the first line that has one.
  const currency = lines.find((l) => l.currency)?.currency ?? null;
  const recommendedId = lines.find((l) => l.finalVendorId)?.finalVendorId ?? null;
  const onHold = lines.some((l) => l.status === "on_hold");

  const enterOverride = () => {
    setErr(null);
    setRates(Object.fromEntries(lines.map((l) => [l.id, l.finalRate != null ? String(l.finalRate) : ""])));
    setMode("override");
  };

  const run = async (
    decision: "approve" | "override" | "reject" | "hold" | "resume",
    extra?: { reason?: string; rates?: { requestItemId: string; rate: number }[] }
  ) => {
    setErr(null);
    setBusy(true);
    try {
      if (editing) {
        if (decision === "hold" || decision === "resume") throw new Error("Not available when revising a decision.");
        await s.updateApprovalRequest({ requestId: request.id, decision, reason: extra?.reason ?? null, rates: extra?.rates ?? null });
      } else {
        await s.decideApprovalRequest({ requestId: request.id, decision, ...extra });
      }
      setMode("none");
      setReason("");
      setRates({});
      onSaved?.();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmOverride = () => {
    const payload: { requestItemId: string; rate: number }[] = [];
    for (const l of lines) {
      const raw = rates[l.id];
      const n = Number(raw);
      if (raw === undefined || raw.trim() === "" || Number.isNaN(n) || n < 0) {
        setErr(`Enter a valid rate for ${s.itemById(l.itemId)?.name ?? "every item"}.`);
        return;
      }
      payload.push({ requestItemId: l.id, rate: n });
    }
    if (payload.length === 0) { setErr("Nothing to approve."); return; }
    run("override", { rates: payload });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      readOnly={readOnly}
      title={`${readOnly ? "Approval" : editing ? "Edit approval" : "Approve"} — ${request.requestNo}`}
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${s.vendorById(recommendedId)?.name ?? "—"}${
        editing && !readOnly ? " · revisable until the PO is generated" : ""
      }`}
    >
      <div className="space-y-4">
        {/* ---- the items; rates become editable while overriding ---- */}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-page/60 text-left text-grey-2">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Rate{overriding ? " (revise)" : ""}</th>
                <th className="px-3 py-2 text-right font-medium">Value ({currency ?? "FCY"})</th>
                <th className="px-3 py-2 text-right font-medium">Value (INR)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{s.itemById(l.itemId)?.name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {qtyOf(l)} {l.unit}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {overriding ? (
                      <span className="inline-flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={rates[l.id] ?? ""}
                          onChange={(e) => setRates((prev) => ({ ...prev, [l.id]: e.target.value }))}
                          className="w-28 rounded-lg border border-line px-2 py-1 text-[13px] focus:border-orange focus:outline-none"
                          aria-label={`Revised rate for ${s.itemById(l.itemId)?.name ?? "this item"}`}
                        />
                        {l.currency && <span className="text-[11.5px] text-grey-2">{l.currency}</span>}
                      </span>
                    ) : (
                      fxMoney(l.finalRate, l.currency)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-navy whitespace-nowrap">{fxMoney(lineFx(l), l.currency)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-navy whitespace-nowrap">{inr(lineInr(l))}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-[12.5px] text-grey-2">
                    Nothing on this requisition is awaiting a decision.
                  </td>
                </tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                {/* Grand totals sit in the SAME columns as the line values, so they
                    align exactly under Value (FCY) / Value (INR). */}
                <tr className="border-t-2 border-line bg-orange-soft/50">
                  <td className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                    Total
                  </td>
                  <td className="px-3 py-2.5 font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={lines.map((l) => ({ qty: qtyOf(l), unit: l.unit }))} />
                  </td>
                  <td />
                  <td className="px-3 py-2.5 text-right font-bold text-navy whitespace-nowrap">{fxMoney(totalFx, currency)}</td>
                  <td className="px-3 py-2.5 text-right font-bold text-navy whitespace-nowrap">{inr(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ---- the decision: what was made, or the controls to make one ---- */}
        {readOnly ? (
          <DecisionReadout lines={lines} tier={lines.find((l) => l.approvalTier)?.approvalTier ?? null} />
        ) : mode === "override" ? (
          <div className="space-y-2.5">
            <p className="text-[12px] text-grey-2">
              Revise the rate on any line (in the vendor's currency). Approving applies the new rates and recomputes the
              INR values. Rejecting or holding still uses the current rates.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={confirmOverride} disabled={busy || lines.length === 0}>
                {busy ? "Saving…" : editing ? "Save revised rates" : "Approve with revised rates"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setMode("none"); setErr(null); }} disabled={busy}>
                Back
              </Button>
            </div>
          </div>
        ) : mode === "reject" ? (
          <div className="space-y-2.5">
            <FieldLabel label="Remarks" required hint="a reason is required to reject">
              <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being rejected?" />
            </FieldLabel>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => (reason.trim() ? run("reject", { reason: reason.trim() }) : setErr("A reason is required to reject."))}
                disabled={busy}
              >
                Confirm reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode("none")} disabled={busy}>
                Back
              </Button>
            </div>
          </div>
        ) : mode === "hold" ? (
          <div className="space-y-2.5">
            <FieldLabel label="Remarks" hint="optional">
              <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for putting this requisition on hold…" />
            </FieldLabel>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run("hold", { reason: reason.trim() || undefined })} disabled={busy}>
                Confirm hold
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode("none")} disabled={busy}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run("approve")} disabled={busy || lines.length === 0}>
              {editing ? "Re-approve" : "Approve"}
            </Button>
            <Button variant="ghost" size="sm" onClick={enterOverride} disabled={busy || lines.length === 0}>
              Override rates
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setErr(null); setReason(""); setMode("reject"); }}
              disabled={busy || lines.length === 0}
            >
              Reject
            </Button>
            {/* Hold/Resume are decisions on an UNDECIDED requisition — meaningless
                once one has been made, so they're absent when revising. */}
            {!editing &&
              (onHold ? (
                <Button variant="ghost" size="sm" onClick={() => run("resume")} disabled={busy}>
                  Resume
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setErr(null); setReason(""); setMode("hold"); }}
                  disabled={busy || lines.length === 0}
                >
                  On Hold
                </Button>
              ))}
          </div>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/**
 * What was decided, in place of the controls to decide it.
 *
 * Lines on one requisition can land differently (part approved, part rejected),
 * so this is a rollup in the same shape as the Approvals queue's Decision
 * column — plus the rejection reasons, which the queue has no room for and which
 * are usually the reason someone opened the entry at all.
 */
function DecisionReadout({ lines, tier }: { lines: RequestItem[]; tier: string | null }) {
  const approved = lines.filter((l) => l.status === "approved_pending_po" || l.status === "po").length;
  const rejected = lines.filter((l) => l.status === "rejected");
  const parts = [approved ? `${approved} approved` : "", rejected.length ? `${rejected.length} rejected` : ""].filter(Boolean);
  // Identical reasons on every rejected line is the norm (one decision, many
  // lines) — collapse them rather than repeating the same sentence six times.
  const reasons = [...new Set(rejected.map((l) => l.rejectReason).filter(Boolean))] as string[];

  return (
    <div className="space-y-1.5 rounded-xl bg-page px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Decision</span>
        <span className="text-[13px] font-semibold text-navy">{parts.join(" · ") || "Not decided"}</span>
        {tier && <span className="text-[11.5px] text-grey-2">tier {tier}</span>}
      </div>
      {reasons.map((r) => (
        <p key={r} className="text-[12.5px] text-grey">
          <strong className="text-navy">Reason:</strong> {r}
        </p>
      ))}
    </div>
  );
}

