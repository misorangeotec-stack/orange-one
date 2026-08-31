import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { formatDateDMY } from "@/shared/lib/date";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { money, LEG_LABEL, STATUS_LABEL } from "../../lib/format";
import StatusPill from "../../components/StatusPill";
import type { Trip } from "../../types";

/**
 * Who is away, and when.
 *
 * ⚠ THIS IS A FILTER, NOT A QUEUE, AND THAT IS WHY THERE IS NO `travel` STEP.
 *   The journey happening is not work anybody owes — a step no human can
 *   complete would be a queue row owed by nobody, for ever. "Upcoming travel"
 *   falls straight out of `status = booked` and a departure date that has not
 *   passed, which is exactly what this reads.
 *
 * ⚠ A CANCELLED-PENDING-CLAIM TRIP IS NOT UPCOMING. Its journey is off; only its
 *   money is still open. It belongs on Cancelled Travel and on Outstanding
 *   Advances, never here — a manager scanning this list is asking who is out of
 *   the office.
 */
export default function UpcomingTravel() {
  const s = useTravelStore();
  const { departmentById } = useDirectory();
  const today = todayLocalIso();

  const rows = useMemo(
    () =>
      s.trips
        .filter(
          (t) =>
            t.status === "booked" &&
            !!t.plannedDepartureDate &&
            (t.actualReturnDate ?? t.plannedReturnDate ?? t.plannedDepartureDate) >= today,
        )
        .sort((a, b) => (a.plannedDepartureDate ?? "").localeCompare(b.plannedDepartureDate ?? "")),
    [s.trips, today],
  );

  const daysAway = (t: Trip): number | null => {
    if (!t.plannedDepartureDate) return null;
    return Math.round(
      (new Date(t.plannedDepartureDate).getTime() - new Date(today).getTime()) / 86_400_000,
    );
  };

  const leaving7 = rows.filter((t) => (daysAway(t) ?? 99) <= 7 && (daysAway(t) ?? -1) >= 0);
  const away = rows.filter((t) => (daysAway(t) ?? 1) <= 0);
  const spend = rows.reduce((sum, t) => sum + (t.bookingTotal ?? 0), 0);

  const tiles: KpiTile[] = [
    { key: "trips", label: "Trips ahead", value: rows.length },
    { key: "week", label: "Leaving within 7 days", value: leaving7.length },
    { key: "away", label: "Away now", value: away.length },
    { key: "spend", label: "Booked", value: money(spend) },
  ];

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const legsText = (t: Trip): string => {
      const ls = s.legsOf(t.id);
      if (!ls.length) return "—";
      const counts = new Map<string, number>();
      for (const l of ls) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
      return [...counts.entries()]
        .map(([k, n]) => (n > 1 ? `${n} × ${LEG_LABEL[k as keyof typeof LEG_LABEL]}` : LEG_LABEL[k as keyof typeof LEG_LABEL]))
        .join(", ");
    };

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
        key: "department",
        header: "Department",
        cell: (t) => departmentById(t.snapDepartmentId)?.name ?? "—",
        sortValue: (t) => departmentById(t.snapDepartmentId)?.name ?? "",
        filter: { kind: "select", get: (t) => departmentById(t.snapDepartmentId)?.name ?? "—" },
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
        key: "returns",
        header: "Returns",
        cell: (t) => (t.plannedReturnDate ? formatDateDMY(t.plannedReturnDate) : "—"),
        sortValue: (t) => t.plannedReturnDate ?? "",
        filter: { kind: "date", get: (t) => t.plannedReturnDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "in",
        header: "In",
        align: "right",
        cell: (t) => {
          const d = daysAway(t);
          if (d === null) return <span className="text-grey-2">—</span>;
          if (d < 0) return <span className="font-semibold text-orange">away</span>;
          if (d === 0) return <span className="font-semibold text-orange">today</span>;
          return <span className={d <= 7 ? "font-semibold text-navy" : "text-grey"}>{d}d</span>;
        },
        sortValue: (t) => daysAway(t) ?? 9999,
        filter: { kind: "number", get: (t) => daysAway(t) ?? 0 },
        exportValue: (t) => daysAway(t) ?? "",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "legs",
        header: "Arranged",
        cell: (t) => legsText(t),
        sortValue: (t) => s.legsOf(t.id).length,
        filter: { kind: "select", get: (t) => legsText(t) },
      },
      {
        key: "cost",
        header: "Booked",
        align: "right",
        cell: (t) => money(t.bookingTotal),
        sortValue: (t) => t.bookingTotal ?? 0,
        exportValue: (t) => t.bookingTotal ?? 0,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "advance",
        header: "Advance",
        align: "right",
        cell: (t) => money(t.advancePaidAmount),
        sortValue: (t) => t.advancePaidAmount ?? 0,
        exportValue: (t) => t.advancePaidAmount ?? 0,
        tdClassName: "whitespace-nowrap",
        defaultHidden: true,
      },
      {
        key: "status",
        header: "Status",
        cell: (t) => <StatusPill status={t.status} />,
        sortValue: (t) => STATUS_LABEL[t.status],
        filter: { kind: "select", get: (t) => STATUS_LABEL[t.status] },
        defaultHidden: true,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.legs, today]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Upcoming travel</h1>
        <p className="max-w-3xl text-[13px] text-grey">
          Booked trips that have not finished yet — who is about to be away, where, and what it has
          cost so far.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        rowsLabel="trips"
        emptyTitle="Nobody is travelling"
        emptyMessage="No booked trip is still to happen. A trip appears here once the desk marks it booked."
        loading={s.isLoading}
        initialSort={{ key: "departure", dir: "asc" }}
        exportName="Travel_Upcoming"
        exportNotes={[
          "Booked trips whose return date has not passed. A cancelled trip appears on Cancelled Travel instead, even where its money is still open.",
          "“Booked” is the sum of every leg's net cost — ticket plus taxes and fees, less any refund.",
        ]}
        columnPicker={{ storageKey: "travel-upcoming" }}
      />
    </div>
  );
}
