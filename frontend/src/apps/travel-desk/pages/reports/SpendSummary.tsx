import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { Select } from "@/shared/components/ui/Form";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { money, TIER_LABEL } from "../../lib/format";
import type { Trip } from "../../types";

/**
 * What travel actually cost, aggregated however the reader needs it.
 *
 * ⚠ ONE SCREEN WITH A DIMENSION PICKER, NOT FOUR REPORTS. The source PRD asks
 *   for employee-wise, department-wise and purpose-wise spend as separate
 *   screens; the difference between them is a GROUP BY. Building three would
 *   mean three places to fix the day somebody decides the allowance should count
 *   differently.
 *
 * ⚠ THE COST OF A TRIP IS NOT ITS CLAIM. It is what the company actually parted
 *   with: what was booked (flights, hotels, trains — paid by the desk, never
 *   claimed by the traveller) PLUS what was allowed on the claim PLUS the daily
 *   allowance. Reporting only the claim would understate the biggest line on
 *   most trips, which is the one the traveller never sees.
 *
 * ⚠ DISALLOWED IS SHOWN BESIDE IT, NOT NETTED INTO SILENCE. "We spent 4.1 lakh
 *   and refused 32,000 of it" is the sentence a Director wants; a single net
 *   figure hides whether the policy is doing anything at all.
 *
 * ⚠ DRAFTS ARE EXCLUDED, everything else is not. A draft is a trip nobody has
 *   committed to and its estimate is a guess; a CANCELLED trip, by contrast, may
 *   have cost real money in cancellation charges and is counted.
 */

type Dim = "traveller" | "department" | "purpose" | "destination" | "tier" | "band" | "month";

const DIMS: { value: Dim; label: string }[] = [
  { value: "traveller", label: "Traveller" },
  { value: "department", label: "Department" },
  { value: "purpose", label: "Purpose" },
  { value: "destination", label: "Destination" },
  { value: "tier", label: "City tier" },
  { value: "band", label: "Band" },
  { value: "month", label: "Month of travel" },
];

interface Row {
  key: string;
  label: string;
  trips: number;
  booked: number;
  allowed: number;
  disallowed: number;
  da: number;
  advance: number;
  total: number;
}

