import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import CandidateDrawer from "../../components/kanban/CandidateDrawer";
import InterviewResultModal from "../../components/kanban/InterviewResultModal";
import ScheduleInterviewModal from "../../components/kanban/ScheduleInterviewModal";
import CompletedTable from "../../components/CompletedTable";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { roundOf } from "../../lib/board";
import type { StepKey } from "../../lib/steps";
import type { StageEntry, CompletedRow } from "../../lib/queues";
import type { Candidate, Interview, Requisition } from "../../types";

const INTERVIEW_STEPS: StepKey[] = ["telephonic_screening", "interview_1", "interview_2", "interview_3"];
/** The round an interview step records. */
const roundOfStep = (step: StepKey): 0 | 1 | 2 | 3 =>
  (step === "telephonic_screening" ? 0 : Number(step.slice(-1))) as 0 | 1 | 2 | 3;

/** One interview that has not happened yet: the candidate, the round, and its booking (if any). */
interface Row {
  candidate: Candidate;
  requisition: Requisition;
  round: 0 | 1 | 2 | 3;
  interview: Interview | undefined;
  mine: boolean;
}

const ROUND_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: "Screening · Tel",
  1: "R1 · HR",
  2: "R2 · HOD",
  3: "R3 · Director",
};

/**
 * Every interview still to happen, in one list.
 *
 * The board is the right tool for MOVING a candidate, and the wrong one for answering
 * "what is booked this week, and what has nobody booked at all?" — that answer is
 * scattered across three columns and a dozen cards. This page is that answer.
 *
 * It shows rounds that have NOT been conducted. A round vanishes from here the moment
 * its result is recorded, because at that point it is history, not work.
 *
 * Everyone who can see a vacancy sees its interviews (HR needs to chase a director's
 * round even though they cannot act on it). The BUTTONS, not the rows, are what get
 * gated — you only act where the rules already let you.
 */
