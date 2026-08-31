/**
 * Production Entry cycle time — how long a lot spent at each stage, and what that
 * makes the average for the stage.
 *
 * Pure: takes a snapshot and a clock, returns plain data, knows nothing about the
 * signed-in user. Both report screens consume these, so their numbers cannot drift.
 *
 * THE MODEL. There is no `entered_at` column anywhere in this FMS. A step's start is
 * only ever derivable as its anchor's completion, which `queues.ts` already maps in
 * `ANCHOR_AT` and now exposes as `stepStartedAt`. So:
 *
 *     duration at step S  =  stepDoneAt(S)  −  stepStartedAt(S)
 *
 * and a stage's duration is the sum of its member steps. The chain is contiguous —
 * each leg starts where the last one ended — so summing legs and spanning
 * first-start to last-end give the same answer, and summing is the one that skips a
 * step a card type never runs.
 *
 * WHAT THIS CANNOT SEE, stated once so no screen has to guess:
 *
 *  · A REWORK LOOP under-counts. Every step RPC stamps `x_at = coalesce(x_at, now())`,
 *    so when a QC-rejected lot loops back through Additional Issue Slip → Handover →
 *    RM Transfer, those steps keep their FIRST timestamps. Only `ais_at` moves. The
 *    extra passes are invisible; `reworkRounds` is carried so a reader can distrust
 *    the row rather than be misled by it.
 *  · A PAST HOLD is invisible. `hold_at` is set on hold and set back to NULL on resume,
 *    so a card held for three days and released shows those days inside its step
 *    duration with nothing at all to mark them. Only a card held RIGHT NOW can be
 *    flagged. This is not fixable from the current schema.
 *  · SAME-SECOND ENTRY is not a fast stage. Steps typed together stamp within a second
 *    of each other; `formatDuration` renders that as `<1m`, and `subMinute` counts how
 *    many legs behind an average were measured that way — the honest denominator.
 */
import { formatDuration, daysBetweenIso } from "@/shared/lib/time";
import { localDateIso } from "@/shared/lib/workingDays";
import { STEPS, STAGES, stepAppliesTo, type StepKey } from "./steps";
import {
  openStep,
  productionDueIso,
  stepDoneAt,
  stepStartedAt,
  type ProductionSnapshot,
  type QueueStep,
} from "./queues";
import type { StepSlaMap } from "./sla";
import type { ProductionRequest } from "../types";

/** Every step that owns a queue, in chain order. `issue_slip` is the origin and holds none. */
export const QUEUE_STEPS: QueueStep[] = STEPS.filter((s) => !s.noQueue).map((s) => s.key as QueueStep);

const TITLE: Record<string, string> = Object.fromEntries(STEPS.map((s) => [s.key, s.title]));
const SHORT: Record<string, string> = Object.fromEntries(STEPS.map((s) => [s.key, s.short]));

/** A step key to its full title, for a column header or a "currently at" cell. */
export const stepTitle = (step: string): string => TITLE[step] ?? step;

/** A step key to its short label, where a column header has to stay narrow. */
export const stepShort = (step: string): string => SHORT[step] ?? step;

/** Which of the five stages a step rolls into. */
const STAGE_OF: Record<string, string> = Object.fromEntries(
  STAGES.flatMap((st) => st.keys.map((k) => [k as string, st.label])),
);

/* -------------------------------------------------------------------------- */
/*  One lot's time at one step                                                */
/* -------------------------------------------------------------------------- */

export interface StepLeg {
  step: QueueStep;
  title: string;
  short: string;
  stageLabel: string;
  /** False when this card type never runs this step — renders "n/a", never 0. */
  applies: boolean;
  startIso: string | null;
  endIso: string | null;
  /** end − start, or now − start while running. Null when it cannot be measured. */
  ms: number | null;
  /** This is the lot's current open step: the clock is still going. */
  running: boolean;
  /** end precedes start. Never averaged, never printed as a negative. */
  suspect: boolean;
  dueIso: string | null;
  /** Whole days past the due date; negative = early; null when there is no due date. */
  lateDays: number | null;
}

