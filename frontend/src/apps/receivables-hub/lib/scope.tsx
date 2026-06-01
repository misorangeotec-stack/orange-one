import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSession } from "@/core/platform/session";

/**
 * Per-salesperson scope for the Outstanding Dashboard.
 *
 * Derived from the signed-in Orange One user's profile tag
 * (`receivablesSalespersons`). `useAppData` reads this and filters the data:
 *   - `restrictToSalespersons === null`  → unrestricted (admins).
 *   - non-empty array                    → only those salesperson names.
 *   - empty array `[]`                    → nothing (untagged non-admin).
 *
 * NOTE: this is UI-LEVEL scoping only. The raw data is still fetched into the
 * browser by `useAppData`; a technical user could read other rows via DevTools.
 * True isolation would require a server-side (Edge Function) data layer that
 * returns only the caller's rows — a planned follow-up, not implemented here.
 */
export interface ReceivablesScope {
  restrictToSalespersons: string[] | null;
}

const ScopeContext = createContext<ReceivablesScope>({ restrictToSalespersons: null });

export function ReceivablesScopeProvider({ children }: { children: ReactNode }) {
  const { isAdmin, user } = useSession();
  const value = useMemo<ReceivablesScope>(
    () => ({ restrictToSalespersons: isAdmin ? null : (user.receivablesSalespersons ?? []) }),
    [isAdmin, user.receivablesSalespersons],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useReceivablesScope(): ReceivablesScope {
  return useContext(ScopeContext);
}
