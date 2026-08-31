import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { money, STATUS_LABEL, TIER_LABEL } from "../../lib/format";
import StatusPill from "../../components/StatusPill";
import type { Trip } from "../../types";

/**
 * Every trip the company has raised, ever.
 *
 * ⚠ THIS IS ONE FLAT GRID, AND IT REPLACES THREE OF THE PRD's REPORTS. The
 *   source PRD asks for Employee-wise, Department-wise and Purpose-wise travel
 *   reports as three separate screens. Per `CLAUDE.md`, FMS list views are flat:
 *   every dimension is an ordinary sortable, cascading-filterable column here,
 *   so "what did Sales spend on customer visits in August" is three dropdowns on
 *   one screen rather than a fourth report nobody built. The aggregate lives on
 *   Spend Summary next door.
 *
 * ⚠ NO `groupBy`. Banding by department would make the department name the
 *   PRIMARY sort, so a register sorted by cost would only sort within each band
 *   and the most expensive trip in the company would hide mid-page.
 *
 * ⚠ IT COUNTS EVERY STATUS, INCLUDING DRAFTS AND CANCELLED. A register that
 *   quietly drops the trips that went wrong is the one nobody can audit — and
 *   cancelled trips are exactly where the unrecovered advances hide. Filter the
 *   Status column to narrow it.
 */
