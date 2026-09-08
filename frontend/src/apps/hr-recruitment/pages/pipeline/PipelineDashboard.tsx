import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import EmptyState from "@/shared/components/ui/EmptyState";
import Kpi from "@/shared/components/ui/Kpi";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useRailWhileMounted } from "@/shared/components/layout/navRail";
import { formatDateDMY } from "@/shared/lib/date";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import CandidateDetail from "../../components/candidate/CandidateDetail";
import PipelineMatrix, { MATRIX_PHASES, type MatrixRow } from "../../components/pipeline/PipelineMatrix";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeePipeline } from "../../lib/access";
import { overdueRollup, seatSummary } from "../../lib/analytics";
import { PHASE_FILL, PHASE_OF, PHASE_PILL, STAGE_LABEL, type CandidatePhase } from "../../lib/board";
import { fitFill } from "../../lib/fit";
import { REQ_STATUS_LABEL } from "../../lib/format";
import { isPosition, isLivePosition } from "../../lib/positions";
import { tintFor } from "../../lib/tint";
import { CANDIDATE_WINDOW_MONTHS } from "../../data/hrFetch";
import type { Candidate, CandidateStage, Requisition, RequisitionStatus } from "../../types";

/**
 * THE MANAGEMENT PIPELINE DASHBOARD — every position's pipeline on one screen (NR-2).
 *
 * WHAT IT IS FOR
 *   Management should not have to open each vacancy in turn to see who is in its
 *   pipeline. Nineteen positions meant nineteen page-opens, and no screen anywhere
 *   showed position × stage. This is that screen, and it REPLACES NOTHING — Positions
 *   keeps every job it does today.
 *
 * WHO CAN SEE IT — TWO GRANTS, AND ONLY ONE OF THEM IS IN THIS APP
 *   `canSeePipeline` decides whether the screen renders. It does NOT decide which rows
 *   arrive: that is RLS, via the `pipeline_viewers` list in Setup, which is OR'd into
 *   fms_hr_can_read_requisition() (20260908120000). The two read the same config key,
 *   so the screen cannot offer a view the database then refuses to fill. Anyone on the
 *   list ALSO needs `hr-recruitment` at Edit to open the app at all and to press
 *   anything — see PipelineViewersSection.
 *
 * ONE CALCULATION, NEVER TWO
 *   The KPI strip reads `seatSummary` and `overdueRollup` from lib/analytics with the
 *   SAME inputs the Dashboard uses, so the two screens cannot claim different numbers.
 *   "In play" and "At offer" come out of the very same PHASE_OF pass that fills the
 *   matrix — not a second tally beside it.
 *
 *   ⚠ "In play" is genuinely ambiguous in this codebase and the two answers differ.
 *     `isOpenCandidate` (lib/queues) excludes an offer that is out; PHASE_OF counts it
 *     as still in play, which is what PipelineSummary shows. Measured 08-09-2026 that
 *     is 105 against 106. THIS SCREEN USES THE PHASE TALLY, because it is the same one
 *     pass that fills the matrix and it matches the strip this is a per-position
 *     version of — and the strip says so in words, with "At offer" broken out beside
 *     it so the difference is visible rather than argued about.
 *
 * TWO MODES, ONE ROUTE
 *   Matrix + list is the default. Picking a person swaps the LIST BAND for the full
 *   candidate detail, with a breadcrumb back and ‹ › walking the rows you had
 *   filtered. A permanent side-by-side split was ruled out: the detail is already
 *   three columns and folds the sidebar to fit them, so there is no width to put a
 *   list beside it. The selection lives in `?c=`, so "this person, in this view"
 *   survives a paste.
 */

