import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useDirectory } from "@/core/platform/store";
import { useTravelStore } from "../../store";

/**
 * Who may RECEIVE a reassignment, for Travel Desk. The control itself is shared
 * (`shared/components/approvals/ReassignPoolSection`); this file supplies the
 * module's own wiring and its two sentences of module-specific wording.
 *
 * ⚠ The profiles and departments come from the platform directory rather than the
 *   Travel store, which has no directory dependency and should not grow one.
 *
 * ⚠ Expect the "no edit access" warning to fire for almost everybody at the
 *   moment: nobody has been granted travel-desk edit access yet, and
 *   fms_travel_can_act refuses every non-admin without it before any ownership
 *   rule is consulted. That is the module being pre-go-live, not a fault in the
 *   list — and it is exactly the thing the warning exists to surface.
 */
export default function ReassignmentSection() {
  const s = useTravelStore();
  const dir = useDirectory();
  return (
    <ReassignPoolSection
      appId="travel-desk"
      appLabel="Travel Desk"
      profiles={dir.profiles}
      departments={dir.departments}
      profileById={dir.profileById}
      savedDepartmentIds={s.reassignPoolDepartmentIds}
      savedUserIds={s.reassignPoolUserIds}
      onSave={s.setReassignPool}
      emptyPoolNote="Leave it empty and a step can only be passed back to whoever normally owns it."
      peopleNote="a step can always be handed back to its usual owner."
    />
  );
}
