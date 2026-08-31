import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, Select } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import ReceiptCapture from "./ReceiptCapture";
import DaPanel from "./DaPanel";
import { uploadTravelDoc, travelDocUrl } from "../data/travelBookingWrites";
import type { BillReading } from "../data/travelClaimWrites";
import type { Trip, ClaimLine, ClaimLineInput, ClaimPreview, ActualTravelInput } from "../types";

/**
 * The expense claim, as the traveller writes it.
 *
 * ⚠ EVERY FIGURE ON THIS SCREEN COMES FROM THE SERVER. There is no cap, no rate
 *   and no daily-allowance rule anywhere in this file. The form sends the lines
 *   as they are typed to `fms_travel_preview_claim` — the same
 *   `fms_travel_check_claim` that submit runs — and renders what comes back.
 *   This is the module's one stated divergence from the OCPI pattern, which
 *   keeps two copies of its branch rules in step by hand: acceptable for a
 *   branch, not for money, because two authors of a cap eventually disagree and
 *   the disagreement is somebody's salary.
 *
 * ⚠ THE PREVIEW IS DEBOUNCED, NOT THROTTLED, AND IT IS RACE-GUARDED. A traveller
 *   typing "1750" fires four keystrokes; without the sequence check the answer
 *   to "1" can land after the answer to "1750" and the screen shows a cap
 *   against a figure nobody typed.
 *
 * ⚠ CAPS APPEAR WHILE TYPING, NOT AFTER SAVING. That is the entire point of the
 *   live preview: somebody who learns at submit time that ₹1,000 of their hotel
 *   bill is disallowed has already had the argument with the hotel. Learning it
 *   as they type lets them attach the §7.3 evidence instead.
 */

const uid = (): string => Math.random().toString(36).slice(2, 10);

const emptyLine = (): ClaimLineInput => ({
  key: uid(),
  id: null,
  categoryId: null,
  cityId: null,
  spentOn: null,
  description: null,
  amount: null,
  gstAmount: null,
  vendor: null,
  gstin: null,
  invoiceNo: null,
  hasReceipt: false,
  selfDeclared: false,
  nights: null,
  persons: null,
  days: null,
  km: null,
  guests: null,
  mealKind: null,
  vehicleType: null,
  fullDayRental: false,
  overCapEvidence: false,
  hodApproved: false,
  directorApproved: false,
  docPath: null,
});

const toInput = (l: ClaimLine): ClaimLineInput => ({
  key: l.id,
  id: l.id,
  categoryId: l.categoryId,
  cityId: l.cityId,
  spentOn: l.spentOn,
  description: l.description,
  amount: l.amount,
  gstAmount: l.gstAmount,
  vendor: l.vendor,
  gstin: l.gstin,
  invoiceNo: l.invoiceNo,
  hasReceipt: l.hasReceipt,
  selfDeclared: l.selfDeclared,
  nights: l.nights,
  persons: l.persons,
  days: l.days,
  km: l.km,
  guests: l.guests,
  mealKind: l.mealKind,
  vehicleType: l.vehicleType,
  fullDayRental: l.fullDayRental,
  overCapEvidence: l.overCapEvidence,
  hodApproved: l.hodApproved,
  directorApproved: l.directorApproved,
  docPath: l.docPath,
});