export default function TripRegister() {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const { departmentById } = useDirectory();

  const rows = s.trips;

  const spend = (t: Trip) => (t.bookingTotal ?? 0) + (t.claimTotal ?? 0) - (t.disallowedTotal ?? 0) + (t.daTotal ?? 0);

  const tiles: KpiTile[] = useMemo(() => {
    const closed = rows.filter((t) => t.status === "closed");
    const totalSpend = rows.reduce((sum, t) => sum + spend(t), 0);
    return [
      { key: "all", label: "Trips on record", value: String(rows.length), hint: "Every status, including drafts" },
      { key: "closed", label: "Closed", value: String(closed.length), hint: "Claimed and settled" },
      { key: "people", label: "Travellers", value: String(new Set(rows.map((t) => t.travellerId)).size) },
      {
        key: "spend",
        label: "Cost on record",
        value: money(totalSpend),
        hint: "Bookings plus allowed expenses plus allowance",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

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
            {t.tripNo ?? "Draft"}
          </Link>
        ),
        sortValue: (t) => t.tripNo ?? "",
        filter: { kind: "text", get: (t) => t.tripNo ?? "Draft" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "status",
        header: "Status",
        cell: (t) => <StatusPill status={t.status} />,
        sortValue: (t) => STATUS_LABEL[t.status],
        filter: { kind: "select", get: (t) => STATUS_LABEL[t.status] },
        exportValue: (t) => STATUS_LABEL[t.status],
      },
      // ---- the PRD's three reports, as three columns ----------------------
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
        key: "purpose",
        header: "Purpose",
        cell: (t) => s.purposes.find((p) => p.id === t.purposeId)?.name ?? "—",
        sortValue: (t) => s.purposes.find((p) => p.id === t.purposeId)?.name ?? "",
        filter: { kind: "select", get: (t) => s.purposes.find((p) => p.id === t.purposeId)?.name ?? "—" },
      },
      {
        key: "destination",
        header: "Destination",
        cell: (t) => s.cityById(t.destinationCityId)?.name ?? "—",
        sortValue: (t) => s.cityById(t.destinationCityId)?.name ?? "",
        filter: { kind: "select", get: (t) => s.cityById(t.destinationCityId)?.name ?? "—" },
      },
      {
        key: "tier",
        header: "Tier",
        cell: (t) => {
          const c = s.cityById(t.destinationCityId);
          return c ? TIER_LABEL[c.tier] : "—";
        },
        sortValue: (t) => s.cityById(t.destinationCityId)?.tier ?? 9,
        filter: {
          kind: "select",
          get: (t) => {
            const c = s.cityById(t.destinationCityId);
            return c ? TIER_LABEL[c.tier] : "—";
          },
        },
      },
      {
        key: "band",
        header: "Band",
        cell: (t) => (t.snapBandNo ? `Band ${t.snapBandNo}` : "—"),
        sortValue: (t) => t.snapBandNo ?? 0,
        filter: { kind: "select", get: (t) => (t.snapBandNo ? `Band ${t.snapBandNo}` : "—") },
      },
      {
        key: "category",
        header: "Entitlement",
        cell: (t) => t.snapTravelCategory ?? "—",
        sortValue: (t) => t.snapTravelCategory ?? "",
        filter: { kind: "select", get: (t) => t.snapTravelCategory ?? "—" },
      },
      {
        key: "departure",
        header: "Departed",
        cell: (t) => {
          const d = t.actualDepartureDate ?? t.plannedDepartureDate;
          return d ? formatDateDMY(d) : "—";
        },
        sortValue: (t) => t.actualDepartureDate ?? t.plannedDepartureDate ?? "",
        filter: { kind: "date", get: (t) => t.actualDepartureDate ?? t.plannedDepartureDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "return",
        header: "Returned",
        cell: (t) => {
          const d = t.actualReturnDate ?? t.plannedReturnDate;
          return d ? formatDateDMY(d) : "—";
        },
        sortValue: (t) => t.actualReturnDate ?? t.plannedReturnDate ?? "",
        filter: { kind: "date", get: (t) => t.actualReturnDate ?? t.plannedReturnDate ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      // ---- the money ------------------------------------------------------
      {
        key: "estimate",
        header: "Estimated",
        cell: (t) => money(t.estimatedCost),
        sortValue: (t) => t.estimatedCost ?? 0,
        exportValue: (t) => t.estimatedCost ?? "",
        tdClassName: "whitespace-nowrap text-right",
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
        key: "claimed",
        header: "Claimed",
        cell: (t) => money(t.claimTotal),
        sortValue: (t) => t.claimTotal ?? 0,
        exportValue: (t) => t.claimTotal ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "disallowed",
        header: "Disallowed",
        cell: (t) =>
          (t.disallowedTotal ?? 0) > 0 ? (
            <span className="font-semibold text-ryg-amber">{money(t.disallowedTotal)}</span>
          ) : (
            <span className="text-grey-2">—</span>
          ),
        sortValue: (t) => t.disallowedTotal ?? 0,
        exportValue: (t) => t.disallowedTotal ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "da",
        header: "Allowance",
        cell: (t) => money(t.daTotal),
        sortValue: (t) => t.daTotal ?? 0,
        exportValue: (t) => t.daTotal ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "advance",
        header: "Advance",
        cell: (t) => money(t.advancePaidAmount),
        sortValue: (t) => t.advancePaidAmount ?? 0,
        exportValue: (t) => t.advancePaidAmount ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "cost",
        header: "Total cost",
        cell: (t) => <span className="font-semibold text-navy">{money(spend(t))}</span>,
        sortValue: (t) => spend(t),
        exportValue: (t) => spend(t),
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "settled",
        header: "Settled",
        cell: (t) => (t.settledAt ? formatDateDMY(t.settledAt) : "—"),
        sortValue: (t) => t.settledAt ?? "",
        filter: { kind: "date", get: (t) => t.settledAt ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "raisedBy",
        header: "Raised by",
        cell: (t) => personById(t.raisedBy)?.name ?? "—",
        sortValue: (t) => personById(t.raisedBy)?.name ?? "",
        filter: { kind: "select", get: (t) => personById(t.raisedBy)?.name ?? "—" },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.cities, s.purposes, personById, departmentById],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Trip register</h1>
        <p className="text-[13px] text-grey">
          Every trip on record, at every status. Traveller, department and purpose are ordinary
          columns here — sort or filter any of them rather than opening a different report.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        rowsLabel="trips"
        emptyTitle="No trips yet"
        emptyMessage="Once somebody raises a travel request it appears here, and stays for ever — including the ones that were cancelled."
        loading={s.isLoading}
        initialSort={{ key: "departure", dir: "desc" }}
        exportName="Travel_Trip_Register"
        columnPicker={{ storageKey: "travel-report-register" }}
      />
    </div>
  );
}