/** The status groups the reader can switch on, beyond the live default. */
const STATUS_GROUPS: { key: string; label: string; statuses: RequisitionStatus[] }[] = [
  { key: "hold", label: "Paused", statuses: ["on_hold"] },
  { key: "closed", label: "Closed", statuses: ["closed"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];

const EMPTY_PHASES: Record<CandidatePhase, number> = {
  screening: 0,
  interviewing: 0,
  offer: 0,
  hired: 0,
  dropped: 0,
};

/** Stage options in BOARD ORDER, not alphabetical — the filter reads as the pipeline. */
const STAGE_OPTIONS: string[] = (
  [
    "resume_uploaded",
    "hr_shortlisted",
    "hod_shortlisted",
    "telephonic",
    "interview_1",
    "interview_2",
    "interview_3",
    "final_decision",
    "finalized",
    "hired",
    "disqualified",
  ] satisfies CandidateStage[]
).map((st) => STAGE_LABEL[st]);

export default function PipelineDashboard() {
  const s = useHrStore();
  const [params, setParams] = useSearchParams();

  const openId = params.get("c");
  const drillReq = params.get("pos");
  const drillPhase = params.get("phase") as CandidatePhase | null;
  const extraStatuses = (params.get("show") ?? "").split(",").filter(Boolean);

  // The detail is three columns wide, exactly as on the candidate page — so the rail
  // folds only while it is open, and springs back when you return to the matrix.
  useRailWhileMounted(!!openId);

  const today = todayLocalIso();

  /* ------------------------------- the positions ------------------------------ */
  /**
   * `isPosition` — not every requisition. The four approval-stage statuses (hr_review,
   * mgmt_review, sent_back, rejected) are requests working their way through approval;
   * they have no pipeline by definition and belong on the Requisitions screen.
   */
  const shownStatuses = useMemo(() => {
    const on = new Set<RequisitionStatus>();
    for (const g of STATUS_GROUPS) {
      if (extraStatuses.includes(g.key)) g.statuses.forEach((st) => on.add(st));
    }
    return on;
  }, [extraStatuses]);

  const positions = useMemo(
    () =>
      s.requisitions
        .filter(isPosition)
        .filter((r) => isLivePosition(r) || shownStatuses.has(r.status))
        .sort((a, b) => a.jobTitle.localeCompare(b.jobTitle)),
    [s.requisitions, shownStatuses],
  );

  /* --------------------------- one pass, one bucketing -------------------------- */
  /**
   * Every number on this screen that is about phases comes out of THIS loop — the
   * matrix cells, the column totals and the two phase KPIs. One walk, one bucketing,
   * so the strip and the grid cannot disagree: every candidate is counted into both,
   * or into neither. (Same shape as the Control Center's step rollup.)
   *
   * `candidatesFor` is an O(1) map lookup in the store, so this stays cheap as the
   * position list grows.
   */
  const { matrixRows, totals, visibleCandidates } = useMemo(() => {
    const rows: MatrixRow[] = [];
    const sum: Record<CandidatePhase, number> = { ...EMPTY_PHASES };
    const all: Candidate[] = [];

    for (const r of positions) {
      const counts: Record<CandidatePhase, number> = { ...EMPTY_PHASES };
      const cands = s.candidatesFor(r.id);
      for (const c of cands) {
        const phase = PHASE_OF[c.stage];
        counts[phase] += 1;
        sum[phase] += 1;
      }
      all.push(...cands);
      // Positions with NO candidates are kept, as a row of zeros. A vacancy nobody has
      // applied to is exactly what this screen exists to surface.
      rows.push({ requisition: r, counts, total: cands.length });
    }
    return { matrixRows: rows, totals: sum, visibleCandidates: all };
  }, [positions, s]);

  /* -------------------------------- the KPI strip ------------------------------- */
  /**
   * seatSummary and overdueRollup are called with the SAME arguments Dashboard.tsx
   * passes, deliberately: these are module-wide figures and must match that screen to
   * the digit. The matrix below is filtered, and says so in its own footer row.
   */
  const report = useMemo(
    () => ({
      seats: seatSummary(s.requisitions, s.candidates, s.onboardings),
      overdue: overdueRollup(s.queueEntries, s.queueOwnerIds, today),
    }),
    [s, today],
  );

  const inPlay = totals.screening + totals.interviewing + totals.offer;

  /* ---------------------------------- the list ---------------------------------- */
  /**
   * The drill narrows the ROWS, not a column filter.
   *
   * ⚠ QueueTable seeds a filter's `initial` ONCE, on first render — by design, so a
   *   rebuilt columns array cannot stamp a default back over the reader's own choice.
   *   That makes it useless for a control that fires after mount, so a matrix cell
   *   narrows the array we hand over and announces itself as a chip above the table.
   *   Without the chip the narrowing would be invisible and read as a bug.
   */
  const rows = useMemo(() => {
    let out = visibleCandidates;
    if (drillReq) out = out.filter((c) => c.requisitionId === drillReq);
    if (drillPhase) out = out.filter((c) => PHASE_OF[c.stage] === drillPhase);
    return out;
  }, [visibleCandidates, drillReq, drillPhase]);

  const positionLabel = (c: Candidate): string => {
    const r = s.requisitionById(c.requisitionId);
    return r ? `${r.mrfNo} · ${r.jobTitle}` : "—";
  };
  const sourceName = (c: Candidate): string =>
    s.jobPlatforms.find((p) => p.id === c.sourcePlatformId)?.name ?? "—";
  const departmentName = (c: Candidate): string => {
    const r = s.requisitionById(c.requisitionId);
    if (!r) return "—";
    return s.departments.find((d) => d.id === r.departmentId)?.name ?? "—";
  };
  const statusLabelOf = (r: Requisition): string => REQ_STATUS_LABEL[r.status];

  const openCandidate = (candidateId: string) => {
    const next = new URLSearchParams(params);
    next.set("c", candidateId);
    setParams(next, { replace: false });
  };
  const closeCandidate = () => {
    const next = new URLSearchParams(params);
    next.delete("c");
    setParams(next, { replace: false });
  };
  const pickCell = (requisitionId: string, phase: CandidatePhase) => {
    const next = new URLSearchParams(params);
    if (drillReq === requisitionId && drillPhase === phase) {
      next.delete("pos");
      next.delete("phase");
    } else {
      next.set("pos", requisitionId);
      next.set("phase", phase);
    }
    next.delete("c");
    setParams(next, { replace: true });
  };
  const clearDrill = () => {
    const next = new URLSearchParams(params);
    next.delete("pos");
    next.delete("phase");
    setParams(next, { replace: true });
  };
  const toggleStatus = (key: string) => {
    const on = new Set(extraStatuses);
    if (on.has(key)) on.delete(key);
    else on.add(key);
    const next = new URLSearchParams(params);
    if (on.size === 0) next.delete("show");
    else next.set("show", [...on].join(","));
    setParams(next, { replace: true });
  };

  const columns: QueueColumn<Candidate>[] = useMemo(() => {
    const cols: QueueColumn<Candidate>[] = [
      {
        key: "candidate",
        header: "Candidate",
        alwaysVisible: true,
        cell: (c) => (
          <div className="flex items-center gap-2.5">
            <Avatar name={c.name} color={tintFor(c.id)} size={28} />
            <div className="min-w-0">
              <button
                onClick={() => openCandidate(c.id)}
                className="block truncate text-left text-[14px] font-semibold leading-tight text-navy hover:text-orange hover:underline"
              >
                {c.name}
              </button>
              <div className="mt-0.5 text-[11.5px] text-grey-2">{c.candidateNo ?? "—"}</div>
            </div>
          </div>
        ),
        sortValue: (c) => c.name,
        // One box that finds a person however you remember them.
        filter: {
          kind: "text",
          get: (c) => `${c.name} ${c.candidateNo ?? ""} ${c.email ?? ""} ${c.phone ?? ""}`,
        },
        exportValue: (c) => c.name,
      },
      {
        key: "position",
        header: "Position",
        cell: (c) => {
          const r = s.requisitionById(c.requisitionId);
          if (!r) return <span className="text-grey-2">—</span>;
          return (
            <div className="min-w-0">
              <Link
                to={`/hr-recruitment/positions/${r.id}`}
                className="block truncate text-[13px] font-medium text-navy hover:text-orange hover:underline"
              >
                {r.jobTitle}
              </Link>
              <div className="mt-0.5 text-[11.5px] text-grey-2">{r.mrfNo}</div>
            </div>
          );
        },
        sortValue: positionLabel,
        filter: { kind: "select", get: positionLabel },
        exportValue: positionLabel,
      },
      {
        key: "phase",
        header: "Phase",
        cell: (c) => {
          const phase = PHASE_OF[c.stage];
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-navy">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PHASE_FILL[phase] }}
                aria-hidden="true"
              />
              {MATRIX_PHASES.find((p) => p.key === phase)?.label ?? phase}
            </span>
          );
        },
        sortValue: (c) => MATRIX_PHASES.findIndex((p) => p.key === PHASE_OF[c.stage]),
        filter: {
          kind: "select",
          get: (c) => MATRIX_PHASES.find((p) => p.key === PHASE_OF[c.stage])?.label ?? "—",
          options: MATRIX_PHASES.map((p) => p.label),
        },
        exportValue: (c) => MATRIX_PHASES.find((p) => p.key === PHASE_OF[c.stage])?.label ?? "—",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "stage",
        header: "Stage",
        cell: (c) => {
          const phase = PHASE_OF[c.stage];
          return (
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PHASE_PILL[phase]}`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: PHASE_FILL[phase] }}
                aria-hidden="true"
              />
              {STAGE_LABEL[c.stage]}
            </span>
          );
        },
        sortValue: (c) => STAGE_LABEL[c.stage],
        // Options are listed, not derived: a stage nobody is currently in must still
        // be selectable, or you cannot ask "is anyone at Round 3?" and get "no".
        filter: { kind: "select", get: (c) => STAGE_LABEL[c.stage], options: STAGE_OPTIONS },
        exportValue: (c) => STAGE_LABEL[c.stage],
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "fit",
        header: "AI fit",
        cell: (c) => {
          const fit = s.fitFor(c.id);
          if (!fit) return <span className="text-[12.5px] text-grey-2">Not scored</span>;
          return (
            <div className="w-[64px]" title={`Scored ${formatDateDMY(fit.scoredAt)}`}>
              <span className="text-[12.5px] font-semibold tabular-nums text-navy">
                {fit.overall} <span className="font-normal text-grey-2">/ 10</span>
              </span>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${fit.overall * 10}%`, background: fitFill(fit.overall) }}
                />
              </div>
            </div>
          );
        },
        // Unscored sorts as -1, never as 0: "no read yet" is not "read, and weak".
        sortValue: (c) => s.fitFor(c.id)?.overall ?? -1,
        filter: { kind: "number", get: (c) => s.fitFor(c.id)?.overall ?? -1 },
        exportValue: (c) => s.fitFor(c.id)?.overall ?? "Not scored",
      },
      {
        key: "department",
        header: "Department",
        cell: (c) => <span className="text-grey">{departmentName(c)}</span>,
        sortValue: departmentName,
        filter: { kind: "select", get: departmentName },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "source",
        header: "Source",
        cell: (c) => <span className="text-grey">{sourceName(c)}</span>,
        sortValue: sourceName,
        filter: { kind: "select", get: sourceName },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "phone",
        header: "Phone",
        defaultHidden: true,
        cell: (c) => <span className="text-grey">{c.phone ?? "—"}</span>,
        sortValue: (c) => c.phone ?? "",
        filter: { kind: "text", get: (c) => c.phone ?? "" },
        exportValue: (c) => c.phone ?? "",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "received",
        header: "CV received",
        cell: (c) => <span className="text-grey">{formatDateDMY(c.uploadedAt)}</span>,
        sortValue: (c) => c.uploadedAt,
        filter: { kind: "date", get: (c) => c.uploadedAt },
        exportValue: (c) => formatDateDMY(c.uploadedAt),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "waiting",
        header: "In stage",
        cell: (c) => <span className="text-grey">{s.daysInStage(c)}d</span>,
        sortValue: (c) => s.daysInStage(c),
        filter: { kind: "number", get: (c) => s.daysInStage(c) },
        exportValue: (c) => s.daysInStage(c),
        align: "right",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "due",
        header: "Due",
        cell: (c) => <DueCell dueIso={s.candidateDueIso(c)} />,
        sortValue: (c) => s.candidateDueIso(c) ?? "9999",
        exportValue: (c) => formatDateDMY(s.candidateDueIso(c)),
        tdClassName: "whitespace-nowrap",
      },
    ];
    // ⚠ There is deliberately NO offered-CTC column, at any visibility. Reading a
    //   pipeline is not the same right as reading what we offered — that gate is
    //   `salary_viewers` and it stays separate (decided 02-09-2026). Not building the
    //   column at all is what keeps it out of the Columns menu and the Excel file too.
    return cols;
    // The whole store: Position, AI fit, Due and In stage all read live data, so a
    // refetch must rebuild these columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, params]);

  /* ---------------------------------- guards ----------------------------------- */
  if (!canSeePipeline(s)) return <AccessDenied />;

  const openCandidateRow = openId ? rows.find((c) => c.id === openId) ?? s.candidateById(openId) : undefined;
  const drilledPosition = drillReq ? s.requisitionById(drillReq) : undefined;
  const drillPhaseLabel = drillPhase
    ? MATRIX_PHASES.find((p) => p.key === drillPhase)?.label ?? drillPhase
    : null;

  /* ------------------------------- detail mode --------------------------------- */
  if (openCandidateRow) {
    // ‹ › walks THE DASHBOARD'S OWN FILTERED ROWS — never the candidate page's board
    // -column siblings, which would page to somebody who is not on this screen.
    const idx = rows.findIndex((c) => c.id === openCandidateRow.id);
    const prev = idx > 0 ? rows[idx - 1] : null;
    const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;

    return (
      <div className="space-y-3">
        <nav className="text-[12.5px] text-grey-2" aria-label="Breadcrumb">
          <button onClick={closeCandidate} className="font-semibold text-orange hover:underline">
            Pipeline
          </button>
          <span className="mx-1.5" aria-hidden="true">
            /
          </span>
          <span className="text-navy">{openCandidateRow.name}</span>
        </nav>
        <CandidateDetail
          candidate={openCandidateRow}
          onBack={closeCandidate}
          backLabel="Back to the pipeline"
          pager={
            idx >= 0
              ? { index: idx + 1, total: rows.length, prev, next, go: openCandidate, label: "in this list" }
              : undefined
          }
          onOpenCandidate={openCandidate}
        />
      </div>
    );
  }

  /* -------------------------------- board mode --------------------------------- */
  const { seats, overdue } = report;
  const nothingYet = s.requisitions.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Pipeline</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Every position and everyone in it, on one screen. Click any number to see those people below.
          </p>
        </div>
      </div>

      {s.error ? (
        <p className="text-[13.5px] text-ryg-red">Couldn't load HR data: {(s.error as Error).message}</p>
      ) : nothingYet && !s.isLoading ? (
        <EmptyState
          title="No positions yet"
          message="Once a requisition is approved and starts sourcing, its pipeline appears here."
          actionLabel="Go to requisitions"
          actionTo="/hr-recruitment/requisitions"
        />
      ) : (
        <>
          {/* ---- Band 1: the numbers, once ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi
              label="Open positions"
              value={seats.openRequisitions}
              size="lg"
              hint={seats.onHold > 0 ? `+${seats.onHold} on hold` : "being worked now"}
            />
            <Kpi
              label="Seats unfilled"
              value={seats.seatsUnfilled}
              size="hero"
              tone={seats.seatsUnfilled > 0 ? "red" : undefined}
              hint={`of ${seats.seatsRequired} asked for`}
            />
            <Kpi
              label="In play"
              value={inPlay}
              size="lg"
              hint="screening, interviewing or at offer"
            />
            <Kpi label="At offer" value={totals.offer} size="lg" hint="offered, not yet joined" />
            <Kpi
              label="Overdue right now"
              value={overdue.totalOverdue}
              size="lg"
              tone={overdue.totalOverdue > 0 ? "red" : undefined}
              hint={`${overdue.totalDueToday} due today`}
            />
          </div>

          {/* ---- Which positions ---- */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-grey-2">Showing active jobs</span>
            {STATUS_GROUPS.map((g) => {
              const on = extraStatuses.includes(g.key);
              return (
                <button
                  key={g.key}
                  onClick={() => toggleStatus(g.key)}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
                    on
                      ? "border-orange bg-orange-soft text-orange"
                      : "border-line bg-white text-grey-2 hover:border-orange/40 hover:text-navy"
                  }`}
                >
                  {on ? "✓ " : "+ "}
                  {g.label}
                </button>
              );
            })}
          </div>

          {/* ---- Band 2: the matrix ---- */}
          {matrixRows.length === 0 ? (
            <Card className="p-6 text-center text-[13px] text-grey-2">
              No positions match. Add Paused, Closed or Cancelled above to widen this.
            </Card>
          ) : (
            <PipelineMatrix
              rows={matrixRows}
              totals={totals}
              selected={drillReq && drillPhase ? { requisitionId: drillReq, phase: drillPhase } : null}
              onPick={pickCell}
              statusLabelOf={statusLabelOf}
            />
          )}

          {/* ---- Band 3: the people ---- */}
          <div className="space-y-2">
            {(drilledPosition || drillPhaseLabel) && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-grey-2">Showing</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-orange-soft px-3 py-1 font-semibold text-orange">
                  {drilledPosition?.jobTitle ?? "All positions"}
                  {drillPhaseLabel && ` · ${drillPhaseLabel}`}
                  <button
                    onClick={clearDrill}
                    aria-label="Clear this selection"
                    title="Clear this selection"
                    className="text-orange hover:text-navy"
                  >
                    ✕
                  </button>
                </span>
              </div>
            )}

            <QueueTable
              rows={rows}
              rowKey={(c) => c.id}
              columns={columns}
              loading={s.isLoading}
              rowsLabel="candidates"
              rowClassName={(c) => {
                const d = s.candidateDueIso(c);
                return d ? overdueRowClass(d) : "";
              }}
              emptyTitle="Nobody in these pipelines yet"
              emptyMessage="Once CVs are uploaded against these positions, the people appear here."
              exportName="HR_Pipeline"
              exportTitle="Pipeline"
              exportNotes={[
                "Every candidate on the positions shown, at the moment of export.",
                `Candidates are loaded for the last ${CANDIDATE_WINDOW_MONTHS} months, so this is not an all-time list.`,
                "Offered CTC is deliberately not included — it has its own separate permission.",
              ]}
              columnPicker={{ storageKey: "hr-pipeline" }}
            />

            <p className="text-[11.5px] text-grey-2">
              Candidates are kept on screen for the last {CANDIDATE_WINDOW_MONTHS} months, so these counts
              are not all-time figures.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
