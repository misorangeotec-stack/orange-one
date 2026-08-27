import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useProcurementStore } from "../store";
import type { PurchaseRequest } from "../types";

/**
 * Hand ONE requisition awaiting approval to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves Purchase's own
 * answer to "who may receive it?".
 *
 * ⚠ That answer is per-REQUISITION here, not a flat approver list. Purchase routes
 *   by AMOUNT BAND, so a name from another band could not receive this one and
 *   fms_purchase_reassign_request would refuse it. This is exactly why the shared
 *   modal takes candidates as a prop instead of reading a store.
 */
export default function ReassignApprovalModal({
  request,
  open,
  onClose,
}: {
  request: PurchaseRequest | null;
  open: boolean;
  onClose: () => void;
}) {
  const s = useProcurementStore();
  const holder = request ? s.holderOfRequest(request) : null;
  const candidates = useMemo(
    () => (request ? s.reassignCandidates(request) : []),
    [s, request]
  );

  if (!request) return null;

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={request.requestNo}
      resetKey={request.id}
      candidates={candidates}
      currentHolderName={holder ? s.personName(holder) : null}
      defaultOwnerLabel="The approvers on this requisition's amount band"
      setupHref="/procurement/settings"
      setupLabel="Setup → Approval Matrix"
      returnLabel="Return to the approvers"
      onReassign={(target, note) =>
        s.reassignApprovalRequest({ requestId: request.id, approverId: target, note })
      }
    />
  );
}
