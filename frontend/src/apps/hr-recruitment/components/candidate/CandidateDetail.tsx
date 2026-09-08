import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import CandidateDocuments from "../kanban/CandidateDocuments";
import MoveModal from "../kanban/MoveModal";
import InterviewResultModal from "../kanban/InterviewResultModal";
import ScheduleInterviewModal from "../kanban/ScheduleInterviewModal";
import OnboardingPanel from "../onboarding/OnboardingPanel";
import CandidateDetailsCard from "./CandidateDetailsCard";
import CandidateFit from "./CandidateFit";
import CandidateMeetings from "./CandidateMeetings";
import CandidateTimeline from "./CandidateTimeline";
import ResumeViewer from "./ResumeViewer";
import { useHrStore } from "../../store";
import { STAGE_LABEL, legalTargets, roundOf } from "../../lib/board";
import { isBooked } from "../../lib/interviewers";
import { tintFor } from "../../lib/tint";
import type { Candidate, CandidateStage, Onboarding } from "../../types";

/**
 * ONE CANDIDATE, RENDERED ONCE — header, three columns, and every modal they drive.
 *
 * THIS FILE EXISTS SO THERE IS EXACTLY ONE RENDERER. It was lifted wholesale out of
 * CandidatePage when the management pipeline dashboard (NR-2) needed the same thing
 * inline. Two copies of these three columns is how a field gets fixed in one place and
 * stays broken in the other, so CandidatePage now renders THIS and keeps no grid of
 * its own.
 *
 * ⚠ THE HEADER CAME WITH IT, DELIBERATELY. The obvious seam was "lift the body, let
 *   each host build its own header" — and it is wrong. "Change stage" lives in the
 *   header while the MoveModal it opens is mounted in the body, so leaving the header
 *   behind would have forced the dashboard to rebuild the one control that actually
 *   writes. That is the very duplication the extraction is for. The host therefore
 *   supplies only what is genuinely its own: where Back goes, and which rows ‹ › walks.
 *
 * WHAT THE HOST OWNS, AND WHY EACH:
 *   `onBack`   — CandidatePage NAVIGATES (to the list or to the vacancy, depending on
 *                how you arrived); the dashboard only switches mode, without leaving
 *                its URL. A callback covers both; a `to=` string could not.
 *   `pager`    — the sibling set is not a property of the candidate. CandidatePage
 *                pages within one board column of one requisition; the dashboard pages
 *                its own FILTERED rows. Copying either rule across would page you to
 *                somebody who is not on the screen you are looking at.
 *   `onOpenCandidate` — see the note on that prop.
 *
 * The nav rail is NOT folded here. Folding it is a property of the PAGE you are on,
 * not of this component, and doing it from inside would collapse the sidebar in any
 * drawer or split view that ever embeds this. Hosts call `useRailWhileMounted()`.
 */
export interface CandidateDetailPager {
  /** 1-based position, for the "3/17" readout. */
  index: number;
  total: number;
  prev: Candidate | null;
  next: Candidate | null;
  go: (candidateId: string) => void;
  /** What the ‹ › tooltips call this set, e.g. "in this column". */
  label?: string;
}

