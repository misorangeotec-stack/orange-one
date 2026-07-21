import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import QtyTotal from "./QtyTotal";
import type { PurchaseRequest, RequestItem } from "../types";

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
  readOnly = false,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  editing?: boolean;
  /**
   * Show the decision that was made instead of offering to make one. Needed
   * because this dialog's Approve / Override / Reject / Hold controls live in
   * the BODY, not in a footer — left in place they would render as a row of
   * dead grey buttons under Modal's disabled read-only fieldset.
   */
  readOnly?: boolean;
}) {
  const s = useProcurementStore();
  const [mode, setMode] = useState<"none" | "override" | "reject" | "hold">("none");
  const [overrideVendor, setOverrideVendor] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** Per-line override edits, held as strings so a half-typed cell survives. */
  const [ovr, setOvr] = useState<Record<string, { qty: string; rate: string; gst: string }>>({});

  const requestId = request?.id ?? null;
  const allLines = useMemo(() => (requestId ? s.itemsForRequest(requestId) : []), [requestId, s]);
  /** Exactly the lines the server will act on — keep the two in step. */
  const lines = useMemo(
    () =>
      // A VIEW shows every line. The narrowed filters below track what the
      // server will act on, but a decision is locked precisely BECAUSE the PO
      // was generated — by then the lines have moved past `approved_pending_po`
      // and the filter yields nothing, so a view built on it would claim the
      // requisition had no items and a total of ₹0.
      readOnly
        ? allLines
        : allLines.filter((l) =>
            editing ? l.status === "approved_pending_po" : l.status === "approval" || l.status === "on_hold"
          ),
    [allLines, editing, readOnly]
  );
  // In override mode the approver may edit qty/rate/GST per line; the totals below
  // — and the band this requisition routes to — follow those edits live.
  const editingOverride = mode === "override" && !readOnly;
  const effOf = (l: RequestItem) => {
    if (!editingOverride) {
      return { qty: l.finalQty ?? l.quantity ?? 0, rate: l.finalRate ?? 0, gst: l.gstPct ?? 0, value: l.lineValue ?? 0 };
    }
    const o = ovr[l.id] ?? { qty: "", rate: "", gst: "" };
    const qty = Number(o.qty) || 0;
    const rate = Number(o.rate) || 0;
    const gst = o.gst === "" ? 0 : Number(o.gst) || 0;
    const value = qty > 0 && rate >= 0 ? Math.round(qty * rate * (1 + gst / 100) * 100) / 100 : 0;
    return { qty, rate, gst, value };
  };
  const total = Math.round(lines.reduce((sum, l) => sum + effOf(l).value, 0) * 100) / 100;
  // Base = qty × rate before GST; GST derived from the total so the three can
  // never disagree with each other.
  const base = Math.round(lines.reduce((sum, l) => { const e = effOf(l); return sum + e.qty * e.rate; }, 0) * 100) / 100;
  const gst = Math.round((total - base) * 100) / 100;
  // If the edited total lands in a band the current user can't approve, the save
  // keeps the numbers but routes it to that band (the RPC enforces this too).
  const willReroute = editingOverride && lines.length > 0 && !s.canApproveAmount(total);
  const projectedBand = [...s.approvalBands]
    .filter((b) => b.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount)
    .find((b) => total >= b.minAmount && (b.maxAmount === null || total <= b.maxAmount));

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
    setOvr({});
    setErr(null);
  }, [open, requestId]);

  if (!request) return null;

  const recommendedId = shortlist.find((v) => v.isRecommended)?.vendorId ?? lines[0]?.finalVendorId ?? null;
  const onHold = lines.some((l) => l.status === "on_hold");

  /** Enter override mode, seeding the editable cells from the sourced values. */
  const openOverride = () => {
    setErr(null);
    setReason("");
    setOvr(
      Object.fromEntries(
        lines.map((l) => [
          l.id,
          {
            qty: String(l.finalQty ?? l.quantity ?? ""),
            rate: l.finalRate === null ? "" : String(l.finalRate),
            gst: l.gstPct === null ? "" : String(l.gstPct),
          },
        ])
      )
    );
    setMode("override");
  };

  const setCell = (lineId: string, field: "qty" | "rate" | "gst", value: string) =>
    setOvr((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? { qty: "", rate: "", gst: "" }), [field]: value } }));

  const num = "w-24 rounded-lg border border-line px-2 py-1 text-[13px] text-navy focus:outline-none focus:ring-2 focus:ring-orange/30";

  /** Build the per-line override payload from the edited cells. */
  const overrideLines = () =>
    lines.map((l) => {
      const o = ovr[l.id] ?? { qty: "", rate: "", gst: "" };
      return {
        requestItemId: l.id,
        finalQty: o.qty === "" ? (l.finalQty ?? l.quantity) : Number(o.qty),
        finalRate: o.rate === "" ? l.finalRate : Number(o.rate),
        gstPct: o.gst === "" ? null : Number(o.gst),
      };
    });

  const submitOverride = () => {
    for (const l of lines) {
      const o = ovr[l.id] ?? { qty: "", rate: "", gst: "" };
      const q = o.qty === "" ? (l.finalQty ?? l.quantity) : Number(o.qty);
      const rt = o.rate === "" ? l.finalRate : Number(o.rate);
      const name = s.itemById(l.itemId)?.name ?? "item";
      if (!(Number(q) > 0)) return setErr(`Quantity must be greater than 0 — ${name}.`);
      if (rt === null || rt === undefined || !(Number(rt) >= 0)) return setErr(`Enter a rate of 0 or more — ${name}.`);
    }
    run("override", { overrideVendorId: overrideVendor || undefined, reason: reason.trim() || undefined, lines: overrideLines() });
  };

  const run = async (
    decision: "approve" | "override" | "reject" | "hold" | "resume",
    extra?: { overrideVendorId?: string; reason?: string; lines?: { requestItemId: string; finalQty: number | null; finalRate: number | null; gstPct: number | null }[] }
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
          lines: extra?.lines ?? null,
        });
      } else {
        await s.decideApprovalRequest({
          requestId: request.id,
          decision,
          overrideVendorId: extra?.overrideVendorId ?? null,
          reason: extra?.reason ?? null,
          lines: extra?.lines ?? null,
        });
      }
      setMode("none");
      setOverrideVendor("");
      setReason("");
      setOvr({});
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

        {/* ---- the items — editable in override mode, read-only otherwise ---- */}
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
              {lines.map((l) => {
                const e = effOf(l);
                const o = ovr[l.id] ?? { qty: "", rate: "", gst: "" };
                return (
                  <tr key={l.id} className="border-b border-line/70 last:border-0">
                    {/* Item NAME only — matches the sourcing grid. */}
                    <td className="px-3 py-2 font-medium text-navy whitespace-nowrap">{s.itemById(l.itemId)?.name ?? "—"}</td>
                    {editingOverride ? (
                      <>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <input type="number" className={num} value={o.qty} onChange={(ev) => setCell(l.id, "qty", ev.target.value)} />
                            {l.unit && <span className="shrink-0 text-[11.5px] text-grey-2">{l.unit}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2"><input type="number" className={num} value={o.rate} onChange={(ev) => setCell(l.id, "rate", ev.target.value)} /></td>
                        <td className="px-3 py-2"><input type="number" className={num} value={o.gst} onChange={(ev) => setCell(l.id, "gst", ev.target.value)} /></td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 whitespace-nowrap">{e.qty} {l.unit}</td>
                        <td className="px-3 py-2">{inr(l.finalRate)}</td>
                        <td className="px-3 py-2">{l.gstPct ?? "—"}</td>
                      </>
                    )}
                    <td className="px-3 py-2">{l.leadTimeDays === null ? "—" : `${l.leadTimeDays}d`}</td>
                    <td className="px-3 py-2 text-right font-semibold text-navy whitespace-nowrap">{inr(e.value)}</td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-[12.5px] text-grey-2">
                    Nothing on this requisition is awaiting a decision.
                  </td>
                </tr>
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-orange-soft/50">
                  <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                  <td className="px-3 py-2 font-bold text-navy whitespace-nowrap">
                    <QtyTotal entries={lines.map((l) => ({ qty: effOf(l).qty, unit: l.unit }))} />
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 font-bold text-navy whitespace-nowrap">{inr(gst)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-bold text-navy whitespace-nowrap">{inr(total)}</td>
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
            <p className="text-[11.5px] text-grey-2">
              Edit any item's quantity, rate or GST in the table above, and/or switch the vendor. Leave the vendor blank to
              keep the sourced one.
            </p>
            <FieldLabel label="Override vendor" hint="optional — keeps the sourced vendor if left blank">
              <Combobox
                value={overrideVendor}
                onChange={setOverrideVendor}
                options={overrideOptions}
                placeholder="Keep current vendor"
                autoAdvance
              />
            </FieldLabel>
            <FieldLabel label="Remarks" hint="optional">
              <TextArea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for the override…"
              />
            </FieldLabel>
            {willReroute && (
              <p className="rounded-xl bg-[#FFF7E6] px-3.5 py-2.5 text-[12px] text-yellow">
                This raises the total to <strong>{inr(total)}</strong>
                {projectedBand ? <> — tier <strong>{projectedBand.tierLabel}</strong></> : null}, above your approval limit.
                Saving keeps these changes and routes it to{" "}
                <strong>
                  {s.approversForAmount(total).map((id) => s.profileById(id)?.name ?? "—").join(", ") ||
                    "that tier's approver"}
                </strong>{" "}
                for approval.
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={submitOverride} disabled={busy || lines.length === 0}>
                {willReroute ? "Save & route for approval" : "Confirm override"}
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
              onClick={openOverride}
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

/**
 * What was decided, in place of the controls to decide it.
 *
 * Lines on one requisition can land differently (part approved, part rejected),
 * so this is a rollup in the same shape as the Approvals queue's Decision
 * column — plus the rejection reasons, which the queue has no room for and
 * which are usually the reason someone opened the entry at all.
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
