import type { Profile } from "@/core/platform/types";
import type { PurchaseEntry, StepOwner } from "../types";
import { PURCHASE_STAGES } from "../config/stages";
import { useFmsStore } from "../mock/store";
import StageCard from "./StageCard";
import { isOwner, ownerLabel } from "../lib/owner";

/**
 * Vertical timeline of all 9 stages for one entry. Only the active stage is
 * actionable, and only by an assigned owner (or an admin). Completing it bubbles
 * up to the store, which advances the pipeline.
 */
export default function StageTimeline({
  entry,
  ownerForStep,
  profileById,
  userId,
  isAdmin,
  selectedKey,
  onComplete,
}: {
  entry: PurchaseEntry;
  ownerForStep: (stepKey: string) => StepOwner | undefined;
  profileById: (id: string | null) => Profile | undefined;
  userId: string;
  isAdmin: boolean;
  selectedKey?: string;
  onComplete: (values: Record<string, string | number | null>) => void;
}) {
  const { uploadDocument } = useFmsStore();
  const onUploadFile = (file: File) => uploadDocument(entry.id, file);
  return (
    <div>
      {PURCHASE_STAGES.map((def, i) => {
        const state = entry.stages[i];
        if (!state) return null;
        const owner = ownerForStep(def.key);
        const canAct = state.status === "active" && (isAdmin || isOwner(owner, userId));
        return (
          <StageCard
            key={def.key}
            def={def}
            state={state}
            ownerLabel={ownerLabel(owner, profileById)}
            isLast={i === PURCHASE_STAGES.length - 1}
            canAct={canAct}
            highlight={selectedKey ? selectedKey === def.key : state.status === "active"}
            anchorId={`fms-stage-${def.key}`}
            onComplete={onComplete}
            onUploadFile={onUploadFile}
          />
        );
      })}
    </div>
  );
}
