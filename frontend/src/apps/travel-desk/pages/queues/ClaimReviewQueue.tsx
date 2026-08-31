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
 * Claims waiting on the reporting manager (§11.1, step 7).
 *
 * ⚠ THE DISALLOWED COLUMN IS THE WHOLE REASON THIS SCREEN IS USEFUL. The engine
 *   has already applied every cap by the time a claim reaches here, so a
 *   reviewer's job is not to re-derive the arithmetic — it is to judge the
 *   things arithmetic cannot: was this journey necessary, is the business meal
 *   plausible, does the §7.3 exception hold. A row showing a large disallowance
 *   is where that judgement is most likely to be needed, so it is sortable.
 *
 * ⚠ A NEGATIVE NET IS MONEY COMING BACK, and it is shown as such rather than
 *   floored at zero. That figure is what §11.2 blocks the next advance on.
 */
export default function ClaimReviewQueue() {
  const s = useTravelStore();

  const rows = useMemo(
    () => s.trips.filter((t) => t.status === "awaiting_claim_review"),
    [s.trips],
  );

  const columns = useMemo<QueueColumn<Trip>[]>(() => {
    const dueOf = (t: Trip) => tripDueIso(t, "claim_review", s.stepSla);

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
        key: "filed",
        header: "Filed",
        cell: (t) => (t.clAt ? formatDateDMY(t.clAt) : "—"),
        sortValue: (t) => t.clAt ?? "",
        filter: { kind: "date", get: (t) => t.clAt ?? "" },
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
        key: "net",
        header: "Net",
        cell: (t) => {
          const n = t.netPayable ?? 0;
          return n < 0 ? (
            <span className="font-semibold text-ryg-red">{money(n)}</span>
          ) : (
            money(n)
          );
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
  }, [s.cities, s.stepSla, s.trips]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Claim review</h1>
        <p className="text-[13px] text-grey">
          Every cap has already been applied by the time a claim reaches here (§7, §9, §10, §15).
          What is left is the judgement the arithmetic cannot make — §12 allows two working days.
        </p>
      </div>

      <QueueTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        actions={(t) => (
          <Link to={`/travel-desk/trips/${t.id}`}>
            <Button
              variant={s.canActOn("claim_review", t) ? "primary" : "outline"}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.canActOn("claim_review", t) ? "Open & decide" : "Open"}
            </Button>
          </Link>
        )}
        rowsLabel="claims"
        emptyTitle="No claims to review"
        emptyMessage="A claim lands here the moment a traveller files it, and goes to Finance once you approve it."
        loading={s.isLoading}
        initialSort={{ key: "due", dir: "asc" }}
        exportName="Travel_Claims_To_Review"
        columnPicker={{ storageKey: "travel-queue-claim-review" }}
      />
    </div>
  );
}
