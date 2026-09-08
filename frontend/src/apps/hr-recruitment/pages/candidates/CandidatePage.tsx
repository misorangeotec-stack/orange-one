import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import EmptyState from "@/shared/components/ui/EmptyState";
import { useRailWhileMounted } from "@/shared/components/layout/navRail";
import { returnToFor } from "@/shared/lib/returnTo";
import { CANDIDATES_ROUTE } from "./CandidatesList";
import CandidateDetail from "../../components/candidate/CandidateDetail";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeeBoard } from "../../lib/access";
import { columnOf } from "../../lib/board";

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
 *
 * ⚠ THE DETAIL ITSELF IS NOT HERE. Header, three columns and every modal live in
 *   `components/candidate/CandidateDetail`, because the management pipeline dashboard
 *   (NR-2) renders the same thing inline. This page is now only the four things that
 *   are genuinely ITS OWN: reading the id out of the URL, folding the nav rail,
 *   deciding where Back goes, and choosing which candidates ‹ › walks. Do not
 *   re-add a copy of the grid here — two renderers of the same fields is how one gets
 *   fixed and the other stays broken.
 */
export default function CandidatePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const s = useHrStore();

  // Three columns need the width. The nav folds to its icon rail while this page is
  // open and springs back on the way out — the user's own setting is not touched.
  useRailWhileMounted();

  const c = s.candidateById(id);

  /**
   * Previous / next WITHIN THE SAME BOARD COLUMN, in the board's own order (oldest CV
   * first, matching CandidateBoard). Screening is a column at a time — fifteen new
   * CVs — and going back to the board between each one is the whole friction.
   *
   * This set belongs to THIS page. The dashboard pages its own filtered rows instead,
   * which is why CandidateDetail takes the pager rather than deriving one.
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

  const idx = siblings.findIndex((x) => x.id === c.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  // Carry the "where I came from" marker along the pager, so working through five
  // candidates and then hitting Back still returns to the list, not to a vacancy.
  const go = (candidateId: string) =>
    navigate(`/hr-recruitment/candidates/${candidateId}`, { state: location.state });

  return (
    <CandidateDetail
      candidate={c}
      onBack={() => navigate(backTo)}
      backLabel="Back to the board"
      vacancyTo={backTo}
      pager={{
        index: idx + 1,
        total: siblings.length,
        prev,
        next,
        go,
        label: "in this column",
      }}
    />
  );
}