export default function SpendSummary() {
  const s = useTravelStore();
  const { departmentById } = useDirectory();
  const [dim, setDim] = useState<Dim>("department");

  const trips = useMemo(() => s.trips.filter((t) => t.status !== "draft"), [s.trips]);

  const labelOf = useMemo(() => {
    const purposeName = new Map(s.purposes.map((p) => [p.id, p.name]));
    return (t: Trip): string => {
      switch (dim) {
        case "traveller":
          return t.travellerName || "—";
        case "department":
          return departmentById(t.snapDepartmentId)?.name ?? "Not recorded";
        case "purpose":
          return t.purposeId ? (purposeName.get(t.purposeId) ?? "—") : "Not recorded";
        case "destination":
          return s.cityById(t.destinationCityId)?.name ?? "Not recorded";
        case "tier": {
          const c = s.cityById(t.destinationCityId);
          return c ? TIER_LABEL[c.tier] : "Not recorded";
        }
        case "band":
          return t.snapBandNo ? `Band ${t.snapBandNo}` : "Not recorded";
        case "month": {
          const d = t.actualDepartureDate ?? t.plannedDepartureDate;
          if (!d) return "No date";
          // ⚠ Sorts correctly BECAUSE it is YYYY-MM. A "Aug 2026" label would
          //   put April after August in every column sort.
          return d.slice(0, 7);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim, s.purposes, s.cities, departmentById]);

  const rows = useMemo<Row[]>(() => {
    const acc = new Map<string, Row>();
    for (const t of trips) {
      const label = labelOf(t);
      const cur =
        acc.get(label) ??
        { key: label, label, trips: 0, booked: 0, allowed: 0, disallowed: 0, da: 0, advance: 0, total: 0 };
      cur.trips += 1;
      cur.booked += t.bookingTotal ?? 0;
      cur.allowed += (t.claimTotal ?? 0) - (t.disallowedTotal ?? 0);
      cur.disallowed += t.disallowedTotal ?? 0;
      cur.da += t.daTotal ?? 0;
      cur.advance += t.advancePaidAmount ?? 0;
      cur.total = cur.booked + cur.allowed + cur.da;
      acc.set(label, cur);
    }
    return [...acc.values()];
  }, [trips, labelOf]);

  const grand = rows.reduce(
    (a, r) => ({
      trips: a.trips + r.trips,
      booked: a.booked + r.booked,
      allowed: a.allowed + r.allowed,
      disallowed: a.disallowed + r.disallowed,
      da: a.da + r.da,
      total: a.total + r.total,
    }),
    { trips: 0, booked: 0, allowed: 0, disallowed: 0, da: 0, total: 0 },
  );

  const tiles: KpiTile[] = [
    { key: "total", label: "Total cost", value: money(grand.total), hint: "Bookings + allowed claims + allowance" },
    { key: "booked", label: "Booked by the desk", value: money(grand.booked), hint: "Never claimed by the traveller" },
    { key: "claims", label: "Allowed on claims", value: money(grand.allowed) },
    {
      key: "disallowed",
      label: "Refused by policy",
      value: money(grand.disallowed),
      hint: `Across ${grand.trips} trip${grand.trips === 1 ? "" : "s"}`,
    },
  ];

  const columns = useMemo<QueueColumn<Row>[]>(
    () => [
      {
        key: "label",
        header: DIMS.find((d) => d.value === dim)?.label ?? "Group",
        alwaysVisible: true,
        cell: (r) => <span className="font-semibold text-navy">{r.label}</span>,
        sortValue: (r) => r.label,
        filter: { kind: "select", get: (r) => r.label },
      },
      {
        key: "trips",
        header: "Trips",
        cell: (r) => r.trips,
        sortValue: (r) => r.trips,
        exportValue: (r) => r.trips,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "booked",
        header: "Booked",
        cell: (r) => money(r.booked),
        sortValue: (r) => r.booked,
        exportValue: (r) => r.booked,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "allowed",
        header: "Claims allowed",
        cell: (r) => money(r.allowed),
        sortValue: (r) => r.allowed,
        exportValue: (r) => r.allowed,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "da",
        header: "Allowance",
        cell: (r) => money(r.da),
        sortValue: (r) => r.da,
        exportValue: (r) => r.da,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "disallowed",
        header: "Refused",
        cell: (r) =>
          r.disallowed > 0 ? (
            <span className="font-semibold text-ryg-amber">{money(r.disallowed)}</span>
          ) : (
            <span className="text-grey-2">—</span>
          ),
        sortValue: (r) => r.disallowed,
        exportValue: (r) => r.disallowed,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "total",
        header: "Total cost",
        cell: (r) => <span className="font-semibold text-navy">{money(r.total)}</span>,
        sortValue: (r) => r.total,
        exportValue: (r) => r.total,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "avg",
        header: "Average per trip",
        cell: (r) => money(r.trips ? Math.round((r.total / r.trips) * 100) / 100 : 0),
        sortValue: (r) => (r.trips ? r.total / r.trips : 0),
        exportValue: (r) => (r.trips ? Math.round((r.total / r.trips) * 100) / 100 : 0),
        tdClassName: "whitespace-nowrap text-right",
      },
    ],
    [dim],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Spend summary</h1>
        <p className="text-[13px] text-grey">
          What travel cost, grouped however you need it. A trip&rsquo;s cost is what the company
          actually parted with — what the desk booked, plus what was allowed on the claim, plus the
          daily allowance. Drafts are excluded; cancelled trips are not, because a cancellation
          charge is real money.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] font-semibold text-navy">Group by</span>
          <Select
            className="w-56"
            value={dim}
            onChange={(e) => setDim(e.target.value as Dim)}
          >
            {DIMS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
          <span className="text-[11.5px] text-grey-2">
            The same figures, re-cut. Nothing is filtered out by changing this.
          </span>
        </div>
      </Card>

      <QueueTable
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        rowsLabel="groups"
        emptyTitle="Nothing to summarise yet"
        emptyMessage="A trip counts here once it is past draft. Raise and submit one, and it appears."
        loading={s.isLoading}
        initialSort={{ key: "total", dir: "desc" }}
        exportName="Travel_Spend_Summary"
        columnPicker={{ storageKey: "travel-report-spend" }}
      />
    </div>
  );
}
