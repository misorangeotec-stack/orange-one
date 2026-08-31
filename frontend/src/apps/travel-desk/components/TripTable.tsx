import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../store";
import { STATUS_LABEL, money, tripRef } from "../lib/format";
import { tripDueIso } from "../lib/queues";
import type { QueueStep } from "../lib/queues";
import { STATUS_STEP, type Trip } from "../types";
import StatusPill from "./StatusPill";

/**
 * Every trip list in the module — All Trips, My Trips, Drafts and the reports —
 * is this one table with a different `rows`.
 *
 * ⚠ FLAT, NEVER GROUPED. Per the house rule, an FMS list view does not pass
 *   `groupBy`: the dimension you would band by is an ordinary column with its
 *   own sort and its own cascading filter. Banding by department would make the
 *   department name the PRIMARY sort, so a list ordered by departure date would
 *   only be ordered within each band and the trip leaving tomorrow could hide
 *   halfway down the page.
 *
 * ⚠ EVERY COLUMN SORTS AND FILTERS. `sortValue` is given wherever the rendered
 *   text is the wrong thing to order by — money that reads "₹18,000", a date
 *   that reads "23-Aug-2026", a status that reads as a sentence — because
 *   otherwise the table would sort ₹9 after ₹18,000 and December before March.
 */
export default function TripTable({
  trips,
  rowsLabel = "trips",
  emptyTitle,
  emptyMessage,
  exportName,
  showDue = true,
}: {
  trips: Trip[];
  rowsLabel?: string;
  emptyTitle: string;
  emptyMessage: string;
  exportName: string;
  /** Off for Drafts — a draft is at no step, so every due cell would be a dash. */
  showDue?: boolean;
}) {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const { departmentById } = useDirectory();

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const cityName = (id: string | null) => s.cityById(id)?.name ?? "—";
    const purposeName = (id: string | null) =>
      s.purposes.find((p) => p.id === id)?.name ?? "—";
    const dueOf = (t: Trip): string | null => {
      const step = STATUS_STEP[t.status] as QueueStep | undefined;
      return step ? tripDueIso(t, step, s.stepSla) : null;
    };

    const cols: QueueColumn<Trip>[] = [
      {
        key: "ref",
        header: "Trip",
        alwaysVisible: true,
        cell: (t) => (
          <Link
            to={`/travel-desk/trips/${t.id}`}
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
            {tripRef(t.tripNo, t.travellerName)}
          </Link>
        ),
        sortValue: (t) => t.tripNo ?? `zzz-${t.createdAt}`,
        filter: { kind: "text", get: (t) => tripRef(t.tripNo, t.travellerName) },
        tdClassName: "whitespace-nowrap",
        exportValue: (t) => t.tripNo ?? "(draft)",
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
        defaultHidden: true,
      },
      {
        key: "purpose",
        header: "Purpose",
        cell: (t) => purposeName(t.purposeId),
        sortValue: (t) => purposeName(t.purposeId),
        filter: { kind: "select", get: (t) => purposeName(t.purposeId) },
      },
      {
        key: "destination",
        header: "Destination",
        cell: (t) => cityName(t.destinationCityId),
        sortValue: (t) => cityName(t.destinationCityId),
        filter: { kind: "select", get: (t) => cityName(t.destinationCityId) },
      },
      {
        key: "departure",
        header: "Departure",
        cell: (t) => (t.plannedDepartureDate ? formatDateDMY(t.plannedDepartureDate) : "—"),
        // ⚠ ISO, not the rendered text. Sorting "23-Aug-2026" as a string puts
        //   April before March and every 1st before every 2nd of the month before.
        sortValue: (t) => t.plannedDepartureDate ?? "",
        filter: { kind: "date", get: (t) => t.plannedDepartureDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "return",
        header: "Return",
        cell: (t) =>
          t.actualReturnDate
            ? formatDateDMY(t.actualReturnDate)
            : t.plannedReturnDate
              ? formatDateDMY(t.plannedReturnDate)
              : "—",
        sortValue: (t) => t.actualReturnDate ?? t.plannedReturnDate ?? "",
        filter: { kind: "date", get: (t) => t.actualReturnDate ?? t.plannedReturnDate ?? "" },
        tdClassName: "whitespace-nowrap",
        defaultHidden: true,
      },
      {
        key: "status",
        header: "Status",
        cell: (t) => <StatusPill status={t.status} />,
        sortValue: (t) => STATUS_LABEL[t.status],
        filter: { kind: "select", get: (t) => STATUS_LABEL[t.status] },
      },
      {
        key: "category",
        header: "Category",
        cell: (t) =>
          t.snapTravelCategory ? `${t.snapTravelCategory} · Band ${t.snapBandNo ?? "—"}` : "—",
        sortValue: (t) => t.snapBandNo ?? 0,
        filter: { kind: "select", get: (t) => t.snapTravelCategory ?? "—" },
        defaultHidden: true,
      },
      {
        key: "estimate",
        header: "Estimate",
        align: "right",
        cell: (t) => money(t.estimatedCost),
        sortValue: (t) => t.estimatedCost ?? 0,
        filter: { kind: "number", get: (t) => t.estimatedCost ?? 0 },
        exportValue: (t) => t.estimatedCost ?? 0,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "advance",
        header: "Advance",
        align: "right",
        cell: (t) => money(t.advancePaidAmount ?? t.advanceApprovedAmount ?? t.advanceRequestedAmount),
        sortValue: (t) => t.advancePaidAmount ?? t.advanceApprovedAmount ?? t.advanceRequestedAmount ?? 0,
        filter: {
          kind: "number",
          get: (t) => t.advancePaidAmount ?? t.advanceApprovedAmount ?? t.advanceRequestedAmount ?? 0,
        },
        exportValue: (t) =>
          t.advancePaidAmount ?? t.advanceApprovedAmount ?? t.advanceRequestedAmount ?? 0,
        tdClassName: "whitespace-nowrap",
        defaultHidden: true,
      },
      {
        key: "raisedBy",
        header: "Raised by",
        cell: (t) => personById(t.raisedBy)?.name ?? "—",
        sortValue: (t) => personById(t.raisedBy)?.name ?? "",
        filter: { kind: "select", get: (t) => personById(t.raisedBy)?.name ?? "—" },
        defaultHidden: true,
      },
    ];

    if (showDue) {
      cols.push({
        key: "due",
        header: "Due",
        cell: (t) => <DueCell dueIso={dueOf(t)} />,
        sortValue: (t) => dueOf(t) ?? "9999",
        filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
        tdClassName: "whitespace-nowrap",
        exportValue: (t) => dueOf(t) ?? "",
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.purposes, s.stepSla, showDue]);

  return (
    <QueueTable
      rows={trips}
      rowKey={(t) => t.id}
      columns={columns}
      rowsLabel={rowsLabel}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
      loading={s.isLoading}
      initialSort={{ key: showDue ? "due" : "departure", dir: "asc" }}
      exportName={exportName}
      exportNotes={[
        "Every figure is in Indian Rupees, as full figures — the Domestic Travel Policy forbids lakh/crore abbreviation.",
        "Band and travel category are the values FROZEN when the trip was submitted, not the traveller's band today.",
      ]}
      columnPicker={{ storageKey: `travel-trips-${exportName}` }}
    />
  );
}
