import { useEffect, useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import Kpi from "@/shared/components/ui/Kpi";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateDMY } from "@/shared/lib/date";
import { rememberReturnTo } from "@/shared/lib/returnTo";
import { dueState } from "@/shared/lib/workingDays";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeeBoard } from "../../lib/access";
import { PHASE_FILL, PHASE_OF, PHASE_PILL, STAGE_LABEL } from "../../lib/board";
import { fitFill } from "../../lib/fit";
import { isOpenCandidate } from "../../lib/queues";
import { tintFor } from "../../lib/tint";
import type { Candidate, CandidateStage } from "../../types";

/** The route this list owns — the key its "back here" href is remembered under. */
export const CANDIDATES_ROUTE = "/hr-recruitment/candidates";

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
).map((s) => STAGE_LABEL[s]);

/**
 * Every candidate, across every vacancy.
 *
 * WHY THIS EXISTS
 *   A candidate was only ever reachable THROUGH a position: Positions → a position
 *   → its board. That is the right tool for moving one person along, and the wrong
 *   one for "who applied from Naukri last month", "who is sitting at 8+ on the AI
 *   read", or simply "show me everyone". Those answers were scattered across a
 *   dozen boards. This screen is that answer.
 *
 * It is a VIEW, not a second model. Every row comes from the same store snapshot
 * the board reads, so a stage here and a stage there cannot disagree.
 *
 * NOT PRE-FILTERED. It opens on everyone — disqualified and hired included —
 * because a list called "all candidates" that quietly hides two thirds of them is
 * lying about its own count. Stage is a filter, one click away.
 */
