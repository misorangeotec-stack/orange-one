import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../store";
import { money, LEG_LABEL } from "../lib/format";
import TicketCapture from "./TicketCapture";
import { uploadTravelDoc, travelDocUrl, type TicketReading } from "../data/travelBookingWrites";
import type { LegKind, LegDirection, Trip, TripLeg, TripLegInput } from "../types";

/**
 * What was actually booked, one row per flight, train, bus, cab or hotel.
 *
 * ⚠ ONE TRIP, MANY LEGS — deliberately not the source PRD's "one travel service
 *   per requisition". A Mumbai visit is a flight out, three nights in a hotel and
 *   a train back; filing that as three requisitions means three approvals, three
 *   numbers and three claims for one journey, and nothing can then answer what
 *   the trip cost.
 *
 * ⚠ THE NET COST IS READ, NEVER COMPUTED HERE. `netCost` is a generated column —
 *   ticket + other − refund — so the row on screen, the trip's booking total and
 *   the settlement all read the same arithmetic from the same place.
 */

const KIND_OPTIONS: { value: LegKind; label: string }[] = [
  { value: "flight", label: "Flight" },
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
  { value: "cab", label: "Cab" },
  { value: "hotel", label: "Hotel" },
];

const DIRECTION_OPTIONS: { value: LegDirection; label: string }[] = [
  { value: "outbound", label: "Outbound" },
  { value: "return", label: "Return" },
  { value: "local", label: "Local / stay" },
];

const emptyLeg = (kind: LegKind = "flight"): TripLegInput => ({
  kind,
  direction: kind === "hotel" ? "local" : "outbound",
  fromCityId: null,
  toCityId: null,
  startOn: null,
  startTime: null,
  endOn: null,
  endTime: null,
  airlineId: null,
  hotelId: null,
  busOperatorId: null,
  carrierOther: null,
  bookingRef: null,
  travelClass: null,
  ticketCost: null,
  otherCharges: null,
  refundAmount: null,
  docPath: null,
  notes: null,
});

const toInput = (l: TripLeg): TripLegInput => ({
  kind: l.kind,
  direction: l.direction,
  fromCityId: l.fromCityId,
  toCityId: l.toCityId,
  startOn: l.startOn,
  startTime: l.startTime,
  endOn: l.endOn,
  endTime: l.endTime,
  airlineId: l.airlineId,
  hotelId: l.hotelId,
  busOperatorId: l.busOperatorId,
  carrierOther: l.carrierOther,
  bookingRef: l.bookingRef,
  travelClass: l.travelClass,
  ticketCost: l.ticketCost,
  otherCharges: l.otherCharges,
  refundAmount: l.refundAmount,
  docPath: l.docPath,
  notes: l.notes,
});

