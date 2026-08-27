import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useImportStore } from "../../store";

/**
 * Who may RECEIVE a handover, for Purchase RM Import. The control itself is
 * shared (`shared/components/approvals/ReassignPoolSection`); this file supplies the
 * module's own wiring and its two sentences of module-specific wording.
 *
 * Import routes approvals to a FLAT list of configured approvers with no value
 * banding, so a hand-back can always go to any of them — which is why the modal's
 * candidate list needs no per-requisition input here, unlike Purchase's.
 */
export default function ReassignmentSection() {
  const s = useImportStore();
  return (
    <ReassignPoolSection
      appId="import"
      appLabel="Purchase RM Import"
      profiles={s.profiles}
      departments={s.departments}
      profileById={s.profileById}
      savedDepartmentIds={s.reassignPoolDepartmentIds}
      savedUserIds={s.reassignPoolUserIds}
      onSave={s.setReassignPool}
      emptyPoolNote="Leave it empty and no one can be handed anything."
      peopleNote="the approvers can also hand a requisition back to each other."
    />
  );
}
