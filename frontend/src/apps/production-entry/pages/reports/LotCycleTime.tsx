/**
 * LOT CYCLE TIME — one row per lot: when it started, how long it sat at each stage,
 * and how long the whole lot has taken.
 *
 * Flat. No `groupBy` — the dimension a reader would band by (card type, FG item, the
 * stage it is stuck in) is an ordinary sortable, filterable column here, and banding
 * would make the group name the primary sort and hide the slowest lot mid-page.
 *
 * ⚠ MOST LOTS ARE STILL RUNNING. Nothing in the book has cleared FG Transfer, so a
 *   total that reads "6d 4h so far" is the normal case, not an edge one. The current
 *   leg is measured against now; the legs after it are BLANK, never zero — a zero
 *   there would read as a stage that took no time rather than one not yet reached.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import StatusPill from "../../components/StatusPill";
import CycleFilters from "../../components/CycleFilters";
import LotStageChart from "../../components/LotStageChart";
import { formatDate, formatDateTime, formatDuration } from "@/shared/lib/time";
import { useProductionStore } from "../../store";
import { useCycleReport } from "./useCycleReport";
import { CARD_TYPE_LABEL, STATUS_LABEL } from "../../lib/format";
import { STAGES } from "../../lib/steps";
import {
  QUEUE_STEPS,
  legLabel,
  stepShort,
  msToHours,
  totalLabel,
  type LotCycle,
  type StageLeg,
  type StepLeg,
} from "../../lib/cycleTime";

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export default function LotCycleTime() {
  const store = useProductionStore();
  const r = useCycleReport();

  const tiles = useMemo<KpiTile[]>(() => {
    const totals = r.rows.map((c) => c.totalMs);
    const slowest = totals.length ? Math.max(...totals) : null;
    return [
      { key: "lots", label: "Lots in view", value: r.rows.length },
      { key: "median", label: "Median total time", value: formatDuration(median(totals)) },
      { key: "slowest", label: "Slowest lot", value: formatDuration(slowest) },
      { key: "open", label: "Still running", value: r.rows.filter((c) => !c.done).length },
      { key: "done", label: "Finished", value: r.rows.filter((c) => c.done).length },
    ];
  }, [r.rows]);

  const columns = useMemo<QueueColumn<LotCycle>[]>(() => {
    const stageOrStep: QueueColumn<LotCycle>[] =
      r.level === "stage"
        ? STAGES.map((stage, i) => {
            const at = (c: LotCycle): StageLeg | undefined => c.stages[i];
            return {
              key: `stage:${stage.label}`,
              header: stage.label,
              align: "right",
              tdClassName: "whitespace-nowrap text-right",
              cell: (c) => durationCell(at(c)),
              // Sorted on the raw span, never the formatted text: "9h" sorts after
              // "10d" as a string, which is the wrong end of the table entirely.
              sortValue: (c) => at(c)?.ms ?? -1,
              exportValue: (c) => msToHours(at(c)?.ms ?? null),
            };
          })
        : QUEUE_STEPS.map((step) => {
            const at = (c: LotCycle): StepLeg | undefined => c.legs.find((l) => l.step === step);
            const title = stepShort(step);
            return {
              key: `step:${step}`,
              header: title,
              align: "right",
              tdClassName: "whitespace-nowrap text-right",
              cell: (c) => durationCell(at(c)),
              sortValue: (c) => at(c)?.ms ?? -1,
              exportValue: (c) => msToHours(at(c)?.ms ?? null),
            };
          });

    return [
      {
        key: "lot",
        header: "Lot No",
        alwaysVisible: true,
        tdClassName: "whitespace-nowrap",
        cell: (c) => (
          <Link
            to={`/production-entry/requests/${c.request.id}`}
            className="font-semibold text-navy hover:text-orange"
          >
            {c.request.jobcardNo || c.request.reqNo}
          </Link>
        ),
        sortValue: (c) => c.request.jobcardNo || c.request.reqNo,
        filter: { kind: "text", get: (c) => c.request.jobcardNo || c.request.reqNo },
      },
      {
        key: "ref",
        header: "Ref",
        defaultHidden: true,
        cell: (c) => c.request.reqNo,
        sortValue: (c) => c.request.reqNo,
        filter: { kind: "text", get: (c) => c.request.reqNo },
      },
      {
        key: "type",
        header: "Type",
        cell: (c) => CARD_TYPE_LABEL[c.request.cardType],
        sortValue: (c) => CARD_TYPE_LABEL[c.request.cardType],
        filter: { kind: "select", get: (c) => CARD_TYPE_LABEL[c.request.cardType] },
      },
      {
        key: "fg",
        header: "Item",
        // Ink names run to four words ("KY SUBLIMATION INK BLACK") and were setting
        // the height of every row. One line, with the full name on hover.
        tdClassName: "max-w-[170px]",
        cell: (c) => {
          const name = store.fgItemById(c.request.fgItemId)?.name ?? "—";
          return (
            <span className="block truncate" title={name}>
              {name}
            </span>
          );
        },
        sortValue: (c) => store.fgItemById(c.request.fgItemId)?.name ?? "",
        filter: { kind: "select", get: (c) => store.fgItemById(c.request.fgItemId)?.name ?? "—" },
      },
      {
        key: "fgQty",
        header: "Qty",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (c) => (c.request.fgQty != null ? String(c.request.fgQty) : "—"),
        sortValue: (c) => c.request.fgQty ?? -1,
      },
      {
        // The date the raiser says the job belongs to. Deliberately NOT the clock
        // the durations run on, and null on cards raised before the field existed —
        // which is why it is shown beside `Started`, never instead of it.
        key: "jobDate",
        header: "Job date",
        defaultHidden: true,
        cell: (c) => formatDate(c.jobDateIso),
        sortValue: (c) => c.jobDateIso ?? "",
        filter: { kind: "date", get: (c) => c.jobDateIso ?? "" },
      },
      {
        key: "started",
        header: "Started",
        tdClassName: "whitespace-nowrap",
        cell: (c) => formatDateTime(c.startIso),
        sortValue: (c) => c.startIso,
        filter: { kind: "date", get: (c) => c.startIso },
      },
      {
        key: "finished",
        header: "Finished",
        tdClassName: "whitespace-nowrap",
        cell: (c) => (c.endIso ? formatDateTime(c.endIso) : "—"),
        sortValue: (c) => c.endIso ?? "",
        filter: { kind: "date", get: (c) => c.endIso ?? "" },
      },
      {
        key: "total",
        header: "Total",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (c) => (
          <span className={c.done ? "font-semibold text-navy" : "font-semibold text-grey-2"}>
            {totalLabel(c)}
          </span>
        ),
        sortValue: (c) => c.totalMs,
        exportValue: (c) => msToHours(c.totalMs),
      },
      {
        // Hidden by default because it SAYS THE SAME THING as `Now at` one column
        // over — "Awaiting PM transfer" beside "Packing Material Transfer (Tally)" —
        // and both were wrapping to three lines to do it. `Now at` covers the open
        // steps in fewer words and covers closed / held / cancelled too, so this is
        // the one that goes. Still a tick away in the Columns menu.
        key: "status",
        header: "Status",
        defaultHidden: true,
        cell: (c) => <StatusPill status={c.request.status} />,
        sortValue: (c) => STATUS_LABEL[c.request.status],
        filter: { kind: "select", get: (c) => STATUS_LABEL[c.request.status] },
      },
      {
        key: "at",
        header: "Now at",
        tdClassName: "whitespace-nowrap",
        // The SHORT step label, not the full title: "PM Transfer" says what
        // "Packing Material Transfer (Tally)" says, in one line instead of three.
        // A card that owes no step is closed, held or cancelled — say which, rather
        // than an em-dash that leaves the reader hunting for the Status column.
        cell: (c) => whereNow(c),
        sortValue: (c) => whereNow(c),
        filter: { kind: "select", get: (c) => whereNow(c) },
      },
      {
        key: "age",
        header: "Age",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        cell: (c) => {
          const leg = c.legs.find((l) => l.running);
          return leg?.ms != null ? formatDuration(leg.ms) : "—";
        },
        sortValue: (c) => c.legs.find((l) => l.running)?.ms ?? -1,
        exportValue: (c) => msToHours(c.legs.find((l) => l.running)?.ms ?? null),
      },
      {
        // Carried because a reworked lot's Handover & QC time is UNDER-counted: the
        // step stamps are coalesce-first, so the re-passes leave no trace. A reader
        // seeing a round count here knows to distrust that row's early stages.
        key: "rework",
        header: "Rework",
        align: "right",
        tdClassName: "whitespace-nowrap text-right",
        defaultHidden: true,
        cell: (c) => (c.reworkRounds ? String(c.reworkRounds) : "—"),
        sortValue: (c) => c.reworkRounds,
        filter: { kind: "select", get: (c) => (c.reworkRounds ? `${c.reworkRounds} round(s)` : "None") },
      },
      {
        key: "held",
        header: "Held",
        defaultHidden: true,
        cell: (c) => (c.held ? "On hold" : "—"),
        sortValue: (c) => (c.held ? 1 : 0),
        filter: { kind: "select", get: (c) => (c.held ? "On hold" : "No") },
      },
      ...stageOrStep,
    ];
  }, [r.level, store]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Lot Cycle Time</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Every lot, and how long it spent at each stage. A lot still running shows the time it has
          taken <em>so far</em>; stages it has not reached yet are blank, not zero.
        </p>
        <p className="mt-1 text-[12.5px] text-grey-2">
          The chart follows the filters in the card below it, not the per-column filters inside the
          table — narrowing a column narrows the table only.
        </p>
      </div>

      <CycleFilters r={r} />
      <KpiRow tiles={tiles} />
      <LotStageChart cycles={r.rows} />

      <QueueTable
        rows={r.rows}
        rowKey={(c) => c.request.id}
        columns={columns}
        rowsLabel="lots"
        loading={r.isLoading}
        initialSort={{ key: "total", dir: "desc" }}
        emptyTitle="No job cards yet"
        emptyMessage="A lot appears here the moment an issue slip is raised."
        exportName="Production_Lot_Cycle_Time"
        exportTitle="Production — lot cycle time"
        exportNotes={EXPORT_NOTES}
        columnPicker={{ storageKey: "production-lot-cycle-v2" }}
        // Twenty-odd columns wide: the rules are what let the eye track one lot
        // across eleven step durations without sliding onto the row above.
        columnRules
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Where the lot is right now — its open step, or why it has none. */
function whereNow(c: LotCycle): string {
  if (c.openStep) return stepShort(c.openStep);
  return STATUS_LABEL[c.request.status] ?? "—";
}