export interface StageLeg {
  label: string;
  keys: QueueStep[];
  applies: boolean;
  /** Sum of the member legs that could be measured. */
  ms: number | null;
  running: boolean;
  /** Every applicable member has an end — the stage is behind the lot. */
  complete: boolean;
  suspect: boolean;
  /** True when no applicable member missed its due date; null when none had one. */
  onTime: boolean | null;
}

export interface LotCycle {
  request: ProductionRequest;
  legs: StepLeg[];
  stages: StageLeg[];
  /**
   * The clock the durations run on — when the row was created.
   *
   * ⚠ NOT the same thing as `jobDateIso`. `issue_date` is the date the raiser says the
   * job belongs to and is back-datable; `submitted_at` is when it actually entered the
   * system, and it is what every step's SLA is anchored on. Showing one in place of the
   * other would quietly change what the report measures.
   */
  startIso: string;
  jobDateIso: string | null;
  endIso: string | null;
  totalMs: number;
  done: boolean;
  openStep: QueueStep | null;
  /** Additional Issue Slip rounds — see the rework caveat at the top of this file. */
  reworkRounds: number;
  /** On hold RIGHT NOW. A released hold leaves no trace; see the file header. */
  held: boolean;
}

/**
 * The linear chain, without the QC-reject branch. `additional_issue_slip` is a
 * detour off quality checking, not a link in the spine, so walking back through it
 * would hand a later step a start that is not upstream of it.
 */
const SPINE: QueueStep[] = QUEUE_STEPS.filter((s) => s !== "additional_issue_slip");

/**
 * A step's start, with the one correction the due-date map cannot make.
 *
 * `ANCHOR_AT` points `additional_issue_slip` at `qcActualDate` — a DATE. That is right
 * for a due date, which is date-granular by design, and wrong for a duration: it drops
 * the time of day, so a slip issued four hours after QC measures as either a whole day
 * or a NEGATIVE span depending on which side of midnight it fell. The real anchor for
 * the elapsed clock is `qc_at`, the timestamp of the very same event.
 */
function legStart(step: QueueStep, r: ProductionRequest): string | null {
  if (step === "additional_issue_slip") return r.qcAt;

  const declared = stepStartedAt(step, r);
  if (declared) return declared;

  // The declared anchor produced nothing. Walk back to the nearest EARLIER step that
  // actually left a stamp, and failing that, to the card's own start.
  //
  // This is not belt-and-braces — without it a repackaging card is unmeasurable end
  // to end. Such a card is raised straight into `awaiting_pm_transfer`, but
  // `pm_transfer` anchors on `mc_testing`, a step repackaging NEVER runs. So its
  // anchor is null and always will be, and every leg downstream would inherit a
  // missing start. The same hole opens for a production card whose M/C testing was
  // BYPASSED by an admin, which sets `mc_bypassed_at` and leaves `mc_at` null.
  //
  // Safe for a step the card has simply not REACHED yet: such a leg has no end and is
  // not running, so it stays unmeasured whatever start it is given.
  const i = SPINE.indexOf(step);
  for (let j = i - 1; j >= 0; j--) {
    const done = stepDoneAt(SPINE[j], r);
    if (done) return done;
  }
  return r.submittedAt;
}

