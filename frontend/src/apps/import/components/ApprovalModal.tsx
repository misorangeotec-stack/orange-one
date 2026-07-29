import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useImportStore } from "../store";
import QtyTotal from "./QtyTotal";
import { RequestRefPanel } from "./PoRefPanel";
import type { PurchaseRequest, RequestItem } from "../types";

/**
 * Stage 2 — one approval decision for a WHOLE requisition.
 *
 * Import is a pure quantity requisition: there is no rate or value, so a decision
 * is simply Approve · Reject (reason required) · On Hold / Resume, on the items as
 * requested. Every request routes to the configured approver(s) regardless of
 * quantity.
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
   * dialog's Approve / Reject / Hold controls sit in the BODY, not a footer, so
   * leaving them in place would render a row of dead grey buttons under Modal's
   * disabled read-only fieldset.
   */
  readOnly?: boolean;
}) {
  const s = useImportStore();
  const [mode, setMode] = useState<"none" | "reject" | "hold">("none");
  const [reason, setReason] = useState("");
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
      // requisition had no items.
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
    setErr(null);
  }, [open, requestId]);

  if (!request) return null;

  const qtyOf = (l: RequestItem) => l.finalQty ?? l.quantity ?? 0;
  const recommendedId = lines.find((l) => l.finalVendorId)?.finalVendorId ?? null;
  const onHold = lines.some((l) => l.status === "on_hold");

  const run = async (
    decision: "approve" | "reject" | "hold" | "resume",
    extra?: { reason?: string }
  ) => {
    setErr(null);
    setBusy(true);
    try {
      if (editing) {
        if (decision === "hold" || decision === "resume") throw new Error("Not available when revising a decision.");
        await s.updateApprovalRequest({ requestId: request.id, decision, reason: extra?.reason ?? null });
      } else {
        await s.decideApprovalRequest({ requestId: request.id, decision, ...extra });
      }
      setMode("none");
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
      size="2xl"
      readOnly={readOnly}
      title={`${readOnly ? "Approval" : editing ? "Edit approval" : "Approve"} — ${request.requestNo}`}
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${s.vendorById(recommendedId)?.name ?? "—"}${
        editing && !readOnly ? " · revisable until the PO is generated" : ""
      }`}
    >
      <div className="space-y-4">
        {/* Who this spend is being approved FOR, and against whom. The vendor is
            in the subtitle too, but an approver reading a money decision should
            not have to find it there. */}
        <RequestRefPanel request={request} vendorId={recommendedId} vendorFieldLabel="Recommended Vendor" />

        {/* ---- the items (quantity only) ---- */}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-page/60 text-left text-grey-2">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{s.itemById(l.itemId)?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {qtyOf(l)} {l.unit}
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-4 text-center text-[12.5px] text-grey-2">
                    Nothing on this requisition is awaiting a decision.
                  </td>
                </tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-orange-soft/50">
                  <td className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                    Total
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={lines.map((l) => ({ qty: qtyOf(l), unit: l.unit }))} />
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ---- the decision: what was made, or the controls to make one ---- */}
        {readOnly ? (
          <DecisionReadout lines={lines} tier={lines.find((l) => l.approvalTier)?.approvalTier ?? null} />
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
