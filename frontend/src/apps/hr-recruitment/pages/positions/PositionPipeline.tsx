import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { formatDateDMY } from "@/shared/lib/date";
import CandidateBoard from "../../components/kanban/CandidateBoard";
import PipelineSummary from "../../components/positions/PipelineSummary";
import StateNote from "../../components/StateNote";
import StatusPill from "../../components/StatusPill";
import HiringTeamModal from "../../components/HiringTeamModal";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { canSeeBoard } from "../../lib/access";
import { isLivePosition } from "../../lib/positions";
import { isOpenCandidate } from "../../lib/queues";
import { REQ_STATUS_LABEL } from "../../lib/format";

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
  // Declared before the early returns below — a hook after them crashes the page.
  const [changingTeam, setChangingTeam] = useState(false);

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
  // NR-3: org-wide, NOT profileById. The directory is RLS-scoped, so a head mapped
  // from another department resolved to undefined and was dropped by the filter —
  // the cluster then showed nothing at all on a vacancy that has an owner.
  const team = r.hiringManagerIds.map((mid) => s.personNameOrNull(mid)).filter((n): n is string => !!n);

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

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-grey-2">Hiring team</span>
          {team.length > 0 ? (
            <span className="flex items-center -space-x-1.5">
              {team.map((n) => (
                <Avatar key={n} name={n} size={26} className="ring-2 ring-white" />
              ))}
            </span>
          ) : (
            <span className="text-[12.5px] text-grey-2">Not set</span>
          )}
          {/* NR-3. Gated on the client mirror of fms_hr_may_set_hiring_managers; the
              RPC is still the authority, so the two can never disagree about Save. */}
          {s.canSetHiringManagers(r) && (
            <Button size="sm" variant="ghost" onClick={() => setChangingTeam(true)}>
              Change
            </Button>
          )}
        </div>
      </div>

      {/* Why it stopped, then what that means for this board. The note carries the reason,
          the person and the date; the sentence below it only explains the read-only state. */}
      <StateNote requisition={r} />

      {!live && (
        <p className="rounded-xl border border-line bg-page/60 px-4 py-2.5 text-[12.5px] text-grey-2">
          This position is {REQ_STATUS_LABEL[r.status].toLowerCase()}. Its board is read-only — candidates cannot be
          moved until it is taking applications again.
        </p>
      )}

      <PipelineSummary candidates={candidates} />

      <CandidateBoard
        requisition={r}
        onOpenCandidate={(cand) => navigate(`/hr-recruitment/candidates/${cand.id}`)}
      />

      {changingTeam && (
        <HiringTeamModal requisition={r} open={changingTeam} onClose={() => setChangingTeam(false)} />
      )}
    </div>
  );
}
