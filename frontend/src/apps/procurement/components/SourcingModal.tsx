import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import RequestMasterModal from "./RequestMasterModal";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import type { PurchaseRequest, RequestItem } from "../types";

/** One shortlisted vendor. Deliberately carries NO rate — see the header note. */
interface VRow {
  vendorId: string;
  remark: string;
}
const emptyVendor = (): VRow => ({ vendorId: "", remark: "" });

/** The three per-item numbers, held as strings so a half-typed cell survives. */
type CellField = "rate" | "gstPct" | "leadTimeDays";
interface LRow {
  lineId: string;
  qty: string;
  rate: string;
  gstPct: string;
  leadTimeDays: string;
}

const MAX_VENDORS = 3;

/**
 * Stage 2 — sourcing for a WHOLE requisition.
 *
 * The shape deliberately separates the two things that used to be tangled:
 *   • VENDORS are a shortlist (max 3). They carry no prices — you tick the one
 *     that wins, and that vendor supplies every item on the requisition.
 *   • RATES are per ITEM: one rate, one GST%, one lead-days per line, each with
 *     a "fill down to every item" shortcut and each individually editable after.
 *
 * There is no separate "final rate" any more: the rate typed against an item IS
 * the final rate, and it is what the approval bands on.
 *
 * Re-opening this on an already-sourced requisition is the EDIT path — the RPC
 * accepts lines in sourcing/approval/on_hold and refuses decided ones.
 */
