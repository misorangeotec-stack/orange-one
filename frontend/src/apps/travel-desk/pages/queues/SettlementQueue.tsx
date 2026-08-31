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
 * Verified claims waiting for the money to move.
 *
 * ⚠ THE DUE DATE IS MEASURED FROM HOD APPROVAL, NOT FROM FINANCE'S OWN
 *   VERIFICATION. §12 promises the credit within seven working days of the HOD
 *   signing off, so Finance taking its full five days does not buy the traveller
 *   another week. Anchoring on the step before would let the 14-day promise
 *   drift quietly.
 *
 * ⚠ PAYMENTS AND RECOVERIES SIT IN ONE LIST, and the Direction column separates
 *   them. They are the same job — release the settlement — done two different
 *   ways, and splitting them into two screens would mean the person doing the
 *   bank run has to remember to check both.
 */
export default function SettlementQueue() {
  const s = useTravelStore();

  const rows = useMemo(
    () => s.trips.filter((t) => t.status === "awaiting_settlement"),
    [s.trips],
  );

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const dueOf = (t: Trip) => tripDueIso(t, "settlement", s.stepSla);
    const dir = (t: Trip) => ((t.netPayable ?? 0) < 0 ? "Recover" : "Pay");

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
        key: "direction",
        header: "Direction",
        cell: (t) =>
          dir(t) === "Recover" ? (
            <span className="font-semibold text-ryg-amber">Recover</span>
          ) : (
            <span className="text-grey-2">Pay</span>
          ),
        sortValue: (t) => dir(t),
        filter: { kind: "select", get: dir },
      },
      {
        key: "amount",
        header: "Amount",
        cell: (t) => money(Math.abs(t.netPayable ?? 0)),
        sortValue: (t) => Math.abs(t.netPayable ?? 0),
        exportValue: (t) => Math.abs(t.netPayable ?? 0),
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "verified",
        header: "Verified",
        cell: (t) => (t.frAt ? formatDateDMY(t.frAt) : "—"),
        sortValue: (t) => t.frAt ?? "",
        filter: { kind: "date", get: (t) => t.frAt ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "approved",
        header: "HOD approved",
        cell: (t) => (t.crAt ? formatDateDMY(t.crAt) : "—"),
        sortValue: (t) => t.crAt ?? "",
        filter: { kind: "date", get: (t) => t.crAt ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "due",
        header: "Credit due",
        cell: (t) => <DueCell dueIso={dueOf(t)} />,
        sortValue: (t) => dueOf(t) ?? "9999",
        filter: { kind: "date", get: (t) => dueOf(t) ?? "" },
        exportValue: (t) => dueOf(t) ?? "",
        tdClassName: "whitespace-nowrap",
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.stepSla, s.trips]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Settlement</h1>
        <p className="text-[13px] text-grey">
          §12 promises the credit within seven working days of HOD approval — which is what the due
          column counts from, not from when Finance got round to verifying it.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button
              variant={s.canActOn("settlement", t) ? "primary" : "outline"}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.canActOn("settlement", t)
                ? (t.netPayable ?? 0) < 0
                  ? "Open & recover"
                  : "Open & pay"
                : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="trips"
        emptyTitle="Nothing waiting to be settled"
        emptyMessage="A verified claim lands here, and leaves once the payment or the recovery is recorded against a reference."
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="Travel_Settlements_Due"
        columnPicker={{ storageKey: "travel-queue-settlement" }}
      />
    </div>
  );
}