/**
 * A leg's duration, with the three things it can be other than a number said in
 * words rather than implied by a blank.
 */
function durationCell(leg: { applies: boolean; ms: number | null; running: boolean; suspect: boolean } | undefined) {
  if (!leg) return <span className="text-grey-2">—</span>;
  const text = legLabel(leg);
  if (!leg.applies) return <span className="text-grey-2 italic">n/a</span>;
  if (leg.suspect)
    return (
      <span className="text-ryg-red" title="This step is stamped as finishing before it started — the row needs checking.">
        ?
      </span>
    );
  if (leg.running) return <span className="text-grey-2">{text}</span>;
  return <span>{text}</span>;
}

const EXPORT_NOTES: string[] = [
  "Durations are plain clock time between one step's completion stamp and the next — nights, Sundays and holidays included.",
  "A step's start is the previous step's completion. There is no separate 'entered stage' timestamp in the system.",
  "'so far' means the lot is still sitting at that step; the clock is still running. Stages it has not reached are blank, not zero.",
  "'n/a' means the step is not part of this lot's journey: either the card type never runs it (a repackaging card skips material handover, RM transfer, quality, the log book, production entry and M/C testing), or it is the Additional Issue Slip, which only happens when quality rejects a lot.",
  "'<1m' means the two steps were saved within the same minute of each other, i.e. entered together. It is not a stage that took no time.",
  "'?' means the step is stamped as finishing before it started. Those legs are excluded from every average.",
  "REWORK IS UNDER-COUNTED: when a QC-rejected lot loops back through the Additional Issue Slip, the handover, RM transfer and quality steps keep their FIRST timestamps, so the repeat passes are invisible. Check the Rework column before trusting an early stage on such a lot.",
  "A HOLD THAT HAS ENDED IS INVISIBLE: the hold timestamp is cleared on resume, so time a lot spent on hold is included in its step duration with nothing to mark it. Only a lot on hold right now is flagged.",
];
