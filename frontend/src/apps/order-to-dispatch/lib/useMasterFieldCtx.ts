import { useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useDispatchStore } from "../store";
import type { MasterFieldCtx } from "./masterFields";

/**
 * The one place the relational masters' option lists are built.
 *
 * Three screens render a master form — the Masters tabs, the Master Requests
 * approve modal and the "request a new entry" modal — and every one of them needs
 * the same customer / category / unit / item / company / transporter / user lists.
 * Purchase learnt what happens when each builds its own: they drift, and one screen
 * quietly shows empty pickers. See procurement/lib/useMasterFieldCtx.ts.
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
      customerOptions: opts(s.activeOf(s.customers)),
      categoryOptions: opts(s.activeOf(s.categories)),
      unitOptions: opts(s.activeOf(s.units)),
      itemOptions: opts(s.activeOf(s.items)),
      companyOptions: opts(s.activeOf(s.companies)),
      transporterOptions: opts(s.activeOf(s.transporters)),
      userOptions: [...s.dispatchUsers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          value: p.id,
          label: p.designation ? `${p.name} · ${p.designation}` : p.name,
        })),
    };
  }, [s]);
}
