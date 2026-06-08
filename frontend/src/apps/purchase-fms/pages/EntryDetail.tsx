import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { formatDate } from "@/shared/lib/time";
import { useFmsStore, activeStage, entryStatus } from "../mock/store";
import { STAGE_COUNT, stageByKey } from "../config/stages";
import { ownerLabel } from "../lib/owner";
import PipelineStepper from "../components/PipelineStepper";
import StageTimeline from "../components/StageTimeline";
import EmptyState from "@/shared/components/ui/EmptyState";

/**
 * The core Purchase FMS screen: a hybrid pipeline view for one entry — a
 * horizontal stepper + progress bar up top, and the full vertical stage timeline
 * (with the active stage's inline entry form) below.
 */
export default function EntryDetail() {
  const { id = "" } = useParams();
  const { user, isAdmin } = useSession();
  const { profileById } = useDirectory();
  const { getEntry, ownerForStep, completeStage } = useFmsStore();
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);

  const focusStage = (key: string) => {
    setSelectedKey(key);
    // Defer so the highlight class is applied before we scroll to the card.
    requestAnimationFrame(() => {
      document.getElementById(`fms-stage-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const entry = getEntry(id);
  if (!entry) {
    return (
      <EmptyState
        title="Entry not found"
        message="This purchase entry no longer exists."
        actionLabel="Back to all entries"
        actionTo="/purchase-fms/entries"
      />
    );
  }

  const handleComplete = async (values: Record<string, string | number | null>) => {
    setActionError(null);
    try {
      await completeStage(entry.id, values);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not complete this stage. You may not be its assigned owner.");
    }
  };

  const status = entryStatus(entry);
  const active = activeStage(entry);
  const activeDef = active ? stageByKey(active.key) : undefined;
  const activeOwner = active ? ownerLabel(ownerForStep(active.key), profileById) : "—";

  return (
    <div className="space-y-5">
      <Link to="/purchase-fms/entries" className="inline-flex items-center gap-1.5 text-[13px] text-grey hover:text-orange transition">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        All entries
      </Link>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[22px] font-bold text-navy">{entry.code}</h2>
              <span className="rounded-pill bg-page px-2.5 py-1 text-[11.5px] font-semibold text-grey">{entry.category}</span>
            </div>
            <p className="text-grey text-[13.5px] mt-1">
              <span className="text-navy font-medium">{entry.itemName}</span> · {entry.quantity.toLocaleString("en-IN")} {entry.unit}
            </p>
          </div>
          <div className="text-right text-[12.5px] text-grey-2">
            <div>Created {formatDate(entry.createdAt.slice(0, 10))}</div>
            {status === "completed" ? (
              <div className="text-[#1f9d57] font-semibold mt-0.5">Pipeline complete</div>
            ) : (
              <div className="mt-0.5">Current: <span className="text-navy font-medium">{activeDef?.title}</span> · {activeOwner}</div>
            )}
          </div>
        </div>

        <div className="mt-5">
          <PipelineStepper stages={entry.stages} selectedKey={selectedKey} onSelect={focusStage} />
        </div>
      </Card>

      {status === "completed" && (
        <div className="rounded-card border border-[#bfe6cf] bg-[#E8F8EF] px-4 py-3 text-[13px] text-[#1f9d57] font-medium">
          All {STAGE_COUNT} stages are done — this purchase is fully processed.
        </div>
      )}

      {actionError && (
        <div className="rounded-card border border-[#f3c9c9] bg-[#fdecec] px-4 py-3 text-[13px] text-ryg-red font-medium">
          {actionError}
        </div>
      )}

      <StageTimeline
        entry={entry}
        ownerForStep={ownerForStep}
        profileById={profileById}
        userId={user.id}
        isAdmin={isAdmin}
        selectedKey={selectedKey}
        onComplete={handleComplete}
      />
    </div>
  );
}
