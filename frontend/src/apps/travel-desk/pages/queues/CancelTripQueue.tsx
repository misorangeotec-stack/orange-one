import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import Button from "@/shared/components/ui/Button";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useTravelStore } from "../../store";
import { LEG_LABEL, money } from "../../lib/format";
import { tripDueIso } from "../../lib/queues";
import type { Trip } from "../../types";

/**
 * The Cancel Trip bucket (since 2026-10-23).
 *
 * Every "Cancel booking" the raiser submitted lands here with the tickets and
 * the reason. Whoever owns Cancel Trip in Settings opens the trip, uploads the
 * credit note and types its number and amount — only then are the tickets
 * cancelled and the row leaves this list.
 */
export default function CancelTripQueue() {
  const s = useTravelStore();
  const personById = useOrgPersonById();

  const rows = useMemo(() => s.trips.filter((t) => t.status === "cancel_pending"), [s.trips]);

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const req = (t: Trip) => s.cancellationsOf(t.id).find((c) => c.status === "requested") ?? null;
    const tickets = (t: Trip): string => {
      const r = req(t);
      if (!r) return "—";
      if (r.wholeTrip) return "Whole trip";
      return r.legIds
        .map((id) => s.legsOf(t.id).find((l) => l.id === id))
        .filter(Boolean)
        .map((l) => LEG_LABEL[l!.kind])
        .join(", ");
    };
    const value = (t: Trip): number => {
      const r = req(t);
      if (!r) return 0;
      return s
        .legsOf(t.id)
        .filter((l) => r.legIds.includes(l.id))
        .reduce((sum, l) => sum + l.ticketCost + l.otherCharges, 0);
    };
    const dueOf = (t: Trip) => tripDueIso(t, "cancel_trip", s.stepSla);

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
        key: "tickets",
        header: "Tickets",
        cell: (t) => tickets(t),
        sortValue: (t) => tickets(t),
        filter: { kind: "text", get: (t) => tickets(t) },
      },
      {
        key: "reason",
        header: "Reason",
        cell: (t) => req(t)?.reason ?? "—",
        sortValue: (t) => req(t)?.reason ?? "",
        filter: { kind: "text", get: (t) => req(t)?.reason ?? "" },
      },
      {
        key: "value",
        header: "Ticket value",
        cell: (t) => money(value(t)),
        sortValue: (t) => value(t),
        filter: { kind: "number", get: (t) => value(t) },
        exportValue: (t) => value(t),
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "askedBy",
        header: "Asked by",
        cell: (t) => personById(t.cancelRequestedBy)?.name ?? "—",
        sortValue: (t) => personById(t.cancelRequestedBy)?.name ?? "",
        filter: { kind: "select", get: (t) => personById(t.cancelRequestedBy)?.name ?? "—" },
      },
      {
        key: "askedOn",
        header: "Asked on",
        cell: (t) => (t.cancelRequestedAt ? formatDateDMY(t.cancelRequestedAt) : "—"),
        sortValue: (t) => t.cancelRequestedAt ?? "",
        filter: { kind: "date", get: (t) => t.cancelRequestedAt ?? "" },
        tdClassName: "whitespace-nowrap",
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
    // personById is rebuilt every render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.stepSla, s.trips, s.legs]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Cancel Trip</h1>
        <p className="text-[13px] text-grey">
          Bookings the raiser asked to cancel. Open each one, upload the credit note and enter its
          number and amount — the tickets are cancelled when you submit.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button
              variant={s.canActOn("cancel_trip", t) ? "primary" : "outline"}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.canActOn("cancel_trip", t) ? "Open & add credit note" : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="trips"
        emptyTitle="No cancellation waiting"
        emptyMessage="When someone clicks Cancel booking on a booked trip, it lands here until the credit note is filed."
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="Travel_Cancel_Trip"
        columnPicker={{ storageKey: "travel-queue-cancel-trip" }}
      />
    </div>
  );
}
