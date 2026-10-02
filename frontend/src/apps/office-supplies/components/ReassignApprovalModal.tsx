import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { B } from "../lib/routes";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

/**
 * Hand ONE request awaiting FIRST or SECOND approval to somebody else. The dialog
 * is shared (`shared/components/approvals/ReassignModal`); this file resolves
 * Office Supplies' own answer to "who may receive it?" — the configured pool plus
 * the step's default owners (the department HOD at first approval, the Management
 * step owners at second), so it can always be handed back.
 *
 * Handover is never reassignable: that step is physical delivery, not a decision.
 */
export default function ReassignApprovalModal({
  request,
  open,
  onClose,
}: {
  request: SupplyRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useSuppliesStore();
  const holder = request ? s.holderOfRequest(request) : null;
  const candidates = useMemo(() => (request ? s.reassignCandidates(request) : []), [s, request]);

  if (!request) return null;
  const atSecond = request.status === "pending_second_approval";

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={request.reqNo}
      resetKey={request.id}
      candidates={candidates}
      currentHolderName={holder ? s.personName(holder) : null}
      defaultOwnerLabel={atSecond ? "The Management (second approval) step owners" : "The head of this request's department"}
      // Built from `B`, never retyped — the module has already moved once (see lib/routes.ts).
      setupHref={`${B}/settings`}
      setupLabel="Setup → Raising & Routing"
      returnLabel={atSecond ? "Return to Management" : "Return to the department head"}
      onReassign={(target, note) => s.reassignRequest({ request, approverId: target, note })}
    />
  );
}
