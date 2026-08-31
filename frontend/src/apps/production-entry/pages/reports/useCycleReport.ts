/**
 * The one lot set both cycle-time reports read.
 *
 * Lot-wise and Stage-wise are two views of the same question, so they must never be
 * looking at different lots. This hook owns the period, the card-type and FG filters
 * and the stage/step detail level, and hands back the filtered `LotCycle[]`. Both
 * screens call it; neither filters on its own.
 *
 * The state lives in ONE sticky namespace shared by both pages, so walking from the
 * lot table to the stage table keeps the period you set — and a hard refresh is the
 * clean slate, which is `stickyState`'s deliberate escape hatch.
 */
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useStickyScope, useStickyState } from "@/shared/lib/stickyState";
import {
  EMPTY_RANGE,
  dateInRange,
  isRangeActive,
  rangeLabel,
  type DateRange,
} from "@/shared/components/ui/DateRangeFilter";
import { useProductionStore } from "../../store";
import { productionSnapshotFrom } from "../../lib/queues";
import { buildLotCycles, type LotCycle } from "../../lib/cycleTime";
import { CARD_TYPE_LABEL } from "../../lib/format";
import type { StepSlaMap } from "../../lib/sla";
import type { ProductionCardType } from "../../types";

export type CycleLevel = "stage" | "step";
export type CardTypeFilter = "" | ProductionCardType;

const STICKY_NS = "production-cycle-report";

/**
 * How often the "so far" clocks advance.
 *
 * Every open lot's current leg is measured against now, so a value captured once at
 * mount would quietly go stale on a tab left open all afternoon — and this is a
 * screen people leave open. A minute is finer than any duration this report prints.
 */
const TICK_MS = 60_000;

function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export interface CycleReport {
  /** Every lot, unfiltered. Keys the full-page empty state — see below. */
  all: LotCycle[];
  /** The lots surviving the filters. What both tables render. */
  rows: LotCycle[];
  isLoading: boolean;
  stepSla: StepSlaMap;

  level: CycleLevel;
  setLevel: Dispatch<SetStateAction<CycleLevel>>;
  range: DateRange;
  setRange: Dispatch<SetStateAction<DateRange>>;
  cardType: CardTypeFilter;
  setCardType: Dispatch<SetStateAction<CardTypeFilter>>;
  fgItemId: string;
  setFgItemId: Dispatch<SetStateAction<string>>;

  fgOptions: { value: string; label: string }[];
  /** The active filters in words — for the screen and for the export's About sheet. */
  filters: string[];
  anyFilter: boolean;
  clear: () => void;
}

export function useCycleReport(): CycleReport {
  const s = useProductionStore();
  const now = useMinuteTick();

  const scope = useStickyScope(STICKY_NS);
  const [level, setLevel] = useStickyState<CycleLevel>(scope, "level", "stage");
  const [range, setRange] = useStickyState<DateRange>(scope, "range", EMPTY_RANGE);
  const [cardType, setCardType] = useStickyState<CardTypeFilter>(scope, "cardType", "");
  const [fgItemId, setFgItemId] = useStickyState<string>(scope, "fgItemId", "");

  // productionSnapshotFrom is THE snapshot builder — the queue pages and the
  // cross-FMS adapter both go through it, so the report cannot be reading a
  // differently-assembled view of the same data.
  const all = useMemo(
    () => buildLotCycles(productionSnapshotFrom({ requests: s.requests, stepSla: s.stepSla }), now),
    [s.requests, s.stepSla, now],
  );

  const rows = useMemo(
    () =>
      all.filter(
        (c) =>
          // Filtered on the lot's START, not its finish: a period means "the lots
          // that began in it", which is the only reading that includes the ones
          // still running — and those are most of the book today.
          (!isRangeActive(range) || dateInRange(c.startIso, range)) &&
          (!cardType || c.request.cardType === cardType) &&
          (!fgItemId || c.request.fgItemId === fgItemId),
      ),
    [all, range, cardType, fgItemId],
  );

  const fgOptions = useMemo(
    () => s.activeFgItems.map((f) => ({ value: f.id, label: f.name })),
    [s.activeFgItems],
  );

  const filters = useMemo(() => {
    const out: string[] = [];
    if (isRangeActive(range)) out.push(`Started: ${rangeLabel(range)}`);
    if (cardType) out.push(`Type: ${CARD_TYPE_LABEL[cardType]}`);
    if (fgItemId) out.push(`FG item: ${s.fgItemById(fgItemId)?.name ?? fgItemId}`);
    out.push(level === "stage" ? "Detail: 5 stages" : "Detail: 11 steps");
    return out;
    // fgItemById closes over the masters list, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, cardType, fgItemId, level, s.fgItems]);

  const clear = () => {
    setRange(EMPTY_RANGE);
    setCardType("");
    setFgItemId("");
  };

  // The detail level is a way of LOOKING, not a way of narrowing — it never hides a
  // lot, so it must not count toward "you have filters on".
  const anyFilter = isRangeActive(range) || !!cardType || !!fgItemId;

  return {
    all,
    rows,
    isLoading: s.isLoading,
    stepSla: s.stepSla,
    level,
    setLevel,
    range,
    setRange,
    cardType,
    setCardType,
    fgItemId,
    setFgItemId,
    fgOptions,
    filters,
    anyFilter,
    clear,
  };
}
