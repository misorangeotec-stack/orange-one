import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import { dueState } from "@/shared/lib/workingDays";
import { formatDateDMY } from "@/shared/lib/date";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { CANDIDATE_WINDOW_MONTHS } from "../../data/hrFetch";
import { useHrStore } from "../../store";
import { BOARD_COLUMNS, STAGE_LABEL, columnOf, type BoardColumnKey } from "../../lib/board";
import { useBoardDnd } from "./useBoardDnd";
import BoardColumn from "./BoardColumn";
import CandidateCard from "./CandidateCard";
import MoveModal from "./MoveModal";
import InterviewResultModal from "./InterviewResultModal";
import ScheduleInterviewModal from "./ScheduleInterviewModal";
import HodDecisionModal from "./HodDecisionModal";
import AddCandidatesModal from "./AddCandidatesModal";
import OnboardingPanel from "../onboarding/OnboardingPanel";
import type { Candidate, CandidateStage, Onboarding, Requisition } from "../../types";

/**
 * The candidate board for one requisition.
 *
 * It is a VIEW over `lib/queues.ts`, not a parallel model: a card's due date and
 * overdue chip are the same values the queue pages and the Control Center read. If
 * a card shows red here, it is red on the scoreboard too — by construction, not by
 * coincidence.
 *
 * Bulk actions exist because the sheet's own instruction is "Short List and Share a
 * minimum of 5–10 CVs with the HOD's" — a batch. Ticking ten cards and sharing them
 * in one go sends the HOD one notification, not ten.
 */