export default function LegRows({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const legs = s.legsOf(trip.id);

  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<TripLegInput>(emptyLeg());
  const [pending, setPending] = useState<File | null>(null);
  const [reading, setReading] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const editable =
    s.canActOn("booking", trip) &&
    !["draft", "closed", "cancelled", "rejected"].includes(trip.status);

  const cityOptions = useMemo(
    () =>
      s.cities
        .filter((c) => c.active)
        .map((c) => ({ value: c.id, label: c.name, sublabel: `Tier ${c.tier}` })),
    [s.cities],
  );
  const airlineOptions = useMemo(
    () => s.airlines.filter((a) => a.active).map((a) => ({ value: a.id, label: a.name })),
    [s.airlines],
  );
  const hotelOptions = useMemo(
    () => s.hotels.filter((h) => h.active).map((h) => ({ value: h.id, label: h.name })),
    [s.hotels],
  );
  const busOptions = useMemo(
    () => s.busOperators.filter((b) => b.active).map((b) => ({ value: b.id, label: b.name })),
    [s.busOperators],
  );

  const set = (patch: Partial<TripLegInput>) => setForm((f) => ({ ...f, ...patch }));

  const open = (leg?: TripLeg) => {
    setErr(null);
    setPending(null);
    setReading(null);
    if (leg) {
      setForm(toInput(leg));
      setEditing(leg.id);
    } else {
      setForm(emptyLeg());
      setEditing("new");
    }
  };

  /**
   * Fold what the extractor read into the form.
   *
   * ⚠ IT ONLY FILLS WHAT IS EMPTY — except for the two fields a reader is
   *   plainly asking to be replaced. A booker who has already typed the fare and
   *   then reads the PDF to catch the taxes should not have their figure
   *   overwritten by a worse one.
   *
   * ⚠ CITY NAMES ARE MATCHED, NOT CREATED. The extractor returns "Ahmedabad" as
   *   text; a city carries a TIER, and the tier prices the hotel cap and the
   *   conveyance cap. A city invented from a ticket would be an unpriceable
   *   trip, so an unmatched name is simply left for the booker to pick.
   */
  const applyReading = (r: TicketReading) => {
    setReading(r as unknown as Record<string, unknown>);
    const cityId = (name: string): string | null => {
      const t = name.trim().toLowerCase();
      if (!t) return null;
      return s.cities.find((c) => c.active && c.name.toLowerCase() === t)?.id ?? null;
    };
    /**
     * Match a carrier the document names against the master list.
     *
     * ⚠ IT HAS TO WORK IN BOTH DIRECTIONS. A ticket says "INDIGO AIRLINES" or
     *   "Air India Express Ltd"; the master says "IndiGo" and "Air India
     *   Express". Testing only `master.includes(extracted)` fails exactly when
     *   the document is more verbose than the master — which is nearly always,
     *   and is how a perfectly good read came back "not listed".
     *
     * ⚠ THE LONGEST MATCH WINS. "Air India Express" and "Air India" both sit
     *   inside a ticket that says "Air India Express"; picking the first would
     *   book an Express flight against the wrong carrier.
     */
    const matchMaster = (
      name: string,
      list: { id: string; name: string; active: boolean }[],
    ): string | null => {
      const t = name.trim().toLowerCase();
      if (!t) return null;
      const live = list.filter((x) => x.active);
      const exact = live.find((x) => x.name.trim().toLowerCase() === t);
      if (exact) return exact.id;
      const both = live
        .filter((x) => {
          const m = x.name.trim().toLowerCase();
          return m.length > 2 && (t.includes(m) || m.includes(t));
        })
        .sort((a, b) => b.name.length - a.name.length);
      return both[0]?.id ?? null;
    };

    setForm((f) => {
      const kind = (r.kind || f.kind) as LegKind;
      const matchedCarrier =
        kind === "flight"
          ? matchMaster(r.carrier, s.airlines)
          : kind === "hotel"
            ? matchMaster(r.carrier, s.hotels)
            : kind === "bus"
              ? matchMaster(r.carrier, s.busOperators)
              : null;
      return {
        ...f,
        kind,
        direction: kind === "hotel" ? "local" : f.direction,
        fromCityId: f.fromCityId ?? cityId(r.fromCity),
        toCityId: f.toCityId ?? cityId(r.toCity),
        startOn: f.startOn ?? (r.startDate || null),
        startTime: f.startTime ?? (r.startTime || null),
        endOn: f.endOn ?? (r.endDate || null),
        endTime: f.endTime ?? (r.endTime || null),
        airlineId: f.airlineId ?? (kind === "flight" ? matchedCarrier : null),
        hotelId: f.hotelId ?? (kind === "hotel" ? matchedCarrier : null),
        busOperatorId: f.busOperatorId ?? (kind === "bus" ? matchedCarrier : null),
        // A carrier the master does not know still gets recorded, as text — and
        // the form below shows that box whenever nothing is picked, so it is
        // never written invisibly.
        carrierOther: f.carrierOther ?? (matchedCarrier ? null : r.carrier || null),
        bookingRef: f.bookingRef ?? (r.bookingRef || null),
        travelClass: f.travelClass ?? (r.travelClass || null),
        ticketCost: f.ticketCost ?? r.ticketCost,
        otherCharges: f.otherCharges ?? r.otherCharges,
      };
    });
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      let docPath = form.docPath;
      if (pending) {
        docPath = await uploadTravelDoc(trip.id, form.kind === "hotel" ? "hotel" : "ticket", pending);
      }
      await s.saveLeg(
        trip.id,
        { ...form, docPath, aiExtracted: reading },
        editing === "new" ? null : editing,
      );
      setEditing(null);
      setPending(null);
      setReading(null);
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

  const carrierName = (l: TripLeg): string =>
    s.airlines.find((a) => a.id === l.airlineId)?.name ??
    s.hotels.find((h) => h.id === l.hotelId)?.name ??
    s.busOperators.find((b) => b.id === l.busOperatorId)?.name ??
    l.carrierOther ??
    "—";

  const total = legs.reduce((sum, l) => sum + l.netCost, 0);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-navy">
          What was booked
        </h2>
        <span className="text-[12.5px] text-grey">
          {legs.length
            ? `${legs.length} ${legs.length === 1 ? "booking" : "bookings"} · ${money(total)}`
            : "nothing yet"}
        </span>
      </div>

      {legs.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-grey">
                <th className="py-1.5 pr-3">Kind</th>
                <th className="py-1.5 pr-3">Carrier / hotel</th>
                <th className="py-1.5 pr-3">Route</th>
                <th className="py-1.5 pr-3">Dates</th>
                <th className="py-1.5 pr-3">Ref</th>
                <th className="py-1.5 pr-3 text-right">Ticket</th>
                <th className="py-1.5 pr-3 text-right">Other</th>
                <th className="py-1.5 pr-3 text-right">Refund</th>
                <th className="py-1.5 pr-3 text-right">Net</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {legs.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-b-0">
                  <td className="py-1.5 pr-3">
                    {LEG_LABEL[l.kind]}
                    {l.cancelledAt && (
                      <span className="ml-1.5 rounded-pill bg-[#FDECEC] px-1.5 py-0.5 text-[10px] font-semibold text-ryg-red">
                        {l.cancelReasonKind === "business" ? "Cancelled · business" : "Cancelled"}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{carrierName(l)}</td>
                  <td className="py-1.5 pr-3 text-grey">
                    {[s.cityById(l.fromCityId)?.name, s.cityById(l.toCityId)?.name]
                      .filter(Boolean)
                      .join(" → ") || "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-grey">
                    {l.startOn ? formatDateDMY(l.startOn) : "—"}
                    {l.endOn && l.endOn !== l.startOn ? ` – ${formatDateDMY(l.endOn)}` : ""}
                  </td>
                  <td className="py-1.5 pr-3 text-grey">{l.bookingRef ?? "—"}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right">{money(l.ticketCost)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right">{money(l.otherCharges)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                    {l.refundAmount ? (
                      <span className="text-ryg-green">−{money(l.refundAmount)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold text-navy">
                    {money(l.netCost)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {l.docPath && (
                      <button
                        type="button"
                        onClick={() => openDoc(l.docPath as string)}
                        className="mr-2 text-[12px] font-medium text-navy hover:text-orange hover:underline"
                      >
                        Document
                      </button>
                    )}
                    {editable && (
                      <>
                        <button
                          type="button"
                          onClick={() => open(l)}
                          className="mr-2 text-[12px] font-medium text-navy hover:text-orange hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => s.removeLeg(l.id).catch((e) => setErr((e as Error).message))}
                          className="text-[12px] font-medium text-ryg-red hover:underline"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}

      {editable && editing === null && (
        <div className="mt-3">
          <Button variant="outline" onClick={() => open()}>
            Add a booking
          </Button>
        </div>
      )}

      {editing !== null && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <TicketCapture onRead={applyReading} onFile={setPending} disabled={busy} />

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <FieldLabel label="Kind" required>
              <Select
                value={form.kind}
                onChange={(e) =>
                  set({
                    kind: e.target.value as LegKind,
                    direction: e.target.value === "hotel" ? "local" : form.direction,
                  })
                }
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </FieldLabel>

            <FieldLabel label="Direction">
              <Select
                value={form.direction}
                onChange={(e) => set({ direction: e.target.value as LegDirection })}
              >
                {DIRECTION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </FieldLabel>

            <FieldLabel
              label={form.kind === "hotel" ? "Hotel" : form.kind === "flight" ? "Airline" : form.kind === "bus" ? "Operator" : "Carrier"}
            >
              {form.kind === "hotel" ? (
                <Combobox
                  value={form.hotelId ?? ""}
                  onChange={(v) => set({ hotelId: v || null })}
                  options={hotelOptions}
                  clearable
                  placeholder="— Not listed —"
                />
              ) : form.kind === "flight" ? (
                <Combobox
                  value={form.airlineId ?? ""}
                  onChange={(v) => set({ airlineId: v || null })}
                  options={airlineOptions}
                  clearable
                  placeholder="— Not listed —"
                />
              ) : form.kind === "bus" ? (
                <Combobox
                  value={form.busOperatorId ?? ""}
                  onChange={(v) => set({ busOperatorId: v || null })}
                  options={busOptions}
                  clearable
                  placeholder="— Not listed —"
                />
              ) : (
                <TextInput
                  value={form.carrierOther ?? ""}
                  onChange={(e) => set({ carrierOther: e.target.value || null })}
                />
              )}
              {/*
                ⚠ THE FALLBACK BOX APPEARS WHENEVER NOTHING IS PICKED, and it is
                  not a nicety. The extractor writes an unmatched carrier into
                  `carrierOther`; without somewhere to render it the name was
                  saved and never shown, so a booking with a real airline on the
                  ticket displayed as "—" and nobody could correct it. It also
                  gives a booker a way to record a carrier that is genuinely not
                  on the master, without waiting for a master request.
              */}
              {(form.kind === "flight" || form.kind === "hotel" || form.kind === "bus") &&
                !form.airlineId &&
                !form.hotelId &&
                !form.busOperatorId && (
                  <TextInput
                    className="mt-1.5"
                    value={form.carrierOther ?? ""}
                    onChange={(e) => set({ carrierOther: e.target.value || null })}
                    placeholder="Not on the list — type the name as the document has it"
                  />
                )}
            </FieldLabel>

            {form.kind !== "hotel" && (
              <FieldLabel label="From">
                <Combobox
                  value={form.fromCityId ?? ""}
                  onChange={(v) => set({ fromCityId: v || null })}
                  options={cityOptions}
                  clearable
                  placeholder="— Choose —"
                />
              </FieldLabel>
            )}
            <FieldLabel label={form.kind === "hotel" ? "City stayed in" : "To"}>
              <Combobox
                value={form.toCityId ?? ""}
                onChange={(v) => set({ toCityId: v || null })}
                options={cityOptions}
                clearable
                placeholder="— Choose —"
              />
            </FieldLabel>

            <FieldLabel label={form.kind === "hotel" ? "Check-in" : "Departs"}>
              <TextInput
                type="date"
                value={form.startOn ?? ""}
                onChange={(e) => set({ startOn: e.target.value || null })}
              />
            </FieldLabel>
            <FieldLabel label={form.kind === "hotel" ? "Check-out" : "Arrives"}>
              <TextInput
                type="date"
                value={form.endOn ?? ""}
                onChange={(e) => set({ endOn: e.target.value || null })}
                min={form.startOn ?? undefined}
              />
            </FieldLabel>

            {form.kind !== "hotel" && (
              <>
                <FieldLabel label="Departure time">
                  <TextInput
                    type="time"
                    value={form.startTime ?? ""}
                    onChange={(e) => set({ startTime: e.target.value || null })}
                  />
                </FieldLabel>
                <FieldLabel label="Arrival time">
                  <TextInput
                    type="time"
                    value={form.endTime ?? ""}
                    onChange={(e) => set({ endTime: e.target.value || null })}
                  />
                </FieldLabel>
              </>
            )}

            <FieldLabel label="PNR / confirmation">
              <TextInput
                value={form.bookingRef ?? ""}
                onChange={(e) => set({ bookingRef: e.target.value || null })}
              />
            </FieldLabel>
            <FieldLabel label="Class / room type">
              <TextInput
                value={form.travelClass ?? ""}
                onChange={(e) => set({ travelClass: e.target.value || null })}
              />
            </FieldLabel>

            <FieldLabel label="Ticket / room cost">
              <TextInput
                type="number"
                min={0}
                step="1"
                value={form.ticketCost ?? ""}
                onChange={(e) =>
                  set({ ticketCost: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </FieldLabel>
            <FieldLabel label="Taxes & fees">
              <TextInput
                type="number"
                min={0}
                step="1"
                value={form.otherCharges ?? ""}
                onChange={(e) =>
                  set({ otherCharges: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </FieldLabel>
            <FieldLabel label="Refund received" hint="on a cancellation, once it lands">
              <TextInput
                type="number"
                min={0}
                step="1"
                value={form.refundAmount ?? ""}
                onChange={(e) =>
                  set({ refundAmount: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </FieldLabel>
          </div>

          <div className="mt-3">
            <FieldLabel label="Notes">
              <TextArea
                rows={1}
                value={form.notes ?? ""}
                onChange={(e) => set({ notes: e.target.value || null })}
              />
            </FieldLabel>
          </div>

          <p className="mt-2 text-[12px] text-grey-2">
            Net for this booking:{" "}
            <strong className="text-navy">
              {money((form.ticketCost ?? 0) + (form.otherCharges ?? 0) - (form.refundAmount ?? 0))}
            </strong>{" "}
            — the database computes it the same way, so this is a preview, not the figure that gets
            stored.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : editing === "new" ? "Add this booking" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
