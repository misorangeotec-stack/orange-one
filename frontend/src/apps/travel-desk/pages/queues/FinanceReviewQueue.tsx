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
 * Claims the reporting manager has approved and Finance has not yet verified.
 *
 * ⚠ §12 GIVES FINANCE FIVE WORKING DAYS FROM HOD APPROVAL, and the credit seven
 *   — both measured from the SAME point. So a row that is late here is already
 *   eating into the traveller's payment window, not into Finance's own. That is
 *   why the due column is the default sort.
 *
 * ⚠ NO RECEIPT is its own filter, not a footnote. It is the single most common
 *   reason a verification stalls, and being able to pull those rows out is the
 *   difference between chasing one traveller and reading forty claims.
 */
export default function FinanceReviewQueue() {
  const s = useTravelStore();

  const rows = useMemo(
    () => s.trips.filter((t) => t.status === "awaiting_finance_review"),
    [s.trips],
  );

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const dueOf = (t: Trip) => tripDueIso(t, "finance_review", s.stepSla);
    const missingReceipts = (t: Trip) =>
      s.claimLinesOf(t.id).filter((l) => !l.hasReceipt && !l.docPath).length;

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
        key: "approved",
        header: "HOD approved",
        cell: (t) => (t.crAt ? formatDateDMY(t.crAt) : "—"),
        sortValue: (t) => t.crAt ?? "",
        filter: { kind: "date", get: (t) => t.crAt ?? "" },
        tdClassName: "whitespace-nowrap",
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
        filter: {
          kind: "select",
          get: (t) => ((t.disallowedTotal ?? 0) > 0 ? "Capped by policy" : "Within policy"),
        },
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
        header: "Advance out",
        cell: (t) => {
          const a = Math.max((t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0), 0);
          return a > 0 ? money(a) : <span className="text-grey-2">—</span>;
        },
        sortValue: (t) => Math.max((t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0), 0),
        exportValue: (t) =>
          Math.max((t.advancePaidAmount ?? 0) - (t.advanceRecoveredAmount ?? 0), 0),
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "net",
        header: "Net",
        cell: (t) => {
          const n = t.netPayable ?? 0;
          return n < 0 ? <span className="font-semibold text-ryg-red">{money(n)}</span> : money(n);
        },
        sortValue: (t) => t.netPayable ?? 0,
        filter: {
          kind: "select",
          get: (t) => ((t.netPayable ?? 0) < 0 ? "Traveller owes" : "Company owes"),
        },
        exportValue: (t) => t.netPayable ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "receipts",
        header: "Receipts",
        cell: (t) => {
          const n = missingReceipts(t);
          return n > 0 ? (
            <span className="font-semibold text-ryg-amber">
              {n} missing
            </span>
          ) : (
            <span className="text-grey-2">All in</span>
          );
        },
        sortValue: (t) => missingReceipts(t),
        filter: { kind: "select", get: (t) => (missingReceipts(t) > 0 ? "Missing" : "All in") },
        exportValue: (t) => missingReceipts(t),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cities, s.stepSla, s.trips, s.claimLines]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Finance verification</h1>
        <p className="text-[13px] text-grey">
          §12 allows five working days from HOD approval, and the credit seven — both counted from
          the same point, so a claim that waits here is eating into the traveller&rsquo;s payment
          window rather than into Finance&rsquo;s own.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button
              variant={s.canActOn("finance_review", t) ? "primary" : "outline"}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.canActOn("finance_review", t) ? "Open & verify" : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="claims"
        emptyTitle="Nothing to verify"
        emptyMessage="A claim lands here once the reporting manager approves it, and moves on to settlement once you have."
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="Travel_Claims_To_Verify"
        columnPicker={{ storageKey: "travel-queue-finance" }}
      />
    </div>
  );
}
