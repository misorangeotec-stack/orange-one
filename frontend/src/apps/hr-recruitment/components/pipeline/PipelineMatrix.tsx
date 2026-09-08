import { Link } from "react-router-dom";
import { PHASE_FILL, type CandidatePhase } from "../../lib/board";
import type { Requisition } from "../../types";

/**
 * EVERY position's pipeline, one row each, five phase columns.
 *
 * THE SHAPE IS THE WHOLE POINT. Reading "is this pipeline top-heavy, or is anything
 * near an offer?" used to mean opening nineteen boards in turn. Down a column you now
 * read which vacancies are stuck in screening; across a row you read one vacancy's
 * shape. Nothing is summed across positions — each row stays attached to its own job,
 * which is what makes this legitimate where a single summed strip was not.
 *
 * ⚠ THIS IS NOT PipelineSummary, AND IT DELIBERATELY DOES NOT REUSE IT.
 *   PipelineSummary answers the same question for ONE vacancy, and two of its choices
 *   are wrong here:
 *     · it renders three bar SEGMENTS (hired and dropped are counts beside the bar),
 *       whereas a matrix needs all five phases as columns that line up between rows;
 *     · it returns `null` for a position with no candidates — and a vacancy with no
 *       CVs at all is precisely what management opens this screen to find. Three live
 *       positions are in that state as this ships, and they render here as a row of
 *       zeros rather than vanishing.
 *   What IS reused is the vocabulary: PHASE_OF and PHASE_FILL from lib/board, so a
 *   phase cannot mean one thing on the board's strip and another here.
 *
 * COLOUR SAYS "HOW MANY", NOT "WHICH PHASE". The phase is already named by its column
 * header, so tinting every cell by phase would spend the reader's attention on
 * something they can read from the top of the table. Instead each cell carries its own
 * phase hue at an opacity scaled to the count, against the WHOLE MATRIX's largest cell
 * — so a dense cell is visibly dense wherever it sits, and rows stay comparable. The
 * same global-scaling rule StepPipeline uses for its severity bars.
 */
export interface MatrixRow {
  requisition: Requisition;
  counts: Record<CandidatePhase, number>;
  total: number;
}

/** Left to right, in pipeline order. The two outcomes sit last, after a divider. */
export const MATRIX_PHASES: { key: CandidatePhase; label: string; outcome?: boolean }[] = [
  { key: "screening", label: "Screening" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired", outcome: true },
  { key: "dropped", label: "Dropped", outcome: true },
];

export default function PipelineMatrix({
  rows,
  totals,
  selected,
  onPick,
  statusLabelOf,
}: {
  rows: MatrixRow[];
  /** Column sums over the rows shown, so this band and the KPI strip reconcile. */
  totals: Record<CandidatePhase, number>;
  /** The cell currently drilled into, if any. */
  selected: { requisitionId: string; phase: CandidatePhase } | null;
  /** Click a cell to narrow the list below; click the same cell again to clear. */
  onPick: (requisitionId: string, phase: CandidatePhase) => void;
  statusLabelOf: (r: Requisition) => string;
}) {
  // The busiest single cell anywhere in the matrix. Scaling each cell against this
  // rather than against its own row keeps rows comparable: a 4 must not look as
  // heavy as a 28 merely because its row is quiet.
  const peak = Math.max(1, ...rows.flatMap((row) => MATRIX_PHASES.map((p) => row.counts[p.key])));

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-page/60">
            <th className="sticky left-0 z-10 bg-page/60 px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
              Position
            </th>
            {MATRIX_PHASES.map((p) => (
              <th
                key={p.key}
                className={`px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2 ${
                  p.key === "hired" ? "border-l border-line" : ""
                }`}
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
            <th className="px-3 py-2 text-right text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
              All
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map(({ requisition: r, counts, total }) => (
            <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-page/40">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 hover:bg-page/40">
                <Link
                  to={`/hr-recruitment/positions/${r.id}`}
                  className="block max-w-[280px] truncate font-medium text-navy hover:text-orange hover:underline"
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

              {MATRIX_PHASES.map((p) => {
                const n = counts[p.key];
                const isSel = selected?.requisitionId === r.id && selected.phase === p.key;
                return (
                  <td
                    key={p.key}
                    className={`px-1.5 py-1.5 text-right ${p.key === "hired" ? "border-l border-line" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onPick(r.id, p.key)}
                      disabled={n === 0}
                      aria-label={`${n} ${p.label.toLowerCase()} on ${r.jobTitle}`}
                      title={
                        n === 0
                          ? `Nobody ${p.label.toLowerCase()} on ${r.jobTitle}`
                          : isSel
                            ? "Showing these below — click to clear"
                            : `Show these ${n} below`
                      }
                      className={`block w-full rounded-lg px-2 py-1.5 text-right tabular-nums transition ${
                        n === 0
                          ? "cursor-default text-grey-2/50"
                          : "font-semibold text-navy hover:ring-2 hover:ring-orange/40"
                      } ${isSel ? "ring-2 ring-orange" : ""}`}
                      // Opacity carries the count; the hue names the phase. A zero gets
                      // no fill at all, so an empty pipeline reads as empty rather than
                      // as "a little bit of something".
                      style={
                        n > 0
                          ? { background: PHASE_FILL[p.key], opacity: 0.25 + 0.75 * (n / peak) }
                          : undefined
                      }
                    >
                      {n === 0 ? "–" : n}
                    </button>
                  </td>
                );
              })}

              <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-navy">
                {total === 0 ? <span className="font-normal text-grey-2">–</span> : total}
              </td>
            </tr>
          ))}
        </tbody>

        {/* The reconciliation row. Without it the KPI strip above states figures the
            reader has no way to check against the rows they are looking at. */}
        <tfoot>
          <tr className="border-t-2 border-line bg-page/60">
            <td className="sticky left-0 z-10 bg-page/60 px-3 py-2 text-[12px] font-semibold text-navy">
              {rows.length} {rows.length === 1 ? "position" : "positions"} shown
            </td>
            {MATRIX_PHASES.map((p) => (
              <td
                key={p.key}
                className={`px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-navy ${
                  p.key === "hired" ? "border-l border-line" : ""
                }`}
              >
                {totals[p.key]}
              </td>
            ))}
            <td className="px-3 py-2 text-right text-[13px] font-bold tabular-nums text-navy">
              {MATRIX_PHASES.reduce((n, p) => n + totals[p.key], 0)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