export default function CandidateDetail({
  candidate: c,
  onBack,
  backLabel = "Back",
  vacancyTo,
  pager,
  onOpenCandidate,
}: {
  candidate: Candidate;
  onBack: () => void;
  backLabel?: string;
  /** Where the vacancy name links. Omit to fall back to the position page. */
  vacancyTo?: string;
  pager?: CandidateDetailPager;
  /**
   * Open ANOTHER candidate without leaving the host screen.
   *
   * Only the duplicate-candidate list inside CandidateDetailsCard needs this. On the
   * dashboard a plain <Link> there would silently throw the reader out onto the
   * candidate page — losing the matrix, the filters and their place in the list — for
   * what is meant to be a glance at "is this the same person?". Given a callback, the
   * card swaps the detail in place instead. CandidatePage passes nothing and keeps the
   * link it has always had, because there navigating IS the right behaviour.
   */
  onOpenCandidate?: (candidateId: string) => void;
}) {
  const s = useHrStore();

  const [leftTab, setLeftTab] = useState("resume");
  const [midTab, setMidTab] = useState("discussion");
  const [moveTo, setMoveTo] = useState<CandidateStage | null>(null);
  const [stageMenu, setStageMenu] = useState(false);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [result, setResult] = useState<0 | 1 | 2 | 3 | null>(null);
  const [book, setBook] = useState<0 | 1 | 2 | 3 | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stageMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setStageMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [stageMenu]);

  const r = s.requisitionById(c.requisitionId);

  /**
   * The ONE authority question this component asks, asked once.
   *
   * Every action below hangs off it. It was previously re-derived at four separate
   * sites (the page, the board card, the meetings panel, the interviews queue) — the
   * same expression each time, which is four chances to drift apart.
   */
  const mine = s.canEdit && s.canActOnCandidate(c);

  const targets = mine ? legalTargets(c.stage) : [];

  /**
   * The interview round this candidate is sitting in, if any — and whether it has been
   * booked, and whether it has been held.
   *
   * The gate is copied verbatim from CandidateCard: a round the system auto-advanced
   * into has NO interviewer yet, so it must be booked before a result can be recorded.
   * Recording a result against a round nobody was ever assigned to is meaningless.
   */
  const round = roundOf(c.stage);
  const iv = round !== null ? s.interviewRound(c.id, round) : undefined;
  const needsScheduling = round !== null && !isBooked(iv);
  const conducted = !!iv?.heldAt;
  const showInterviewAction = mine && round !== null && !conducted;

  const pagerLabel = pager?.label ?? "in this list";
  const jobLink = vacancyTo ?? (r ? `/hr-recruitment/positions/${r.id}` : null);
  const interviewsCount = useMemo(() => s.interviewsFor(c.id).length, [s, c.id]);

  return (
    <div className="space-y-4">
      {/* ---------------------------------- header --------------------------------- */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-page/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={onBack}
              aria-label={backLabel}
              title={backLabel}
              className="shrink-0 rounded-lg px-1.5 py-1 text-grey-2 hover:bg-white hover:text-navy"
            >
              ←
            </button>
            <Avatar name={c.name} color={tintFor(c.id)} size={34} />
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-bold text-navy">{c.name}</h1>
              <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-grey-2">
                {c.candidateNo && <span>{c.candidateNo}</span>}
                <span className="font-medium text-navy">{STAGE_LABEL[c.stage]}</span>
                {r &&
                  (jobLink ? (
                    <Link to={jobLink} className="font-semibold text-orange hover:underline">
                      {r.jobTitle}
                    </Link>
                  ) : (
                    <span className="font-semibold text-navy">{r.jobTitle}</span>
                  ))}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Book it / Record result.
                These existed ONLY on the board and the Interviews queue, so the one
                screen showing everything about a candidate could not record what had
                just happened to them. Same gate, same modals — nothing new is
                permitted, it only saves the trip. */}
            {showInterviewAction && round !== null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => (needsScheduling ? setBook(round) : setResult(round))}
              >
                {needsScheduling ? "Book it" : "Record result"}
              </Button>
            )}

            {targets.length > 0 && (
              <div ref={menuRef} className="relative">
                <Button size="sm" onClick={() => setStageMenu((m) => !m)}>
                  Change stage
                </Button>
                {stageMenu && (
                  <div className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-line bg-white py-1 shadow-lg">
                    <div className={`px-3 py-1 ${FIELD_LABEL_CLASS}`}>Move to</div>
                    {targets.map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setStageMenu(false);
                          setMoveTo(t);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-[12.5px] text-navy hover:bg-page"
                      >
                        {STAGE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pager && pager.total > 1 && (
              <div className="flex items-center overflow-hidden rounded-lg border border-line bg-white">
                <button
                  onClick={() => pager.prev && pager.go(pager.prev.id)}
                  disabled={!pager.prev}
                  aria-label={`Previous candidate ${pagerLabel}`}
                  title={pager.prev ? `← ${pager.prev.name}` : `First ${pagerLabel}`}
                  className="px-2 py-1 text-[13px] text-navy hover:bg-page disabled:text-grey-2/50 disabled:hover:bg-transparent"
                >
                  ‹
                </button>
                <span className="border-x border-line px-2 py-1 text-[11.5px] text-grey-2">
                  {pager.index}/{pager.total}
                </span>
                <button
                  onClick={() => pager.next && pager.go(pager.next.id)}
                  disabled={!pager.next}
                  aria-label={`Next candidate ${pagerLabel}`}
                  title={pager.next ? `${pager.next.name} →` : `Last ${pagerLabel}`}
                  className="px-2 py-1 text-[13px] text-navy hover:bg-page disabled:text-grey-2/50 disabled:hover:bg-transparent"
                >
                  ›
                </button>
              </div>
            )}

            <button
              onClick={onBack}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-grey-2 hover:bg-white hover:text-navy"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* ---------------------------------- body ----------------------------------- */}
      {/* The CV is the densest thing on the page and the one you actually read, so it
          takes the widest column — a PDF scales to its container, and 20% more width
          is 20% larger type. The discussion gives that width up: its content is short
          lines that wrap comfortably, and it loses nothing by being narrower. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)_320px]">
        {/* Left — the paperwork */}
        <Card className="p-3">
          <Tabs
            tabs={[
              { key: "resume", label: "Resume / CV" },
              { key: "documents", label: "Documents" },
            ]}
            active={leftTab}
            onChange={setLeftTab}
          />
          <div className="mt-3">
            {leftTab === "resume" ? <ResumeViewer candidate={c} /> : <CandidateDocuments candidate={c} />}
          </div>
        </Card>

        {/* Middle — the conversation, and the machine's read of the CV.
            AI fit is a tab rather than a block in the right rail because a tab
            costs ZERO extra page height (this card already draws the strip, and
            the page's height is set by the CV viewer), and because `midTab` lives
            here rather than inside the tab — so it survives the ‹ › pager. Pick
            "AI fit" once and pressing › lands the next candidate already on it,
            which is what turns screening a column into one loop. */}
        <Card className="flex flex-col p-3">
          <Tabs
            tabs={[
              { key: "discussion", label: "Discussion" },
              { key: "meetings", label: "Meetings", count: interviewsCount || undefined },
              // The score IS the count pill — readable from the Discussion tab
              // without a second badge anywhere on the page.
              { key: "fit", label: "AI fit", count: s.fitFor(c.id)?.overall },
            ]}
            active={midTab}
            onChange={setMidTab}
          />
          <div className="mt-3 flex-1">
            {midTab === "discussion" ? (
              <CandidateTimeline candidate={c} />
            ) : midTab === "meetings" ? (
              <CandidateMeetings candidate={c} />
            ) : (
              <CandidateFit candidate={c} />
            )}
          </div>
        </Card>

        {/* Right — the facts */}
        <Card className="p-4 lg:sticky lg:top-24 lg:self-start">
          <CandidateDetailsCard
            candidate={c}
            onOpenOnboarding={() => {
              const o = s.onboardingForCandidate(c.id);
              if (o) setOnboarding(o);
            }}
            onOpenCandidate={onOpenCandidate}
          />
        </Card>
      </div>

      {moveTo && (
        <MoveModal candidate={c} toStage={moveTo} open={!!moveTo} onClose={() => setMoveTo(null)} />
      )}
      {result !== null && (
        <InterviewResultModal candidate={c} round={result} open onClose={() => setResult(null)} />
      )}
      {book !== null && (
        <ScheduleInterviewModal candidate={c} round={book} open onClose={() => setBook(null)} />
      )}
      {onboarding && (
        <OnboardingPanel onboarding={onboarding} open={!!onboarding} onClose={() => setOnboarding(null)} />
      )}
    </div>
  );
}
