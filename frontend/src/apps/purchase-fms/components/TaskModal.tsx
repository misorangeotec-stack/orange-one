import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import type { PurchaseEntry } from "../types";
import { activeStage } from "../mock/store";
import { useFmsStore } from "../mock/store";
import { stageByKey } from "../config/stages";
import StageForm from "./StageForm";

/**
 * The individual-user completion pop-up. Shows a read-only summary of the order
 * plus the form for the ONE stage currently awaiting this user, and completes it
 * through the same write path the pipeline uses (`completeStage` → fms_complete_stage
 * RPC + cache invalidate). No stepper, no other stages — the simplified inbox flow.
 *
 * `onComplete` is an optional override of how completion is persisted: real usage
 * leaves it unset (→ the store RPC); Test Mode passes a local handler so the exact
 * same pop-up can be driven against an in-memory sandbox entry (no DB writes).
 */
export default function TaskModal({
  entry,
  onClose,
  onComplete,
  onUploadFile,
}: {
  entry: PurchaseEntry;
  onClose: () => void;
  onComplete?: (entryId: string, values: Record<string, string | number | null>) => Promise<void> | void;
  /** Override the file uploader (Test Mode passes a no-DB stub); defaults to the store. */
  onUploadFile?: (file: File) => Promise<string>;
}) {
  const { completeStage, uploadDocument } = useFmsStore();
  const complete = onComplete ?? completeStage;
  const upload = onUploadFile ?? ((file: File) => uploadDocument(entry.id, file));
  const [error, setError] = useState<string | null>(null);

  const active = activeStage(entry);
  const def = active ? stageByKey(active.key) : undefined;

  // Defensive: if the entry has no actionable stage, there's nothing to show.
  if (!active || !def) return null;

  const submit = async (values: Record<string, string | number | null>) => {
    setError(null);
    try {
      await complete(entry.id, values);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete this task. Please try again.");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={def.title}
      subtitle={`${entry.code} · ${entry.itemName} · ${entry.quantity.toLocaleString("en-IN")} ${entry.unit}`}
      size="lg"
    >
      <div className="space-y-4">
        {/* read-only order summary */}
        <div className="rounded-card border border-line bg-page px-3.5 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
          <Detail label="Category" value={entry.category} />
          <Detail label="Item" value={entry.itemName} />
          <Detail label="Quantity" value={`${entry.quantity.toLocaleString("en-IN")} ${entry.unit}`} />
          {entry.remarks && <Detail label="Remarks" value={entry.remarks} />}
        </div>

        <p className="text-[12px] text-grey">{def.what}</p>

        {error && (
          <div className="rounded-card border border-[#f3c9c9] bg-[#fdecec] px-3.5 py-2.5 text-[12.5px] text-ryg-red font-medium">
            {error}
          </div>
        )}

        <StageForm
          fields={def.fields}
          initial={active.values}
          submitLabel="Complete task"
          onSubmit={submit}
          onCancel={onClose}
          onUploadFile={upload}
        />
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-grey-2">{label}</span>
      <span className="text-navy font-medium text-right">{value || "—"}</span>
    </div>
  );
}
