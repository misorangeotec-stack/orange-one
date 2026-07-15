import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { dueState } from "@/shared/lib/workingDays";
import CandidateBoard from "../../components/kanban/CandidateBoard";
import CandidateDrawer from "../../components/kanban/CandidateDrawer";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import type { Candidate } from "../../types";

/**
 * The candidate pipeline across every open vacancy.
 *
 * The board is per-requisition (a card only means something against the vacancy it
 * applied to), so this page picks one and shows its board — with a picker that
 * leads with the vacancies that have work waiting on YOU.
 */
export default function PipelineQueue() {
  const s = useHrStore();
  const [reqId, setReqId] = useState<string>("");
  const [openCandidate, setOpenCandidate] = useState<Candidate | null>(null);

  const canSeeBoard =
    s.isStepOwner("resume_upload") ||
    s.isStepOwner("hr_shortlist") ||
    s.isStepOwner("hod_share") ||
    s.isStepOwner("telephonic_screening") ||
    s.isStepOwner("interview_1") ||
    s.isStepOwner("interview_2") ||
    s.isStepOwner("interview_3") ||
    s.isStepOwner("final_decision") ||
    s.isProcessCoordinator ||
    s.myRequisitions.length > 0;

  /** Open vacancies, each with how many of its cards are waiting on this user. */
  const options = useMemo(() => {
    const live = s.requisitions.filter((r) => r.status === "sourcing");
    return live
      .map((r) => {
        const cands = s.candidatesFor(r.id);
        const mine = cands.filter((c) => c.stage !== "finalized" && c.stage !== "disqualified" && s.canActOnCandidate(c));
        const overdue = mine.filter((c) => {
          const d = s.candidateDueIso(c);
          return d ? dueState(new Date(d)).overdue : false;
        }).length;
        return { r, mine: mine.length, overdue };
      })
      .sort((a, b) => b.overdue - a.overdue || b.mine - a.mine || a.r.mrfNo.localeCompare(b.r.mrfNo));
  }, [s]);

  if (!canSeeBoard) return <AccessDenied />;

  const chosen = reqId ? s.requisitionById(reqId) : options[0]?.r;

  const comboOptions: ComboOption[] = options.map((o) => ({
    value: o.r.id,
    label: `${o.r.mrfNo} · ${o.r.jobTitle}`,
    sublabel:
      o.mine > 0
        ? `${o.mine} waiting on you${o.overdue > 0 ? ` · ${o.overdue} overdue` : ""}`
        : "nothing waiting on you",
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Candidate Pipeline</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Drag a card to move it, or use its ⋮ menu. Every move asks for what it needs — an interviewer, a reason, the
          agreed salary.
        </p>
      </div>

      {options.length === 0 ? (
        <EmptyState
          title="No vacancies are collecting CVs"
          message="Once a requisition is approved and the job is posted, its candidate board appears here."
          actionLabel="See requisitions"
          actionTo="/hr-recruitment/requisitions"
        />
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px] font-medium text-navy">Vacancy</span>
              <div className="min-w-[280px]">
                <Combobox
                  value={chosen?.id ?? ""}
                  onChange={setReqId}
                  options={comboOptions}
                  placeholder="Pick a vacancy"
                  searchable
                />
              </div>
              {chosen && (
                <Link
                  to={`/hr-recruitment/requisitions/${chosen.id}`}
                  className="ml-auto text-[12.5px] font-semibold text-orange hover:underline"
                >
                  Open the requisition →
                </Link>
              )}
            </div>
          </Card>

          {chosen && <CandidateBoard requisition={chosen} onOpenCandidate={setOpenCandidate} />}
        </>
      )}

      {openCandidate && (
        <CandidateDrawer
          candidate={openCandidate}
          open={!!openCandidate}
          onClose={() => setOpenCandidate(null)}
        />
      )}
    </div>
  );
}
