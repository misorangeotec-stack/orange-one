import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useExitStore } from "../store";
import { stepByKey, type StepKey } from "../lib/steps";
import type { ExitCase } from "../types";

/**
 * Reassign ONE step of ONE exit case to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves HR Exit's own
 * answer to "who may receive it?" — the configured pool plus that step's natural
 * owners, which for the manager steps means the case's reporting managers and for
 * everything else the configured step owner.
 *
 * ⚠ Deliberately not called a handover anywhere. `handover` is an existing STEP
 *   KEY in this module and means the leaver handing work back to their team, so
 *   "Reassign this handover" is a sentence that has to stay possible.
 */
export default function ReassignStepModal({
  exitCase,
  stepKey,
  open,
  onClose,
}: {
  exitCase: ExitCase | null;
  stepKey: StepKey | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const assignee = exitCase && stepKey ? s.assigneeOfStep(exitCase.id, stepKey) : null;
  const candidates = useMemo(
    () => (exitCase && stepKey ? s.reassignCandidates(stepKey, exitCase) : []),
    [s, exitCase, stepKey]
  );

  if (!exitCase || !stepKey) return null;

  const label = stepByKey(stepKey)?.title ?? stepKey;

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={`${exitCase.exitNo} · ${label}`}
      resetKey={`${exitCase.id}|${stepKey}`}
      candidates={candidates}
      currentHolderName={assignee ? s.personName(assignee) : null}
      defaultOwnerLabel="Whoever normally owns this step"
      setupHref="/hr-exit/settings"
      setupLabel="Setup → Reassignment"
      returnLabel="Return to the usual owner"
      subtitle="This one step leaves your queue and appears in theirs. The rest of the case is unaffected."
      onReassign={(target, note) => s.reassignStep({ exitCase, stepKey, assignee: target, note })}
    />
  );
}
