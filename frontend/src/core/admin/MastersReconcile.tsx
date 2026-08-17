import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { useSession } from "@/core/platform/session";
import {
  companyDisplayName, fetchMasterCompanies, fetchMasterItems, fetchMasterLookup, fetchMasterParties,
} from "@/core/platform/liveMasters";
import {
  buildMatcher, clearReconcileDecision, fetchLegacyRows, fetchReconcileLinks,
  itemCandidates, partyCandidates, saveReconcileDecision,
  type LegacyTable, type Suggestion,
} from "@/core/platform/reconcile";

/**
 * RECONCILE — say which Tally record each hand-typed Dispatch master actually is.
 *
 * The last thing standing between Phase 0 and the Dispatch cutover. 326 customers
 * and 246 items were typed in by hand; Tally holds 7,812 parties and 14,228 items;
 * many pairs are the same real firm or product under two ids, and no column joins
 * them. Suggestions are offered, a human confirms, and the answers are written to
 * mst_reconcile_links for the cutover to read.
 *
 * ⚠ NOTHING HERE CHANGES A MASTER OR AN ORDER. This screen only records opinions.
 *   The merge itself happens in the Phase 1 migration, inside its freeze window,
 *   reading these decisions. That separation is the point: fuzzy name-matching is
 *   not something to be doing while the app is down.
 *
 * "No Tally match" is a real, first-class answer — not a skip. A customer that
 * genuinely exists only in Dispatch stays a portal-owned row, and saying so is
 * what lets the cutover tell "decided: portal-only" from "nobody looked yet".
 */

type TabKey = "customer" | "item";

const TABS = [
  { key: "customer" as const, label: "Customers" },
  { key: "item" as const, label: "Items" },
];

const LEGACY_TABLE: Record<TabKey, LegacyTable> = {
  customer: "fms_dispatch_customers",
  item: "fms_dispatch_items",
};

type Filter = "undecided" | "suggested" | "linked" | "portal_only" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "undecided", label: "Needs a decision" },
  { key: "suggested", label: "Has a suggestion" },
  { key: "linked", label: "Linked" },
  { key: "portal_only", label: "Portal only" },
  { key: "all", label: "All" },
];

