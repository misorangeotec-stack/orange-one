import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { formatDateDMY } from "@/shared/lib/date";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";
import { money, STATUS_LABEL } from "../../lib/format";
import { tripsWithOutstandingAdvance, stillOwed } from "../../lib/advance";
import StatusPill from "../../components/StatusPill";
import type { Trip } from "../../types";

/**
 * Every rupee of travel advance the company has not got back.
 *
 * ⚠ THIS REPORT IS WHY §11.2 IS ENFORCEABLE AT ALL. "No second travel advance to
 *   an employee who has an outstanding unreconciled advance" was in the policy
 *   before this module existed and could not be applied, because nothing in the
 *   business could answer "who owes what". A rule nobody can evaluate is a rule
 *   nobody follows — and it is the reason this screen is not in the source PRD
 *   yet is the one Finance will live in.
 *
 * ⚠ IT COUNTS THE MONEY, NOT THE OPEN TRIPS. A cancelled trip that drew ₹12,000
 *   still owes ₹12,000 — the journey never happened, so no claim is coming to
 *   net it off. Those rows are the whole point of the report: they are the ones
 *   that fall out of every other list and are never chased.
 *
 * ⚠ AGEING IS FROM THE DAY THE MONEY LEFT, not from the trip's dates. §11's
 *   30-day recovery window runs from disbursement, and a trip whose departure
 *   keeps slipping would otherwise never appear to age.
 */
