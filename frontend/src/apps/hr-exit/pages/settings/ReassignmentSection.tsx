import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useExitStore } from "../../store";

/**
 * Who may RECEIVE a reassignment, for HR Exit. The control itself is shared
 * (`shared/components/approvals/ReassignPoolSection`); this file supplies the
 * module's own wiring and its two sentences of module-specific wording.
 *
 * ⚠ Every one of the fifteen rows in `fms_exit_step_owners` holds exactly ONE
 *   person — including `hr_head_approval` and `fnf_approve`, the two approvals.
 *   Unlike Purchase there is no second name to add, because the business has
 *   configured one everywhere. Until this list has somebody on it, every step in
 *   the module is one absence away from stalling.
 *
 * ⚠ Nothing here is called a "handover": `handover` is an existing STEP KEY in
 *   this module, meaning the leaver handing work back to their team.
 */
export default function ReassignmentSection() {
  const s = useExitStore();
  return (
    <ReassignPoolSection
      appId="hr-exit"
      appLabel="HR Exit"
      profiles={s.profiles}
      departments={s.departments}
      profileById={s.profileById}
      savedDepartmentIds={s.reassignPoolDepartmentIds}
      savedUserIds={s.reassignPoolUserIds}
      onSave={s.setReassignPool}
      emptyPoolNote="Leave it empty and a step can only be passed back to whoever normally owns it."
      peopleNote="a step can always be handed back to its usual owner."
    />
  );
}
