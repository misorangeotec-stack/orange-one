import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateDMY } from "@/shared/lib/date";
import { dueState } from "@/shared/lib/workingDays";
import { HoldCancelModal } from "../../components/MrfModals";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeeBoard } from "../../lib/access";
import { isLivePosition, lastActivityIso, POSITION_STATUSES } from "../../lib/positions";
import { isOpenCandidate } from "../../lib/queues";
import { REQ_STATUS_LABEL } from "../../lib/format";
import type { Requisition } from "../../types";

/**
 * Every job opening, live and closed.
 *
 * A "position" is a requisition that actually became an opening — posted, or
 * anything that happened to it afterwards. An MRF still working its way through HR
 * and Management approval is not a position yet; it is a request for one, and it
 * lives on the Requisitions screen until it is approved and posted.
 *
 * Closed positions are shown, greyed, rather than hidden. They are where hires,
 * time-to-hire and platform effectiveness live, and "we filled this last quarter"
 * is a question people actually ask.
 *
 * Open/Closed is the table's own GROUP dimension rather than a bespoke toggle: it
 * gives the same dropdown every other FMS queue has.
 *
 * ⚠ The group does NOT order the rows here. QueueTable makes the group the primary
 *   sort only when its header bands are shown, and this table hides them
 *   (QueueTable.tsx, "hideGroupHeaders || !groupBy ? 0"), so grouping contributes
 *   nothing to the order and the list fell back to whatever order the store handed
 *   over — which put a CLOSED position at the top. Open-first is therefore an
 *   explicit `initialSort` on the State column, whose sortValue is 0 for live and 1
 *   for everything else.
 */
