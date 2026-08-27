import { useMemo } from "react";
import ReassignModal from "@/shared/components/approvals/ReassignModal";
import { useImportStore } from "../store";
import type { PurchaseRequest } from "../types";

/**
 * Hand ONE requisition awaiting approval to somebody else. The dialog is shared
 * (`shared/components/approvals/ReassignModal`); this file resolves Import's own answer
 * to "who may receive it?" — the configured pool plus the active approvers, so it
 * can be handed back.
 *
 * Unlike Purchase, that answer does not depend on the requisition: Import routes
 * to a flat approver list with no value banding.
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
  const s = useImportStore();
  const holder = request ? s.holderOfRequest(request) : null;
  const candidates = useMemo(() => s.reassignCandidates(), [s]);

  if (!request) return null;

  return (
    <ReassignModal
      open={open}
      onClose={onClose}
      docRef={request.requestNo}
      resetKey={request.id}
      candidates={candidates}
      currentHolderName={holder ? s.personName(holder) : null}
      defaultOwnerLabel="The approvers set up for this module"
      setupHref="/import/settings"
      setupLabel="Setup → Approvers"
      returnLabel="Return to the approvers"
      onReassign={(target, note) =>
        s.reassignApprovalRequest({ requestId: request.id, approverId: target, note })
      }
    />
  );
}