export default function SourcingModal({
  request,
  open,
  onClose,
  onSaved,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const s = useProcurementStore();
  const [vendors, setVendors] = useState<VRow[]>([emptyVendor()]);
  const [recommended, setRecommended] = useState("");
  const [rows, setRows] = useState<LRow[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [raiseVendor, setRaiseVendor] = useState<string | null>(null);
  /**
   * Cells the user has typed into, as `${lineId}:${field}`. The rate card only
   * ever fills cells NOT in here — a typed number is never overwritten by a
   * later vendor change. The master is a default, never a lock.
   */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  /** Cells currently showing a value that came from the rate card, for the tint. */
  const [fromMaster, setFromMaster] = useState<Set<string>>(new Set());

  const requestId = request?.id ?? null;
  const allLines = useMemo(() => (requestId ? s.itemsForRequest(requestId) : []), [requestId, s]);
  /** Only these may be saved — the others are already decided. */
  const openLines = useMemo(
    () => allLines.filter((l) => l.status === "sourcing" || l.status === "approval" || l.status === "on_hold"),
    [allLines]
  );
  const decidedLines = allLines.length - openLines.length;

  /** Approved lines pin the whole requisition to their vendor. */
  const lockedVendorId = requestId ? s.requestLockedVendorId(requestId) : null;
  const mixedVendors = requestId ? s.requestHasMixedVendors(requestId) : false;

  const activeVendors = useMemo(() => s.vendors.filter((v) => v.active), [s.vendors]);
  // A vendor already on another row drops out of this row's dropdown — one row
  // per vendor. The row's own pick is always kept.
  const vendorOptionsFor = (rowIndex: number): ComboOption[] => {
    const taken = new Set(vendors.filter((_, i) => i !== rowIndex).map((r) => r.vendorId).filter(Boolean));
    return activeVendors.filter((v) => !taken.has(v.id)).map((v) => ({ value: v.id, label: v.name }));
  };

  // Initialise from the requisition and whatever was sourced before.
  useEffect(() => {
    if (!open || !request) return;
    const shortlist = s.vendorsForRequest(request.id);
    setVendors(shortlist.length ? shortlist.map((v) => ({ vendorId: v.vendorId, remark: v.remark ?? "" })) : [emptyVendor()]);
    setRecommended(
      shortlist.find((v) => v.isRecommended)?.vendorId ??
        lockedVendorId ??
        openLines.find((l) => l.finalVendorId)?.finalVendorId ??
        ""
    );
    setRows(
      openLines.map((l) => ({
        lineId: l.id,
        qty: String(l.finalQty ?? l.quantity),
        rate: l.finalRate === null ? "" : String(l.finalRate),
        gstPct: l.gstPct === null ? "" : String(l.gstPct),
        leadTimeDays: l.leadTimeDays === null ? "" : String(l.leadTimeDays),
      }))
    );
    setReason(request.sourcingReason ?? "");
    // Anything already saved counts as deliberate — never auto-overwrite it.
    setTouched(
      new Set(
        openLines.flatMap((l) => [
          ...(l.finalRate !== null ? [`${l.id}:rate`] : []),
          ...(l.gstPct !== null ? [`${l.id}:gstPct`] : []),
          ...(l.leadTimeDays !== null ? [`${l.id}:leadTimeDays`] : []),
        ])
      )
    );
    setFromMaster(new Set());
    setErr(null);
    setRequested(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestId]);

  if (!request) return null;

  const lineById = new Map(allLines.map((l) => [l.id, l]));
  const setVendorRow = (i: number, patch: Partial<VRow>) =>
    setVendors((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addVendor = () => setVendors((prev) => (prev.length >= MAX_VENDORS ? prev : [...prev, emptyVendor()]));
  const removeVendor = (i: number) =>
    setVendors((prev) => {
      const gone = prev[i]?.vendorId;
      if (gone && gone === recommended) setRecommended("");
      return prev.filter((_, idx) => idx !== i);
    });

  const markTouched = (lineId: string, field: CellField) => {
    setTouched((prev) => new Set(prev).add(`${lineId}:${field}`));
    setFromMaster((prev) => {
      const next = new Set(prev);
      next.delete(`${lineId}:${field}`);
      return next;
    });
  };

  const setCell = (lineId: string, field: keyof Omit<LRow, "lineId">, v: string) => {
    setRows((prev) => prev.map((r) => (r.lineId === lineId ? { ...r, [field]: v } : r)));
    if (field !== "qty") markTouched(lineId, field);
  };

  /** Type once, apply to every item — then adjust any individual cell after. */
  const applyToAll = (field: keyof Omit<LRow, "lineId">, v: string) => {
    if (v === "") return;
    setRows((prev) => prev.map((r) => ({ ...r, [field]: v })));
    if (field !== "qty") {
      setTouched((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.add(`${r.lineId}:${field}`);
        return next;
      });
      setFromMaster((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.delete(`${r.lineId}:${field}`);
        return next;
      });
    }
  };

  /**
   * Picking the recommended vendor pulls its standing rates in — but ONLY into
   * cells the user has not typed into. Changing vendor re-fills untouched cells
   * and leaves typed ones alone.
   */
  const pickRecommended = (vendorId: string) => {
    setRecommended(vendorId);
    const filled = new Set<string>();
    setRows((prev) =>
      prev.map((r) => {
        const line = lineById.get(r.lineId);
        const price = line ? s.priceFor(vendorId, line.itemId) : undefined;
        if (!price) return r;
        const next = { ...r };
        if (!touched.has(`${r.lineId}:rate`)) {
          next.rate = String(price.rate);
          filled.add(`${r.lineId}:rate`);
        }
        if (!touched.has(`${r.lineId}:gstPct`) && price.gstPct !== null) {
          next.gstPct = String(price.gstPct);
          filled.add(`${r.lineId}:gstPct`);
        }
        if (!touched.has(`${r.lineId}:leadTimeDays`) && price.leadTimeDays !== null) {
          next.leadTimeDays = String(price.leadTimeDays);
          filled.add(`${r.lineId}:leadTimeDays`);
        }
        return next;
      })
    );
    setFromMaster(filled);
  };

  const filledVendors = vendors.filter((v) => v.vendorId);
  /** Base (qty × rate) and the GST on it, kept apart so the strip can show both. */
  const baseOf = (r: LRow) => {
    const q = Number(r.qty);
    const rate = Number(r.rate);
    if (!(q > 0) || r.rate === "" || !(rate >= 0)) return null;
    return Math.round(q * rate * 100) / 100;
  };
  const valueOf = (r: LRow) => {
    const base = baseOf(r);
    if (base === null) return null;
    const gst = r.gstPct === "" ? 0 : Number(r.gstPct);
    return Math.round(base * (1 + gst / 100) * 100) / 100;
  };
  const requestBase = rows.reduce((sum, r) => sum + (baseOf(r) ?? 0), 0);
  const requestValue = rows.reduce((sum, r) => sum + (valueOf(r) ?? 0), 0);
  // Derived rather than summed per line, so it can never disagree with the total.
  const requestGst = Math.round((requestValue - requestBase) * 100) / 100;
  const masterHits = fromMaster.size;

  const cellClass = (lineId: string, field: CellField) =>
    fromMaster.has(`${lineId}:${field}`) ? "bg-orange-soft/40" : undefined;
  const cellTitle = (lineId: string, field: CellField) =>
    fromMaster.has(`${lineId}:${field}`) ? "Filled from the vendor-item rate master — edit freely" : undefined;

  const save = async () => {
    setErr(null);
    if (mixedVendors) return setErr("This requisition's items are split across different vendors and cannot be sourced as one.");
    if (filledVendors.length === 0) return setErr("Shortlist at least one vendor.");
    const ids = filledVendors.map((v) => v.vendorId);
    if (new Set(ids).size !== ids.length) return setErr("Each shortlisted vendor must be different.");
    if (!recommended) return setErr("Tick the vendor you are recommending.");
    if (!ids.includes(recommended)) return setErr("The recommended vendor must be one of the shortlisted vendors.");
    if (lockedVendorId && lockedVendorId !== recommended) {
      return setErr(
        `Part of this requisition is already approved against ${s.vendorById(lockedVendorId)?.name ?? "another vendor"} — all its items must go to that vendor.`
      );
    }
    // Mirrors the server rule exactly, message and all.
    if (filledVendors.length < MAX_VENDORS && !reason.trim()) {
      return setErr(`Give a reason for shortlisting fewer than ${MAX_VENDORS} vendors.`);
    }
    if (rows.length === 0) return setErr("There is nothing left to source on this requisition.");
    for (const r of rows) {
      const name = s.itemLabel(lineById.get(r.lineId)?.itemId ?? "");
      if (!(Number(r.qty) > 0)) return setErr(`Quantity must be greater than 0 — ${name}.`);
      if (r.rate === "" || !(Number(r.rate) >= 0)) return setErr(`Enter a rate for ${name}.`);
    }

    setBusy(true);
    try {
      await s.saveSourcingRequest({
        requestId: request.id,
        vendors: filledVendors.map((v) => ({ vendorId: v.vendorId, remark: v.remark.trim() || null })),
        recommendedVendorId: recommended,
        lines: rows.map((r) => ({
          requestItemId: r.lineId,
          qty: Number(r.qty),
          rate: Number(r.rate),
          gstPct: r.gstPct === "" ? null : Number(r.gstPct),
          leadTimeDays: r.leadTimeDays === "" ? null : Number(r.leadTimeDays),
        })),
        sourcingReason: reason.trim() || null,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = "w-full rounded-lg border border-line px-2 py-1.5 text-[13px] text-navy focus:outline-none focus:ring-2 focus:ring-orange/30";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={`Sourcing — ${request.requestNo}`}
      subtitle={`${openLines.length} item${openLines.length === 1 ? "" : "s"} to source. Shortlist up to ${MAX_VENDORS} vendors, tick the one that wins, then set the rate for each item.`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || mixedVendors}>
            {busy ? "Saving…" : "Submit for approval"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mixedVendors && (
          <p className="rounded-xl bg-ryg-red/10 px-3.5 py-2.5 text-[12.5px] text-ryg-red">
            This requisition's items were sourced to <strong>different vendors</strong> under the old per-item flow. One
            requisition can only go to one vendor now, so it can't be re-sourced here — open the individual items from the
            requisition page instead.
          </p>
        )}
        {decidedLines > 0 && (
          <p className="rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">
            {decidedLines} item{decidedLines === 1 ? " is" : "s are"} already decided and can't be changed here.
            {lockedVendorId && (
              <>
                {" "}
                The vendor is locked to <strong>{s.vendorById(lockedVendorId)?.name ?? "—"}</strong> for the rest of this
                requisition.
              </>
            )}
          </p>
        )}

        {/* ---- vendors: a shortlist, no prices ---- */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className={SECTION_HEADING_CLASS}>Vendors</span>
            <span className="text-[11.5px] text-grey-2">Tick the one you recommend — it supplies every item</span>
          </div>
          {vendors.map((v, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-xl border border-line bg-page/40 p-2.5">
              <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-navy cursor-pointer">
                <input
                  type="radio"
                  name="recommended"
                  className="accent-orange"
                  checked={recommended !== "" && recommended === v.vendorId}
                  onChange={() => v.vendorId && pickRecommended(v.vendorId)}
                  disabled={!v.vendorId}
                />
                Recommended
              </label>
              {/* Proportional, not fixed: the note gets the larger share (people
                  type sentences there), and both still shrink on narrow screens. */}
              <div className="min-w-0 flex-[2]">
                <Combobox
                  value={v.vendorId}
                  onChange={(val) => setVendorRow(i, { vendorId: val })}
                  options={vendorOptionsFor(i)}
                  placeholder="Select vendor"
                  onCreate={(name) => setRaiseVendor(name)}
                  createLabel={(q) => `Request new vendor “${q}”`}
                  autoAdvance
                />
              </div>
              <div className="min-w-0 flex-[3]">
                <TextInput
                  placeholder="Note (optional)"
                  value={v.remark}
                  onChange={(e) => setVendorRow(i, { remark: e.target.value })}
                />
              </div>
              {vendors.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeVendor(i)}
                  className="shrink-0 text-grey-2 hover:text-ryg-red"
                  aria-label="Remove vendor"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {vendors.length < MAX_VENDORS && (
            <button type="button" onClick={addVendor} className="text-[12.5px] font-semibold text-orange hover:underline">
              + Add vendor
            </button>
          )}
          {requested && (
            <p className="text-[12px] text-teal">
              Requested vendor “{requested}” — selectable once the vendor master's owner approves it.
            </p>
          )}

          {/* Sits with the vendors because it is ABOUT the vendors — it was
              stranded below the item grid, far from the choice it explains.
              "Single-source" was also wrong at two vendors. */}
          {filledVendors.length < MAX_VENDORS && (
            <FieldLabel
              label={`Why fewer than ${MAX_VENDORS} vendors?`}
              required
              hint={`${filledVendors.length} of ${MAX_VENDORS} shortlisted`}
            >
              <TextInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. only approved supplier for this grade"
              />
            </FieldLabel>
          )}
        </div>

        {/* ---- items: one rate each, with fill-down ---- */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className={SECTION_HEADING_CLASS}>Items</span>
            {masterHits > 0 && (
              <span className="text-[11.5px] text-grey-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-orange-soft/70 align-middle" /> shaded = filled from
                the rate master · edit freely
              </span>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="bg-page text-left text-[11.5px] uppercase tracking-wide text-grey-2">
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="w-28 px-2 py-2 font-semibold">Qty</th>
                  <th className="w-28 px-2 py-2 font-semibold">Rate</th>
                  <th className="w-24 px-2 py-2 font-semibold">GST %</th>
                  <th className="w-28 px-2 py-2 font-semibold">Lead days</th>
                  <th className="w-32 px-3 py-2 text-right font-semibold">Value</th>
                </tr>
                {/* Type once here, then adjust any individual cell below. */}
                <tr className="border-t border-line bg-page/60">
                  <th className="px-3 py-1.5 text-right text-[11.5px] font-medium text-grey-2">fill down to all →</th>
                  {(["qty", "rate", "gstPct", "leadTimeDays"] as const).map((f) => (
                    <th key={f} className="px-2 py-1.5">
                      <input
                        type="number"
                        className={num}
                        placeholder="—"
                        onChange={(e) => applyToAll(f, e.target.value)}
                        aria-label={`Fill ${f} down to every item`}
                      />
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const line = lineById.get(r.lineId) as RequestItem | undefined;
                  const v = valueOf(r);
                  return (
                    <tr key={r.lineId} className="border-t border-line">
                      {/* Item NAME only — the group is already implied by the
                          requisition and only made these rows wrap. */}
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="font-medium text-navy">{s.itemById(line?.itemId ?? null)?.name ?? "—"}</span>
                        <span className="ml-1.5 text-[11.5px] text-grey-2">
                          asked {line?.quantity} {line?.unit}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" className={num} value={r.qty} onChange={(e) => setCell(r.lineId, "qty", e.target.value)} />
                      </td>
                      {(["rate", "gstPct", "leadTimeDays"] as const).map((f) => (
                        <td key={f} className="px-2 py-1.5">
                          <input
                            type="number"
                            className={`${num} ${cellClass(r.lineId, f) ?? ""}`}
                            title={cellTitle(r.lineId, f)}
                            value={r[f]}
                            onChange={(e) => setCell(r.lineId, f, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-semibold text-navy whitespace-nowrap">
                        {v === null ? "—" : inr(v)}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[12.5px] text-grey-2">
                      Nothing left to source on this requisition.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2 rounded-xl bg-orange-soft/50 px-3.5 py-2.5">
          <Money label="Base" value={requestBase} />
          <Money label="GST" value={requestGst} />
          <Money label="Total (incl. GST)" value={requestValue} strong />
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the sourcing form intact
          underneath (no scroll unlock, ESC closes only this one). */}
      <RequestMasterModal
        stacked
        open={raiseVendor !== null}
        onClose={() => setRaiseVendor(null)}
        masterType="vendor"
        lockType
        prefill={{ name: raiseVendor ?? "" }}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
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