export default function PositionsList() {
  const s = useHrStore();
  /** Pause / reopen / cancel, without a trip to the requisition page. */
  const [holdFor, setHoldFor] = useState<{ r: Requisition; mode: "hold" | "resume" | "cancel" } | null>(null);

  const locationName = (id: string | null) => (id ? (s.locations.find((l) => l.id === id)?.name ?? "—") : "—");
  const jobTypeName = (id: string | null) => (id ? (s.jobTypes.find((t) => t.id === id)?.name ?? "—") : "—");

  const rows = useMemo(
    () => s.requisitions.filter((r) => POSITION_STATUSES.includes(r.status)),
    [s.requisitions],
  );

  /** Totals across every position, so a real 0 reads as "none" rather than a blank. */
  const summary = useMemo(() => {
    const open = rows.filter(isLivePosition).length;
    const candidates = rows.flatMap((r) => s.candidatesFor(r.id));
    const inPlay = candidates.filter(isOpenCandidate);
    const overdue = inPlay.filter((c) => {
      const d = s.candidateDueIso(c);
      return d ? dueState(new Date(d)).overdue : false;
    }).length;
    return {
      open,
      closed: rows.length - open,
      total: candidates.length,
      inPlay: inPlay.length,
      overdue,
      seatsRequired: rows.reduce((n, r) => n + r.positionsRequired, 0),
      seatsFilled: rows.reduce((n, r) => n + s.seatsJoined(r.id), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, s]);

  const columns: QueueColumn<Requisition>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Position",
        cell: (r) => {
          const live = isLivePosition(r);
          return (
            <div className="flex items-center gap-3">
              {/* A ring around the live dot, so "open" reads straight down the column. */}
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${live ? "bg-ryg-green/12" : "bg-page"}`}
                title={REQ_STATUS_LABEL[r.status]}
              >
                <span className={`h-2 w-2 rounded-full ${live ? "bg-ryg-green" : "bg-grey-2/50"}`} />
              </span>
              <div className="min-w-0">
                <Link
                  to={`/hr-recruitment/positions/${r.id}`}
                  className={`block truncate text-[14px] font-semibold leading-tight hover:text-orange hover:underline ${live ? "text-navy" : "text-grey"}`}
                >
                  {r.jobTitle}
                </Link>
                <div className="mt-0.5 text-[11.5px] text-grey-2">
                  {r.mrfNo}
                  {r.positionKind === "replacement" && " · replacement"}
                </div>
              </div>
            </div>
          );
        },
        sortValue: (r) => r.jobTitle,
        filter: { kind: "text", get: (r) => `${r.jobTitle} ${r.mrfNo}` },
        exportValue: (r) => r.jobTitle,
      },
      {
        key: "status",
        header: "State",
        cell: (r) => (
          <span
            className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              isLivePosition(r) ? "bg-[#E9F8EF] text-ryg-green" : "bg-page text-grey-2"
            }`}
          >
            {isLivePosition(r) ? "Open" : REQ_STATUS_LABEL[r.status]}
          </span>
        ),
        sortValue: (r) => (isLivePosition(r) ? 0 : 1),
        filter: { kind: "select", get: (r) => (isLivePosition(r) ? "Open" : REQ_STATUS_LABEL[r.status]) },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "location",
        header: "Location",
        cell: (r) => <span className="text-grey">{locationName(r.locationId)}</span>,
        sortValue: (r) => locationName(r.locationId),
        filter: { kind: "select", get: (r) => locationName(r.locationId) },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "type",
        header: "Type",
        cell: (r) => <span className="text-grey">{jobTypeName(r.jobTypeId)}</span>,
        sortValue: (r) => jobTypeName(r.jobTypeId),
        filter: { kind: "select", get: (r) => jobTypeName(r.jobTypeId) },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "candidates",
        header: "Candidates",
        cell: (r) => {
          const cands = s.candidatesFor(r.id);
          if (!cands.length) return <span className="text-[12.5px] text-grey-2">None yet</span>;
          const live = cands.filter(isOpenCandidate).length;
          return (
            <div className="whitespace-nowrap">
              <span className="text-[13px] font-semibold tabular-nums text-navy">{cands.length}</span>
              <span className="ml-1.5 text-[12px] text-grey-2">{live} in play</span>
            </div>
          );
        },
        sortValue: (r) => s.candidatesFor(r.id).length,
        exportValue: (r) => s.candidatesFor(r.id).length,
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "seats",
        header: "Seats filled",
        // A meter, not a chart: one measure, one hue, turning green only when the
        // vacancy is genuinely full.
        cell: (r) => {
          const joined = s.seatsJoined(r.id);
          const pct = r.positionsRequired > 0 ? Math.min(100, (joined / r.positionsRequired) * 100) : 0;
          const full = joined >= r.positionsRequired;
          return (
            <div className="w-[74px]">
              <span className="text-[12.5px] font-semibold tabular-nums text-navy">
                {joined} <span className="font-normal text-grey-2">/ {r.positionsRequired}</span>
              </span>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct}%`, background: full ? "#27AE60" : "#FF6A1F" }}
                />
              </div>
            </div>
          );
        },
        sortValue: (r) => (r.positionsRequired > 0 ? s.seatsJoined(r.id) / r.positionsRequired : 0),
        exportValue: (r) => `${s.seatsJoined(r.id)} of ${r.positionsRequired} filled`,
      },
      {
        key: "posted",
        header: "Posted",
        cell: (r) => <span className="text-grey">{formatDateDMY(r.postedAt ?? r.submittedAt)}</span>,
        sortValue: (r) => r.postedAt ?? r.submittedAt ?? "",
        filter: { kind: "date", get: (r) => r.postedAt ?? r.submittedAt ?? "" },
        exportValue: (r) => formatDateDMY(r.postedAt ?? r.submittedAt),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "activity",
        header: "Last activity",
        cell: (r) => {
          const iso = lastActivityIso(r, s.candidatesFor(r.id));
          return <span className="text-grey">{iso ? formatDateDMY(iso) : "—"}</span>;
        },
        sortValue: (r) => lastActivityIso(r, s.candidatesFor(r.id)) ?? "",
        exportValue: (r) => formatDateDMY(lastActivityIso(r, s.candidatesFor(r.id))),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "team",
        header: "Hiring team",
        cell: (r) => {
          const names = r.hiringManagerIds.map((id) => s.profileById(id)?.name).filter((n): n is string => !!n);
          if (!names.length) return <span className="text-grey-2">—</span>;
          return (
            <span className="flex items-center -space-x-1.5">
              {names.slice(0, 3).map((n) => (
                <Avatar key={n} name={n} size={22} className="ring-2 ring-white" />
              ))}
              {names.length > 3 && <span className="pl-2.5 text-[11.5px] text-grey-2">+{names.length - 3}</span>}
            </span>
          );
        },
        exportValue: (r) =>
          r.hiringManagerIds
            .map((id) => s.profileById(id)?.name)
            .filter(Boolean)
            .join(", "),
      },
    ],
    // The whole store: Candidates, Seats and Last activity all read live data, so a
    // refetch must rebuild these columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s],
  );

  if (!canSeeBoard(s)) return <AccessDenied />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Positions</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Every opening that has been posted. Open one to work its pipeline.
          </p>
        </div>
        {s.isStepOwner("mrf") && (
          <Link to="/hr-recruitment/requisitions/new">
            <Button size="sm">+ Raise a Requisition</Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Open positions"
          value={summary.open}
          hint={summary.closed > 0 ? `${summary.closed} closed` : "none closed yet"}
        />
        <Kpi
          label="Candidates in play"
          value={summary.inPlay}
          hint={`of ${summary.total} ever on these positions`}
        />
        <Kpi
          label="Seats filled"
          value={`${summary.seatsFilled} / ${summary.seatsRequired}`}
          hint="counts people who actually joined"
        />
        <Kpi
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue > 0 ? "red" : undefined}
          hint={summary.overdue > 0 ? "cards past their due date" : "nothing is running late"}
        />
      </div>

      <Card className="p-4">
        <QueueTable<Requisition>
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          groupBy={{
            idOf: (r) => (isLivePosition(r) ? "open" : "closed"),
            nameOf: (id) => (id === "open" ? "Open" : "Closed"),
            allLabel: "All positions",
            label: "State",
          }}
          hideGroupHeaders
          rowsLabel="positions"
          // Closed positions stay legible but recede — reference material sitting
          // under the ones you can still act on.
          rowClassName={(r) => (isLivePosition(r) ? "" : "bg-page/50")}
          emptyTitle="No positions yet"
          emptyMessage="A requisition becomes a position once it has been approved and the job is posted."
          exportName="HR_Positions"
          exportTitle="Positions"
          exportNotes={[
            "One row per job opening that reached posting. Requisitions still in HR or Management approval are not here — they are on the Requisitions screen.",
            "Open = still posting or collecting CVs. Everything else (on hold, closed, cancelled) reads as closed.",
            "Seats = people who have actually JOINED, out of the headcount the MRF asked for. An offer that has not been taken up yet does not count as filled.",
            "Last activity is the most recent movement of any candidate on that position — not an edit to the requisition itself.",
          ]}
          initialSort={{ key: "status", dir: "asc" }}
          actions={(r) => {
            // Same rule the requisition page uses: only a coordinator pauses or
            // abandons a vacancy, and a closed or cancelled one is not reopenable —
            // there is no RPC for it, so no button pretends otherwise.
            const mayHold = s.isProcessCoordinator;
            const dead = r.status === "cancelled" || r.status === "closed";
            return (
              <div className="flex items-center gap-2.5 whitespace-nowrap">
                <Link
                  to={`/hr-recruitment/positions/${r.id}`}
                  className="text-[12.5px] font-semibold text-orange hover:underline"
                >
                  Pipeline
                </Link>
                {mayHold && !dead && r.status === "on_hold" && (
                  <button
                    onClick={() => setHoldFor({ r, mode: "resume" })}
                    className="text-[12.5px] font-semibold text-ryg-green hover:underline"
                  >
                    Reopen
                  </button>
                )}
                {mayHold && !dead && r.status !== "on_hold" && (
                  <button
                    onClick={() => setHoldFor({ r, mode: "hold" })}
                    className="text-[12.5px] text-grey hover:text-navy hover:underline"
                  >
                    Hold
                  </button>
                )}
                {mayHold && !dead && (
                  <button
                    onClick={() => setHoldFor({ r, mode: "cancel" })}
                    className="text-[12.5px] text-grey hover:text-ryg-red hover:underline"
                  >
                    Close
                  </button>
                )}
              </div>
            );
          }}
        />
      </Card>

      {holdFor && (
        <HoldCancelModal
          requisition={holdFor.r}
          mode={holdFor.mode}
          open={!!holdFor}
          onClose={() => setHoldFor(null)}
        />
      )}
    </div>
  );
}