export default function MastersReconcile() {
  const { isAdmin, user } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("customer");
  const [filter, setFilter] = useState<Filter>("undecided");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const opts = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;

  const legacy = useQuery({
    queryKey: ["reconcile", "legacy", tab],
    queryFn: () => fetchLegacyRows(LEGACY_TABLE[tab]),
    ...opts,
  });
  const links = useQuery({ queryKey: ["reconcile", "links"], queryFn: fetchReconcileLinks, ...opts });
  const companies = useQuery({ queryKey: ["masters", "companies"], queryFn: fetchMasterCompanies, ...opts });
  const parties = useQuery({
    queryKey: ["masters", "parties"], queryFn: fetchMasterParties, ...opts, enabled: tab === "customer",
  });
  const items = useQuery({ queryKey: ["masters", "items"], queryFn: fetchMasterItems, ...opts, enabled: tab === "item" });
  const groups = useQuery({
    queryKey: ["masters", "item_groups"], queryFn: () => fetchMasterLookup("mst_item_groups"), ...opts,
    enabled: tab === "item",
  });

  const companyLabel = useMemo(
    () => new Map((companies.data ?? []).map((c) => [c.id, companyDisplayName(c)])),
    [companies.data],
  );
  const groupLabel = useMemo(
    () => new Map((groups.data ?? []).map((g) => [g.id, g.name])),
    [groups.data],
  );

  /** Built once per data change, not per row — see buildMatcher's note. */
  const suggest = useMemo(() => {
    if (tab === "customer") return buildMatcher(partyCandidates(parties.data ?? [], companyLabel, "customer"));
    return buildMatcher(itemCandidates(items.data ?? [], groupLabel));
  }, [tab, parties.data, items.data, companyLabel, groupLabel]);

  /** Every candidate, for the manual picker when no suggestion is right. */
  const allOptions = useMemo(() => {
    const src = tab === "customer"
      ? (parties.data ?? []).filter((p) => p.isCustomer).map((p) => ({
          guid: p.tallyGuid, name: p.name,
          detail: p.companyId ? companyLabel.get(p.companyId) ?? "" : "",
        }))
      : (items.data ?? []).map((i) => ({
          guid: i.tallyGuid, name: i.name,
          detail: i.groupId ? groupLabel.get(i.groupId) ?? "" : "",
        }));
    return src
      .filter((c) => c.guid)
      .map((c) => ({ value: c.guid as string, label: c.name, sublabel: c.detail }));
  }, [tab, parties.data, items.data, companyLabel, groupLabel]);

  const linkByLegacy = useMemo(
    () => new Map((links.data ?? [])
      .filter((l) => l.legacyTable === LEGACY_TABLE[tab])
      .map((l) => [l.legacyId, l])),
    [links.data, tab],
  );

  const rows = useMemo(() => {
    const list = (legacy.data ?? []).map((r) => ({
      ...r,
      link: linkByLegacy.get(r.id) ?? null,
      suggestions: suggest(r.name),
    }));
    const byFilter = list.filter((r) => {
      switch (filter) {
        case "undecided": return !r.link;
        case "suggested": return !r.link && r.suggestions.length > 0;
        case "linked": return r.link?.status === "linked";
        case "portal_only": return r.link?.status === "portal_only";
        default: return true;
      }
    });
    return q.trim() ? byFilter.filter((r) => matchesSearch(q, `${r.name} ${r.code ?? ""}`)) : byFilter;
  }, [legacy.data, linkByLegacy, suggest, filter, q]);

  const pg = usePagination(rows, { resetKey: `${tab}|${filter}|${q}` });

  const stats = useMemo(() => {
    const all = legacy.data ?? [];
    let linked = 0, portalOnly = 0;
    for (const r of all) {
      const l = linkByLegacy.get(r.id);
      if (l?.status === "linked") linked++;
      else if (l?.status === "portal_only") portalOnly++;
    }
    return { total: all.length, linked, portalOnly, undecided: all.length - linked - portalOnly };
  }, [legacy.data, linkByLegacy]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["reconcile", "links"] });

  const decide = async (
    row: { id: string; name: string },
    guid: string | null,
    matchedName: string | null,
  ) => {
    setBusyId(row.id);
    setErr(null);
    try {
      await saveReconcileDecision({
        legacyTable: LEGACY_TABLE[tab],
        legacyId: row.id,
        legacyName: row.name,
        tallyGuid: guid,
        matchedName,
        status: guid ? "linked" : "portal_only",
        decidedBy: user?.id ?? null,
      });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const undo = async (legacyId: string) => {
    setBusyId(legacyId);
    setErr(null);
    try {
      await clearReconcileDecision(LEGACY_TABLE[tab], legacyId);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const loading = [legacy, links, parties, items, companies].some((x) => x.isFetching);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-navy">Reconcile with Tally</h1>
            <p className="mt-1 max-w-3xl text-[13px] text-grey">
              Say which Tally record each hand-typed Order&nbsp;to&nbsp;Dispatch master actually is.
              Nothing here changes a master or an order — it records the answers, and the
              cutover applies them. <strong>No Tally match</strong> is a real answer, not a skip.
            </p>
          </div>
          <Link to="/admin/masters" className="text-[12.5px] font-medium text-orange hover:underline">
            ← Back to masters
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
          <span className="text-grey">Total <strong className="text-navy">{stats.total}</strong></span>
          <span className="text-grey">Linked <strong className="text-navy">{stats.linked}</strong></span>
          <span className="text-grey">Portal only <strong className="text-navy">{stats.portalOnly}</strong></span>
          <span className="text-grey">Undecided <strong className="text-orange">{stats.undecided}</strong></span>
        </div>
        {err && <p className="mt-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">{err}</p>}
      </Card>

      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as TabKey)} />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${tab === "customer" ? "customer" : "item"}…`}
            className="max-w-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  "rounded-full px-3 py-1 text-[12px] font-medium transition " +
                  (filter === f.key ? "bg-navy text-white" : "bg-page text-grey hover:text-navy")
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="mt-3 text-[12.5px] text-grey-2">Loading…</p>}

        {!loading && rows.length === 0 ? (
          <EmptyState
            title="Nothing here"
            message={
              filter === "undecided"
                ? "Every row on this tab has been decided. Switch to All to review them."
                : "No rows match this filter."
            }
          />
        ) : (
          <>
            <ScrollableTable className="mt-3">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-grey-2">
                    <th className="py-2 pr-3 font-semibold">Dispatch record</th>
                    <th className="py-2 pr-3 font-semibold">Decision</th>
                    <th className="py-2 font-semibold">Match it to</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => (
                    <tr key={r.id} className="border-b border-line/60 align-top">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-navy">{r.name}</div>
                        {r.code && <div className="text-[11.5px] text-grey-2">Code {r.code}</div>}
                        {!r.active && <div className="text-[11.5px] text-grey-2">Inactive</div>}
                      </td>

                      <td className="py-2.5 pr-3 w-56">
                        {r.link ? (
                          <div>
                            {r.link.status === "linked" ? (
                              <>
                                <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy">
                                  Linked
                                </span>
                                <div className="mt-1 text-[12px] text-grey">{r.link.matchedName}</div>
                              </>
                            ) : (
                              <span className="rounded bg-page px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">
                                Portal only
                              </span>
                            )}
                            <button
                              onClick={() => undo(r.id)}
                              disabled={!isAdmin || busyId === r.id}
                              className="mt-1 block text-[11.5px] font-semibold text-grey hover:text-navy disabled:opacity-50"
                            >
                              Undo
                            </button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-grey-2">Not decided</span>
                        )}
                      </td>

                      <td className="py-2.5">
                        {/* Suggestions first — one click each. The picker below is
                            the fallback when none of them is right. */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.suggestions.slice(0, 3).map((s: Suggestion) => (
                            <button
                              key={s.guid}
                              onClick={() => decide(r, s.guid, s.name)}
                              disabled={!isAdmin || busyId === r.id}
                              title={s.confidence === "exact" ? "Same name" : "Same name ignoring punctuation"}
                              className={
                                "rounded border px-2 py-1 text-[12px] transition disabled:opacity-50 " +
                                (s.confidence === "exact"
                                  ? "border-navy/30 bg-navy/5 text-navy hover:bg-navy/10"
                                  : "border-line text-grey hover:text-navy")
                              }
                            >
                              {s.name}
                              {s.detail && <span className="text-grey-2"> · {s.detail}</span>}
                            </button>
                          ))}
                          <button
                            onClick={() => decide(r, null, null)}
                            disabled={!isAdmin || busyId === r.id}
                            className="rounded border border-line px-2 py-1 text-[12px] text-grey hover:text-navy disabled:opacity-50"
                          >
                            No Tally match
                          </button>
                        </div>

                        <div className="mt-1.5 max-w-sm">
                          <Combobox
                            value=""
                            onChange={(guid) => {
                              const picked = allOptions.find((o) => o.value === guid);
                              if (picked) decide(r, guid, picked.label);
                            }}
                            options={allOptions}
                            placeholder="Search all Tally records…"
                            disabled={!isAdmin || busyId === r.id}
                            searchable
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={pg} rowsLabel={tab === "customer" ? "customers" : "items"} showPageSize />
          </>
        )}
      </Card>
    </div>
  );
}
