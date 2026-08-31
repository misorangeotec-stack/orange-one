import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { formatDateDMY } from "@/shared/lib/date";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { money, STATUS_LABEL } from "../../lib/format";
import { stillOwed } from "../../lib/advance";
import StatusPill from "../../components/StatusPill";
import type { Trip } from "../../types";

/**
 * Travel that did not happen, and what it cost anyway.
 *
 * ⚠ THE POINT OF THIS REPORT IS THE MONEY, NOT THE CANCELLATION. A trip called
 *   off after booking usually leaves something behind — an airline charge, a
 *   no-show hotel night, an advance already transferred — and every one of those
 *   falls out of the ordinary queues the moment the journey is off. This is the
 *   only screen that keeps them in view.
 *
 * ⚠ BUSINESS AND PERSONAL ARE SHOWN SEPARATELY BECAUSE §4.1 TREATS THEM
 *   DIFFERENTLY. A charge from a customer moving the meeting is reimbursable; a
 *   charge from the traveller changing their mind is theirs. Totalling the two
 *   together would produce a figure that answers nothing.
 */
export default function CancelledTravel() {
  const s = useTravelStore();
  const { departmentById } = useDirectory();

  const rows = useMemo(
    () =>
      s.trips.filter(
        (t) => t.status === "cancelled" || t.status === "cancelled_pending_claim",
      ),
    [s.trips],
  );

  /** The reason recorded on the legs — the trip itself carries only the words. */
  const kindOf = (t: Trip): "business" | "personal" | null =>
    s.legsOf(t.id).find((l) => l.cancelReasonKind)?.cancelReasonKind ?? null;

  const charges = (t: Trip) => s.legsOf(t.id).reduce((sum, l) => sum + l.netCost, 0);

  const businessCharges = rows
    .filter((t) => kindOf(t) === "business")
    .reduce((sum, t) => sum + charges(t), 0);
  const personalCharges = rows
    .filter((t) => kindOf(t) === "personal")
    .reduce((sum, t) => sum + charges(t), 0);
  const advanceOut = rows.reduce((sum, t) => sum + stillOwed(t), 0);
  const openCount = rows.filter((t) => t.status === "cancelled_pending_claim").length;

  const tiles: KpiTile[] = [
    { key: "count", label: "Cancelled trips", value: rows.length },
    {
      key: "open",
      label: "Still to settle",
      value: openCount,
      tone: openCount ? "red" : undefined,
    },
    { key: "biz", label: "Reimbursable charges", value: money(businessCharges) },
    {
      key: "personal",
      label: "Personal charges",
      value: money(personalCharges),
      tone: personalCharges > 0 ? "red" : undefined,
    },
  ];

  const columns = useMemo<QueueColumn<Trip>[]>(
    () => [
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
        defaultHidden: true,
      },
      {
        key: "destination",
        header: "Destination",
        cell: (t) => s.cityById(t.destinationCityId)?.name ?? "—",
        sortValue: (t) => s.cityById(t.destinationCityId)?.name ?? "",
        filter: { kind: "select", get: (t) => s.cityById(t.destinationCityId)?.name ?? "—" },
      },
      {
        key: "wouldHaveLeft",
        header: "Would have left",
        cell: (t) => (t.plannedDepartureDate ? formatDateDMY(t.plannedDepartureDate) : "—"),
        sortValue: (t) => t.plannedDepartureDate ?? "",
        filter: { kind: "date", get: (t) => t.plannedDepartureDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "cancelledOn",
        header: "Cancelled",
        cell: (t) => (t.cancelledAt ? formatDateDMY(t.cancelledAt) : "—"),
        sortValue: (t) => t.cancelledAt ?? "",
        filter: { kind: "date", get: (t) => t.cancelledAt ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "kind",
        header: "Reason (§4.1)",
        cell: (t) => {
          const k = kindOf(t);
          if (!k) return <span className="text-grey-2">—</span>;
          return k === "business" ? (
            <span className="rounded-pill bg-[#E9F7EF] px-2 py-0.5 text-[11.5px] font-semibold text-ryg-green">
              Business — reimbursable
            </span>
          ) : (
            <span className="rounded-pill bg-[#FDECEC] px-2 py-0.5 text-[11.5px] font-semibold text-ryg-red">
              Personal — not reimbursable
            </span>
          );
        },
        sortValue: (t) => kindOf(t) ?? "",
        filter: { kind: "select", get: (t) => kindOf(t) ?? "not recorded" },
      },
      {
        key: "why",
        header: "What happened",
        cell: (t) => t.cancelReason ?? "—",
        sortValue: (t) => t.cancelReason ?? "",
        filter: { kind: "text", get: (t) => t.cancelReason ?? "" },
      },
      {
        key: "charges",
        header: "Unrefunded",
        align: "right",
        cell: (t) => money(charges(t)),
        sortValue: (t) => charges(t),
        filter: { kind: "number", get: (t) => charges(t) },
        exportValue: (t) => charges(t),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "advance",
        header: "Advance out",
        align: "right",
        cell: (t) => {
          const o = stillOwed(t);
          return o > 0 ? (
            <span className="font-semibold text-ryg-red">{money(o)}</span>
          ) : (
            <span className="text-grey-2">—</span>
          );
        },
        sortValue: (t) => stillOwed(t),
        filter: { kind: "number", get: (t) => stillOwed(t) },
        exportValue: (t) => stillOwed(t),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "status",
        header: "Status",
        cell: (t) => <StatusPill status={t.status} />,
        sortValue: (t) => STATUS_LABEL[t.status],
        filter: { kind: "select", get: (t) => STATUS_LABEL[t.status] },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.cities, s.legs],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Cancelled travel</h1>
        <p className="max-w-3xl text-[13px] text-grey">
          Trips called off after they were booked, and what they cost anyway. §4.1 makes an
          unrefunded charge reimbursable when the reason is business and not when it is personal.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      {openCount > 0 && (
        <Card className="border-ryg-red/40 p-4">
          <h2 className="text-[14px] font-bold text-navy">
            {openCount} {openCount === 1 ? "trip has" : "trips have"} money still open
          </h2>
          <p className="mt-1 text-[12.5px] text-grey">
            The journey is off but the settling is not: an unrefunded charge to claim, an advance to
            recover, or both. These sit at the claim step exactly as a trip that happened would —
            which is the whole reason they are not simply marked cancelled and forgotten.
          </p>
        </Card>
      )}

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        rowsLabel="trips"
        emptyTitle="Nothing has been cancelled"
        emptyMessage="No booked trip has been called off."
        loading={s.isLoading}
        initialSort={{ key: "cancelledOn", dir: "desc" }}
        exportName="Travel_Cancelled"
        exportNotes={[
          "“Unrefunded” is the sum of each leg's net cost — ticket plus fees, less whatever the airline or hotel gave back.",
          "The §4.1 reason is recorded on the legs when the desk processes the cancellation. A business reason makes the charge reimbursable; a personal one does not.",
          "“Advance out” is money paid to the traveller that has not been settled or recovered. It appears on Outstanding Advances too.",
        ]}
        columnPicker={{ storageKey: "travel-cancelled" }}
      />
    </div>
  );
}
