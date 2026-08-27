import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useHrStore } from "../../store";

/**
 * Who may RECEIVE a handover, for HR Recruitment. The control itself is shared
 * (`shared/components/approvals/ReassignPoolSection`); this file supplies the
 * module's own wiring and its two sentences of module-specific wording.
 *
 * ⚠ HR hands over a STEP, not a whole requisition, and that is why it needed this
 *   most. Seven steps — HOD shortlist, Round 2 and the five probation reviews —
 *   route to the requisition's own `hiring_manager_ids` through a branch that
 *   `return`s with no fall-through, so there is no step-owner list an admin could
 *   add a second name to. 15 of the 17 live requisitions name exactly one hiring
 *   manager. Until this list has somebody on it, those steps can only be moved by
 *   an admin or the process coordinator.
 */
export default function ReassignmentSection() {
  const s = useHrStore();
  return (
    <ReassignPoolSection
      appId="hr-recruitment"
      appLabel="HR Recruitment"
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
