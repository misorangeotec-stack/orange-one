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
 * The desk's own list — trips approved and waiting to be arranged, and trips
 * whose cancellation is waiting to be processed.
 *
 * ⚠ TWO SETS, ONE SCREEN, AND THEY ARE SEPARATED VISIBLY. Both sit at the
 *   `booking` step because both are the desk's work, so one queue would be
 *   honest about ownership and useless in practice: cancelling a booking is the
 *   opposite job from making one, and it is the urgent one — an airline refund
 *   window closes.
 */
export default function BookingQueue({ mode }: { mode: "book" | "cancel" }) {
  const s = useTravelStore();

  const wantStatus = mode === "cancel" ? "cancellation_requested" : "awaiting_booking";
  const rows = useMemo(() => s.trips.filter((t) => t.status === wantStatus), [s.trips, wantStatus]);

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const dueOf = (t: Trip) => tripDueIso(t, "booking", s.stepSla);
    const legCount = (t: Trip) => s.legsOf(t.id).length;
    const booked = (t: Trip) => s.legsOf(t.id).reduce((sum, l) => sum + l.netCost, 0);

    const base: QueueColumn<Trip>[] = [
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
        key: "band",
        header: "Entitlement",
        cell: (t) => t.snapTravelCategory ?? "—",
        sortValue: (t) => t.snapBandNo ?? 0,
        filter: { kind: "select", get: (t) => t.snapTravelCategory ?? "—" },
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
        key: "estimate",
        header: "Estimate",
        align: "right",
        cell: (t) => money(t.estimatedCost),
        sortValue: (t) => t.estimatedCost ?? 0,
        exportValue: (t) => t.estimatedCost ?? 0,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "bookings",
        header: "Booked",
        align: "right",
        cell: (t) =>
          legCount(t) ? (
            <span>
              {money(booked(t))}{" "}
              <span className="text-grey-2">
                ({legCount(t)} {legCount(t) === 1 ? "leg" : "legs"})
              </span>
            </span>
          ) : (
            <span className="text-grey-2">nothing yet</span>
          ),
        sortValue: (t) => booked(t),
        filter: { kind: "select", get: (t) => (legCount(t) ? "Started" : "Nothing yet") },
        exportValue: (t) => booked(t),
        tdClassName: "whitespace-nowrap",
      },
    ];

    if (mode === "cancel") {
      base.push({
        key: "why",
        header: "Reason given",
        cell: (t) => t.cancelReason ?? "—",
        sortValue: (t) => t.cancelReason ?? "",
        filter: { kind: "text", get: (t) => t.cancelReason ?? "" },
      });
    }

    base.push({
      key: "due",
      header: "Due",
      cell: (t) => <DueCell dueIso={dueOf(t)} />,
      sortValue: (t) => dueOf(t) ?? "9999",
      filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
      tdClassName: "whitespace-nowrap",
      exportValue: (t) => dueOf(t) ?? "",
    });

    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.stepSla, s.legs, mode]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">
          {mode === "cancel" ? "Cancellations" : "Booking"}
        </h1>
        <p className="max-w-3xl text-[13px] text-grey">
          {mode === "cancel"
            ? "Trips the traveller has asked to call off. Unwind the bookings, record what was refunded against each one, then decide — §4.1 makes an unrefunded charge reimbursable only when the reason is business."
            : "Approved trips waiting to be arranged. Open one to see the entitlement it was approved against before you book anything."}
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button
              variant={s.canActOn("booking", t) ? "primary" : "outline"}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.canActOn("booking", t) ? (mode === "cancel" ? "Open & decide" : "Open & book") : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="trips"
        emptyTitle={mode === "cancel" ? "No cancellations waiting" : "Nothing to book"}
        emptyMessage={
          mode === "cancel"
            ? "No traveller has asked for a booked trip to be called off."
            : "Every approved trip has been arranged."
        }
        loading={s.isLoading}
        initialSort={{ key: mode === "cancel" ? "due" : "departure", dir: "asc" }}
        exportName={mode === "cancel" ? "Travel_Cancellations" : "Travel_Bookings_Due"}
        columnPicker={{ storageKey: `travel-queue-booking-${mode}` }}
      />
    </div>
  );
}