const num = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export default function ClaimPanel({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const stored = s.claimLinesOf(trip.id);
  const daDays = s.daDaysOf(trip.id);

  const open = trip.status === "booked" || trip.status === "cancelled_pending_claim";
  const mine = s.canActOn("claim", trip);
  const editable = open && mine;

  const [lines, setLines] = useState<ClaimLineInput[]>(() => stored.map(toInput));
  const [travel, setTravel] = useState<ActualTravelInput>({
    actualDepartureDate: trip.actualDepartureDate ?? trip.plannedDepartureDate,
    actualReturnDate: trip.actualReturnDate ?? trip.plannedReturnDate,
    actualDepartureTime: trip.actualDepartureTime,
    actualReturnTime: trip.actualReturnTime,
    customerProvided: trip.customerProvided,
    isCompanyConference: trip.isCompanyConference,
    familyJoinedFrom: trip.familyJoinedFrom,
    familyJoinedTo: trip.familyJoinedTo,
  });
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, File>>({});
  const [readings, setReadings] = useState<Record<string, Record<string, unknown>>>({});

  /*
    The stored lines are the truth after every save, and this is what re-seeds
    the form from them. It is keyed on the ids and the priced-at stamps rather
    than on the array itself, so a background refetch that changed nothing does
    not throw away half-typed input.
  */
  const storedKey = stored.map((l) => `${l.id}:${l.pricedAt ?? ""}`).join("|");
  useEffect(() => {
    setLines(stored.map(toInput));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const categories = useMemo(
    () => s.expenseCategories.filter((c) => c.active),
    [s.expenseCategories],
  );
  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        value: c.id,
        label: c.name,
        // ⚠ A category that refuses is labelled as refusing, in the picker. §15
        //   refuses alcohol, fines and personal entertainment BY THE CATEGORY,
        //   so somebody picking one should learn that before they type an amount
        //   and attach a photo, not after.
        sublabel: c.reimbursable ? undefined : "Not reimbursable (§15)",
      })),
    [categories],
  );
  const cityOptions = useMemo(
    () =>
      s.cities
        .filter((c) => c.active)
        .map((c) => ({ value: c.id, label: c.name, sublabel: `Tier ${c.tier}` })),
    [s.cities],
  );

  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  // ---- the live preview ---------------------------------------------------
  const seq = useRef(0);
  const payload = JSON.stringify(lines);
  useEffect(() => {
    if (!open) return;
    // A ticket for this request, so a slow answer to an older keystroke
    // cannot paint over a newer one.
    const ticket = ++seq.current;
    const t = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const p = await s.previewClaim(trip.id, lines);
        // Only the newest request may paint. See the header.
        if (ticket === seq.current) setPreview(p);
      } catch {
        /* A preview that cannot be fetched is not an error the form should
           block on — the figures simply stay as they were, and submit re-prices
           on the server anyway. */
      } finally {
        if (ticket === seq.current) setPreviewing(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, trip.id, open]);

  const byLine = useMemo(() => {
    const m = new Map<string, ClaimPreview["lines"][number]>();
    for (const l of preview?.lines ?? []) m.set(l.line_id, l);
    return m;
  }, [preview]);

  const set = (key: string, patch: Partial<ClaimLineInput>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /**
   * Fold what the extractor read into a line.
   *
   * ⚠ IT ONLY FILLS WHAT IS EMPTY, and it never picks the category. A traveller
   *   who has already typed the amount and then reads the photo to catch the GST
   *   should not have their figure replaced by a worse one — and the category
   *   decides reimbursability, so a model may suggest it and not choose it.
   */
  const applyReading = (key: string, r: BillReading) => {
    setReadings((m) => ({ ...m, [key]: r as unknown as Record<string, unknown> }));
    const cityId = (name: string): string | null => {
      const t = name.trim().toLowerCase();
      if (!t) return null;
      return s.cities.find((c) => c.active && c.name.toLowerCase() === t)?.id ?? null;
    };
    setLines((ls) =>
      ls.map((l) =>
        l.key !== key
          ? l
          : {
              ...l,
              vendor: l.vendor ?? (r.vendor || null),
              invoiceNo: l.invoiceNo ?? (r.invoiceNo || null),
              gstin: l.gstin ?? (r.gstin || null),
              spentOn: l.spentOn ?? (r.date || null),
              cityId: l.cityId ?? cityId(r.city),
              amount: l.amount ?? r.amount,
              gstAmount: l.gstAmount ?? r.gstAmount,
              description: l.description ?? (r.description || null),
              // A photograph IS the receipt, so the box ticks itself.
              hasReceipt: true,
            },
      ),
    );
  };

  const saveDraft = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      // Upload anything picked but not yet attached, then save every line.
      const next = [...lines];
      for (let i = 0; i < next.length; i++) {
        const f = pending[next[i].key];
        if (!f) continue;
        next[i] = {
          ...next[i],
          docPath: await uploadTravelDoc(trip.id, "receipt", f),
          hasReceipt: true,
          aiExtracted: readings[next[i].key] ?? next[i].aiExtracted,
        };
      }
      await s.recordActualTravel(trip.id, travel);
      const n = await s.saveClaimDraft(trip.id, next);
      setPending({});
      setNote(`Saved — ${n} line${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await saveDraftInline();
      const st = await s.submitClaim(trip.id);
      setNote(`Filed — the trip is now ${st.replace(/_/g, " ")}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Save without touching the busy flag, so submit can chain onto it. */
  const saveDraftInline = async () => {
    const next = [...lines];
    for (let i = 0; i < next.length; i++) {
      const f = pending[next[i].key];
      if (!f) continue;
      next[i] = {
        ...next[i],
        docPath: await uploadTravelDoc(trip.id, "receipt", f),
        hasReceipt: true,
        aiExtracted: readings[next[i].key] ?? next[i].aiExtracted,
      };
    }
    await s.recordActualTravel(trip.id, travel);
    await s.saveClaimDraft(trip.id, next);
    setPending({});
  };

  const nothingToClaim = async () => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      if (lines.length > 0) await s.saveClaimDraft(trip.id, []);
      await s.recordActualTravel(trip.id, travel);
      const st = await s.noClaim(trip.id, "Nothing to claim.");
      setNote(
        st === "closed"
          ? "Closed — no allowance was due and no advance was outstanding."
          : `Filed as a zero claim — the trip is now ${st.replace(/_/g, " ")}, because there is still an allowance or an advance to settle.`,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (path: string) => {
    try {
      window.open(await travelDocUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const totals = preview?.totals;

  return (
    <div className="space-y-4">
      {/* ---- what actually happened ------------------------------------- */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold text-navy">What actually happened</div>
        <p className="mt-0.5 text-[11.5px] text-grey-2">
          The daily allowance is computed from these, not from the planned dates — §8.1 turns on
          the hour you left and the hour you got back.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FieldLabel label="Departed on" required>
            <TextInput
              type="date"
              value={travel.actualDepartureDate ?? ""}
              disabled={!editable}
              onChange={(e) => setTravel((t) => ({ ...t, actualDepartureDate: e.target.value || null }))}
            />
          </FieldLabel>
          <FieldLabel label="Departure time" hint="Decides the first day (§8.1)">
            <TextInput
              type="time"
              value={travel.actualDepartureTime ?? ""}
              disabled={!editable}
              onChange={(e) => setTravel((t) => ({ ...t, actualDepartureTime: e.target.value || null }))}
            />
          </FieldLabel>
          <FieldLabel label="Returned on" required>
            <TextInput
              type="date"
              value={travel.actualReturnDate ?? ""}
              disabled={!editable}
              onChange={(e) => setTravel((t) => ({ ...t, actualReturnDate: e.target.value || null }))}
            />
          </FieldLabel>
          <FieldLabel label="Return time" hint="Decides the last day (§8.1)">
            <TextInput
              type="time"
              value={travel.actualReturnTime ?? ""}
              disabled={!editable}
              onChange={(e) => setTravel((t) => ({ ...t, actualReturnTime: e.target.value || null }))}
            />
          </FieldLabel>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FieldLabel
            label="Did the customer provide any of this?"
            hint="Meals halve the allowance; meals and a room take it to a quarter (§8.3)"
          >
            <Select
              value={travel.customerProvided ?? ""}
              disabled={!editable}
              onChange={(e) =>
                setTravel((t) => ({
                  ...t,
                  customerProvided: (e.target.value || null) as ActualTravelInput["customerProvided"],
                }))
              }
            >
              <option value="">Nothing — I paid for my own</option>
              <option value="meals">Meals</option>
              <option value="room">Room only</option>
              <option value="both">Meals and a room</option>
            </Select>
          </FieldLabel>

          <FieldLabel label="Company conference?" hint="§13 pays 50% of the allowance">
            <Select
              value={travel.isCompanyConference ? "yes" : "no"}
              disabled={!editable}
              onChange={(e) =>
                setTravel((t) => ({ ...t, isCompanyConference: e.target.value === "yes" }))
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </FieldLabel>

          <FieldLabel label="Family joined from" hint="§14.1 — over 15 days cuts it by 25%">
            <TextInput
              type="date"
              value={travel.familyJoinedFrom ?? ""}
              disabled={!editable}
              onChange={(e) => setTravel((t) => ({ ...t, familyJoinedFrom: e.target.value || null }))}
            />
          </FieldLabel>
          <FieldLabel label="…until">
            <TextInput
              type="date"
              value={travel.familyJoinedTo ?? ""}
              disabled={!editable}
              onChange={(e) => setTravel((t) => ({ ...t, familyJoinedTo: e.target.value || null }))}
            />
          </FieldLabel>
        </div>
      </Card>

      {/* ---- the lines --------------------------------------------------- */}
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-navy">Expenses</div>
            <p className="mt-0.5 text-[11.5px] text-grey-2">
              Caps and disallowances are worked out by the server as you type — the same code that
              runs when you file.
            </p>
          </div>
          {previewing && <span className="text-[11.5px] text-grey-2">Checking…</span>}
        </div>

        <div className="mt-3 space-y-3">
          {lines.map((l) => {
            const cat = l.categoryId ? catById.get(l.categoryId) : undefined;
            const verdict = byLine.get(l.id ?? l.key);
            const isHotel = cat?.kind === "hotel";
            const isMeal = cat?.kind === "meal";
            const isMileage = cat?.kind === "mileage";
            const isTransfer = cat?.kind === "transfer";
            const isConveyance = cat?.kind === "conveyance";
            const overCap =
              verdict && verdict.cap_applied !== null && verdict.claimed > verdict.cap_applied;

            return (
              <div key={l.key} className="rounded-xl border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FieldLabel label="Category" required>
                    <Combobox
                      value={l.categoryId ?? ""}
                      options={categoryOptions}
                      disabled={!editable}
                      placeholder="Pick one…"
                      onChange={(v) => set(l.key, { categoryId: v || null })}
                    />
                  </FieldLabel>
                  <FieldLabel label="Date">
                    <TextInput
                      type="date"
                      value={l.spentOn ?? ""}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { spentOn: e.target.value || null })}
                    />
                  </FieldLabel>
                  <FieldLabel
                    label="City"
                    hint="Blank uses wherever you were that day, read off the bookings"
                  >
                    <Combobox
                      value={l.cityId ?? ""}
                      options={cityOptions}
                      disabled={!editable}
                      placeholder="From the itinerary"
                      onChange={(v) => set(l.key, { cityId: v || null })}
                    />
                  </FieldLabel>
                  <FieldLabel label="Amount" required hint="The gross, including tax">
                    <TextInput
                      inputMode="decimal"
                      value={l.amount ?? ""}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { amount: num(e.target.value) })}
                    />
                  </FieldLabel>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <FieldLabel label="Description">
                    <TextInput
                      value={l.description ?? ""}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { description: e.target.value || null })}
                    />
                  </FieldLabel>
                  <FieldLabel label="Vendor">
                    <TextInput
                      value={l.vendor ?? ""}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { vendor: e.target.value || null })}
                    />
                  </FieldLabel>
                  <FieldLabel
                    label="GST amount"
                    hint="The tax component, if shown separately — it feeds the ITC register"
                  >
                    <TextInput
                      inputMode="decimal"
                      value={l.gstAmount ?? ""}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { gstAmount: num(e.target.value) })}
                    />
                  </FieldLabel>
                  <FieldLabel label="Vendor GSTIN">
                    <TextInput
                      value={l.gstin ?? ""}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { gstin: e.target.value.toUpperCase() || null })}
                    />
                  </FieldLabel>
                </div>

                {/* Only the counts this category actually prices on. A nights box
                    on a taxi fare is a box somebody fills in wrongly. */}
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {isHotel && (
                    <FieldLabel label="Nights" hint="The cap is per night, per city (§7.2)">
                      <TextInput
                        inputMode="numeric"
                        value={l.nights ?? ""}
                        disabled={!editable}
                        onChange={(e) => set(l.key, { nights: num(e.target.value) })}
                      />
                    </FieldLabel>
                  )}
                  {isConveyance && (
                    <FieldLabel label="Days" hint="The conveyance cap is per day (§10)">
                      <TextInput
                        inputMode="numeric"
                        value={l.days ?? ""}
                        disabled={!editable}
                        onChange={(e) => set(l.key, { days: num(e.target.value) })}
                      />
                    </FieldLabel>
                  )}
                  {isMeal && (
                    <>
                      <FieldLabel label="Kind of meal">
                        <Select
                          value={l.mealKind ?? "business"}
                          disabled={!editable}
                          onChange={(e) => set(l.key, { mealKind: e.target.value || null })}
                        >
                          <option value="business">Business meal</option>
                          <option value="team">Team meal</option>
                          <option value="refreshment">Refreshment</option>
                          <option value="late_night">Late night</option>
                        </Select>
                      </FieldLabel>
                      <FieldLabel label="People" hint="The cap is per person, per meal (§9)">
                        <TextInput
                          inputMode="numeric"
                          value={l.persons ?? ""}
                          disabled={!editable}
                          onChange={(e) => set(l.key, { persons: num(e.target.value) })}
                        />
                      </FieldLabel>
                      <FieldLabel
                        label="Who was there, and why"
                        hint="§9.1 requires this on a business meal"
                      >
                        <TextInput
                          value={l.guests ?? ""}
                          disabled={!editable}
                          onChange={(e) => set(l.key, { guests: e.target.value || null })}
                        />
                      </FieldLabel>
                    </>
                  )}
                  {isMileage && (
                    <>
                      <FieldLabel label="Kilometres">
                        <TextInput
                          inputMode="decimal"
                          value={l.km ?? ""}
                          disabled={!editable}
                          onChange={(e) => set(l.key, { km: num(e.target.value) })}
                        />
                      </FieldLabel>
                      <FieldLabel label="Vehicle">
                        <Select
                          value={l.vehicleType ?? "four_wheeler"}
                          disabled={!editable}
                          onChange={(e) => set(l.key, { vehicleType: e.target.value || null })}
                        >
                          <option value="four_wheeler">Car</option>
                          <option value="two_wheeler">Two-wheeler</option>
                        </Select>
                      </FieldLabel>
                    </>
                  )}
                  {isTransfer && (
                    <FieldLabel label="Full-day rental?" hint="§10.1 has its own cap">
                      <Select
                        value={l.fullDayRental ? "yes" : "no"}
                        disabled={!editable}
                        onChange={(e) => set(l.key, { fullDayRental: e.target.value === "yes" })}
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </Select>
                    </FieldLabel>
                  )}
                </div>

                {/* ---- what the engine said about THIS line --------------- */}
                {verdict && (
                  /*
                    ⚠ THE COLOUR AND THE WORDING KEY ON WHETHER THE ENGINE HAD A
                      COMPLAINT, NOT ON THE DISALLOWED AMOUNT. A line with no
                      category yet claims nothing, so it disallows nothing — and
                      keying on the amount painted it green and captioned it
                      "₹0 allowed in full" directly above the engine's own
                      sentence saying it could not be priced at all. Two opposite
                      claims in one box, which is the same defect the lifecycle
                      rail carried in phase 4.
                  */
                  <div
                    className={
                      "mt-3 rounded-lg px-2.5 py-2 text-[12px] " +
                      (verdict.disallow_reason ? "bg-[#FDECEC] text-navy" : "bg-[#F1F7F1] text-navy")
                    }
                  >
                    <span className="font-semibold">
                      {verdict.disallowed > 0
                        ? `${money(verdict.allowed)} allowed, ${money(verdict.disallowed)} disallowed`
                        : verdict.disallow_reason
                          ? "Nothing can be allowed on this line yet"
                          : `${money(verdict.allowed)} allowed in full`}
                    </span>
                    {verdict.disallow_reason && <div className="mt-0.5">{verdict.disallow_reason}</div>}
                    {verdict.note && <div className="mt-0.5 text-grey-2">{verdict.note}</div>}
                  </div>
                )}

                {/* §7.3 — the two flags, shown only where they can do anything.
                    Offering them on every line would invite them being ticked on
                    lines where they mean nothing. */}
                {isHotel && overCap && editable && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex items-start gap-2 text-[12px] text-navy">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={l.overCapEvidence}
                        onChange={(e) => set(l.key, { overCapEvidence: e.target.checked })}
                      />
                      <span>
                        I have evidence that nothing within the cap was available
                        <span className="block text-grey-2">
                          Attach it as the receipt, or as a separate file on this line.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-[12px] text-navy">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={l.hodApproved}
                        onChange={(e) => set(l.key, { hodApproved: e.target.checked })}
                      />
                      <span>
                        My HOD approved going above the cap
                        <span className="block text-grey-2">
                          §7.3 needs both, and never more than 1.5× the cap.
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[12px] text-navy">
                    <input
                      type="checkbox"
                      checked={l.hasReceipt}
                      disabled={!editable}
                      onChange={(e) => set(l.key, { hasReceipt: e.target.checked })}
                    />
                    I have the original receipt
                  </label>
                  {l.docPath && (
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-orange underline"
                      onClick={() => void openDoc(l.docPath!)}
                    >
                      View attachment
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      className="ml-auto text-[12px] font-semibold text-grey-2 underline"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      Remove this line
                    </button>
                  )}
                </div>

                {editable && (
                  <div className="mt-3">
                    <ReceiptCapture
                      disabled={busy}
                      onFile={(f) =>
                        setPending((m) => {
                          const next = { ...m };
                          if (f) next[l.key] = f;
                          else delete next[l.key];
                          return next;
                        })
                      }
                      onRead={(r) => applyReading(l.key, r)}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {lines.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-4 text-[12.5px] text-grey-2">
              No expenses yet. Add a line, or use <span className="font-semibold">Nothing to
              claim</span> below — the daily allowance is still worked out either way.
            </p>
          )}
        </div>

        {editable && (
          <div className="mt-3">
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              Add an expense
            </Button>
          </div>
        )}
      </Card>

      {/* ---- the allowance ---------------------------------------------- */}
      <DaPanel frozen={daDays} preview={preview} overrideTotal={trip.daTotal} />

      {/* ---- §16, when it applies ---------------------------------------- */}
      {(preview?.class_excess ?? []).some((x) => x.note) && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold text-navy">
            Booked above the band entitlement (§16)
          </div>
          <ul className="mt-2 space-y-1.5">
            {(preview?.class_excess ?? [])
              .filter((x) => x.note)
              .map((x) => (
                <li key={x.leg_id} className="text-[12px] text-grey-2">
                  <span className="font-semibold text-navy">
                    {x.kind}
                    {x.booked_class ? ` — ${x.booked_class}` : ""}
                  </span>
                  {x.personal_excess > 0 && (
                    <span className="ml-1 font-semibold text-navy">
                      ({money(x.personal_excess)} personal)
                    </span>
                  )}
                  <div>{x.note}</div>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {/* ---- the totals and the buttons ---------------------------------- */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Claimed", totals?.claimed],
            ["Allowed", totals?.allowed],
            ["Disallowed", totals?.disallowed],
            ["Daily allowance", totals?.da],
            ["Advance paid", totals?.advance_paid],
          ].map(([label, v]) => (
            <div key={String(label)}>
              <div className="text-[11px] uppercase tracking-wide text-grey">{label}</div>
              <div className="text-[15px] font-semibold text-navy">
                {money(v as number | undefined ?? null)}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl bg-[#F6F8FB] p-3">
          <div className="text-[11px] uppercase tracking-wide text-grey">
            {(totals?.net_payable ?? 0) < 0 ? "You owe the company" : "The company owes you"}
          </div>
          <div className="text-[20px] font-semibold text-navy">
            {money(Math.abs(totals?.net_payable ?? 0))}
          </div>
          {(totals?.net_payable ?? 0) < 0 && (
            <p className="mt-1 text-[11.5px] text-grey-2">
              The advance was larger than the claim and the allowance together, so the difference
              comes back. Finance nets it at settlement.
            </p>
          )}
          {preview?.rate_card && (
            <p className="mt-1 text-[11.5px] text-grey-2">
              Priced on <span className="font-semibold">{preview.rate_card}</span>
              {preview.travel_category ? ` at ${preview.travel_category}` : ""} — the card this trip
              was frozen on, not whichever one is current.
            </p>
          )}
        </div>

        {err && <p className="mt-3 text-[12.5px] font-semibold text-[#B3261E]">{err}</p>}
        {note && <p className="mt-3 text-[12.5px] text-grey">{note}</p>}

        {editable && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Button onClick={submit} disabled={busy || lines.length === 0}>
              {busy ? "Working…" : "File this claim"}
            </Button>
            <Button variant="outline" onClick={saveDraft} disabled={busy}>
              Save without filing
            </Button>
            <Button variant="outline" onClick={nothingToClaim} disabled={busy}>
              Nothing to claim
            </Button>
          </div>
        )}

        {!editable && open && (
          <p className="mt-3 text-[12.5px] text-grey-2">
            This claim is {trip.travellerName}&rsquo;s to file.
          </p>
        )}
        {!open && trip.clAt && (
          <p className="mt-3 text-[12.5px] text-grey-2">
            Filed on {formatDateDMY(trip.clAt)}. The lines are locked while it is being reviewed.
          </p>
        )}
      </Card>
    </div>
  );
}
