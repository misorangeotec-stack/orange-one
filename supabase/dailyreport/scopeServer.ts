/**
 * The server stand-in for `@hub/lib/scope` — the receivables per-salesperson VISIBILITY scope.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 *   The Daily Report reads the day's invoice lines through `@hub/lib/salesRegister`, which imports
 *   two PURE helpers from `@hub/lib/scopeParties` (`SCOPE_ALL`, `isEmptyScope`). That module also
 *   holds one React hook, `useScopedParties`, and to build it imports `useReceivablesScope` from
 *   `scope.tsx` — a React context that reaches `session.tsx`, `useCatalogueVersion.ts`, and from
 *   there `import.meta.env`, `window` and React itself.
 *
 *   So a single unused hook drags the entire portal session into a Node job. The build's purity
 *   guard caught exactly that and named all three. This shim cuts the chain at the module boundary,
 *   which is what the guard's own error message instructs: shim it here rather than editing the app.
 *
 * ── WHY NOT SPLIT THE PURE FUNCTIONS OUT OF `scopeParties.ts` INSTEAD ─────────────────────────
 *   That would be the tidier fix and it is the wrong trade today. `scopeParties.ts` is imported by
 *   a large number of receivables screens; moving its exports around to serve one server job risks
 *   a live app for a cosmetic gain, and this repo has no test runner to catch what that breaks. If
 *   a second server job ever needs the same thing, the split becomes worth doing properly.
 *
 * ⚠ THE HOOKS THROW RATHER THAN RETURNING "ALL", AND THAT IS THE LOAD-BEARING DECISION.
 *   Returning `{ kind: "all" }` would be the convenient stub and would silently hand a server job
 *   an unscoped view of every salesperson's customers the first time something DID call it. The
 *   Daily Report is a whole-business report that legitimately reads everything, so it never calls
 *   these — but the next job might not be, and a stub that quietly grants the widest possible scope
 *   is how a scoping bug ships. If one of these ever throws, that is the design working: the code
 *   asking for it needs a real answer, which only a signed-in browser has.
 */

/** The shape `scope.tsx` returns. Mirrored structurally rather than imported, to keep this leaf. */
export interface ReceivablesScope {
  kind: "all" | "only";
  parties: string[];
  salespersons: string[];
  loading: boolean;
}

const refuse = (what: string): never => {
  throw new Error(
    `daily-report: ${what} was called on the server. It answers which salespeople THIS VIEWER ` +
      "may see, and a scheduled job has no viewer. If a report genuinely needs scoping, pass the " +
      "scope in explicitly rather than resolving it here.",
  );
};

export function useReceivablesScope(): ReceivablesScope {
  return refuse("useReceivablesScope");
}

export function useScopeDimension(): "salesperson" | "collection_team" | "none" {
  return refuse("useScopeDimension");
}

/** Present only so the specifier resolves; a server run renders no providers. */
export function ReceivablesScopeProvider(): never {
  return refuse("ReceivablesScopeProvider");
}
