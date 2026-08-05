import { useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import type { MasterFieldCtx } from "./masterFields";
import { useHrStore } from "../store";

/**
 * The option lists the HR master forms need but cannot derive from a master.
 *
 * One hook, three callers — the Request-new-master modal, the Master Requests
 * approve modal and the Masters page. The import module learned the hard way
 * that letting each screen build this itself lets them drift: two of its three
 * screens omitted a list, which left a required select empty and let an approver
 * silently wipe a valid payload (see `apps/import/lib/useMasterFieldCtx.ts`).
 *
 * Departments come from the portal-wide directory, NOT an HR master — one org
 * chart for the whole portal. Inactive departments are kept out so a retired
 * team can't be attached to a new job title.
 */
export function useMasterFieldCtx(): MasterFieldCtx {
  const s = useHrStore();

  const departmentOptions: ComboOption[] = useMemo(
    () =>
      [...s.departments]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => ({ value: d.id, label: d.name })),
    [s.departments]
  );

  return useMemo(() => ({ departmentOptions }), [departmentOptions]);
}
