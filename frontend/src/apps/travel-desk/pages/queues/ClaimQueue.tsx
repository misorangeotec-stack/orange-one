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
 * Journeys that have happened and not yet been claimed for.
 *
 * ⚠ THE DUE DATE COMES FROM THE RETURN DATE, NOT FROM THE BOOKING. §11.1 gives
 *   five working days from return, and the journey ending is not a step anybody
 *   completes — so `ANCHOR_AT` reads `actualReturnDate ?? plannedReturnDate`
 *   directly. A trip whose return is still in the future therefore gets a FUTURE
 *   due date, which is why "upcoming travel" falls out of the same list instead
 *   of needing its own query.
 *
 * ⚠ A CANCELLED TRIP CAN BE IN HERE, AND IT SHOULD BE. `cancelled_pending_claim`
 *   is a journey that did not happen and money that did — a cancellation charge
 *   §4.1 makes reimbursable, or an advance that has to come back. Routing it
 *   straight to `cancelled` would take both out of every queue in the module.
 *
 * ⚠ THIS QUEUE IS OWED BY THE TRAVELLER, not by a desk. Everyone can see it —
 *   a manager chasing their own team is the point — but the action button only
 *   turns primary for the person who can actually file it.
 */
export default function ClaimQueue() {
  const s = useTravelStore();

  const rows = useMemo(
    () =>
      s.trips.filter(
        (t) => t.status === "booked" || t.status === "cancelled_pending_claim",
      ),
    [s.trips],
  );

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const dueOf = (t: Trip) => tripDueIso(t, "claim", s.stepSla);
    const advanceOf = (t: Trip) =>
      (t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0);

    return [
      {
        key: "ref",
        header: "Trip",
        alwaysVisible: true,
        cell: (t) => (
          <Link
            to={`/travel-desk/trips/${t.id}`}
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
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
        key: "state",
        header: "Journey",
        cell: (t) =>
          t.status === "cancelled_pending_claim" ? (
            <span className="font-semibold text-ryg-amber">Cancelled</span>
          ) : (
            <span className="text-grey-2">Travelled</span>
          ),
        sortValue: (t) => (t.status === "cancelled_pending_claim" ? "1" : "0"),
        filter: {
          kind: "select",
          get: (t) => (t.status === "cancelled_pending_claim" ? "Cancelled" : "Travelled"),
        },
      },
      {
        key: "returned",
        header: "Returned",
        cell: (t) => {
          const d = t.actualReturnDate ?? t.plannedReturnDate;
          return d ? (
            <>
              {formatDateDMY(d)}
              {/* Saying which one is being counted from matters: an estimate and
                  a fact look identical once formatted. */}
              {!t.actualReturnDate && <span className="ml-1 text-[11px] text-grey-2">planned</span>}
            </>
          ) : (
            "—"
          );
        },
        sortValue: (t) => t.actualReturnDate ?? t.plannedReturnDate ?? "",
        filter: { kind: "date", get: (t) => t.actualReturnDate ?? t.plannedReturnDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "booked",
        header: "Booked",
        cell: (t) => money(t.bookingTotal),
        sortValue: (t) => t.bookingTotal ?? 0,
        exportValue: (t) => t.bookingTotal ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "advance",
        header: "Advance out",
        cell: (t) => {
          const a = advanceOf(t);
          return a > 0 ? (
            <span className="font-semibold text-navy">{money(a)}</span>
          ) : (
            <span className="text-grey-2">—</span>
          );
        },
        sortValue: (t) => advanceOf(t),
        filter: { kind: "select", get: (t) => (advanceOf(t) > 0 ? "Advance to settle" : "None") },
        exportValue: (t) => advanceOf(t),
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "due",
        header: "Due",
        cell: (t) => <DueCell dueIso={dueOf(t)} />,
        sortValue: (t) => dueOf(t) ?? "9999",
        filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
        exportValue: (t) => dueOf(t) ?? "",
        tdClassName: "whitespace-nowrap",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.stepSla, s.trips]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Expense claims</h1>
        <p className="text-[13px] text-grey">
          Journeys waiting to be claimed for. §11.1 allows five working days from the return date,
          which is what the due column counts from — not from when the trip was booked.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button
              variant={s.canActOn("claim", t) ? "primary" : "outline"}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.canActOn("claim", t) ? "Open & claim" : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="trips"
        emptyTitle="Nothing waiting to be claimed"
        emptyMessage="A trip appears here once it is booked, and leaves once its claim is filed — even a claim of nothing, which still settles the allowance."
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="Travel_Claims_Due"
        columnPicker={{ storageKey: "travel-queue-claim" }}
      />
    </div>
  );
}
