import { Link } from "react-router-dom";
import { formatDateDMY } from "@/shared/lib/date";
import { BOARD_COLUMNS, PHASE_FILL, PHASE_OF, type BoardColumnKey, type CandidatePhase } from "../../lib/board";
import { isLivePosition } from "../../lib/positions";
import type { Requisition } from "../../types";

/**
 * EVERY position's pipeline, one row each.
 *
 * THE SHAPE IS THE WHOLE POINT. Reading "is this pipeline top-heavy, or is anything
 * near an offer?" used to mean opening nineteen boards in turn. Down a column you now
 * read which vacancies are stuck where; across a row you read one vacancy's shape.
 * Nothing is summed across positions — each row stays attached to its own job, which is
 * what makes this legitimate where a single summed strip was not.
 *
 * TWO VIEWS OF THE SAME NUMBERS. Phases (five columns) is the default and answers the
 * glance. Stages opens the ten board columns underneath, banded by phase — which is also
 * how the screen answers "what is actually inside Screening?" without a legend.
 *
 * ⚠ NO HEAT MAP, AND NOT BY ACCIDENT. The first version tinted each cell by phase and
 *   scaled `opacity` with the count. `opacity` fades the ELEMENT, so it faded the number
 *   too: a cell holding 1 against a peak of 28 drew its text at 27% and was unreadable.
 *   Colour now does one job only — naming the phase, in the header dot and in the shape
 *   bar — and every count is drawn at full strength. Magnitude is read from the digits,
 *   which is what digits are for.
 *
 * ⚠ THIS IS NOT PipelineSummary, and deliberately does not reuse it: that component
 *   renders three bar SEGMENTS for one vacancy and `return null`s when a vacancy has no
 *   candidates — and a vacancy with no CVs at all is precisely what management opens this
 *   screen to find. What IS reused is the vocabulary (PHASE_OF / PHASE_FILL / columnOf
 *   from lib/board) and the strip's own styling, so a phase cannot mean one thing on the
 *   board and another here.
 */
export interface MatrixRow {
  requisition: Requisition;
  counts: Record<CandidatePhase, number>;
  /** Per board column, for the Stages view. Keyed by `columnOf`, never by raw stage. */
  columnCounts: Record<BoardColumnKey, number>;
  total: number;
}

export type MatrixView = "phases" | "stages";

/** Left to right, in pipeline order. The two outcomes sit last, after a divider. */
export const MATRIX_PHASES: { key: CandidatePhase; label: string }[] = [
  { key: "screening", label: "Screening" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "dropped", label: "Dropped" },
];

/**
 * The board columns, grouped under the phase each belongs to.
 *
 * ⚠ `hired` is moved AHEAD of `disqualified`, which is not `BOARD_COLUMNS` order. The
 *   bands have to be contiguous and have to match the Phases view's column order, and
 *   the board lists Disqualified first. The reorder is presentational only — every count
 *   still comes from `columnOf`.
 */
export const STAGE_BANDS: { phase: CandidatePhase; label: string; columns: BoardColumnKey[] }[] = [
  { phase: "screening", label: "Screening", columns: ["resumes", "hr_shortlist", "hod_shortlist"] },
  { phase: "interviewing", label: "Interviewing", columns: ["telephonic", "r1", "r2", "r3"] },
  { phase: "offer", label: "Offer", columns: ["offer"] },
  { phase: "hired", label: "Hired", columns: ["hired"] },
  { phase: "dropped", label: "Dropped", columns: ["disqualified"] },
];

/** Short header labels — the band above already says which phase they belong to. */
const COLUMN_LABEL: Record<BoardColumnKey, string> = {
  resumes: "Resumes",
  hr_shortlist: "HR",
  hod_shortlist: "HOD",
  telephonic: "Telephonic",
  r1: "R1",
  r2: "R2",
  r3: "R3",
  offer: "Offer",
  hired: "Hired",
  disqualified: "Dropped",
};

