/**
 * The Sales Register's three hub-master columns — Salesperson, Customer Group and Orange / Non-Orange
 * — for any window of lines.
 *
 * Salesperson and Customer Group are per ledger (lib/bushraLedgerLink.ts). Orange / Non-Orange is a
 * CUSTOMER's bucket over the last two FYs, exactly as the Orange vs Non-Orange page decides it (hand-
 * set buckets included), so it is classified from that two-year window — the same load and cache key
 * as the Sales dashboards — and then read for whatever window the register shows. A month's view
 * must not call a machine customer Non-Orange just because no machine was billed that month.
 */
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { currentFy, ymd } from "./salesRegister";
import { loadBushraSalesRegister, loadItemLookup, type BushraRegisterRow } from "./bushraSalesRegister";
import { classify, loadGroupLink } from "./bushraOrangeCustomers";
import { loadBucketOverrides } from "./bushraOrangeOverrides";
import { NOT_ASSIGNED, loadSalespersonLink } from "./bushraSalespersonSales";
import { useScopedParties } from "./scopeParties";
import type { RegisterLine } from "./bushraRegisterLink";

export function useRegisterExtras(): {
  ready: boolean;
  error: Error | null;
  enrich: (rows: BushraRegisterRow[]) => RegisterLine[];
} {
  const { scope, loading: scopeLoading } = useScopedParties();
  const scopeKey = scope.kind === "all" ? "all" : scope.parties.join("|");
  const from2 = `${Number(currentFy().slice(0, 4)) - 1}0401`;
  const today = ymd(new Date());

  const { data: lookup } = useQuery({
    queryKey: ["bushraSalesRegister", "itemLookup", "v4"], queryFn: loadItemLookup, staleTime: 30 * 60 * 1000,
  });
  const { data: twoYears, error: e1 } = useQuery<BushraRegisterRow[]>({
    queryKey: ["bushraSalesRegister", "v8", from2, today, scopeKey],
    queryFn: () => loadBushraSalesRegister(from2, today, scope, lookup),
    enabled: !scopeLoading && !!lookup, staleTime: 5 * 60 * 1000,
  });
  const { data: groupLink, error: e2 } = useQuery({
    queryKey: ["bushraOrangeCustomers", "groupLink", "v1"], queryFn: loadGroupLink, staleTime: 30 * 60 * 1000,
  });
  const { data: spOf, error: e3 } = useQuery({
    queryKey: ["bushraSalespersonSales", "link", "v1"], queryFn: loadSalespersonLink, staleTime: 30 * 60 * 1000,
  });
  const { data: overrides, error: e4 } = useQuery({
    queryKey: ["bushraOrangeCustomers", "overrides"], queryFn: loadBucketOverrides, staleTime: 60 * 1000,
  });

  const buckets = useMemo(
    () => (twoYears && groupLink ? classify(twoYears, groupLink, overrides?.byGroup) : null),
    [twoYears, groupLink, overrides],
  );
  const enrich = useCallback((rows: BushraRegisterRow[]): RegisterLine[] => rows.map((r) => {
    const group = groupLink ? groupLink.of(r.tenant_id, r.party).group : r.party;
    return {
      ...r,
      salesperson: spOf?.(r.tenant_id, r.party) ?? NOT_ASSIGNED,
      customer_group: group,
      // A customer outside the two-year window (or before it loads) has no bucket.
      orange: buckets?.get(group)?.bucket ?? "—",
    };
  }), [groupLink, spOf, buckets]);

  const error = (e1 ?? e2 ?? e3 ?? e4 ?? null) as Error | null;
  return { ready: !!groupLink && !!spOf && !!buckets && !!overrides, error, enrich };
}
