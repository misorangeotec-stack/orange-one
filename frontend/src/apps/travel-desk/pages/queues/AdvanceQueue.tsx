import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import Button from "@/shared/components/ui/Button";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../../store";
import { money } from "../../lib/format";
import { tripDueIso } from "../../lib/queues";
import type { Trip } from "../../types";

/**
 * Trips waiting on money before they leave.
 *
 * ⚠ THIS QUEUE IS DUE BEFORE ITS TRIPS DEPART, NOT AFTER SOMETHING COMPLETED —
 *   the only step in the module measured that way. §11.1 wants the advance
 *   credited before the employee travels; money that lands afterwards has missed
 *   the point entirely. `TRIGGER_STEPS` marks it `before: true` and the due date
 *   counts BACKWARDS from the planned departure with `addWorkingDaysSigned`, so
 *   a row here goes red while there is still time to act rather than once the
 *   traveller has already gone.
 *
 * ⚠ THE OUTSTANDING COLUMN IS THE §11.2 WARNING. It shows what the traveller
 *   already owes on OTHER trips, so Finance can see the refusal coming instead
 *   of meeting it on the Save button.
 */
export default function AdvanceQueue() {
  const s = useTravelStore();

  const rows = useMemo(
    () => s.trips.filter((t) => t.status === "awaiting_advance" && !t.advanceSkipped),
    [s.trips],
  );

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const dueOf = (t: Trip) => tripDueIso(t, "advance", s.stepSla);
    const owingOf = (t: Trip) => s.outstandingAdvanceFor(t.travellerId, t.id);

    return [
      {
        key: "ref",
        header: "Trip",
        alwaysVisible: true,
        cell: (t) => (
          <Link to={`/travel-desk/trips/${t.id}`} className="font-semibold text-navy hover:text-orange hover:underline">
            {t.tripNo ?? t.travellerName}
          </Link>
        ),
        sortValue: (t) => t.tripNo ?? "",
        filter: { kind: "text", get: (t) => t.tripNo ?? t.travellerName },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "traveller",
        header: "Traveller",
        cell: (t) => t.travellerName,
        sortValue: (t) => t.travellerName,
        filter: { kind: "select", get: (t) => t.travellerName },
      },
      {
        key: "destination",
        header: "Destination",
        cell: (t) => s.cityById(t.destinationCityId)?.name ?? "—",
        sortValue: (t) => s.cityById(t.destinationCityId)?.name ?? "",
        filter: { kind: "select", get: (t) => s.cityById(t.destinationCityId)?.name ?? "—" },
      },
      {
        key: "departure",
        header: "Departs",
        cell: (t) => (t.plannedDepartureDate ? formatDateDMY(t.plannedDepartureDate) : "—"),
        sortValue: (t) => t.plannedDepartureDate ?? "",
        filter: { kind: "date", get: (t) => t.plannedDepartureDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "requested",
        header: "Requested",
        align: "right",
        cell: (t) => money(t.advanceRequestedAmount),
        sortValue: (t) => t.advanceRequestedAmount ?? 0,
        filter: { kind: "number", get: (t) => t.advanceRequestedAmount ?? 0 },
        exportValue: (t) => t.advanceRequestedAmount ?? 0,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "ceiling",
        header: "§11.1 ceiling",
        align: "right",
        cell: (t) => money(s.advanceCeiling(t)),
        sortValue: (t) => s.advanceCeiling(t) ?? 0,
        filter: { kind: "number", get: (t) => s.advanceCeiling(t) ?? 0 },
        exportValue: (t) => s.advanceCeiling(t) ?? 0,
        tdClassName: "whitespace-nowrap",
        defaultHidden: true,
      },
      {
        key: "agreed",
        header: "Agreed",
        align: "right",
        cell: (t) => money(t.advanceApprovedAmount),
        sortValue: (t) => t.advanceApprovedAmount ?? 0,
        filter: { kind: "select", get: (t) => (t.advanceApprovedAmount === null ? "Not yet" : "Agreed") },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "owing",
        header: "Already owes",
        align: "right",
        cell: (t) => {
          const o = owingOf(t);
          return o > 0 ? <span className="font-semibold text-ryg-red">{money(o)}</span> : <span className="text-grey-2">—</span>;
        },
        sortValue: (t) => owingOf(t),
        filter: { kind: "select", get: (t) => (owingOf(t) > 0 ? "Blocked by §11.2" : "Clear") },
        exportValue: (t) => owingOf(t),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "due",
        header: "Due",
        cell: (t) => <DueCell dueIso={dueOf(t)} />,
        sortValue: (t) => dueOf(t) ?? "9999",
        filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
        tdClassName: "whitespace-nowrap",
        exportValue: (t) => dueOf(t) ?? "",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.stepSla, s.trips, s.config.policy.advanceMaxPct]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Travel Advance</h1>
        <p className="text-[13px] text-grey">
          Money that has to reach the traveller before they leave (§11.1). The due date on this step
          counts <strong>backwards</strong> from the departure date — a row goes red while there is
          still time to act.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button variant={s.canActOn("advance", t) ? "primary" : "outline"} className="h-7 px-2.5 text-[12px]">
              {s.canActOn("advance", t) ? "Open & pay" : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="trips"
        emptyTitle="No advance is waiting"
        emptyMessage="Most trips draw no advance at all — those skip this step entirely."
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="Travel_Advances_Due"
        columnPicker={{ storageKey: "travel-queue-advance" }}
      />
    </div>
  );
}
