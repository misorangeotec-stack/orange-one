import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import RequestMasterModal from "./RequestMasterModal";
import { useProcurementStore } from "../store";
import { inr } from "../lib/format";
import QtyTotal from "./QtyTotal";
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
  readOnly = false,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Show what was sourced, without offering to change it — see `viewLines`. */
  readOnly?: boolean;
}) {
  const s = useProcurementStore();
  const [vendors, setVendors] = useState<VRow[]>([emptyVendor()]);
  const [recommended, setRecommended] = useState("");
  const [rows, setRows] = useState<LRow[]>([]);
  /**
   * Items being sourced in THIS pass. Everything starts ticked — sourcing the
   * whole requisition is the normal case — but a buyer can untick the ones that
   * aren't ready. An unticked item is simply left out of the save, so it stays
   * in sourcing and can be done later; it is never rejected or cancelled.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
  /**
   * What the grid is built from.
   *
   * Editing uses `openLines`, because those are the only ones the RPC accepts.
   * A VIEW must use every line: a sourcing entry is locked precisely BECAUSE the
   * approver decided, so by then its lines have moved on to approved/rejected
   * and `openLines` is empty — showing "nothing left to source" and ₹0 for a
   * requisition that was plainly sourced.
   */
  const viewLines = readOnly ? allLines : openLines;

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
        viewLines.find((l) => l.finalVendorId)?.finalVendorId ??
        ""
    );
    setRows(
      viewLines.map((l) => ({
        lineId: l.id,
        qty: String(l.finalQty ?? l.quantity),
        rate: l.finalRate === null ? "" : String(l.finalRate),
        gstPct: l.gstPct === null ? "" : String(l.gstPct),
        leadTimeDays: l.leadTimeDays === null ? "" : String(l.leadTimeDays),
      }))
    );
    setSelected(new Set(viewLines.map((l) => l.id)));
    setReason(request.sourcingReason ?? "");
    // Anything already saved counts as deliberate — never auto-overwrite it.
    setTouched(
      new Set(
        viewLines.flatMap((l) => [
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

  /**
   * Type once, apply to every TICKED item — then adjust any individual cell
   * after. Qty is deliberately not fill-downable: it is always per item.
   */
  const applyToAll = (field: CellField, v: string) => {
    if (v === "") return;
    setRows((prev) => prev.map((r) => (selected.has(r.lineId) ? { ...r, [field]: v } : r)));
    const hit = rows.filter((r) => selected.has(r.lineId));
    setTouched((prev) => {
      const next = new Set(prev);
      for (const r of hit) next.add(`${r.lineId}:${field}`);
      return next;
    });
    setFromMaster((prev) => {
      const next = new Set(prev);
      for (const r of hit) next.delete(`${r.lineId}:${field}`);
      return next;
    });
  };

  const toggleRow = (lineId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

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
  /** Everything downstream — totals, validation, save — is the ticked set only. */
  const pickedRows = rows.filter((r) => selected.has(r.lineId));
  const requestBase = pickedRows.reduce((sum, r) => sum + (baseOf(r) ?? 0), 0);
  const requestValue = pickedRows.reduce((sum, r) => sum + (valueOf(r) ?? 0), 0);
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
    if (pickedRows.length === 0) return setErr("Tick at least one item to source.");
    for (const r of pickedRows) {
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
        lines: pickedRows.map((r) => ({
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
      readOnly={readOnly}
      title={`Sourcing — ${request.requestNo}`}
      subtitle={
        readOnly
          ? `${viewLines.length} item${viewLines.length === 1 ? "" : "s"} · the vendor shortlist and the rates that were sourced.`
          : `${openLines.length} item${openLines.length === 1 ? "" : "s"} to source. Shortlist up to ${MAX_VENDORS} vendors, tick the one that wins, then set the rate for each item.`
      }
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
        {/* Not in a view: there, every line is shown deliberately, so "already
            decided and can't be changed here" is noise about a form that isn't
            being offered. */}
        {decidedLines > 0 && !readOnly && (
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
            {!readOnly && <span className="text-[11.5px] text-grey-2">Tick the one you recommend — it supplies every item</span>}
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
              {!readOnly && vendors.length > 1 && (
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
          {!readOnly && vendors.length < MAX_VENDORS && (
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
              required={!readOnly}
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
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-2.5">
              <span className={SECTION_HEADING_CLASS}>Items</span>
              {/* Ticking chooses what to SUBMIT — meaningless once it's history. */}
              {!readOnly && (
                <>
              <span className="text-[11.5px] text-grey-2">
                {pickedRows.length} of {rows.length} ticked
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set(rows.map((r) => r.lineId)))}
                disabled={pickedRows.length === rows.length}
                className="text-[11.5px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={pickedRows.length === 0}
                className="text-[11.5px] font-semibold text-orange hover:underline disabled:text-grey-2 disabled:no-underline"
              >
                Clear all
              </button>
                </>
              )}
            </div>
            {masterHits > 0 && !readOnly && (
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
                  {!readOnly && (
                  <th className="w-9 px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-orange"
                      aria-label="Tick every item"
                      checked={rows.length > 0 && pickedRows.length === rows.length}
                      ref={(el) => {
                        if (el) el.indeterminate = pickedRows.length > 0 && pickedRows.length < rows.length;
                      }}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.lineId)) : new Set())}
                    />
                  </th>
                  )}
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="w-28 px-2 py-2 font-semibold">Qty</th>
                  <th className="w-28 px-2 py-2 font-semibold">Rate</th>
                  <th className="w-24 px-2 py-2 font-semibold">GST %</th>
                  <th className="w-28 px-2 py-2 font-semibold">Lead days</th>
                  <th className="w-32 px-3 py-2 text-right font-semibold">Value</th>
                </tr>
                {/* Type once here, then adjust any individual cell below. Qty is
                    NOT here on purpose — it is always per item, never one number
                    pushed across the requisition. */}
                {!readOnly && (
                <tr className="border-t border-line bg-page/60">
                  <th colSpan={3} className="px-3 py-1.5 text-right text-[11.5px] font-medium text-grey-2">
                    fill down to ticked items →
                  </th>
                  {(["rate", "gstPct", "leadTimeDays"] as const).map((f) => (
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
                )}
              </thead>
              <tbody>
                {rows.map((r) => {
                  const line = lineById.get(r.lineId) as RequestItem | undefined;
                  const v = valueOf(r);
                  const on = selected.has(r.lineId);
                  return (
                    <tr key={r.lineId} className={`border-t border-line ${on ? "" : "opacity-45"}`}>
                      {!readOnly && (
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          className="accent-orange"
                          checked={on}
                          onChange={() => toggleRow(r.lineId)}
                          aria-label={`Source ${s.itemById(line?.itemId ?? null)?.name ?? "this item"}`}
                        />
                      </td>
                      )}
                      {/* Item NAME only — the group is already implied by the
                          requisition and only made these rows wrap. */}
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className="font-medium text-navy">{s.itemById(line?.itemId ?? null)?.name ?? "—"}</span>
                        <span className="ml-1.5 text-[11.5px] text-grey-2">
                          asked {line?.quantity} {line?.unit}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            className={num}
                            value={r.qty}
                            disabled={!on}
                            onChange={(e) => setCell(r.lineId, "qty", e.target.value)}
                          />
                          {line?.unit && <span className="shrink-0 text-[11.5px] text-grey-2">{line.unit}</span>}
                        </div>
                      </td>
                      {(["rate", "gstPct", "leadTimeDays"] as const).map((f) => (
                        <td key={f} className="px-2 py-1.5">
                          <input
                            type="number"
                            className={`${num} ${cellClass(r.lineId, f) ?? ""}`}
                            title={cellTitle(r.lineId, f)}
                            value={r[f]}
                            disabled={!on}
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
                    <td colSpan={readOnly ? 6 : 7} className="px-3 py-6 text-center text-[12.5px] text-grey-2">
                      Nothing left to source on this requisition.
                    </td>
                  </tr>
                )}
              </tbody>
              {pickedRows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line bg-orange-soft/50 text-[13px]">
                    {!readOnly && <td className="px-3 py-2" />}
                    <td className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">Total</td>
                    <td className="px-2 py-2 font-bold text-navy whitespace-nowrap">
                      <QtyTotal
                        entries={pickedRows.map((r) => ({ qty: Number(r.qty) || 0, unit: lineById.get(r.lineId)?.unit }))}
                      />
                    </td>
                    <td className="px-2 py-2" />
                    <td className="px-2 py-2 font-bold text-navy whitespace-nowrap">{inr(requestGst)}</td>
                    <td className="px-2 py-2" />
                    <td className="px-3 py-2 text-right font-bold text-navy whitespace-nowrap">{inr(requestValue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {/* Unticked ≠ rejected — say so, or "submit" looks like it drops them. */}
          {!readOnly && rows.length > 0 && pickedRows.length < rows.length && (
            <p className="text-[11.5px] text-grey-2">
              {rows.length - pickedRows.length} unticked item{rows.length - pickedRows.length === 1 ? "" : "s"} won't be
              submitted — {rows.length - pickedRows.length === 1 ? "it stays" : "they stay"} in sourcing and can be done
              later.
            </p>
          )}
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>

      {/* Opens on top of this dialog — `stacked` keeps the sourcing form intact
          underneath (no scroll unlock, ESC closes only this one). Never offered
          in a view: it's a write, and it renders inside Modal's disabled
          read-only fieldset, so it would come up inert anyway. */}
      {!readOnly && (
      <RequestMasterModal
        stacked
        open={raiseVendor !== null}
        onClose={() => setRaiseVendor(null)}
        masterType="vendor"
        lockType
        prefill={{ name: raiseVendor ?? "" }}
        onRequested={(_id, _mt, name) => setRequested(name)}
      />
      )}
    </Modal>
  );
}
