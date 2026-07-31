import { useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useDispatchStore } from "../store";
import type { MasterFieldCtx } from "./masterFields";

/**
 * The one place the relational masters' option lists are built.
 *
 * Three screens render a master form — the Masters tabs, the Master Requests
 * approve modal and the "request a new entry" modal — and every one of them needs
 * the same company / category / unit lists. Purchase learnt what happens when each
 * builds its own: they drift, and one screen quietly shows empty pickers. See
 * procurement/lib/useMasterFieldCtx.ts.
 *
 * Three lists: `companyOptions` backs the required company↔customer mapping, and
 * customer + item back the two halves of the customer↔item mapping. The category
 * and unit lists went with their masters.
 *
 * Options are ACTIVE-only (a deactivated parent must not be selectable), while the
 * store's display lookups still read the full list so history renders.
 */
export function useMasterFieldCtx(): MasterFieldCtx {
  const s = useDispatchStore();

  return useMemo<MasterFieldCtx>(() => {
    const opts = (rows: { id: string; name: string }[]): ComboOption[] =>
      rows.map((r) => ({ value: r.id, label: r.name }));

    return {
      companyOptions: opts(s.activeOf(s.companies)),
      customerOptions: opts(s.activeOf(s.customers)),
      itemOptions: opts(s.activeOf(s.items)),
    };
  }, [s]);
}
