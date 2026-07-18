import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import type { PurchaseRequest } from "../types";

/**
 * Stage 3 — one approval decision for a WHOLE requisition.
 *
 * The band is picked on the requisition TOTAL, not per item: five ₹40k items are
 * one ₹200k decision. Approve · Override (switch the vendor for every item) ·
 * Reject (reason required) · On Hold / Resume.
 *
 * `editing` routes to a different RPC on purpose. `decide_approval_request` only
 * accepts a requisition still awaiting a decision; revising an already-approved
 * one is `update_approval_request`, which refuses once any PO exists. Hold/Resume
 * are not offered when editing — the requisition is past the point where holding
 * it means anything.
 */
export default function ApprovalModal({
  request,
  open,
  onClose,
  onSaved,
  editing = false,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  editing?: boolean;
}) {
  const s = useProcurementStore();
  const [mode, setMode] = useState<"none" | "override" | "reject" | "hold">("none");
  const [overrideVendor, setOverrideVendor] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const requestId = request?.id ?? null;
  const allLines = useMemo(() => (requestId ? s.itemsForRequest(requestId) : []), [requestId, s]);
  /** Exactly the lines the server will act on — keep the two in step. */
  const lines = useMemo(
    () =>
      allLines.filter((l) =>
        editing ? l.status === "approved_pending_po" : l.status === "approval" || l.status === "on_hold"
      ),
    [allLines, editing]
  );
  const total = lines.reduce((sum, l) => sum + (l.lineValue ?? 0), 0);
  // Base = qty × rate before GST; GST derived from the total so the three can
  // never disagree with each other.
  const base = Math.round(lines.reduce((sum, l) => sum + (l.finalQty ?? 0) * (l.finalRate ?? 0), 0) * 100) / 100;
  const gst = Math.round((total - base) * 100) / 100;

  /** The shortlist. Legacy requisitions predate it — fall back to who quoted. */
  const shortlist = useMemo(() => (requestId ? s.vendorsForRequest(requestId) : []), [requestId, s]);
  const legacy = shortlist.length === 0;
  const overrideOptions: ComboOption[] = useMemo(() => {
    if (!legacy) {
      return shortlist.map((v) => ({
        value: v.vendorId,
        label: s.vendorById(v.vendorId)?.name ?? "Vendor",
        sublabel: v.isRecommended ? "Recommended" : undefined,
      }));
    }
    const seen = new Map<string, number>();
    for (const l of lines) for (const q of s.quotationsForLine(l.id)) if (!seen.has(q.vendorId)) seen.set(q.vendorId, q.rate);
    return [...seen].map(([vendorId, rate]) => ({
      value: vendorId,
      label: s.vendorById(vendorId)?.name ?? "Vendor",
      sublabel: inr(rate),
    }));
  }, [legacy, shortlist, lines, s]);

  useEffect(() => {
    if (!open) return;
    setMode("none");
    setOverrideVendor("");
    setReason("");
    setErr(null);
  }, [open, requestId]);

  if (!request) return null;

  const recommendedId = shortlist.find((v) => v.isRecommended)?.vendorId ?? lines[0]?.finalVendorId ?? null;
  const onHold = lines.some((l) => l.status === "on_hold");

  const run = async (
    decision: "approve" | "override" | "reject" | "hold" | "resume",
    extra?: { overrideVendorId?: string; reason?: string }
  ) => {
    setErr(null);
    setBusy(true);
    try {
      if (editing) {
        if (decision === "hold" || decision === "resume") throw new Error("Not available when revising a decision.");
        await s.updateApprovalRequest({
          requestId: request.id,
          decision,
          overrideVendorId: extra?.overrideVendorId ?? null,
          reason: extra?.reason ?? null,
        });
      } else {
        await s.decideApprovalRequest({ requestId: request.id, decision, ...extra });
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
      size="2xl"
      title={`${editing ? "Edit approval" : "Approve"} — ${request.requestNo}`}
      subtitle={`${lines.length} item${lines.length === 1 ? "" : "s"} · ${s.vendorById(recommendedId)?.name ?? "—"}`}
    >
      <div className="space-y-4">
        {/* ---- the shortlist ---- */}
        <div className="space-y-1.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
            Vendors shortlisted{legacy && " (from quotations)"}
          </span>
          <div className="flex flex-wrap gap-2">
            {overrideOptions.map((v) => (
              <span
                key={v.value}
                className={`rounded-full px-2.5 py-1 text-[12px] ${
                  v.value === recommendedId ? "bg-orange-soft font-semibold text-orange" : "bg-page text-grey"
                }`}
              >
                {v.label}
                {v.value === recommendedId && " · recommended"}
              </span>
            ))}
            {overrideOptions.length === 0 && <span className="text-[12.5px] text-grey-2">No vendors recorded.</span>}
          </div>
          {!legacy && (
            <p className="text-[11.5px] text-grey-2">
              Only the recommended vendor quoted a price — the others are a shortlist. Overriding switches the vendor for
              every item and keeps the sourced prices.
            </p>
          )}
          {legacy && (
            <p className="text-[11.5px] text-grey-2">
              Sourced under the old per-item flow: overriding swaps in that vendor's own quoted rate.
            </p>
          )}
        </div>

        {request.sourcingReason && (
          <p className="rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">
            <strong className="text-navy">Single-source reason:</strong> {request.sourcingReason}
          </p>
        )}

        {/* ---- the items, read-only ---- */}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-page/60 text-left text-grey-2">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Rate</th>
                <th className="px-3 py-2 font-medium">GST %</th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-line/70 last:border-0">
                  {/* Item NAME only — matches the sourcing grid. */}
                  <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{s.itemById(l.itemId)?.name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {l.finalQty ?? l.quantity} {l.unit}
                  </td>
                  <td className="px-3 py-2">{inr(l.finalRate)}</td>
                  <td className="px-3 py-2">{l.gstPct ?? "—"}</td>
                  <td className="px-3 py-2">{l.leadTimeDays === null ? "—" : `${l.leadTimeDays}d`}</td>
                  <td className="px-3 py-2 text-right font-semibold text-navy whitespace-nowrap">{inr(l.lineValue)}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-[12.5px] text-grey-2">
                    Nothing on this requisition is awaiting a decision.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2 rounded-xl bg-orange-soft/50 px-3.5 py-2.5">
          <Money label="Base" value={base} />
          <Money label="GST" value={gst} />
          <Money label="Total (incl. GST)" value={total} strong />
        </div>

        {/* ---- decision controls ---- */}
        {mode === "override" ? (
          <div className="space-y-2.5">
            <FieldLabel label="Override vendor" required hint="applies to every item on this requisition">
              <Combobox
                value={overrideVendor}
                onChange={setOverrideVendor}
                options={overrideOptions}
                placeholder="Pick a shortlisted vendor"
                autoAdvance
              />
            </FieldLabel>
            <FieldLabel label="Remarks" hint="optional">
              <TextArea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for overriding the recommendation…"
              />
            </FieldLabel>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  overrideVendor
                    ? run("override", { overrideVendorId: overrideVendor, reason: reason.trim() || undefined })
                    : setErr("Pick a vendor.")
                }
                disabled={busy}
              >
                Confirm override
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode("none")} disabled={busy}>
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
              <TextArea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for putting this requisition on hold…"
              />
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
              onClick={() => {
                setErr(null);
                setReason("");
                setMode("override");
              }}
              disabled={busy || lines.length === 0}
            >
              Override
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setErr(null);
                setReason("");
                setMode("reject");
              }}
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
                  onClick={() => {
                    setErr(null);
                    setReason("");
                    setMode("hold");
                  }}
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

/** One figure in the Base / GST / Total strip. */
function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-[11.5px] text-grey-2">{label}</div>
      <div className={strong ? "text-[15px] font-bold text-navy" : "text-[13px] font-semibold text-grey"}>
        {inr(value)}
      </div>
    </div>
  );
}