export default function CandidateBoard({
  requisition,
  onOpenCandidate,
}: {
  requisition: Requisition;
  onOpenCandidate: (c: Candidate) => void;
}) {
  const s = useHrStore();

  const [move, setMove] = useState<{ c: Candidate; to: CandidateStage } | null>(null);
  const [result, setResult] = useState<{ c: Candidate; round: 0 | 1 | 2 | 3 } | null>(null);
  const [schedule, setSchedule] = useState<{ c: Candidate; round: 0 | 1 | 2 | 3 } | null>(null);
  const [hodDecision, setHodDecision] = useState<{ ids: string[]; selected: boolean } | null>(null);
  const [addingCvs, setAddingCvs] = useState(false);
  /** The onboarding dialog, reachable straight from a Made Offer / Hired card. */
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const candidates = s.candidatesFor(requisition.id);

  // Uploading CVs belongs to the BOARD, not to one screen that happens to host it.
  // The board is rendered both from the requisition and from the position's own
  // page, and "where do I add resumes?" must have the same answer in both places.
  const canAddCvs = requisition.status === "sourcing" && s.canActOn("resume_upload", requisition);

  /**
   * Cards, grouped by the COLUMN they are drawn in — not by their raw stage.
   *
   * `columnOf` is total, so every card lands somewhere visible. The old grouping
   * did `map.get(c.stage)?.push(c)`, which silently dropped any stage without a
   * column while the queues went on counting it as open work.
   */
  const byColumn = useMemo(() => {
    const m = new Map<BoardColumnKey, Candidate[]>();
    for (const col of BOARD_COLUMNS) m.set(col.key, []);
    for (const c of candidates) {
      const key = columnOf(c);
      const list = m.get(key) ?? [];
      list.push(c);
      m.set(key, list);
    }
    // Oldest first inside a column — the thing that has waited longest is on top.
    for (const list of m.values()) list.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    return m;
  }, [candidates]);

  const dnd = useBoardDnd((id, to) => {
    const c = s.candidateById(id);
    if (c) setMove({ c, to });
  });

  const openOnboarding = (cand: Candidate) => {
    const o = s.onboardingForCandidate(cand.id);
    if (o) setOnboarding(o);
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  /**
   * Bulk actions key off the ticked card's own STAGE, never off the column it is
   * drawn in. "Shortlisted by HR" holds both `hr_shortlisted` and `shared_with_hod`,
   * and those two owe opposite actions — one is waiting for HR to send it, the other
   * for the HOD to decide. Selecting by column would offer "share with the HOD" for
   * cards already with the HOD, and would never offer the HOD anything at all.
   */
  const ticked = useMemo(() => candidates.filter((c) => selected.has(c.id)), [candidates, selected]);
  const shareIds = ticked.filter((c) => c.stage === "hr_shortlisted").map((c) => c.id);
  const hodIds = ticked.filter((c) => c.stage === "shared_with_hod").map((c) => c.id);
  const belowMin = shareIds.length > 0 && shareIds.length < s.minCvsToShare;

  /** Bulk: send the ticked CVs to the HOD in one action. */
  const shareSelected = async () => {
    if (!shareIds.length) return;
    setBusy(true);
    setErr(null);
    try {
      await s.shareCandidatesWithHod(shareIds);
      clearSelection();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * CVs older than the fetch window aren't loaded (see data/hrFetch.ts). For a
   * long-closed vacancy that means the board shows its hires but not the CVs it
   * turned down — so say so, rather than showing an honest-looking zero.
   */
  const outsideWindow =
    !!requisition.closedAt && requisition.submittedAt.slice(0, 10) < s.candidateWindowStartIso;

  const exportCandidates = () =>
    exportRowsToXlsx({
      fileName: `HR_Candidates_${requisition.mrfNo}`,
      sheetName: "Candidates",
      title: `Candidates — ${requisition.mrfNo} · ${requisition.jobTitle}`,
      rows: candidates,
      columns: [
        { header: "Candidate", width: 22, value: (c) => c.name },
        { header: "Phone", width: 14, value: (c) => c.phone ?? "" },
        { header: "Email", width: 26, value: (c) => c.email ?? "" },
        { header: "Current company", width: 22, value: (c) => c.currentCompany ?? "" },
        { header: "Experience (yrs)", width: 14, value: (c) => c.experienceYears ?? "" },
        { header: "Skills", width: 30, value: (c) => c.skills.join(", ") },
        { header: "Source platform", width: 18, value: (c) => s.jobPlatforms.find((p) => p.id === c.sourcePlatformId)?.name ?? "Not recorded" },
        { header: "Stage", width: 18, value: (c) => STAGE_LABEL[c.stage] },
        { header: "Days in stage", width: 12, value: (c) => s.daysInStage(c) },
        { header: "Due", width: 12, value: (c) => formatDateDMY(s.candidateDueIso(c)) },
        { header: "CV received", width: 13, value: (c) => formatDateDMY(c.uploadedAt) },
        { header: "Shortlisted by HR", width: 15, value: (c) => formatDateDMY(c.hrShortlistedAt) },
        { header: "Shared with HOD", width: 15, value: (c) => formatDateDMY(c.sharedToHodAt) },
        { header: "HOD decided", width: 13, value: (c) => formatDateDMY(c.hodDecidedAt) },
        { header: "Round 1 held", width: 13, value: (c) => formatDateDMY(c.interview1At) },
        { header: "Round 2 held", width: 13, value: (c) => formatDateDMY(c.interview2At) },
        { header: "Round 3 held", width: 13, value: (c) => formatDateDMY(c.interview3At) },
        { header: "Offer made on", width: 14, value: (c) => formatDateDMY(c.finalizedAt) },
        // Offered salary is gated: only salary viewers (admins, allowed depts/people) get the value.
        { header: "Offered CTC", width: 13, value: (c) => (s.canViewSalary ? (c.offeredCtc ?? "") : "") },
        { header: "Joined", width: 13, value: (c) => formatDateDMY(c.joinedAt) },
        { header: "Disqualified", width: 13, value: (c) => formatDateDMY(c.disqualifiedAt) },
        { header: "Disqualification reason", width: 26, value: (c) => s.disqualificationReasons.find((d) => d.id === c.disqualificationReasonId)?.name ?? "" },
      ],
      filters: [`Requisition: ${requisition.mrfNo} — ${requisition.jobTitle}`],
      notes: [
        "One row per candidate on this vacancy, whatever stage they reached.",
        "Every date is the moment the thing ACTUALLY happened, stamped by the system — an interview date means the round was held, not that it was booked.",
        "'Offer made on' is when the offer was extended; 'Joined' is when they actually turned up and their onboarding completed. A candidate can have the first without the second.",
        "A blank date means that stage was never reached.",
        "Contains names, phone numbers, email addresses and agreed salaries — this is personal data. Handle accordingly.",
        outsideWindow
          ? `This vacancy closed more than ${CANDIDATE_WINDOW_MONTHS} months ago, so only its hires are loaded — the CVs it turned down are not in this file.`
          : "",
      ].filter(Boolean),
    });

  return (
    <div className="space-y-3">
      {outsideWindow && (
        <p className="rounded-xl border border-line bg-page/60 px-4 py-2.5 text-[12.5px] text-grey-2">
          This vacancy closed more than {CANDIDATE_WINDOW_MONTHS} months ago. To keep the app fast, CVs uploaded before{" "}
          {formatDateDMY(s.candidateWindowStartIso)} are no longer loaded — you can see who was hired, but not the CVs
          that were turned down.
        </p>
      )}

      {/* ---- Bulk action bar ---- */}
      {(shareIds.length > 0 || hodIds.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-orange/40 bg-orange/5 px-4 py-2.5">
          <span className="text-[13px] font-medium text-navy">
            {shareIds.length + hodIds.length} selected
          </span>

          {shareIds.length > 0 && (
            <>
              <Button size="sm" onClick={shareSelected} disabled={busy}>
                {busy ? "Sharing…" : `Share ${shareIds.length} CV${shareIds.length === 1 ? "" : "s"} with the HOD`}
              </Button>
              {belowMin && (
                <span className="text-[12px] text-yellow">
                  Fewer than the {s.minCvsToShare} CVs you usually send. You can still go ahead.
                </span>
              )}
            </>
          )}

          {hodIds.length > 0 && (
            <>
              <Button size="sm" onClick={() => setHodDecision({ ids: hodIds, selected: true })} disabled={busy}>
                Shortlist {hodIds.length}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHodDecision({ ids: hodIds, selected: false })}
                disabled={busy}
              >
                Drop {hodIds.length}
              </Button>
            </>
          )}

          <button onClick={clearSelection} className="ml-auto text-[12.5px] font-semibold text-grey-2 hover:text-navy">
            Clear
          </button>
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      )}

      {/* ---- Board toolbar ---- */}
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-grey-2">
          {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={exportCandidates}
          disabled={candidates.length === 0}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[12px] font-semibold text-grey-2 hover:border-orange/50 hover:text-orange disabled:opacity-40 disabled:hover:border-line disabled:hover:text-grey-2"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Excel
        </button>
        {canAddCvs && (
          <Button size="sm" onClick={() => setAddingCvs(true)}>
            Add candidates
          </Button>
        )}
      </div>

      {/* ---- The board ---- */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {BOARD_COLUMNS.map((col) => {
          const cards = byColumn.get(col.key) ?? [];
          const overdue = cards.filter((c) => {
            const d = s.candidateDueIso(c);
            return d ? dueState(new Date(d)).overdue : false;
          }).length;

          return (
            <BoardColumn
              key={col.key}
              column={col}
              count={cards.length}
              overdue={overdue}
              isHover={dnd.hoverStage === col.target}
              droppable={dnd.draggingFrom !== null && dnd.allows(col.target)}
              onDragOver={(e) => dnd.onDragOver(e, col.target)}
              onDragLeave={() => dnd.onDragLeave(col.target)}
              onDrop={(e) => dnd.onDropOn(e, col.target)}
              onAdd={col.key === "resumes" && canAddCvs ? () => setAddingCvs(true) : undefined}
            >
              {cards.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  // Ticking a card only means something where a bulk action exists,
                  // and that is a property of the CARD's stage, not of the column.
                  selectable={c.stage === "hr_shortlisted" || c.stage === "shared_with_hod"}
                  selected={selected.has(c.id)}
                  onToggleSelect={toggleSelect}
                  onMoveTo={(cand, to) => setMove({ c: cand, to })}
                  onRecordResult={(cand, round) => setResult({ c: cand, round })}
                  onSchedule={(cand, round) => setSchedule({ c: cand, round })}
                  onOpen={onOpenCandidate}
                  onOpenOnboarding={openOnboarding}
                  onDragStart={dnd.onDragStart}
                  onDragEnd={dnd.onDragEnd}
                  dragging={dnd.draggingId === c.id}
                />
              ))}
            </BoardColumn>
          );
        })}
      </div>

      {move && (
        <MoveModal candidate={move.c} toStage={move.to} open={!!move} onClose={() => setMove(null)} />
      )}
      {result && (
        <InterviewResultModal
          candidate={result.c}
          round={result.round}
          open={!!result}
          onClose={() => setResult(null)}
        />
      )}
      {schedule && (
        <ScheduleInterviewModal
          candidate={schedule.c}
          round={schedule.round}
          open={!!schedule}
          onClose={() => setSchedule(null)}
        />
      )}
      {hodDecision && (
        <HodDecisionModal
          ids={hodDecision.ids}
          selected={hodDecision.selected}
          open={!!hodDecision}
          onClose={() => {
            setHodDecision(null);
            clearSelection();
          }}
        />
      )}
      {addingCvs && (
        <AddCandidatesModal requisition={requisition} open={addingCvs} onClose={() => setAddingCvs(false)} />
      )}
      {onboarding && (
        <OnboardingPanel onboarding={onboarding} open={!!onboarding} onClose={() => setOnboarding(null)} />
      )}
    </div>
  );
}