export default function OutstandingAdvances() {
  const s = useTravelStore();
  const personById = useOrgPersonById();
  const { departmentById } = useDirectory();

  const rows = useMemo(() => tripsWithOutstandingAdvance(s.trips), [s.trips]);

  const total = rows.reduce((sum, t) => sum + stillOwed(t), 0);
  const people = new Set(rows.map((t) => t.travellerId)).size;
  const stranded = rows.filter((t) => t.status === "cancelled" || t.status === "rejected");
  const strandedTotal = stranded.reduce((sum, t) => sum + stillOwed(t), 0);

  const daysOut = (t: Trip): number | null => {
    if (!t.advancePaidAt) return null;
    const ms = Date.now() - new Date(t.advancePaidAt).getTime();
    return Math.floor(ms / 86_400_000);
  };

  const overdue = rows.filter((t) => (daysOut(t) ?? 0) > s.config.policy.advanceRecoveryDays);

  const tiles: KpiTile[] = [
    { key: "total", label: "Outstanding", value: money(total), tone: total > 0 ? "red" : undefined },
    { key: "people", label: "People", value: people },
    {
      key: "overdue",
      label: `Past ${s.config.policy.advanceRecoveryDays} days`,
      value: overdue.length,
      tone: overdue.length ? "red" : undefined,
    },
    {
      key: "stranded",
      label: "On dead trips",
      value: money(strandedTotal),
      tone: strandedTotal > 0 ? "red" : undefined,
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
        key: "code",
        header: "Employee code",
        cell: (t) => t.travellerEmployeeCode ?? "—",
        sortValue: (t) => t.travellerEmployeeCode ?? "",
        filter: { kind: "text", get: (t) => t.travellerEmployeeCode ?? "" },
        defaultHidden: true,
      },
      {
        key: "department",
        header: "Department",
        cell: (t) => departmentById(t.snapDepartmentId)?.name ?? "—",
        sortValue: (t) => departmentById(t.snapDepartmentId)?.name ?? "",
        filter: { kind: "select", get: (t) => departmentById(t.snapDepartmentId)?.name ?? "—" },
      },
      {
        key: "status",
        header: "Trip status",
        cell: (t) => <StatusPill status={t.status} />,
        sortValue: (t) => STATUS_LABEL[t.status],
        filter: { kind: "select", get: (t) => STATUS_LABEL[t.status] },
      },
      {
        key: "paidOn",
        header: "Paid on",
        cell: (t) => (t.advancePaidAt ? formatDateDMY(t.advancePaidAt) : "—"),
        sortValue: (t) => t.advancePaidAt ?? "",
        filter: { kind: "date", get: (t) => t.advancePaidAt ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "age",
        header: "Days out",
        align: "right",
        cell: (t) => {
          const d = daysOut(t);
          if (d === null) return <span className="text-grey-2">—</span>;
          const late = d > s.config.policy.advanceRecoveryDays;
          return <span className={late ? "font-semibold text-ryg-red" : "text-grey"}>{d}</span>;
        },
        sortValue: (t) => daysOut(t) ?? -1,
        filter: { kind: "number", get: (t) => daysOut(t) ?? 0 },
        exportValue: (t) => daysOut(t) ?? "",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "paid",
        header: "Paid",
        align: "right",
        cell: (t) => money(t.advancePaidAmount),
        sortValue: (t) => t.advancePaidAmount ?? 0,
        exportValue: (t) => t.advancePaidAmount ?? 0,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "recovered",
        header: "Recovered",
        align: "right",
        cell: (t) => money(t.advanceRecoveredAmount),
        sortValue: (t) => t.advanceRecoveredAmount ?? 0,
        exportValue: (t) => t.advanceRecoveredAmount ?? 0,
        tdClassName: "whitespace-nowrap",
        defaultHidden: true,
      },
      {
        key: "owed",
        header: "Still owed",
        align: "right",
        cell: (t) => <span className="font-semibold text-navy">{money(stillOwed(t))}</span>,
        sortValue: (t) => stillOwed(t),
        filter: { kind: "number", get: (t) => stillOwed(t) },
        exportValue: (t) => stillOwed(t),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "ref",
        header: "Reference",
        cell: (t) => t.advancePaidRef ?? "—",
        sortValue: (t) => t.advancePaidRef ?? "",
        filter: { kind: "text", get: (t) => t.advancePaidRef ?? "" },
        defaultHidden: true,
      },
      {
        key: "paidBy",
        header: "Paid by",
        cell: (t) => personById(t.advBy)?.name ?? "—",
        sortValue: (t) => personById(t.advBy)?.name ?? "",
        filter: { kind: "select", get: (t) => personById(t.advBy)?.name ?? "—" },
        defaultHidden: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.config.policy.advanceRecoveryDays],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Outstanding advances</h1>
        <p className="max-w-3xl text-[13px] text-grey">
          Travel advance the company has paid out and not yet got back — netted against a claim at
          settlement, or handed back on a trip that never happened. Policy §11.2 refuses a second
          advance to anybody appearing here.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      {stranded.length > 0 && (
        <Card className="border-ryg-red/40 p-4">
          <h2 className="text-[14px] font-bold text-navy">
            {money(strandedTotal)} sits on {stranded.length}{" "}
            {stranded.length === 1 ? "trip that will never reach a claim" : "trips that will never reach a claim"}
          </h2>
          <p className="mt-1 text-[12.5px] text-grey">
            These trips were cancelled or turned down after the money went out, so no settlement is
            coming to net them off. They have to be recovered directly — open the trip and record
            the repayment. Until that happens the traveller is blocked from any further advance, and
            nothing else in the module will chase this.
          </p>
        </Card>
      )}

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        rowsLabel="advances"
        emptyTitle="Nothing outstanding"
        emptyMessage="Every advance paid out has been settled against a claim or recovered."
        loading={s.isLoading}
        initialSort={{ key: "age", dir: "desc" }}
        exportName="Travel_Outstanding_Advances"
        exportTitle="Outstanding travel advances"
        exportNotes={[
          "Amounts are in Indian Rupees, as full figures — the Domestic Travel Policy forbids lakh/crore abbreviation.",
          "“Still owed” is what was paid less anything recovered. A trip drops off this list when the settlement step nets it against the claim.",
          "“Days out” counts from the day the money left, not from the trip's dates — §11's recovery window runs from disbursement.",
          "A cancelled or rejected trip that drew an advance stays here until the money is recorded as returned; no claim is coming to net it off.",
        ]}
        columnPicker={{ storageKey: "travel-outstanding-advances" }}
      />
    </div>
  );
}
