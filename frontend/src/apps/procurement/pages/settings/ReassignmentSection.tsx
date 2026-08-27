import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useProcurementStore } from "../../store";

/**
 * Who may RECEIVE a handover, for Purchase RM Domestic. The control itself is
 * shared (`shared/components/approvals/ReassignPoolSection`); this file supplies the
 * module's own wiring and its two sentences of module-specific wording.
 *
 * ⚠ It sits under the Approval Matrix tab on purpose. Reassign only ever moves a
 *   requisition off a BAND, so the two controls are read together — and the modal
 *   also offers that requisition's own band members, so a hand-back needs no
 *   entry here at all.
 */
export default function ReassignmentSection() {
  const s = useProcurementStore();
  return (
    <ReassignPoolSection
      appId="procurement"
      appLabel="Purchase RM Domestic"
      profiles={s.profiles}
      departments={s.departments}
      profileById={s.profileById}
      savedDepartmentIds={s.reassignPoolDepartmentIds}
      savedUserIds={s.reassignPoolUserIds}
      onSave={s.setReassignPool}
      emptyPoolNote="Leave it empty and a requisition can only be passed between the approvers of its own band."
      peopleNote="a requisition can always be handed back to its own band."
    />
  );
}
