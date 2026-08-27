import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useDispatchStore } from "../store";
import type { OwnerStepKey } from "../lib/steps";
import type { DispatchOrder } from "../types";

/**
 * Reassign ONE step of ONE order to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves Dispatch's
 * own answer to "who may receive it?".
 *
 * ⚠ THAT ANSWER IS LOCATION-SCOPED. Ownership here is per (step, location), so
 *   the candidates are the pool plus the people configured for THIS order's site
 *   — offering another site's owners would put up names the server then refuses.
 *   It is also why the reassignment is keyed on the ORDER: the same person stays
 *   the owner of every other order at that location.
 */
export default function ReassignStepModal({
  order,
  step,
  open,
  onClose,
}: {
  order: DispatchOrder | null;
  step: OwnerStepKey | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useDispatchStore();
  const assignee = order && step ? s.assigneeOfStep(order.id, step) : null;
  const candidates = useMemo(
    () => (order && step ? s.reassignCandidates(step, order) : []),
    [s, order, step]
  );

  if (!order || !step) return null;

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={`${order.orderNo} · ${step.replace(/_/g, " ")}`}
      resetKey={`${order.id}|${step}`}
      candidates={candidates}
      currentHolderName={assignee ? s.personName(assignee) : null}
      defaultOwnerLabel="Whoever owns this step at this location"
      setupHref="/order-to-dispatch/settings"
      setupLabel="Setup → Reassignment"
      returnLabel="Return to the location's owners"
      subtitle="This one step of this one order leaves your queue and appears in theirs. Your other orders are unaffected."
      onReassign={(target, note) => s.reassignStep({ order, step, assignee: target, note })}
    />
  );
}
