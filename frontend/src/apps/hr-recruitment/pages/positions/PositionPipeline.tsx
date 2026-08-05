import { Link, useNavigate, useParams } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import { formatDateDMY } from "@/shared/lib/date";
import CandidateBoard from "../../components/kanban/CandidateBoard";
import PipelineSummary from "../../components/positions/PipelineSummary";
import StatusPill from "../../components/StatusPill";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeeBoard } from "../../lib/access";
import { isLivePosition } from "../../lib/positions";
import { isOpenCandidate } from "../../lib/queues";

/**
 * One position, and the people moving through it.
 *
 * The board gets a whole page here rather than a tab, because it is the screen HR
 * actually lives in: ten columns need the width, and the header carries the facts
 * you need while you work it — which job, where, how many seats are left, and who
 * the hiring team is.
 */
export default function PositionPipeline() {
  const { id = "" } = useParams();
  const s = useHrStore();
  const navigate = useNavigate();

  if (!canSeeBoard(s)) return <AccessDenied />;

  const r = s.requisitionById(id);
  if (!r) {
    return (
      <EmptyState
        title="Position not found"
        message="It may have been cancelled, or you may not have access to it."
        actionLabel="Back to positions"
        actionTo="/hr-recruitment/positions"
      />
    );
  }

  const live = isLivePosition(r);
  const candidates = s.candidatesFor(r.id);
  const inPlay = candidates.filter(isOpenCandidate).length;
  const joined = s.seatsJoined(r.id);
  const location = r.locationId ? s.locations.find((l) => l.id === r.locationId)?.name : null;
  const team = r.hiringManagerIds.map((mid) => s.profileById(mid)?.name).filter((n): n is string => !!n);

  return (
    <div className="space-y-4">
      <div>
        <Link to="/hr-recruitment/positions" className="text-[12.5px] font-semibold text-grey-2 hover:text-orange">
          ← Positions
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${live ? "bg-ryg-green" : "bg-grey-2/40"}`}
              aria-hidden="true"
            />
            <h1 className="truncate text-[22px] font-bold text-navy">{r.jobTitle}</h1>
            <StatusPill status={r.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-grey-2">
            <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
              {r.mrfNo}
            </Link>
            {location && <span>{location}</span>}
            <span>
              {joined} of {r.positionsRequired} {r.positionsRequired === 1 ? "seat" : "seats"} filled
            </span>
            <span>{inPlay} still in play</span>
            {r.postedAt && <span>Posted {formatDateDMY(r.postedAt)}</span>}
          </div>
        </div>

        {team.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-grey-2">Hiring team</span>
            <span className="flex items-center -space-x-1.5">
              {team.map((n) => (
                <Avatar key={n} name={n} size={26} className="ring-2 ring-white" />
              ))}
            </span>
          </div>
        )}
      </div>

      {!live && (
        <p className="rounded-xl border border-line bg-page/60 px-4 py-2.5 text-[12.5px] text-grey-2">
          This position is {r.status === "on_hold" ? "on hold" : r.status}. Its board is read-only — candidates cannot be
          moved until it is taking applications again.
        </p>
      )}

      <PipelineSummary candidates={candidates} />

      <CandidateBoard
        requisition={r}
        onOpenCandidate={(cand) => navigate(`/hr-recruitment/candidates/${cand.id}`)}
      />
    </div>
  );
}