/** The flat left-to-right column order used by the Stages view. */
export const STAGE_COLUMNS: BoardColumnKey[] = STAGE_BANDS.flatMap((b) => b.columns);

/** What each phase contains, in words — the Phases header's tooltip. */
export const PHASE_CONTENTS: Record<CandidatePhase, string> = Object.fromEntries(
  STAGE_BANDS.map((b) => [
    b.phase,
    b.columns.map((c) => BOARD_COLUMNS.find((bc) => bc.key === c)?.label ?? COLUMN_LABEL[c]).join(" · "),
  ]),
) as Record<CandidatePhase, string>;

const HEAD_CELL =
  "px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2";

/**
 * EVERY column boundary carries a rule, and they are all the same weight.
 *
 * The first cut drew one only where a phase band started, which left the table looking
 * half-ruled — a line after Position and another before All, nothing between the phase
 * columns. A grid of numbers wants its columns separated consistently or the eye cannot
 * tell which figure belongs to which heading.
 */
const RULE = "border-l border-line/70";

/** When the position was opened. Same expression PositionsList's Posted column uses,
 *  so the two screens cannot print different dates for the same vacancy. */
const openedIso = (r: Requisition): string | null => r.postedAt ?? r.submittedAt ?? null;

/** Whole days since it opened. Only meaningful while it is still taking candidates. */
function daysOpen(r: Requisition): number | null {
  const iso = openedIso(r);
  if (!iso || !isLivePosition(r)) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export default function PipelineMatrix({
  rows,
  totals,
  columnTotals,
  view,
  selected,
  onPick,
  statusLabelOf,
}: {
  rows: MatrixRow[];
  /** Phase sums over the rows shown, so this band and the KPI strip reconcile. */
  totals: Record<CandidatePhase, number>;
  /** Board-column sums over the rows shown, for the Stages view's footer. */
  columnTotals: Record<BoardColumnKey, number>;
  view: MatrixView;
  /** The cell currently drilled into, if any. */
  selected: { requisitionId: string; phase?: CandidatePhase; column?: BoardColumnKey } | null;
  /** Click a cell to narrow the list below; click the same cell again to clear. */
  onPick: (requisitionId: string, key: { phase?: CandidatePhase; column?: BoardColumnKey }) => void;
  statusLabelOf: (r: Requisition) => string;
}) {
  const stages = view === "stages";
  // The busiest row on screen. The shape bar's LENGTH is scaled against this, so a row
  // of 1 does not present the same slab of colour as a row of 28 — see ShapeBar.
  const busiest = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          {/* The phase bands. Stages view only — in Phases the columns ARE the phases. */}
          {stages && (
            <tr className="border-b border-line bg-page/60">
              <th className="sticky left-0 z-10 bg-page/60 px-3 py-1.5" aria-hidden="true" />
              <th className={`${RULE} px-3 py-1.5`} aria-hidden="true" />
              {STAGE_BANDS.map((b) => (
                <th
                  key={b.phase}
                  colSpan={b.columns.length}
                  className="border-l border-line px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-grey-2"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: PHASE_FILL[b.phase] }}
                      aria-hidden="true"
                    />
                    {b.label}
                  </span>
                </th>
              ))}
              <th className="border-l border-line px-3 py-1.5" aria-hidden="true" />
              <th className={`${RULE} px-3 py-1.5`} aria-hidden="true" />
            </tr>
          )}

          <tr className="border-b border-line bg-page/60">
            <th className={`sticky left-0 z-10 bg-page/60 text-left ${HEAD_CELL}`}>Position</th>
            <th className={`${RULE} ${HEAD_CELL} text-left`} title="When this position was opened">
              Opened
            </th>

            {stages
              ? STAGE_COLUMNS.map((key, i) => {
                  const startsBand = STAGE_BANDS.some((b) => b.columns[0] === key);
                  return (
                    <th
                      key={key}
                      className={`${HEAD_CELL} ${startsBand ? "border-l border-line" : RULE}`}
                      title={BOARD_COLUMNS.find((c) => c.key === key)?.label}
                    >
                      {COLUMN_LABEL[key]}
                    </th>
                  );
                })
              : MATRIX_PHASES.map((p) => (
                  <th
                    key={p.key}
                    className={`${HEAD_CELL} ${p.key === "hired" ? "border-l border-line" : RULE}`}
                    // The grouping, discoverable without switching view.
                    title={`${p.label}: ${PHASE_CONTENTS[p.key]}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: PHASE_FILL[p.key] }}
                        aria-hidden="true"
                      />
                      {p.label}
                    </span>
                  </th>
                ))}

            <th className={`border-l border-line ${HEAD_CELL}`}>All</th>
            <th
              className={`${RULE} ${HEAD_CELL} text-left`}
              title="How this position's people are spread across the five phases. A longer bar means more candidates."
            >
              Breakdown
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map(({ requisition: r, counts, columnCounts, total }) => (
            <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-page/40">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 hover:bg-page/40">
                <Link
                  to={`/hr-recruitment/positions/${r.id}`}
                  className="block max-w-[260px] truncate font-medium text-navy hover:text-orange hover:underline"
                  title={`${r.jobTitle} · ${r.mrfNo}`}
                >
                  {r.jobTitle}
                </Link>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-grey-2">
                  <span>{r.mrfNo}</span>
                  <span aria-hidden="true">·</span>
                  <span>{statusLabelOf(r)}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"}
                  </span>
                </div>
              </td>

              <td className={`${RULE} whitespace-nowrap px-3 py-2`}>
                {openedIso(r) ? (
                  <>
                    <div className="text-[12.5px] text-grey">{formatDateDMY(openedIso(r))}</div>
                    {daysOpen(r) !== null && (
                      <div className="mt-0.5 text-[11px] text-grey-2">{daysOpen(r)}d open</div>
                    )}
                  </>
                ) : (
                  <span className="text-[12.5px] text-grey-2">–</span>
                )}
              </td>

              {stages
                ? STAGE_COLUMNS.map((key, i) => {
                    const startsBand = STAGE_BANDS.some((b) => b.columns[0] === key);
                    return (
                      <Cell
                        key={key}
                        n={columnCounts[key]}
                        label={BOARD_COLUMNS.find((c) => c.key === key)?.label ?? COLUMN_LABEL[key]}
                        job={r.jobTitle}
                        selected={selected?.requisitionId === r.id && selected.column === key}
                        bandStart={startsBand}
                        onPick={() => onPick(r.id, { column: key })}
                      />
                    );
                  })
                : MATRIX_PHASES.map((p) => (
                    <Cell
                      key={p.key}
                      n={counts[p.key]}
                      label={p.label}
                      job={r.jobTitle}
                      selected={selected?.requisitionId === r.id && selected.phase === p.key}
                      bandStart={p.key === "hired"}
                      onPick={() => onPick(r.id, { phase: p.key })}
                    />
                  ))}

              <td className="border-l border-line px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-navy">
                {total === 0 ? <span className="font-normal text-grey-2">–</span> : total}
              </td>

              <td className={`${RULE} px-3 py-2`}>
                <ShapeBar counts={counts} total={total} busiest={busiest} />
              </td>
            </tr>
          ))}
        </tbody>

        {/* The reconciliation row. Without it the KPI strip above states figures the
            reader has no way to check against the rows in front of them. */}
        <tfoot>
          <tr className="border-t-2 border-line bg-page/60">
            <td className="sticky left-0 z-10 bg-page/60 px-3 py-2 text-[12px] font-semibold text-navy">
              {rows.length} {rows.length === 1 ? "position" : "positions"} shown
            </td>
            <td className={RULE} />
            {stages
              ? STAGE_COLUMNS.map((key, i) => (
                  <td
                    key={key}
                    className={`px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-navy ${
                      STAGE_BANDS.some((b) => b.columns[0] === key) ? "border-l border-line" : RULE
                    }`}
                  >
                    {columnTotals[key]}
                  </td>
                ))
              : MATRIX_PHASES.map((p) => (
                  <td
                    key={p.key}
                    className={`px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-navy ${
                      p.key === "hired" ? "border-l border-line" : RULE
                    }`}
                  >
                    {totals[p.key]}
                  </td>
                ))}
            <td className="border-l border-line px-3 py-2 text-right text-[13px] font-bold tabular-nums text-navy">
              {MATRIX_PHASES.reduce((n, p) => n + totals[p.key], 0)}
            </td>
            <td className={RULE} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * One count. A button when there is something to show, inert when there is not.
 *
 * Selection is a RING, never a fill — see the header note on why colour no longer
 * carries magnitude here.
 */
function Cell({
  n,
  label,
  job,
  selected,
  bandStart,
  onPick,
}: {
  n: number;
  label: string;
  job: string;
  selected: boolean;
  /** First column of a phase band — the same rule, drawn a shade stronger. */
  bandStart: boolean;
  onPick: () => void;
}) {
  return (
    <td className={`px-1.5 py-1.5 text-right ${bandStart ? "border-l border-line" : RULE}`}>
      <button
        type="button"
        onClick={onPick}
        disabled={n === 0}
        aria-label={`${n} ${label.toLowerCase()} on ${job}`}
        aria-pressed={selected}
        title={
          n === 0
            ? `Nobody at ${label.toLowerCase()} on ${job}`
            : selected
              ? "Showing these below — click to clear"
              : `Show these ${n} below`
        }
        className={`block w-full rounded-lg px-2 py-1.5 text-right text-[13px] tabular-nums transition ${
          n === 0
            ? "cursor-default text-grey-2/60"
            : `font-semibold text-navy hover:bg-page ${selected ? "bg-orange-soft ring-2 ring-orange" : ""}`
        }`}
      >
        {n === 0 ? "–" : n}
      </button>
    </td>
  );
}

/**
 * The row's shape in one strip — PipelineSummary's bar, per position.
 *
 * TWO THINGS AT ONCE, and it needs both. The SEGMENTS carry the mix (where this
 * vacancy's people are); the overall LENGTH carries the size, scaled against the busiest
 * row on screen. Normalising every bar to full width — the obvious first cut — made a
 * position holding one CV present exactly the same slab of colour as one holding
 * twenty-eight, which is worse than drawing no bar at all.
 *
 * All five phases, including the two outcomes: this is not a progress meter but a
 * portrait of where the people ARE, and a pipeline that is mostly rejects should look
 * like one. 2px gaps so neighbouring segments stay countable rather than melting into a
 * single band.
 */
function ShapeBar({
  counts,
  total,
  busiest,
}: {
  counts: Record<CandidatePhase, number>;
  total: number;
  busiest: number;
}) {
  if (total === 0) return <span className="text-[11.5px] text-grey-2">No candidates yet</span>;

  const words = MATRIX_PHASES.filter((p) => counts[p.key] > 0)
    .map((p) => `${counts[p.key]} ${p.label.toLowerCase()}`)
    .join(" · ");

  return (
    <div className="w-[120px]" title={words} aria-label={words}>
      {/* A floor of 6% so a single candidate is still a visible mark rather than a
          hairline that reads as nothing. */}
      <div className="flex h-2 gap-[2px]" style={{ width: `${Math.max(6, (total / busiest) * 100)}%` }}>
        {MATRIX_PHASES.map((p) => {
          const v = counts[p.key];
          if (v === 0) return null;
          return (
            <span
              key={p.key}
              className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(v / total) * 100}%`, background: PHASE_FILL[p.key] }}
            />
          );
        })}
      </div>
    </div>
  );
}