export default function CandidatesList() {
  const s = useHrStore();
  const location = useLocation();
  const [params] = useSearchParams();

  /**
   * Deep link: `?position=<requisitionId>` opens narrowed to one vacancy. Resolved
   * to the LABEL because that is what the column's filter compares — and captured
   * once, since QueueTable seeds a multiselect's `initial` only on first render.
   */
  const positionParam = params.get("position");

  // "Back to the list" lands on the exact URL you left, filters and page intact.
  useEffect(() => {
    rememberReturnTo(CANDIDATES_ROUTE, `${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  const rows = s.candidates;

  /**
   * "MRF-0042 · Sales Executive" — the position label, and the value every
   * position filter compares against. A candidate whose requisition is missing
   * still gets a row: this list promises EVERYONE, and dropping a row to avoid an
   * awkward cell would be the one bug it cannot afford. (Requisitions are fetched
   * unwindowed, so in practice this should not happen — but three other screens
   * guard for it, so this one does too.)
   */
  const positionLabel = (c: Candidate): string => {
    const r = s.requisitionById(c.requisitionId);
    return r ? `${r.mrfNo} · ${r.jobTitle}` : "—";
  };

  const departmentName = (c: Candidate): string => {
    const r = s.requisitionById(c.requisitionId);
    if (!r) return "—";
    return s.departments.find((d) => d.id === r.departmentId)?.name ?? "—";
  };

  const sourceName = (c: Candidate): string =>
    s.jobPlatforms.find((p) => p.id === c.sourcePlatformId)?.name ?? "—";

  /** Skills and free tags read as one "what is this person about" cell. */
  const tagText = (c: Candidate): string => [...c.skills, ...c.tags].join(", ");

  const summary = useMemo(() => {
    const inPlay = rows.filter(isOpenCandidate);
    const overdue = inPlay.filter((c) => {
      const d = s.candidateDueIso(c);
      return d ? dueState(new Date(d)).overdue : false;
    }).length;
    return {
      total: rows.length,
      inPlay: inPlay.length,
      hired: rows.filter((c) => c.stage === "hired").length,
      overdue,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, s]);

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
              <Link
                to={`/hr-recruitment/candidates/${c.id}`}
                state={{ from: "candidates" }}
                className="block truncate text-[14px] font-semibold leading-tight text-navy hover:text-orange hover:underline"
              >
                {c.name}
              </Link>
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
        filter: {
          kind: "multiselect",
          get: positionLabel,
          initial: positionParam
            ? (() => {
                const r = s.requisitionById(positionParam);
                return r ? [`${r.mrfNo} · ${r.jobTitle}`] : undefined;
              })()
            : undefined,
        },
        exportValue: positionLabel,
      },
      {
        key: "stage",
        header: "Stage",
        // A dot on the shared ramp, so how far along someone is reads down the
        // column without the pills turning the table into a colour chart.
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
        filter: { kind: "multiselect", get: (c) => STAGE_LABEL[c.stage], options: STAGE_OPTIONS },
        exportValue: (c) => STAGE_LABEL[c.stage],
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "fit",
        header: "AI fit",
        // The same one-hue bar the board card uses — a length, not a verdict.
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
        key: "phone",
        header: "Phone",
        cell: (c) => <span className="text-grey">{c.phone ?? "—"}</span>,
        sortValue: (c) => c.phone ?? "",
        filter: { kind: "text", get: (c) => c.phone ?? "" },
        exportValue: (c) => c.phone ?? "",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "email",
        header: "Email",
        cell: (c) => <span className="text-grey">{c.email ?? "—"}</span>,
        sortValue: (c) => c.email ?? "",
        filter: { kind: "text", get: (c) => c.email ?? "" },
        exportValue: (c) => c.email ?? "",
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
      {
        key: "department",
        header: "Department",
        defaultHidden: true,
        cell: (c) => <span className="text-grey">{departmentName(c)}</span>,
        sortValue: departmentName,
        filter: { kind: "select", get: departmentName },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "company",
        header: "Current company",
        defaultHidden: true,
        cell: (c) => <span className="text-grey">{c.currentCompany ?? "—"}</span>,
        sortValue: (c) => c.currentCompany ?? "",
        filter: { kind: "text", get: (c) => c.currentCompany ?? "" },
        exportValue: (c) => c.currentCompany ?? "",
      },
      {
        key: "experience",
        header: "Experience",
        defaultHidden: true,
        cell: (c) => (
          <span className="text-grey tabular-nums">
            {c.experienceYears === null ? "—" : `${c.experienceYears} yr`}
          </span>
        ),
        sortValue: (c) => c.experienceYears ?? -1,
        filter: { kind: "number", get: (c) => c.experienceYears ?? -1 },
        exportValue: (c) => c.experienceYears ?? "",
        align: "right",
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "tags",
        header: "Skills & tags",
        defaultHidden: true,
        cell: (c) => {
          const text = tagText(c);
          return text ? (
            <span className="line-clamp-2 text-[12.5px] text-grey">{text}</span>
          ) : (
            <span className="text-grey-2">—</span>
          );
        },
        sortValue: tagText,
        filter: { kind: "text", get: tagText },
        exportValue: tagText,
      },
    ];

    // Salary is need-to-know. The column is not merely hidden for someone without
    // the right — it is never built, so it cannot be turned on in the Columns menu
    // and cannot reach the Excel file either.
    if (s.canViewSalary) {
      cols.push({
        key: "ctc",
        header: "Offered CTC",
        defaultHidden: true,
        cell: (c) =>
          c.offeredCtc === null ? (
            <span className="text-grey-2">—</span>
          ) : (
            <span className="font-medium tabular-nums text-navy">
              ₹{c.offeredCtc.toLocaleString("en-IN")}/mo
            </span>
          ),
        sortValue: (c) => c.offeredCtc ?? -1,
        filter: { kind: "number", get: (c) => c.offeredCtc ?? -1 },
        exportValue: (c) => c.offeredCtc ?? "",
        align: "right",
        tdClassName: "whitespace-nowrap",
      });
    }

    return cols;
    // The whole store: Position, AI fit, Due and In stage all read live data, so a
    // refetch must rebuild these columns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, positionParam]);

  /**
   * Wait for the snapshot before deciding anything — and note this sits BEFORE the
   * access check, not after. Two reasons, and both are real:
   *
   *   • `canSeeBoard` reads step ownership and your own requisitions, all of which
   *     are empty until the fetch lands. Checking first would flash "Access denied"
   *     at people who have access.
   *   • `?position=` seeds QueueTable's filter on FIRST RENDER ONLY. Mounting the
   *     table before the requisitions arrive would resolve the id to nothing and
   *     silently drop the narrowing the link asked for.
   */
  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (s.error) {
    return <p className="text-[13.5px] text-ryg-red">Couldn't load HR data: {(s.error as Error).message}</p>;
  }
  if (!canSeeBoard(s)) return <AccessDenied />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Candidates</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Everyone on every vacancy you can see. Candidates are kept on screen for two years —
          from {formatDateDMY(s.candidateWindowStartIso)} — plus every offer and hire on record.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Candidates" value={summary.total} hint="in the two-year window" />
        <Kpi label="In play" value={summary.inPlay} hint="still moving through a pipeline" />
        <Kpi
          label="Hired"
          value={summary.hired}
          hint={summary.hired > 0 ? "joined and on the books" : "nobody has joined yet"}
        />
        <Kpi
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue > 0 ? "red" : undefined}
          hint={summary.overdue > 0 ? "past their due date" : "nothing is running late"}
        />
      </div>

      <Card className="p-4">
        <QueueTable<Candidate>
          rows={rows}
          rowKey={(c) => c.id}
          columns={columns}
          rowsLabel="candidates"
          rowClassName={(c) => overdueRowClass(s.candidateDueIso(c))}
          emptyTitle="No candidates yet"
          emptyMessage="CVs added against a posted vacancy appear here, whichever position they were uploaded to."
          initialSort={{ key: "received", dir: "desc" }}
          columnPicker={{ storageKey: "hr-candidates" }}
          exportName="HR_Candidates"
          exportTitle="Candidates"
          exportNotes={[
            "One row per candidate, across every vacancy you have access to.",
            "Candidates load in a rolling 24-month window, plus everyone who was made an offer or hired at any time. Someone older than that with no offer will not be here.",
            "'In stage' is whole days since the candidate entered their current stage. 'Due' comes from the step's rule in Setup → Due Dates, counted in working days (Mon–Sat; only Sunday is skipped).",
            "AI fit is a read of the CV against the vacancy's job description, out of 10. 'Not scored' means no read has been run — it is not a zero.",
            "Contains candidate names, phone numbers and email addresses — this is personal data. Handle accordingly.",
          ]}
        />
      </Card>
    </div>
  );
}
