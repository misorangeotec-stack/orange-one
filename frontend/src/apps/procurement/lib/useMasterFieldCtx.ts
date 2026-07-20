import { useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import type { MasterFieldCtx } from "./masterFields";
import { useProcurementStore } from "../store";

/**
 * The option lists every master form needs, in one place.
 *
 * Three screens (RequestMasterModal, MasterRequests, Masters) built this object
 * independently. They agree today, but that is exactly the shape that drifted in
 * Import and left the vendor-item-price form with empty Vendor/Item pickers.
 * Sharing one hook removes the chance of a fourth caller (or an edit to one of
 * the three) quietly dropping a list.
 */
export function useMasterFieldCtx(): MasterFieldCtx {
  const s = useProcurementStore();

  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );
  const itemGroupOptions: ComboOption[] = useMemo(
    () =>
      s.itemGroups
        .filter((g) => g.active)
        .map((g) => ({ value: g.id, label: g.name, sublabel: s.categoryById(g.categoryId)?.name })),
    [s.itemGroups, s]
  );
  const vendorOptions: ComboOption[] = useMemo(
    () => s.vendors.filter((v) => v.active).map((v) => ({ value: v.id, label: v.name })),
    [s.vendors]
  );
  const itemOptions: ComboOption[] = useMemo(
    () => s.items.filter((i) => i.active).map((i) => ({ value: i.id, label: i.name, sublabel: s.itemGroupById(i.itemGroupId)?.name })),
    [s.items, s]
  );

  return useMemo(
    () => ({ categoryOptions, itemGroupOptions, vendorOptions, itemOptions }),
    [categoryOptions, itemGroupOptions, vendorOptions, itemOptions]
  );
}
