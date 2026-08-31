import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { useDirectory } from "@/core/platform/store";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useTravelStore } from "../store";
import { money } from "../lib/format";
import { needsDirectorApproval } from "../lib/entitlement";
import EntitlementPanel from "./EntitlementPanel";
import PassengerRows from "./PassengerRows";
import RequestMasterModal from "./RequestMasterModal";
import type { PassengerInput, TripDraftInput } from "../data/travelTripWrites";
import { TIME_SLOTS, type Trip, type JourneyType, type TimeSlot } from "../types";

/**
 * The trip request form — new, or an existing draft.
 *
 * ⚠ THE ENTITLEMENT SITS BESIDE THE FIELDS, NOT BEHIND A LINK. Every cap in the
 *   Domestic Travel Policy is currently discovered at claim time, when the money
 *   has been spent and the only remaining move is to disallow it. This screen
 *   exists to move that discovery to the moment somebody is deciding, so the
 *   panel updates as the traveller and the destination are chosen.
 *
 * ⚠ EVERYTHING HERE ADVISES; THE DATABASE DECIDES. Each warning below is
 *   mirrored by a real guard in `fms_travel_submit_trip` — the booking window,
 *   the missing band, the purpose that needs a reason. The copies are NOT
 *   redundant and they are not the enforcement: they exist so a person is told
 *   before they hit Submit rather than by a red error afterwards. Where the two
 *   ever disagree, the database is right.
 *
 * ⚠ THE SNAPSHOT IS NOT SENT FROM HERE. Band, travel category, rate card and
 *   approvers are resolved server-side at submit. A browser that could name its
 *   own travel category could name TC-A.
 */
