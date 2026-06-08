import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import { formatDate } from "@/shared/lib/time";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { useFmsStore, activeStage, entryStatus, doneCount } from "../mock/store";
import { STAGE_COUNT, stageByKey } from "../config/stages";
import { isOwner, ownerLabel } from "../lib/owner";
import EntryProgressBar from "../components/EntryProgressBar";

/**
 * "It's your turn" inbox — entries whose active stage the current user may action.
 * Admins oversee every in-progress entry; everyone else sees only stages assigned
 * to them. This is where stage-handoff notifications link to.
 */
export default function MyQueue() {
  const navigate = useNavigate();
  const { user, isAdmin } = useSession();
  const { profileById } = useDirectory();
  const { entries, ownerForStep } = useFmsStore();

  const mine = useMemo(
    () =>
      entries.filter((e) => {
        if (entryStatus(e) !== "in_progress") return false;
        const active = activeStage(e);
        if (!active) return false;
        return isAdmin || isOwner(ownerForStep(active.key), user.id);
      }),
    [entries, isAdmin, ownerForStep, user.id]
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">My Queue</h2>
        <p className="text-grey text-[13px] mt-1">
          {isAdmin ? "Every entry currently awaiting action." : "Entries waiting on you to complete your stage."}
        </p>
      </div>

      {mine.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing in your queue"
            message="When an entry reaches a stage you own, it'll show up here."
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {mine.map((e) => {
            const active = activeStage(e);
            const def = active ? stageByKey(active.key) : undefined;
            const owner = active ? ownerLabel(ownerForStep(active.key), profileById) : "—";
            return (
              <Card
                key={e.id}
                onClick={() => navigate(`/purchase-fms/entries/${e.id}`)}
                className="p-4 cursor-pointer hover:-translate-y-0.5 hover:border-[#d9e2f0] transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-navy">{e.code}</span>
                  <span className="rounded-pill bg-orange-soft px-2.5 py-1 text-[11px] font-semibold text-orange">{def?.title ?? "—"}</span>
                </div>
                <p className="text-[13px] text-navy font-medium mt-1.5">{e.itemName}</p>
                <p className="text-[11.5px] text-grey-2">{e.category} · {e.quantity.toLocaleString("en-IN")} {e.unit}</p>
                <div className="mt-3"><EntryProgressBar done={doneCount(e)} total={STAGE_COUNT} /></div>
                <div className="mt-3 flex items-center justify-between text-[11.5px] text-grey-2">
                  <span>Owner: <span className="text-navy font-medium">{owner}</span></span>
                  <span>{active?.plannedDate ? `Planned ${formatDate(active.plannedDate)}` : ""}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
