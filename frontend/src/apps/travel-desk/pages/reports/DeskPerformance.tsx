import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { useTravelStore } from "../../store";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import { stepCompletedIso } from "../../lib/queues";
import type { Trip } from "../../types";

/**
 * How long each step actually takes, against what §12 promised.
 *
 * ⚠ MEASURED ON WORK THAT FINISHED, NOT ON WORK OUTSTANDING. A step still open
 *   has no duration yet, and counting it as zero would make a jammed queue look
 *   fast. The count of what is still open is the Control Center's job; this is
 *   the retrospective.
 *
 * ⚠ CALENDAR DAYS, AND THE SCREEN SAYS SO. The due dates in this module are
 *   working days (Mon–Sat), but "how long did this take" is a question about
 *   elapsed time — a claim that sat over a weekend really did take three days
 *   from the traveller's point of view. Reporting working days here would flatter
 *   every figure by exactly the weekends it removed.
 *
 * ⚠ THE MEDIAN, NOT ONLY THE MEAN. One trip held for six weeks while a customer
 *   went quiet drags an average far enough to hide that everything else cleared
 *   next day. Both are shown; the median is the one to read.
 *
 * ⚠ IT DOES NOT NAME INDIVIDUALS. The dimension is the STEP, not the person who
 *   actioned it. A per-approver league table is a different thing with different
 *   consequences, and §12.1 puts escalation in HR's hands rather than in a
 *   dashboard.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Whole days between two stamps, floored at zero. */
const daysBetween = (fromIso: string | null, toIso: string | null): number | null => {
  if (!fromIso || !toIso) return null;
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY));
};

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 10) / 10;
};

interface Row {
  key: StepKey;
  title: string;
  /** Steps whose clock is not "the step before" get their anchor named. */
  measuredFrom: string;
  done: number;
  medianDays: number | null;
  meanDays: number | null;
  worstDays: number | null;
  target: number | null;
}

/**
 * What each step's duration is measured FROM.
 *
 * ⚠ NOT ALWAYS THE STEP BEFORE, and where it differs it matches `ANCHOR_AT` in
 *   lib/queues.ts on purpose. `booking` measures from the last approval that
 *   actually happened (a band-3 trip skipped the Director entirely); `claim`
 *   measures from the return date, because the journey ending is what starts
 *   that clock and the journey is not a step.
 */
const FROM: Record<string, { label: string; at: (t: Trip) => string | null }> = {
  manager_approval: { label: "Submission", at: (t) => t.submittedAt },
  director_approval: { label: "Manager approval", at: (t) => t.maAt },
  advance: { label: "Last approval", at: (t) => t.daAt ?? t.maAt },
  booking: { label: "Last approval", at: (t) => t.daAt ?? t.maAt },
  claim: { label: "Return date", at: (t) => t.actualReturnDate ?? t.plannedReturnDate },
  claim_review: { label: "Claim filed", at: (t) => t.clAt },
  finance_review: { label: "Manager approved the claim", at: (t) => t.crAt },
  settlement: { label: "Manager approved the claim", at: (t) => t.crAt },
};

