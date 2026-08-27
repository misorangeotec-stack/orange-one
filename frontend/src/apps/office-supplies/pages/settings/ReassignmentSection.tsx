import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useSuppliesStore } from "../../store";

/**
 * Who may RECEIVE a handover, for Office Supplies. The control itself is shared
 * (`shared/components/approvals/ReassignPoolSection`); this file supplies the module's
 * own wiring and its two sentences of module-specific wording.
 *
 * ⚠ This module needs the list more than the others do. First approval routes to
 *   fms_supplies_departments.hod_user_id — ONE column — and the `first_approval`
 *   step-owner row was deliberately emptied so it could not be mistaken for the
 *   routing rule. There is no second name to add anywhere else, so until a
 *   department's HOD is back, this list is the only way its requests can move.
 */
export default function ReassignmentSection() {
  const s = useSuppliesStore();
  return (
    <ReassignPoolSection
      appId="office-supplies"
      appLabel="General Purchase"
      profiles={s.profiles}
      departments={s.orgDepartments}
      profileById={s.profileById}
      savedDepartmentIds={s.reassignPoolDepartmentIds}
      savedUserIds={s.reassignPoolUserIds}
      onSave={s.setReassignPool}
      emptyPoolNote="Leave it empty and a request can only be passed back to its own department head."
      peopleNote="a request can always be handed back to its department head."
    />
  );
}
