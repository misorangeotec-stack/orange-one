import { useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useProductionStore } from "../store";

/**
 * The option lists `masterFields()` needs, built ONCE.
 *
 * Three screens render a Production master form — the Masters CRUD tabs, the
 * Request-new-master modal and the Master Requests approve modal. Purchase
 * learnt what happens when each builds its own lists: they drift, and one screen
 * quietly shows an empty picker. They all read this instead.
 */
export interface MasterFieldCtx {
  unitOptions: ComboOption[];
  /** The COA parameter form's optional equipment picker (its own screen, not
   *  masterFields — but it reads the same context so the lists cannot drift). */
  testEquipmentOptions: ComboOption[];
}

export function useMasterFieldCtx(): MasterFieldCtx {
  const s = useProductionStore();
  return useMemo(
    () => ({
      unitOptions: s.activeUnits.map((u) => ({ value: u.id, label: u.name })),
      testEquipmentOptions: s.activeTestEquipments.map((e) => ({ value: e.id, label: e.name })),
    }),
    [s.activeUnits, s.activeTestEquipments],
  );
}