export default function TripForm({ draft }: { draft?: Trip }) {
  const s = useTravelStore();
  const nav = useNavigate();
  const { profiles, bandById } = useDirectory();
  const today = todayLocalIso();

  const isNew = !draft;
  // A returned trip is the same form doing a different job: it already has a
  // number, an approver waiting, and a reason it came back.
  const isReturned = draft?.status === "returned";

  // A coordinator raises on behalf of senior management (PRD §3); everybody else
  // is filing their own trip, so it defaults to them.
  const [travellerId, setTravellerId] = useState(draft?.travellerId ?? s.userId);
  const [purposeId, setPurposeId] = useState(draft?.purposeId ?? "");
  const [remarks, setRemarks] = useState(draft?.purposeOtherRemarks ?? "");
  const [cityId, setCityId] = useState(draft?.destinationCityId ?? "");
  const [journeyType, setJourneyType] = useState<JourneyType>(draft?.journeyType ?? "round_trip");
  const [slot, setSlot] = useState<TimeSlot | "">(draft?.preferredSlot ?? "");
  const [departure, setDeparture] = useState(draft?.plannedDepartureDate ?? "");
  const [returnDate, setReturnDate] = useState(draft?.plannedReturnDate ?? "");
  const [accommodation, setAccommodation] = useState(draft?.accommodationRequired ?? false);
  const [estimate, setEstimate] = useState(
    draft?.estimatedCost === null || draft?.estimatedCost === undefined ? "" : String(draft.estimatedCost),
  );
  const [emergency, setEmergency] = useState(draft?.isEmergency ?? false);
  const [emergencyReason, setEmergencyReason] = useState(draft?.emergencyReason ?? "");
  const [advance, setAdvance] = useState(draft?.advanceRequested ?? false);
  const [advanceAmount, setAdvanceAmount] = useState(
    draft?.advanceRequestedAmount === null || draft?.advanceRequestedAmount === undefined
      ? ""
      : String(draft.advanceRequestedAmount),
  );
  const [passengers, setPassengers] = useState<PassengerInput[]>(() =>
    draft
      ? s.passengersOf(draft.id).map((p) => ({
          employeeId: p.employeeId,
          fullName: p.fullName,
          gender: p.gender,
          dateOfBirth: p.dateOfBirth,
          mobile: p.mobile,
          email: p.email,
          isPrimary: p.isPrimary,
        }))
      : [],
  );

  const [busy, setBusy] = useState<"" | "save" | "submit" | "delete">("");
  const [err, setErr] = useState<string | null>(null);
  const [askCity, setAskCity] = useState(false);

  // ---- what the policy says about this traveller ---------------------------
  const traveller = profiles.find((p) => p.id === travellerId);
  const bandNo = bandById(traveller?.bandId ?? null)?.bandNo ?? null;
  const city = s.cityById(cityId || null);
  const tier = city?.tier ?? null;
  const card = s.effectiveCard;
  const ent = useMemo(
    () => s.entitlementOn(card?.id ?? null, bandNo, tier),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card?.id, bandNo, tier, s.rates],
  );

  const purpose = s.purposes.find((p) => p.id === purposeId);
  const estimateNum = estimate.trim() === "" ? null : Number(estimate);
  const advanceNum = advanceAmount.trim() === "" ? null : Number(advanceAmount);
  const maxAdvance =
    estimateNum !== null && Number.isFinite(estimateNum)
      ? Math.round((estimateNum * s.config.policy.advanceMaxPct) / 100)
      : null;

  const cityOptions = useMemo(
    () =>
      s.cities
        .filter((c) => c.active)
        .map((c) => ({
          value: c.id,
          label: c.name,
          sublabel: `Tier ${c.tier}${c.state ? ` · ${c.state}` : ""}`,
        })),
    [s.cities],
  );

  const purposeOptions = useMemo(
    () => s.purposes.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })),
    [s.purposes],
  );

  /**
   * Only a coordinator may file for somebody else.
   *
   * Mirrors nothing in SQL, deliberately — `fms_travel_save_draft` lets any
   * raiser name any traveller, because a draft decides nothing and the real gate
   * is submit, which freezes the TRAVELLER's band and routes to the TRAVELLER's
   * managers. Narrowing the picker is a courtesy that stops somebody filing a
   * trip against a colleague by accident, not a security boundary.
   */
  const travellerOptions = useMemo(() => {
    if (!s.isProcessCoordinator) {
      const me = profiles.find((p) => p.id === s.userId);
      return me ? [{ value: me.id, label: me.name, sublabel: me.designation ?? undefined }] : [];
    }
    return profiles.map((p) => ({
      value: p.id,
      label: p.name,
      sublabel: p.designation ?? undefined,
    }));
  }, [profiles, s.isProcessCoordinator, s.userId]);

  // ---- the things a person should be told BEFORE they submit ---------------
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!traveller) blockers.push("Say who is travelling.");
  if (bandNo === null && traveller) {
    blockers.push(
      `${traveller.name} has no band on their profile, and the band decides every entitlement and cap. An administrator has to set it first.`,
    );
  }
  if (!purposeId) blockers.push("Give a purpose for the trip.");
  if (purpose?.requiresRemarks && !remarks.trim()) {
    blockers.push(`“${purpose.name}” needs a reason in writing.`);
  }
  if (!cityId) blockers.push("Choose a destination.");
  if (!departure) blockers.push("Give a departure date.");
  if (estimateNum === null || !Number.isFinite(estimateNum)) {
    blockers.push("Give an estimated cost — §3.3 requires one, and the advance is capped against it.");
  }
  if (emergency && !emergencyReason.trim()) {
    blockers.push("An emergency trip needs its reason recorded.");
  }
  if (returnDate && departure && returnDate < departure) {
    blockers.push("The return date is before the departure date.");
  }
  if (!card) blockers.push("There is no rate card in force, so nothing can be priced.");
  if (card && bandNo !== null && !ent.category) {
    blockers.push(`The rate card does not say which travel category band ${bandNo} falls into.`);
  }

  if (departure) {
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + s.config.policy.bookingWindowDays);
    if (departure > windowEnd.toISOString().slice(0, 10)) {
      blockers.push(
        `Travel must be within the next ${s.config.policy.bookingWindowDays} days. Raise this closer to the date.`,
      );
    } else if (departure < today) {
      warnings.push(
        "The departure date has already passed. §3.1 forbids travel without prior written approval, so this will need a retrospective approval with a reason.",
      );
    } else {
      const days = Math.round(
        (new Date(departure).getTime() - new Date(today).getTime()) / 86400000,
      );
      if (days < s.config.policy.advanceBookingWarnDays) {
        warnings.push(
          `Departure is in ${days} day${days === 1 ? "" : "s"}. §4.1 expects tickets to be booked at least ${s.config.policy.advanceBookingWarnDays} days ahead, so fares may be higher and a late booking needs a documented reason.`,
        );
      }
    }
  }

  if (bandNo !== null && needsDirectorApproval(bandNo)) {
    warnings.push(
      `Band ${bandNo} needs a Director's approval as well as the reporting manager's (§3.2), so this will take a step longer.`,
    );
  }

  /*
    ⚠ §11.2 — NO SECOND ADVANCE WHILE ONE IS UNRECONCILED. This is the policy's
      hardest rule and it is unenforceable without a system that can answer "what
      does this person still owe". Phase 5 makes the raise RPC refuse it; here it
      is a warning, because a traveller who learns at submit time that their
      advance is refused has already planned around having it.
  */
  const outstanding = s.trips
    .filter(
      (t) =>
        t.travellerId === travellerId &&
        t.id !== draft?.id &&
        (t.advancePaidAmount ?? 0) > 0 &&
        t.status !== "closed" &&
        t.status !== "cancelled",
    )
    .reduce((sum, t) => sum + (t.advancePaidAmount ?? 0), 0);

  if (advance && outstanding > 0) {
    warnings.push(
      `${money(outstanding)} of travel advance is still unsettled for this traveller. §11.2 does not allow a second advance until that is reconciled.`,
    );
  }
  if (advance && maxAdvance !== null && advanceNum !== null && advanceNum > maxAdvance) {
    warnings.push(
      `§11.1 caps the advance at ${s.config.policy.advanceMaxPct}% of the estimate — ${money(maxAdvance)} here.`,
    );
  }

  /*
    ⚠ THE ORG CHART IS INCOMPLETE AND THE FORM SAYS SO RATHER THAN FAILING. 19 of
      60 people have no `user_hods` row; most are top-of-tree and correctly have
      none, but two are ordinary staff whose manager edge is simply missing.
      `fms_travel_submit_trip` records a note and falls through to the configured
      step owners rather than refusing — a trip that cannot be raised because
      somebody forgot a link is a worse failure than one that goes to HR.
  */
  if (traveller && traveller.hodIds.length === 0) {
    warnings.push(
      `No reporting manager is recorded for ${traveller.name}, so this will go to the people named on the Manager Approval step in Settings instead.`,
    );
  }

  const namelessPassenger = passengers.some((p) => !p.fullName.trim());
  if (namelessPassenger) blockers.push("Every passenger needs a name as printed on their ID.");

  const input = (): TripDraftInput => ({
    travellerId: travellerId || null,
    travellerName: traveller?.name ?? "",
    travellerEmployeeCode: traveller?.employeeCode ?? null,
    purposeId: purposeId || null,
    purposeOtherRemarks: remarks.trim() || null,
    destinationCityId: cityId || null,
    journeyType,
    preferredSlot: slot || null,
    plannedDepartureDate: departure || null,
    plannedReturnDate: returnDate || null,
    accommodationRequired: accommodation,
    estimatedCost: estimateNum !== null && Number.isFinite(estimateNum) ? estimateNum : null,
    isEmergency: emergency,
    emergencyReason: emergencyReason.trim() || null,
    advanceRequested: advance,
    advanceRequestedAmount:
      advance && advanceNum !== null && Number.isFinite(advanceNum) ? advanceNum : null,
  });

  /** Save, then write the passengers onto whatever id we now have. */
  const persist = async (): Promise<string> => {
    const id = await s.saveTripDraft(input(), draft?.id ?? null);
    await s.setPassengers(id, passengers.filter((p) => p.fullName.trim()));
    return id;
  };

  const onSave = async () => {
    setBusy("save");
    setErr(null);
    try {
      const id = await persist();
      nav(`/travel-desk/trips/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const onSubmit = async () => {
    setBusy("submit");
    setErr(null);
    try {
      // Saved first, always. Submitting reads the ROW, not the form, so an
      // unsaved edit would be frozen out of the snapshot without a word.
      const id = await persist();
      const no = await s.submitTrip(id);
      nav(`/travel-desk/trips/${id}?submitted=${encodeURIComponent(no)}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const onDelete = async () => {
    if (!draft) return;
    setBusy("delete");
    setErr(null);
    try {
      await s.deleteTripDraft(draft.id);
      nav("/travel-desk/drafts");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">
          {isNew ? "New trip request" : isReturned ? `Edit ${draft?.tripNo ?? "this request"}` : "Edit draft"}
        </h1>
        <p className="text-[13px] text-grey">
          {isNew
            ? "Your entitlement is shown beside the form as you fill it in, so the policy is visible before anything is booked."
            : isReturned
              ? "It keeps its number, and resubmitting sends it back to the same approver rather than past them."
              : "A draft is private to you and carries no trip number — the number is minted when you submit."}
        </p>
      </div>

      {isReturned && draft?.returnedReason && (
        <div className="rounded-xl bg-[#FDECEC] px-4 py-3 text-[12.5px] text-navy">
          <strong className="text-ryg-red">Sent back for clarification</strong> —{" "}
          {draft.returnedReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <h2 className={SECTION_HEADING_CLASS}>Who and why</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel
                label="Traveller"
                required
                hint={s.isProcessCoordinator ? "you may raise on somebody's behalf" : "your own trip"}
              >
                <Combobox
                  value={travellerId}
                  onChange={setTravellerId}
                  options={travellerOptions}
                  disabled={!s.isProcessCoordinator}
                  wrapLabel
                />
              </FieldLabel>

              <FieldLabel label="Purpose" required>
                <Combobox
                  value={purposeId}
                  onChange={setPurposeId}
                  options={purposeOptions}
                  placeholder="— Choose —"
                />
              </FieldLabel>
            </div>

            {purpose?.requiresRemarks && (
              <FieldLabel label={`Why — ${purpose.name}`} required>
                <TextArea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  placeholder="the reason this trip is needed"
                />
              </FieldLabel>
            )}
          </Card>

          <Card className="space-y-4 p-4">
            <h2 className={SECTION_HEADING_CLASS}>The journey</h2>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel
                label="Destination"
                required
                hint="the city's tier prices the hotel cap and the conveyance cap"
              >
                <Combobox
                  value={cityId}
                  onChange={setCityId}
                  options={cityOptions}
                  placeholder="— Choose —"
                  wrapLabel
                  /*
                    ⚠ NO FREE TEXT HERE, unlike OCPI's masters. A city carries a
                      TIER, and the tier is what prices the hotel cap, the daily
                      allowance and the conveyance cap. A typed-in city is an
                      unpriceable trip, so a missing one is a request that a
                      master owner answers.
                  */
                  onCreate={(label) => {
                    setAskCity(true);
                    return void label;
                  }}
                  createLabel={(q) => `Ask for “${q}” to be added`}
                />
              </FieldLabel>

              <FieldLabel label="Journey">
                <Select
                  value={journeyType}
                  onChange={(e) => setJourneyType(e.target.value as JourneyType)}
                >
                  <option value="one_way">One way</option>
                  <option value="round_trip">Return</option>
                  <option value="multi_city">Multi-city</option>
                </Select>
              </FieldLabel>

              <FieldLabel label="Departure" required>
                <TextInput
                  type="date"
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                />
              </FieldLabel>

              <FieldLabel label="Return" hint={journeyType === "one_way" ? "not applicable" : undefined}>
                <TextInput
                  type="date"
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  min={departure || undefined}
                  disabled={journeyType === "one_way"}
                />
              </FieldLabel>

              <FieldLabel label="Preferred time" hint="a preference for the booker, not a booking">
                <Select value={slot} onChange={(e) => setSlot(e.target.value as TimeSlot | "")}>
                  <option value="">— No preference —</option>
                  {TIME_SLOTS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </FieldLabel>

              <FieldLabel
                label="Estimated cost"
                required
                hint={`§3.3. The advance is capped at ${s.config.policy.advanceMaxPct}% of this.`}
              >
                <TextInput
                  type="number"
                  min={0}
                  step="1"
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                  placeholder="e.g. 18000"
                />
              </FieldLabel>
            </div>

            <label className="flex items-center gap-2 text-[13px] text-navy">
              <input
                type="checkbox"
                checked={accommodation}
                onChange={(e) => setAccommodation(e.target.checked)}
              />
              Accommodation is needed
              {accommodation && ent.hotelCap && (
                <span className="text-[12.5px] text-grey-2">
                  — your cap is{" "}
                  {ent.hotelCap.amount === null ? "uncapped" : `${money(ent.hotelCap.amount)} a night`}
                </span>
              )}
            </label>

            <label className="flex items-center gap-2 text-[13px] text-navy">
              <input
                type="checkbox"
                checked={emergency}
                onChange={(e) => setEmergency(e.target.checked)}
              />
              This is emergency travel (§3.5)
            </label>

            {emergency && (
              <FieldLabel
                label="What made it an emergency"
                required
                hint="§3.5 gives a 24-hour window for approval; without one the trip is reimbursed at TC-D"
              >
                <TextArea
                  value={emergencyReason}
                  onChange={(e) => setEmergencyReason(e.target.value)}
                  rows={2}
                />
              </FieldLabel>
            )}
          </Card>

          <Card className="space-y-4 p-4">
            <h2 className={SECTION_HEADING_CLASS}>Travel advance</h2>
            <label className="flex items-center gap-2 text-[13px] text-navy">
              <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
              I need an advance before departure
            </label>
            {advance ? (
              <FieldLabel
                label="Amount"
                hint={
                  maxAdvance !== null
                    ? `at most ${money(maxAdvance)} — ${s.config.policy.advanceMaxPct}% of the estimate (§11.1)`
                    : "give an estimated cost first"
                }
              >
                <TextInput
                  type="number"
                  min={0}
                  step="1"
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                />
              </FieldLabel>
            ) : (
              <p className="text-[12.5px] text-grey-2">
                No advance is requested, so the Advance step is skipped and the trip goes straight to
                booking once it is approved.
              </p>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <div>
              <h2 className={SECTION_HEADING_CLASS}>Co-passengers</h2>
              <p className="text-[12.5px] text-grey">
                Only for people who share this booking. Reimbursement is personal, so a colleague who
                also needs to claim raises their own request.
              </p>
            </div>
            <PassengerRows
              rows={passengers}
              onChange={setPassengers}
              max={s.config.policy.maxPassengers}
            />
          </Card>
        </div>

        {/* Sticky so the entitlement stays visible while the long form scrolls —
            it is the reason this screen exists, and scrolling it away would put
            the policy back out of sight at the moment it matters. */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <EntitlementPanel
            entitlement={ent}
            card={card}
            tier={tier}
            bandNo={bandNo}
            cityName={city?.name ?? null}
          />

          {warnings.length > 0 && (
            <Card className="p-4">
              <h2 className={SECTION_HEADING_CLASS}>Worth knowing</h2>
              <ul className="mt-2 space-y-2">
                {warnings.map((w, i) => (
                  <li key={i} className="text-[12.5px] text-grey">
                    {w}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card className="p-4">
        {blockers.length > 0 && (
          <div className="mb-3">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-grey">
              Still needed before this can be submitted
            </div>
            <ul className="mt-1 space-y-1">
              {blockers.map((b, i) => (
                <li key={i} className="text-[12.5px] text-ryg-red">
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        {err && <p className="mb-3 break-words text-[12.5px] text-ryg-red">{err}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSubmit} disabled={!!busy || blockers.length > 0}>
            {busy === "submit"
              ? "Submitting…"
              : isReturned
                ? "Resubmit for approval"
                : "Submit for approval"}
          </Button>
          {/* Saving is deliberately unguarded by `blockers`: a draft is allowed to
              be as incomplete as its author likes, and the database says the same
              — the completeness CHECK on the trip is conditional on the status
              leaving draft. */}
          <Button variant="outline" onClick={onSave} disabled={!!busy}>
            {busy === "save" ? "Saving…" : isReturned ? "Save without resubmitting" : "Save draft"}
          </Button>
          {/* Only a NEVER-submitted draft can be thrown away. A returned trip has
              a number and a history, so it is cancelled instead — which
              fms_travel_delete_draft refuses to do for exactly that reason. */}
          {draft && !isReturned && (
            <button
              type="button"
              onClick={onDelete}
              disabled={!!busy}
              className="text-[12.5px] font-medium text-ryg-red hover:underline disabled:opacity-50"
            >
              {busy === "delete" ? "Deleting…" : "Throw this draft away"}
            </button>
          )}
        </div>
      </Card>

      <RequestMasterModal open={askCity} onClose={() => setAskCity(false)} type="city" />
    </div>
  );
}
