import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import Tabs from "@/shared/components/ui/Tabs";
import { FIELD_LABEL_CLASS } from "@/shared/components/ui/Readout";
import { useRailWhileMounted } from "@/shared/components/layout/navRail";
import { returnToFor } from "@/shared/lib/returnTo";
import { CANDIDATES_ROUTE } from "./CandidatesList";
import CandidateDocuments from "../../components/kanban/CandidateDocuments";
import MoveModal from "../../components/kanban/MoveModal";
import OnboardingPanel from "../../components/onboarding/OnboardingPanel";
import CandidateDetailsCard from "../../components/candidate/CandidateDetailsCard";
import CandidateFit from "../../components/candidate/CandidateFit";
import CandidateMeetings from "../../components/candidate/CandidateMeetings";
import CandidateTimeline from "../../components/candidate/CandidateTimeline";
import ResumeViewer from "../../components/candidate/ResumeViewer";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeeBoard } from "../../lib/access";
import { STAGE_LABEL, columnOf, legalTargets } from "../../lib/board";
import { tintFor } from "../../lib/tint";
import type { CandidateStage, Onboarding } from "../../types";

/**
 * One candidate, on a page of their own.
 *
 * WHY A ROUTE AND NOT THE OLD POPUP
 *   A candidate had no address, so a bell saying "Priya moved to Round 2" could only
 *   drop you on the whole board to hunt for the card — `linkFor()` in HrLayout says
 *   as much, and before that it pointed at `/candidates/:id`, a route that had never
 *   existed. Now it does, and the deep link finally lands where it means to.
 *
 * TOP-LEVEL, not nested under `positions/:id`: a notification carries a candidate id
 * and nothing else, so the page resolves its own requisition. Everything on it is
 * derived from the id — nothing is passed in router state — which is what makes a
 * pasted link work exactly like a click.
 */
export default function CandidatePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const s = useHrStore();

  const [leftTab, setLeftTab] = useState("resume");
  const [midTab, setMidTab] = useState("discussion");
  const [moveTo, setMoveTo] = useState<CandidateStage | null>(null);
  const [stageMenu, setStageMenu] = useState(false);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Three columns need the width. The nav folds to its icon rail while this page is
  // open and springs back on the way out — the user's own setting is not touched.
  useRailWhileMounted();

  const c = s.candidateById(id);

  useEffect(() => {
    if (!stageMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setStageMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [stageMenu]);

  /**
   * Previous / next WITHIN THE SAME BOARD COLUMN, in the board's own order (oldest CV
   * first, matching CandidateBoard). Screening is a column at a time — fifteen new
   * CVs — and going back to the board between each one is the whole friction.
   */
  const siblings = useMemo(() => {
    if (!c) return [];
    const col = columnOf(c);
    return s
      .candidatesFor(c.requisitionId)
      .filter((x) => columnOf(x) === col)
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  }, [s, c]);

  if (!canSeeBoard(s)) return <AccessDenied />;

  /**
   * A real case, not a broken link: candidates load in a 24-month window, so an old
   * notification or bookmark can resolve to nothing. Saying "not found" would send
   * someone hunting for a bug that isn't there.
   */
  if (!c) {
    return (
      <EmptyState
        title="This candidate isn't loaded"
        message="Candidates are kept on screen for two years. This one is older than that, or belongs to a vacancy you don't have access to."
        actionLabel="Back to positions"
        actionTo="/hr-recruitment/positions"
      />
    );
  }

  const r = s.requisitionById(c.requisitionId);
  /**
   * Back goes where you actually came from.
   *
   * The all-candidates list marks its links `from: "candidates"`, and returnTo
   * remembers the exact URL it was left at — so Back restores the filters and the
   * page you had. Every other way in (a board card, an interview queue, a bell, a
   * pasted link) carries no such state and lands on the vacancy, exactly as before.
   * Router state is deliberately the signal: a pasted link has none, which is right.
   */
  const fromList = (location.state as { from?: string } | null)?.from === "candidates";
  const backTo = fromList
    ? returnToFor(CANDIDATES_ROUTE)
    : r
      ? `/hr-recruitment/positions/${r.id}`
      : "/hr-recruitment/positions";
  const targets = s.canEdit && s.canActOnCandidate(c) ? legalTargets(c.stage) : [];
  const idx = siblings.findIndex((x) => x.id === c.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // Carry the "where I came from" marker along the pager, so working through five
  // candidates and then hitting Back still returns to the list, not to a vacancy.
  const go = (candidateId: string) =>
    navigate(`/hr-recruitment/candidates/${candidateId}`, { state: location.state });

  return (
    <div className="space-y-4">
      {/* ---------------------------------- header --------------------------------- */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-page/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              to={backTo}
              aria-label="Back to the board"
              className="shrink-0 rounded-lg px-1.5 py-1 text-grey-2 hover:bg-white hover:text-navy"
            >
              ←
            </Link>
            <Avatar name={c.name} color={tintFor(c.id)} size={34} />
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-bold text-navy">{c.name}</h1>
              <div className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-grey-2">
                {c.candidateNo && <span>{c.candidateNo}</span>}
                <span className="font-medium text-navy">{STAGE_LABEL[c.stage]}</span>
                {r && (
                  <Link to={backTo} className="font-semibold text-orange hover:underline">
                    {r.jobTitle}
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
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

            {siblings.length > 1 && (
              <div className="flex items-center overflow-hidden rounded-lg border border-line bg-white">
                <button
                  onClick={() => prev && go(prev.id)}
                  disabled={!prev}
                  aria-label="Previous candidate in this column"
                  title={prev ? `← ${prev.name}` : "First in this column"}
                  className="px-2 py-1 text-[13px] text-navy hover:bg-page disabled:text-grey-2/50 disabled:hover:bg-transparent"
                >
                  ‹
                </button>
                <span className="border-x border-line px-2 py-1 text-[11.5px] text-grey-2">
                  {idx + 1}/{siblings.length}
                </span>
                <button
                  onClick={() => next && go(next.id)}
                  disabled={!next}
                  aria-label="Next candidate in this column"
                  title={next ? `${next.name} →` : "Last in this column"}
                  className="px-2 py-1 text-[13px] text-navy hover:bg-page disabled:text-grey-2/50 disabled:hover:bg-transparent"
                >
                  ›
                </button>
              </div>
            )}

            <Link
              to={backTo}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-grey-2 hover:bg-white hover:text-navy"
            >
              ✕
            </Link>
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
              { key: "meetings", label: "Meetings", count: s.interviewsFor(c.id).length || undefined },
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
          />
        </Card>
      </div>

      {moveTo && (
        <MoveModal candidate={c} toStage={moveTo} open={!!moveTo} onClose={() => setMoveTo(null)} />
      )}
      {onboarding && (
        <OnboardingPanel onboarding={onboarding} open={!!onboarding} onClose={() => setOnboarding(null)} />
      )}
    </div>
  );
}
