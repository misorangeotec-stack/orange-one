import { useQuery } from "@tanstack/react-query";
import { loadSalespersonByParty } from "@hub/lib/salesReport";
import { useReceivablesScope } from "@hub/lib/scope";

/**
 * The viewer's salesperson scope, expressed as the PARTY NAMES they may see.
 *
 * lib/scope.tsx answers "which salespeople is this user tagged to?" — that is the grant.
 * The Tally-sourced reports key on party name, not salesperson, so this module turns the one
 * into the other and is the single place that conversion happens.
 *
 * ── The empty-list trap, and why PartyScope is a tagged union ──
 * Every Tally fetcher normalises its filter arrays with
 *
 *     const arr = (v?: string[]) => (v && v.length ? v : null)
 *
 * and passes the result as `p_parties`, where **null means UNFILTERED**. That is right for a
 * user-chosen filter — "nothing ticked" means "show everything". It is exactly backwards for a
 * scope, where "no parties allowed" must mean "show nothing".
 *
 * A bare `string[]` would have made those two states indistinguishable at the call site, and
 * the failure would have been silent and in the dangerous direction: a user scoped to a
 * salesperson with no customers — a new joiner, a retired territory, or simply a name whose
 * casing does not match the tags — would have been shown the ENTIRE COMPANY. So the scope is
 * a tagged union that cannot collapse to an array, and `{ kind: "only", parties: [] }` is a
 * real, representable, honoured state. See `scopedParties()` below for how callers use it.
 *
 * ── Matching is exact and case-sensitive ──
 * `profiles.receivables_salespersons` lives in the identity project; `ext_ledger_tags.salesperson`
 * lives in ConnectWave. There is no foreign key between them and no normalisation, so "OTHERS"
 * and "Others" are two different scopes. Fix mis-tagged names in Settings → Masters rather than
 * lower-casing here, which would silently merge genuinely distinct tags.
 *
 * ── And it joins by GUID, not by name ──
 * `loadSalespersonByParty` maps ledger GUID → tally_name → salesperson. Joining tags to ledgers
 * by name instead fans customers across FY-split books (the reconciliation notes record 89
 * customers becoming 206 rows). Reused here rather than reimplemented for exactly that reason.
 */

export type PartyScope =
  /** No restriction — an admin, or a user with no salesperson tag applied. */
  | { kind: "all" }
  /** Only these party names. An EMPTY list means nothing is visible, and is honoured as such. */
  | { kind: "only"; parties: string[] };

export const SCOPE_ALL: PartyScope = { kind: "all" };

/**
 * The party-name filter for a fetcher call, or `undefined` when unrestricted.
 *
 * Callers must ALSO handle `isEmptyScope` — this returns `[]` for a scope that permits nothing,
 * and passing `[]` into the fetchers' `arr()` helper would turn it back into "unfiltered".
 */
export function scopedParties(scope: PartyScope): string[] | undefined {
  return scope.kind === "all" ? undefined : scope.parties;
}

/** True when the viewer is scoped to nothing at all — the report should render empty, not full. */
export function isEmptyScope(scope: PartyScope): boolean {
  return scope.kind === "only" && scope.parties.length === 0;
}

/**
 * A user-chosen party filter, narrowed by the viewer's scope.
 *
 * Deliberately a discriminated union rather than `string[] | null`: `parties` is unreachable
 * until the caller has narrowed on `visible`, so TypeScript refuses to let a page pass the
 * filter to a fetcher without first deciding what to do when the answer is "nothing". That is
 * the compile-time half of the empty-list trap described at the top of this file — the runtime
 * half is that `visible: false` must map to `enabled: false` on the query, never to a call with
 * an empty array (which the fetchers' `arr()` would silently widen back to "everything").
 */
export type ComposedPartyFilter =
  /** The viewer may see nothing here. Do not run the query; render the empty state. */
  | { visible: false }
  /** Run the query with this party filter; `undefined` means no filter at all. */
  | { visible: true; parties: string[] | undefined };

/**
 * Intersect the viewer's scope with whatever party filter they picked on the page.
 *
 * Scope is applied LAST and is never widened by a user filter — picking a customer outside your
 * territory narrows to nothing rather than revealing it.
 */
export function composePartyFilter(scope: PartyScope, userParties?: string[]): ComposedPartyFilter {
  const chosen = userParties && userParties.length ? userParties : undefined;
  if (scope.kind === "all") return { visible: true, parties: chosen };
  if (scope.parties.length === 0) return { visible: false };
  if (!chosen) return { visible: true, parties: scope.parties };

  const allowed = new Set(scope.parties);
  const both = chosen.filter((p) => allowed.has(p));
  return both.length ? { visible: true, parties: both } : { visible: false };
}

/**
 * May the viewer see this one party / ledger?
 *
 * Used by the single-entity detail screens (`reports/ledger-outstanding/:ledgerId`,
 * `reports/ledger-voucher/:ledgerId`), which are reachable by typing a GUID into the address
 * bar. Filtering the LIST that links to them is not enough — that is the same "a hidden link is
 * not access control" mistake RequireHubMenu exists to correct, and useAppData already closes
 * for `/customer/:id`.
 */
export function isPartyInScope(scope: PartyScope, party: string | null | undefined): boolean {
  if (scope.kind === "all") return true;
  return party != null && scope.parties.includes(party);
}

/** Narrow a list of rows by the scope, given how to read a row's party name. */
export function filterByScope<T>(rows: T[], scope: PartyScope, partyOf: (row: T) => string | null | undefined): T[] {
  if (scope.kind === "all") return rows;
  const allowed = new Set(scope.parties);
  return rows.filter((r) => {
    const p = partyOf(r);
    return p != null && allowed.has(p);
  });
}

export interface ScopedPartiesResult {
  scope: PartyScope;
  /** True until the tag map has settled. Fetchers must not run against a half-resolved scope. */
  loading: boolean;
  error: string | null;
}

/**
 * The signed-in user's party scope.
 *
 * ⚠ While `loading` is true the scope is reported as `{ kind: "only", parties: [] }`, not
 * `{ kind: "all" }`. Failing closed matters here: a report that fired its query during the
 * first render would otherwise fetch the whole company and paint it before the scope arrived.
 * The same reasoning applies on error — an unreadable tag table is not permission to see
 * everything.
 */
export function useScopedParties(): ScopedPartiesResult {
  const { restrictToSalespersons } = useReceivablesScope();
  const unrestricted = restrictToSalespersons === null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["scopedParties"],
    queryFn: loadSalespersonByParty,
    // The tags are edited by hand in Settings → Masters and change rarely, so this is worth
    // holding for a while — it is on the critical path of every scoped report.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // An unrestricted viewer never needs the map at all; skip the round trip entirely.
    enabled: !unrestricted,
  });

  if (unrestricted) return { scope: SCOPE_ALL, loading: false, error: null };

  const allowedNames = new Set(restrictToSalespersons);
  const parties = data
    ? Object.entries(data)
        .filter(([, salesperson]) => allowedNames.has(salesperson))
        .map(([party]) => party)
    : [];

  return {
    scope: { kind: "only", parties },
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
