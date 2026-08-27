import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useHrStore } from "../store";
import { stepByKey, type StepKey } from "../lib/steps";
import type { Requisition } from "../types";

/**
 * Hand ONE step of ONE requisition to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves HR's own
 * answer to "who may receive it?".
 *
 * ⚠ HR is the only module so far that hands over a STEP rather than a whole
 *   entity, because a requisition has several steps open at once across three
 *   scopes. The candidate list therefore depends on the step, not just the
 *   requisition: the hiring managers for the seven HOD/probation steps, the
 *   configured step owners for everything else.
 *
 * ⚠ Unrelated to ReassignInterviewModal, which moves one INTERVIEW to different
 *   interviewers. Both can be in play on the same requisition at once.
 */
export default function ReassignStepModal({
  requisition,
  stepKey,
  open,
  onClose,
}: {
  requisition: Requisition | null;
  stepKey: StepKey | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const holder =
    requisition && stepKey ? s.holderOfStep(requisition.id, stepKey) : null;
  const candidates = useMemo(
    () => (requisition && stepKey ? s.reassignCandidates(stepKey, requisition) : []),
    [s, requisition, stepKey]
  );

  if (!requisition || !stepKey) return null;

  const label = stepByKey(stepKey)?.title ?? stepKey;

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={`${requisition.mrfNo} · ${label}`}
      resetKey={`${requisition.id}|${stepKey}`}
      candidates={candidates}
      currentHolderName={holder ? s.personName(holder) : null}
      defaultOwnerLabel="Whoever normally owns this step"
      setupHref="/hr-recruitment/settings"
      setupLabel="Setup → Reassignment"
      returnLabel="Return to the usual owner"
      subtitle="This one step leaves your queue and appears in theirs. The rest of the requisition is unaffected."
      onReassign={(target, note) =>
        s.reassignStep({ requisition, stepKey, assignee: target, note })
      }
    />
  );
}