function buildLegs(
  snap: ProductionSnapshot,
  r: ProductionRequest,
  nowMs: number,
  open: QueueStep | null,
): StepLeg[] {
  return QUEUE_STEPS.map((step) => {
    // Two different reasons a step may not be part of THIS lot's journey:
    //
    //  · the card type never runs it (a repackaging card skips the six manufacturing
    //    steps), which is what `stepAppliesTo` answers; and
    //  · the Additional Issue Slip is a BRANCH off quality checking, not a link in
    //    the chain — it fires only when QC rejects. Counting it as applicable to
    //    every production card is what made `Handover & QC` never read as complete,
    //    and that stage holds most of the book: the one stage with real data would
    //    have reported "none measured" forever.
    const applies =
      stepAppliesTo(r.cardType, step as StepKey) &&
      (step !== "additional_issue_slip" || !!r.aisAt || open === "additional_issue_slip");
    const startIso = applies ? legStart(step, r) : null;
    const endIso = applies ? stepDoneAt(step, r) : null;
    const running = applies && open === step;

    const start = startIso ? new Date(startIso).getTime() : NaN;
    const end = endIso ? new Date(endIso).getTime() : NaN;

    let ms: number | null = null;
    let suspect = false;
    if (!Number.isNaN(start)) {
      if (!Number.isNaN(end)) {
        ms = end - start;
        if (ms < 0) {
          suspect = true;
          ms = 0;
        }
      } else if (running) {
        ms = Math.max(0, nowMs - start);
      }
    }

    const dueIso = applies ? productionDueIso(snap, r, step) : null;
    // Compare DATE to DATE: a due date is a calendar day, so the completion has to be
    // reduced to the day it landed on before the two can be subtracted.
    const landedIso = endIso
      ? localDateIso(new Date(endIso))
      : running
        ? localDateIso(new Date(nowMs))
        : null;
    const lateDays = dueIso && landedIso ? daysBetweenIso(dueIso, landedIso) : null;

    return {
      step,
      title: TITLE[step] ?? step,
      short: SHORT[step] ?? step,
      stageLabel: STAGE_OF[step] ?? "",
      applies,
      startIso,
      endIso,
      ms,
      running,
      suspect,
      dueIso,
      lateDays,
    };
  });
}

function rollUpStages(legs: StepLeg[]): StageLeg[] {
  const byStep = new Map(legs.map((l) => [l.step, l]));
  return STAGES.map((stage) => {
    const keys = stage.keys as QueueStep[];
    const members = keys.map((k) => byStep.get(k)).filter((l): l is StepLeg => !!l);
    const live = members.filter((l) => l.applies);
    const measured = live.filter((l) => l.ms != null);
    const dated = live.filter((l) => l.lateDays != null);
    return {
      label: stage.label,
      keys,
      applies: live.length > 0,
      ms: measured.length ? measured.reduce((a, l) => a + (l.ms ?? 0), 0) : null,
      running: live.some((l) => l.running),
      complete: live.length > 0 && live.every((l) => !!l.endIso),
      suspect: live.some((l) => l.suspect),
      onTime: dated.length ? dated.every((l) => (l.lateDays ?? 0) <= 0) : null,
    };
  });
}