export default function InterviewsQueue() {
  const s = useHrStore();
  const [open, setOpen] = useState<Candidate | null>(null);
  const [book, setBook] = useState<{ c: Candidate; round: 0 | 1 | 2 | 3 } | null>(null);
  const [result, setResult] = useState<{ c: Candidate; round: 0 | 1 | 2 | 3 } | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  const canSee =
    s.isStepOwner("telephonic_screening") ||
    s.isStepOwner("interview_1") ||
    s.isStepOwner("interview_2") ||
    s.isStepOwner("interview_3") ||
    s.isStepOwner("hr_shortlist") ||
    s.isProcessCoordinator ||
    s.myRequisitions.length > 0;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const c of s.candidates) {
      // A candidate parked in an interview stage owes that round — recording its result
      // is what moves them on, so anyone still sitting here has not been interviewed yet.
      const round = roundOf(c.stage);
      if (round === null) continue;
      const requisition = s.requisitionById(c.requisitionId);
      if (!requisition) continue;
      const interview = s.interviewsFor(c.id).find((iv) => iv.round === round && !iv.heldAt);
      out.push({ candidate: c, requisition, round, interview, mine: s.canActOnCandidate(c) });
    }
    return out.filter((r) => !mineOnly || r.mine);
  }, [s, mineOnly]);

  const completed = useMemo(() => INTERVIEW_STEPS.flatMap((step) => s.completedFor(step)), [s]);
  const stage = useStageMode(completed, s.userId);

  if (!canSee) return <AccessDenied />;

  const onEditCompleted = (e: StageEntry<CompletedRow>) =>
    setResult({ c: e.row as Candidate, round: roundOfStep(e.stepKey) });

  const dueOf = (r: Row) => s.candidateDueIso(r.candidate);
  const interviewerOf = (r: Row) =>
    r.interview?.interviewerId
      ? (s.profileById(r.interview.interviewerId)?.name ?? "Unknown")
      : (r.interview?.interviewerName ?? "");

  const columns: QueueColumn<Row>[] = [
    {
      key: "candidate",
      header: "Candidate",
      cell: (r) => (
        <button onClick={() => setOpen(r.candidate)} className="text-left">
          <div className="font-semibold text-navy hover:text-orange">{r.candidate.name}</div>
          <div className="text-[12px] text-grey">{r.candidate.phone ?? "—"}</div>
        </button>
      ),
      sortValue: (r) => r.candidate.name,
      filter: { kind: "text", get: (r) => r.candidate.name },
      exportValue: (r) => r.candidate.name,
    },
    {
      key: "vacancy",
      header: "Vacancy",
      cell: (r) => (
        <Link
          to={`/hr-recruitment/requisitions/${r.requisition.id}`}
          className="text-[12.5px] font-semibold text-orange hover:underline"
        >
          {r.requisition.mrfNo}
        </Link>
      ),
      sortValue: (r) => r.requisition.mrfNo,
      exportValue: (r) => `${r.requisition.mrfNo} — ${r.requisition.jobTitle}`,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "round",
      header: "Round",
      cell: (r) => <span className="font-medium text-navy">{ROUND_LABEL[r.round]}</span>,
      sortValue: (r) => r.round,
      filter: { kind: "text", get: (r) => ROUND_LABEL[r.round] },
      exportValue: (r) => ROUND_LABEL[r.round],
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (r) =>
        r.interview ? (
          <span className="rounded-full bg-page px-2 py-0.5 text-[11.5px] font-semibold text-navy">Booked</span>
        ) : (
          // The gap this page exists to expose: a round the system advanced them into
          // that nobody has actually arranged.
          <span className="rounded-full bg-[#FFF7E6] px-2 py-0.5 text-[11.5px] font-semibold text-yellow">
            Not booked
          </span>
        ),
      sortValue: (r) => (r.interview ? 1 : 0),
      filter: { kind: "text", get: (r) => (r.interview ? "Booked" : "Not booked") },
      exportValue: (r) => (r.interview ? "Booked" : "Not booked"),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "interviewer",
      header: "Interviewer",
      cell: (r) => {
        const who = interviewerOf(r);
        return who ? (
          <span className="text-navy">{who}</span>
        ) : (
          <span className="text-grey">Nobody yet</span>
        );
      },
      sortValue: (r) => interviewerOf(r),
      filter: { kind: "text", get: (r) => interviewerOf(r) || "Nobody yet" },
      exportValue: (r) => interviewerOf(r),
    },
    {
      key: "scheduled",
      header: "Interview on",
      cell: (r) =>
        r.interview?.scheduledOn ? (
          <span className="text-navy">{formatDateDMY(r.interview.scheduledOn)}</span>
        ) : (
          <span className="text-grey">—</span>
        ),
      sortValue: (r) => r.interview?.scheduledOn ?? "9999",
      exportValue: (r) => formatDateDMY(r.interview?.scheduledOn ?? null),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "waiting",
      header: "Waiting",
      cell: (r) => <span className="text-grey">{s.daysInStage(r.candidate)}d</span>,
      sortValue: (r) => s.daysInStage(r.candidate),
      exportValue: (r) => s.daysInStage(r.candidate),
      align: "right",
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={dueOf(r)} />,
      sortValue: (r) => dueOf(r) ?? "9999",
      exportValue: (r) => formatDateDMY(dueOf(r)),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Interviews</h1>
        <p className="mt-1 text-[13.5px] text-grey">
          {stage.showingCompleted
            ? "Rounds you have recorded. A selected/rejected result moves the candidate on, so most are a record now — an on-hold or no-show can still be corrected."
            : "Every interview still to happen. A round leaves this list once its result is recorded."}
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={rows.length}
        completedCount={completed.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote={s.stageScopeNote}
        right={
          stage.showingCompleted ? undefined : (
            <Button size="sm" variant={mineOnly ? "primary" : "ghost"} onClick={() => setMineOnly((v) => !v)}>
              {mineOnly ? "Showing only mine" : "Show only mine"}
            </Button>
          )
        }
      />

      {stage.showingCompleted ? (
        <CompletedTable
          rows={stage.rows}
          subjectHeader="Candidate"
          subject={(e) => <span className="font-medium text-navy">{e.ref}</span>}
          subjectText={(e) => e.ref}
          exportName="HR_Interviews_Completed"
          emptyMessage="Interview rounds you record will appear here."
          onEdit={onEditCompleted}
          onView={(e) => setOpen(e.row as Candidate)}
        />
      ) : (
      <QueueTable<Row>
        rows={rows}
        rowKey={(r) => `${r.candidate.id}-${r.round}`}
        columns={columns}
        groupBy={{
          idOf: (r) => r.requisition.id,
          nameOf: (id) => {
            const req = s.requisitionById(id);
            return req ? `${req.mrfNo} · ${req.jobTitle}` : "—";
          },
          allLabel: "All vacancies",
          label: "Vacancy",
        }}
        rowsLabel="interviews"
        rowClassName={(r) => overdueRowClass(dueOf(r))}
        emptyTitle="No interviews to run"
        emptyMessage="When a candidate reaches an interview round, they appear here — booked or waiting to be booked."
        initialSort={{ key: "due", dir: "asc" }}
        exportName="HR_Interviews"
        exportTitle="Interviews — still to happen"
        exportNotes={[
          "One row per interview round that has NOT yet been conducted. A round disappears once its result is recorded.",
          "'Not booked' means the candidate passed the previous round and was advanced automatically, but no interviewer or date has been set yet.",
          "The due date comes from the step's rule in Setup → Due Dates, counted in working days (Mon–Sat; only Sunday is skipped).",
          "Contains candidate names and phone numbers — this is personal data. Handle accordingly.",
        ]}
        actions={(r) =>
          r.mine ? (
            r.interview ? (
              <Button size="sm" variant="ghost" onClick={() => setResult({ c: r.candidate, round: r.round })}>
                Record result
              </Button>
            ) : (
              <Button size="sm" onClick={() => setBook({ c: r.candidate, round: r.round })}>
                Book it
              </Button>
            )
          ) : null
        }
      />
      )}

      {open && <CandidateDrawer candidate={open} open={!!open} onClose={() => setOpen(null)} />}
      {book && (
        <ScheduleInterviewModal
          candidate={book.c}
          round={book.round}
          open={!!book}
          onClose={() => setBook(null)}
        />
      )}
      {result && (
        <InterviewResultModal
          candidate={result.c}
          round={result.round}
          open={!!result}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
