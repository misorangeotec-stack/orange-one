import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useSuppliesStore } from "../store";
import type { SupplyRequest } from "../types";

/**
 * Hand ONE request awaiting FIRST approval to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves Office Supplies'
 * own answer to "who may receive it?" — the configured pool plus this request's
 * own department HOD, so it can always be handed back.
 *
 * ⚠ Only first approval. Second approval and handover both already have two step
 *   owners configured, so neither is blocked on one person; first approval is the
 *   one that routes to a SINGLE uuid column with no fall-through.
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

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={request.reqNo}
      resetKey={request.id}
      candidates={candidates}
      currentHolderName={holder ? s.personName(holder) : null}
      defaultOwnerLabel="The head of this request's department"
      setupHref="/general-purchase/settings"
      setupLabel="Setup → Raising & Routing"
      returnLabel="Return to the department head"
      onReassign={(target, note) => s.reassignRequest({ request, approverId: target, note })}
    />
  );
}