export default function DeskPerformance() {
  const s = useTravelStore();

  const rows = useMemo<Row[]>(() => {
    const queueSteps = STEPS.filter((st) => !st.noQueue);
    return queueSteps.map((st) => {
      const key = st.key as StepKey;
      const from = FROM[key];
      const durations: number[] = [];

      for (const t of s.trips) {
        // Only a step that has actually COMPLETED contributes a duration.
        const to = stepCompletedIso(t, key);
        if (!to || !from) continue;
        const d = daysBetween(from.at(t), to);
        if (d !== null) durations.push(d);
      }

      return {
        key,
        title: st.title,
        measuredFrom: from?.label ?? "The step before",
        done: durations.length,
        medianDays: median(durations),
        meanDays: durations.length
          ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
          : null,
        worstDays: durations.length ? Math.max(...durations) : null,
        target: s.stepSla[key]?.days ?? null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.trips, s.stepSla]);

  const closed = s.trips.filter((t) => t.status === "closed");
  const cycles = closed
    .map((t) => daysBetween(t.actualReturnDate ?? t.plannedReturnDate, t.stAt))
    .filter((d): d is number => d !== null);
  const cancelled = s.trips.filter((t) => t.status === "cancelled" || t.status === "cancelled_pending_claim");

  const tiles: KpiTile[] = [
    { key: "closed", label: "Trips closed", value: String(closed.length), hint: "Claimed, verified and settled" },
    {
      key: "cycle",
      label: "Return to settled",
      value: median(cycles) === null ? "—" : `${median(cycles)} days`,
      hint: "Median, calendar days. §12 promises 14 WORKING days",
    },
    {
      key: "cancelled",
      label: "Cancelled",
      value: String(cancelled.length),
      hint: "Journeys that did not happen",
      tone: cancelled.length ? "red" : undefined,
    },
    {
      key: "raised",
      label: "Trips processed",
      value: String(s.trips.filter((t) => t.status !== "draft").length),
      hint: "Everything past draft",
    },
  ];

  const columns = useMemo<QueueColumn<Row>[]>(
    () => [
      {
        key: "step",
        header: "Step",
        alwaysVisible: true,
        cell: (r) => (
          <div>
            <div className="font-semibold text-navy">{r.title}</div>
            <div className="text-[11px] text-grey-2">from {r.measuredFrom.toLowerCase()}</div>
          </div>
        ),
        sortValue: (r) => stepByKey(r.key)?.index ?? 0,
        filter: { kind: "select", get: (r) => r.title },
        exportValue: (r) => r.title,
      },
      {
        key: "done",
        header: "Completed",
        cell: (r) => r.done,
        sortValue: (r) => r.done,
        exportValue: (r) => r.done,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "median",
        header: "Median days",
        cell: (r) =>
          r.medianDays === null ? (
            <span className="text-grey-2">—</span>
          ) : (
            <span className="font-semibold text-navy">{r.medianDays}</span>
          ),
        sortValue: (r) => r.medianDays ?? -1,
        exportValue: (r) => r.medianDays ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "mean",
        header: "Average days",
        cell: (r) => (r.meanDays === null ? <span className="text-grey-2">—</span> : r.meanDays),
        sortValue: (r) => r.meanDays ?? -1,
        exportValue: (r) => r.meanDays ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "worst",
        header: "Slowest",
        cell: (r) => (r.worstDays === null ? <span className="text-grey-2">—</span> : r.worstDays),
        sortValue: (r) => r.worstDays ?? -1,
        exportValue: (r) => r.worstDays ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "target",
        header: "Target",
        cell: (r) =>
          r.target === null ? (
            <span className="text-grey-2">—</span>
          ) : (
            <span className="text-grey-2">{r.target} working days</span>
          ),
        sortValue: (r) => r.target ?? -1,
        exportValue: (r) => r.target ?? "",
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "verdict",
        header: "Against target",
        cell: (r) => {
          if (r.medianDays === null || r.target === null) return <span className="text-grey-2">—</span>;
          // Calendar vs working days, so this is a reading and not a measurement.
          // A median inside the target is comfortably inside it; one outside is
          // worth looking at rather than proof of a breach.
          return r.medianDays <= r.target ? (
            <span className="text-grey-2">Within</span>
          ) : (
            <span className="font-semibold text-ryg-amber">Over</span>
          );
        },
        sortValue: (r) =>
          r.medianDays === null || r.target === null ? -1 : r.medianDays - r.target,
        filter: {
          kind: "select",
          get: (r) =>
            r.medianDays === null || r.target === null
              ? "No data"
              : r.medianDays <= r.target
                ? "Within"
                : "Over",
        },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">Desk performance</h1>
        <p className="text-[13px] text-grey">
          How long each step took, on work that has finished. Durations are{" "}
          <strong>calendar days</strong> — a claim that sat over a weekend really did take three
          days — while the targets from §12 are working days, so the last column is a reading rather
          than a measurement.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      <QueueTable
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        rowsLabel="steps"
        emptyTitle="Nothing has finished yet"
        emptyMessage="A step contributes a duration once it completes. Until then the Control Center is the screen to read."
        loading={s.isLoading}
        initialSort={{ key: "step", dir: "asc" }}
        exportName="Travel_Desk_Performance"
        columnPicker={{ storageKey: "travel-report-performance" }}
      />

      <Card className="p-4">
        <div className="text-[13px] font-semibold text-navy">Why there is no per-person table</div>
        <p className="mt-1 text-[12.5px] text-grey-2">
          The dimension here is the step, not whoever actioned it. §12.1 puts a slow approval in
          HR&rsquo;s hands to escalate, which is a conversation; a league table of approvers is a
          different instrument with different consequences, and it is not what the policy asked for.
        </p>
      </Card>
    </div>
  );
}
