import ReassignPoolSection from "@/shared/components/approvals/ReassignPoolSection";
import { useDirectory } from "@/core/platform/store";
import { useDispatchStore } from "../../store";

/**
 * Who may RECEIVE a reassignment, for Order to Dispatch. The control itself is
 * shared (`shared/components/approvals/ReassignPoolSection`); this file supplies
 * the module's own wiring and its two sentences of module-specific wording.
 *
 * ⚠ THIS IS NOT THE CHEAPEST FIX, AND IT IS WORTH KNOWING THAT.
 *   `credit_check` is configured as three location rows holding ONE person each,
 *   plus an all-locations fallback row holding NOBODY — and `sales_bill` and
 *   `sales_return` are the same shape. Naming a second person per location on
 *   Step Owners, or simply filling that empty fallback row, removes the single
 *   point of failure without anybody having to reassign anything. This list is
 *   the answer to "the one person is away today"; the owners table is the answer
 *   to "only one person is configured". Both are worth doing.
 */
export default function ReassignmentSection() {
  const s = useDispatchStore();
  // The store exposes orgDepartments but no profileById, so the directory is
  // read straight here rather than widening the store for one dialog.
  const dir = useDirectory();
  return (
    <ReassignPoolSection
      appId="order-to-dispatch"
      appLabel="Order to Dispatch"
      profiles={dir.profiles}
      departments={dir.departments}
      profileById={dir.profileById}
      savedDepartmentIds={s.reassignPoolDepartmentIds}
      savedUserIds={s.reassignPoolUserIds}
      onSave={({ departmentIds, userIds }) =>
        // department_ids is stored so Setup can re-open on the same filter; it is
        // NOT read by fms_dispatch_can_receive_reassignment and grants nothing.
        s.setConfig("reassign_pool", { department_ids: departmentIds, user_ids: userIds })
      }
      emptyPoolNote="Leave it empty and a step can only be passed back to the people who own it at that location."
      peopleNote="a step can always be handed back to its location's owners."
    />
  );
}