/** Every lot as a chain of measured legs. THE builder — both screens go through it. */
export function buildLotCycles(snap: ProductionSnapshot, nowMs: number): LotCycle[] {
  return snap.requests.map((r) => {
    const open = openStep(r);
    const legs = buildLegs(snap, r, nowMs, open);
    const endIso = r.closedAt ?? r.fgAt;
    const start = new Date(r.submittedAt).getTime();
    const end = endIso ? new Date(endIso).getTime() : nowMs;
    return {
      request: r,
      legs,
      stages: rollUpStages(legs),
      startIso: r.submittedAt,
      jobDateIso: r.issueDate,
      endIso,
      totalMs: Number.isNaN(start) ? 0 : Math.max(0, end - start),
      done: !!endIso,
      openStep: open,
      reworkRounds: r.aisRounds?.length ?? 0,
      held: r.status === "on_hold",
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Stage-wise aggregation                                                    */
/* -------------------------------------------------------------------------- */

export interface StatRow {
  key: string;
  label: string;
  /** Legs behind every number in this row. */
  measured: number;
  /** Lots sitting in it at this moment — not part of the averages. */
  inItNow: number;
  /** Lots whose card type never runs it. */
  notApplicable: number;
  /**
   * Measured legs shorter than a minute — steps that were TYPED together, not stages
   * that took no time. Published beside the average so a reader can see how much of it
   * is real floor time.
   */
  subMinute: number;
  meanMs: number | null;
  medianMs: number | null;
  p90Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  /** The configured allowance, in working days. Null where the step has no due date. */
  targetDays: number | null;
  withinTarget: number | null;
  withinPct: number | null;
}

const median = (sorted: number[]): number | null =>
  sorted.length === 0
    ? null
    : sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

/** Nearest-rank P90 — with a handful of lots this is the slowest one, which is the point. */
const p90 = (sorted: number[]): number | null =>
  sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];

/**
 * A leg counts toward an average only if it is finished, applicable and believable.
 * ONE definition, used by both levels — the alternative is two screens quietly
 * disagreeing about what the average counted.
 */
const countable = (l: {
  applies: boolean;
  running: boolean;
  suspect: boolean;
  ms: number | null;
}): boolean => l.applies && !l.running && !l.suspect && l.ms != null;

function statsFrom(spans: number[]): Pick<StatRow, "meanMs" | "medianMs" | "p90Ms" | "minMs" | "maxMs"> {
  if (!spans.length) return { meanMs: null, medianMs: null, p90Ms: null, minMs: null, maxMs: null };
  const sorted = [...spans].sort((a, b) => a - b);
  return {
    meanMs: spans.reduce((a, b) => a + b, 0) / spans.length,
    medianMs: median(sorted),
    p90Ms: p90(sorted),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * The stage-wise table: one row per stage, or per step.
 *
 * `stepSla` supplies the target. A step with no due date — the Log Book Entry is
 * entered without dates and never runs overdue — reports a null target rather than a
 * fabricated one, and is left out of its stage's target sum.
 */
export function aggregate(cycles: LotCycle[], level: "stage" | "step", stepSla: StepSlaMap): StatRow[] {
  const targetOf = (step: QueueStep): number | null => {
    // Mirrors productionDueIso: the Log Book Entry has no due date at all.
    if (step === "transfer_slip") return null;
    return stepSla[step]?.days ?? null;
  };

  if (level === "step") {
    return QUEUE_STEPS.map((step) => {
      const legs = cycles
        .map((c) => c.legs.find((l) => l.step === step))
        .filter((l): l is StepLeg => !!l);
      const counted = legs.filter(countable);
      const spans = counted.map((l) => l.ms as number);
      const dated = counted.filter((l) => l.lateDays != null);
      const within = dated.filter((l) => (l.lateDays as number) <= 0).length;
      return {
        key: step,
        label: TITLE[step] ?? step,
        measured: counted.length,
        inItNow: legs.filter((l) => l.running).length,
        notApplicable: legs.filter((l) => !l.applies).length,
        subMinute: spans.filter((ms) => ms < 60_000).length,
        ...statsFrom(spans),
        targetDays: targetOf(step),
        withinTarget: dated.length ? within : null,
        withinPct: dated.length ? (within / dated.length) * 100 : null,
      };
    });
  }

  return STAGES.map((stage) => {
    const keys = stage.keys as QueueStep[];
    const legs = cycles
      .map((c) => c.stages.find((s) => s.label === stage.label))
      .filter((s): s is StageLeg => !!s);
    // A stage counts only once the lot has cleared ALL of its applicable steps — a
    // half-finished stage would otherwise drag the average down with a partial sum.
    const counted = legs.filter((l) => countable(l) && l.complete);
    const spans = counted.map((l) => l.ms as number);
    const dated = counted.filter((l) => l.onTime != null);
    const within = dated.filter((l) => l.onTime === true).length;
    // The Additional Issue Slip's allowance is left out of a stage target. It is a
    // rework branch, so folding it in would measure every lot that never needed one
    // against a target that budgets for rework — and quietly excuse a slow stage.
    const targets = keys
      .filter((k) => k !== "additional_issue_slip")
      .map(targetOf)
      .filter((d): d is number => d != null);
    return {
      key: stage.label,
      label: stage.label,
      measured: counted.length,
      inItNow: legs.filter((l) => l.running).length,
      notApplicable: legs.filter((l) => !l.applies).length,
      subMinute: spans.filter((ms) => ms < 60_000).length,
      ...statsFrom(spans),
      targetDays: targets.length ? targets.reduce((a, b) => a + b, 0) : null,
      withinTarget: dated.length ? within : null,
      withinPct: dated.length ? (within / dated.length) * 100 : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Display                                                                    */
/* -------------------------------------------------------------------------- */

/** A leg's duration as a reader sees it: "n/a" when skipped, "… so far" while running. */
export function legLabel(l: {
  applies: boolean;
  ms: number | null;
  running: boolean;
  suspect: boolean;
}): string {
  if (!l.applies) return "n/a";
  if (l.suspect) return "?";
  if (l.ms == null) return "—";
  return l.running ? `${formatDuration(l.ms)} so far` : formatDuration(l.ms);
}

/** A lot's total, which reads "so far" until it clears FG Transfer. */
export const totalLabel = (c: LotCycle): string =>
  c.done ? formatDuration(c.totalMs) : `${formatDuration(c.totalMs)} so far`;

/** Hours to one decimal, for Excel — a spreadsheet cannot pivot on "6d 4h". */
export const msToHours = (ms: number | null): number | string =>
  ms == null ? "" : Math.round((ms / 3_600_000) * 10) / 10;

/** How many STEP legs across the whole view were countable at all. */
export function measuredLegCount(cycles: LotCycle[]): number {
  return cycles.reduce((n, c) => n + c.legs.filter(countable).length, 0);
}

/** How many measured legs across the whole view were same-second entry. */
export function subMinuteCount(cycles: LotCycle[]): number {
  return cycles.reduce(
    (n, c) => n + c.legs.filter((l) => countable(l) && (l.ms as number) < 60_000).length,
    0,
  );
}

/* -------------------------------------------------------------------------- */
/*  Chart data                                                                */
/* -------------------------------------------------------------------------- */

/** One stage's slice of a lot's bar. */
export interface StageSlice {
  /** Days to one decimal — a factory reads a stage in days, and the axis stays narrow. */
  days: number;
  ms: number | null;
  /** The lot is sitting in this stage now: the segment is drawn paler. */
  running: boolean;
}

export interface LotChartRow {
  id: string;
  /** The Lot / Batch number, or the ref if a card somehow has none. */
  lot: string;
  totalMs: number;
  done: boolean;
  /** Keyed by stage label — the rich version, for the tooltip. */
  byStage: Record<string, StageSlice>;
  /**
   * Each stage label ALSO sits flat on the row, holding just its day count.
   *
   * Recharts resolves a `dataKey` through a lodash-style path, which splits on dots
   * and brackets — so a nested `byStage.<label>.days` would be at the mercy of what
   * the label happens to contain. Two of ours are "M/C Testing" and "Handover & QC".
   * A flat key is looked up whole and cannot be mis-parsed. No stage label collides
   * with the fields above.
   */
  [stageLabel: string]: unknown;
}

export interface LotChartData {
  rows: LotChartRow[];
  /** How many bars are drawn. */
  shown: number;
  /** How many lots were in view. `total > shown` means the caller must SAY so. */
  total: number;
}

/**
 * The lot-wise chart's rows: slowest lot first, cut to `limit`.
 *
 * Lives here rather than in the chart component on purpose. Every number on this
 * screen comes out of this file, and a chart that totals its own data is a second
 * source of truth — it will eventually disagree with the table sitting above it,
 * and the table is the one people will check.
 *
 * Returns `shown` and `total` so the caller can state the cut. A chart that silently
 * drops 105 of 125 lots reads as "this is the book", which it is not.
 */
export function lotStageChartRows(cycles: LotCycle[], limit: number): LotChartData {
  const rows = [...cycles]
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, Math.max(0, limit))
    .map((c) => {
      const byStage: Record<string, StageSlice> = {};
      const flat: Record<string, number> = {};
      for (const s of c.stages) {
        // A stage the card type never runs contributes nothing — not a zero segment,
        // which recharts would still reserve a sliver and a tooltip row for.
        const slice: StageSlice = s.applies
          ? { days: s.ms == null ? 0 : Math.round((s.ms / 86_400_000) * 10) / 10, ms: s.ms, running: s.running }
          : { days: 0, ms: null, running: false };
        byStage[s.label] = slice;
        flat[s.label] = slice.days;
      }
      return {
        id: c.request.id,
        lot: c.request.jobcardNo || c.request.reqNo,
        totalMs: c.totalMs,
        done: c.done,
        byStage,
        ...flat,
      };
    });
  return { rows, shown: rows.length, total: cycles.length };
}
