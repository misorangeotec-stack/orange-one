import { useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import type { MasterFieldCtx } from "./masterFields";
import { useImportStore } from "../store";

/**
 * The option lists every master form needs, in one place.
 *
 * Three screens used to build this object independently and two of them drifted:
 * they omitted `vendorOptions` / `itemOptions`, which left the Vendor and Item
 * selects on a vendor-item-mapping form completely empty — the request couldn't
 * be submitted, and on the approve side the approver saw blanks and could
 * silently wipe a valid payload. Every caller now shares this hook so the lists
 * can't fall out of sync again.
 *
 * These lists feed the MASTER surfaces only (Masters CRUD, the request modal,
 * the approve modal). The New Request form builds its own vendor list, which is
 * why the currency suffix dropped here still shows there.
 */
export function useMasterFieldCtx(): MasterFieldCtx {
  const s = useImportStore();

  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );
  const vendorOptions: ComboOption[] = useMemo(
    () => s.activeVendors.map((v) => ({ value: v.id, label: v.name })),
    [s.activeVendors]
  );
  const itemOptions: ComboOption[] = useMemo(
    () => s.items.filter((i) => i.active).map((i) => ({ value: i.id, label: i.name, sublabel: s.categoryById(i.categoryId)?.name })),
    [s.items, s]
  );

  return useMemo(
    () => ({ categoryOptions, vendorOptions, itemOptions }),
    [categoryOptions, vendorOptions, itemOptions]
  );
}
