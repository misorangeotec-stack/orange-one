import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSession } from "@/core/platform/session";

/**
 * Per-viewer scope for the Outstanding Dashboard, in TWO dimensions.
 *
 * Derived from the signed-in Orange One user's profile tags. `useAppData` reads
 * this and filters the data:
 *   - `restrictToSalespersons === null`  → this dimension does not restrict (admins).
 *   - non-empty array                    → only those salesperson names.
 *   - empty array `[]`                    → nothing (untagged non-admin, salesperson dimension only).
 *
 * ── The two dimensions are MUTUALLY EXCLUSIVE (RC-11) ──
 * A user is scoped by salesperson OR by collection team, never both — the client's decision. The
 * admin form is what enforces it; this module does not, because a form mid-edit and a row written
 * by some future script are not the same thing. When both are somehow set, every reader INTERSECTS:
 * both narrow, neither widens. The failure direction is a smaller view, never a larger one.
 *
 * ⚠ THE EMPTY LIST MEANS DIFFERENT THINGS ON THE TWO DIMENSIONS, and that asymmetry is deliberate.
 *   Salesperson was the only dimension for a year, so an untagged non-admin means "not trusted yet
 *   → show nothing". Collection team arrived later, on a system where every scoped user already had
 *   salesperson tags and no team tags at all. Had an empty team list meant "nothing", every one of
 *   them would have gone blank the day it shipped. So an empty TEAM list means "this dimension is
 *   not in use for this person" — expressed here by resolving it to `null`, the same value an admin
 *   gets, rather than to `[]`.
 *
 * NOTE: this is UI-LEVEL scoping only. The raw data is still fetched into the
 * browser by `useAppData`; a technical user could read other rows via DevTools.
 * True isolation would require a server-side (Edge Function) data layer that
 * returns only the caller's rows — a planned follow-up, not implemented here.
 */
export interface ReceivablesScope {
  restrictToSalespersons: string[] | null;
  /** null = does not restrict. Never `[]` — see the asymmetry note above. */
  restrictToCollectionTeams: string[] | null;
}

const ScopeContext = createContext<ReceivablesScope>({
  restrictToSalespersons: null,
  restrictToCollectionTeams: null,
});

export function ReceivablesScopeProvider({ children }: { children: ReactNode }) {
  const { isAdmin, user } = useSession();
  const value = useMemo<ReceivablesScope>(() => {
    const teams = user.receivablesCollectionTeams ?? [];
    const salespersons = user.receivablesSalespersons ?? [];
    // ⚠ AN EMPTY SALESPERSON LIST IS AMBIGUOUS, AND THE TEAM TAG IS WHAT DISAMBIGUATES IT.
    //   On its own, `[]` has always meant "untagged, sees NOTHING" — the deliberate fail-closed
    //   default for a salesperson-scoped user. But a user scoped by collection team has an empty
    //   salesperson list BY CONSTRUCTION, because the two are exclusive and the form clears the one
    //   you leave. Reading that `[]` as "sees nothing" filtered every customer out before the team
    //   filter could let any back in, and a collector got a blank dashboard. Found in the browser;
    //   no build or type check can see it, because both readings are well-typed.
    //   So: when teams are tagged, the salesperson dimension simply does not apply.
    const teamScoped = teams.length > 0;
    return {
      restrictToSalespersons:
        isAdmin ? null : (teamScoped && salespersons.length === 0 ? null : salespersons),
      // Resolved to null when empty so no caller has to know about the asymmetry — every one of
      // them reads "null means this dimension is not restricting".
      restrictToCollectionTeams: isAdmin || !teamScoped ? null : teams,
    };
  }, [isAdmin, user.receivablesSalespersons, user.receivablesCollectionTeams]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

/**
 * Is this viewer scoped by collection team rather than by salesperson?
 *
 * The two are exclusive, so this is what a screen asks when it needs to NAME the dimension — an
 * empty-state message, a banner, a disabled filter. It is never the basis of a filter itself.
 */
export function useScopeDimension(): "salesperson" | "collection_team" | "none" {
  const { restrictToSalespersons, restrictToCollectionTeams } = useReceivablesScope();
  if (restrictToCollectionTeams !== null) return "collection_team";
  if (restrictToSalespersons !== null) return "salesperson";
  return "none";
}

export function useReceivablesScope(): ReceivablesScope {
  return useContext(ScopeContext);
}
