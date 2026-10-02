import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useDirectory } from "@/core/platform/store";
import {
  fetchMasterManagers, setMasterManagersForTypes, type MasterManagerGrant,
} from "@/core/platform/masterWrites";
import { CENTRAL_MASTER_AREAS, CENTRAL_MASTERS_PATH } from "./centralMastersAccess";

/**
 * CENTRAL MASTERS RIGHTS — who besides admins may edit Central Masters.
 *
 * Writes mst_master_managers, which every mst_* write policy already reads as
 * `is_admin(uid) OR mst_is_master_manager('<type>', uid)`. So this screen adds
 * no new rule: it is the missing editor for one that has been live since
 * Phase 0. Granting an area lets that person Add / Edit / Deactivate rows on
 * that tab and nothing else — not the Tally sync, not Reconcile, and not this
 * screen, which stay admin-only.
 *
 * ⚠ EMPTY MEANS ADMINS ONLY. That is the strictest setting, not a broken one,
 *   and the screen says so rather than letting it read as unset.
 */
interface HolderRow {
  userId: string;
  name: string;
  designation: string;
  areas: string[];
}

export default function MastersRights() {
  const qc = useQueryClient();
  const grantsQ = useQuery({ queryKey: ["masters", "managers"], queryFn: fetchMasterManagers });
  // The admin's directory holds every profile. Not list_org_people: that one
  // also returns customer logins, who must never be offered a master.
  const { profiles } = useDirectory();
  const grants = grantsQ.data ?? [];

  // The picker per area, seeded from the FIRST type of that area — an area's
  // types are always granted together, so the first speaks for the rest.
  // ⚠ Re-seeded on every refetch EXCEPT for areas with unsaved edits, or saving
  //   one tab would throw away what was picked on another.
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!grantsQ.data) return;
    setPicked((prev) => Object.fromEntries(CENTRAL_MASTER_AREAS.map((a) => [
      a.key,
      dirty.has(a.key) && prev[a.key]
        ? prev[a.key]
        : grantsQ.data.filter((g) => g.masterType === a.types[0]).map((g) => g.userId),
    ])));
  }, [grantsQ.data]);

  const [everyArea, setEveryArea] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const people = useMemo(() => profiles.filter((p) => !p.isExternal), [profiles]);
  const options: MultiOption[] = useMemo(
    () => [...people]
      .filter((p) => p.role !== "admin")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [people],
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["masters"] });
  };

  async function run(key: string, work: (current: MasterManagerGrant[]) => Promise<void>) {
    setBusy(key);
    setErr(null);
    setSaved(null);
    try {
      // Re-read first: diffing against a stale list could re-add a grant another
      // admin just removed, or remove one they just added.
      const current = await fetchMasterManagers();
      await work(current);
      await refresh();
      setSaved(key);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const saveArea = (areaKey: string) => {
    const area = CENTRAL_MASTER_AREAS.find((a) => a.key === areaKey)!;
    return run(areaKey, async (current) => {
      await setMasterManagersForTypes(area.types, picked[areaKey] ?? [], current);
      setDirty((d) => { const n = new Set(d); n.delete(areaKey); return n; });
    });
  };

  /** Adds people to every area without taking anyone else out of any. */
  const grantEveryArea = () =>
    run("every", async (current) => {
      for (const area of CENTRAL_MASTER_AREAS) {
        for (const t of area.types) {
          const keep = current.filter((g) => g.masterType === t).map((g) => g.userId);
          await setMasterManagersForTypes([t], Array.from(new Set([...keep, ...everyArea])), current);
        }
      }
      setEveryArea([]);
    });

  /** Takes one person out of every area. */
  const revokeAll = (userId: string) =>
    run(`revoke:${userId}`, async (current) => {
      for (const area of CENTRAL_MASTER_AREAS) {
        for (const t of area.types) {
          const keep = current.filter((g) => g.masterType === t && g.userId !== userId).map((g) => g.userId);
          await setMasterManagersForTypes([t], keep, current);
        }
      }
    });

  const holders: HolderRow[] = useMemo(() => {
    const byUser = new Map<string, Set<string>>();
    for (const g of grants) {
      const area = CENTRAL_MASTER_AREAS.find((a) => a.types[0] === g.masterType);
      if (!area) continue;
      if (!byUser.has(g.userId)) byUser.set(g.userId, new Set());
      byUser.get(g.userId)!.add(area.label);
    }
    return Array.from(byUser.entries()).map(([userId, areas]) => {
      const p = people.find((x) => x.id === userId);
      return {
        userId,
        name: p?.name ?? "Unknown user",
        designation: p?.designation ?? "",
        // In screen order, not set order.
        areas: CENTRAL_MASTER_AREAS.map((a) => a.label).filter((l) => areas.has(l)),
      };
    });
  }, [grants, people]);

  const columns: QueueColumn<HolderRow>[] = [
    { key: "name", header: "Person", cell: (r) => <span className="font-medium text-navy">{r.name}</span>,
      sortValue: (r) => r.name, filter: { kind: "select", get: (r) => r.name } },
    { key: "designation", header: "Designation", cell: (r) => r.designation || "—",
      sortValue: (r) => r.designation, filter: { kind: "select", get: (r) => r.designation || "—" } },
    { key: "count", header: "Areas", cell: (r) => `${r.areas.length} of ${CENTRAL_MASTER_AREAS.length}`,
      sortValue: (r) => r.areas.length, filter: { kind: "number", get: (r) => r.areas.length }, align: "right" },
    { key: "areas", header: "Can edit", cell: (r) => r.areas.join(", "),
      sortValue: (r) => r.areas.join(", "), filter: { kind: "text", get: (r) => r.areas.join(", ") } },
  ];

  const loadError = grantsQ.error as Error | null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-navy">Central Masters Rights</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-grey">
              Admins can always edit Central Masters. Pick who else may edit each tab. They get a
              <strong> Central Masters</strong> link on their home menu and can add, edit and deactivate
              rows on the tabs given to them &mdash; nothing else. Tally sync, Reconcile and this page
              stay admin-only. Fields Tally owns stay locked for everyone.
            </p>
          </div>
          <Link
            to="/admin/masters"
            className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-navy transition hover:border-orange hover:text-orange"
          >
            Back to Central Masters
          </Link>
        </div>
      </Card>

      {loadError && (
        <Card className="text-[13px] text-ryg-red">Could not load rights: {loadError.message}</Card>
      )}
      {err && <Card className="text-[13px] text-ryg-red">Could not save: {err}</Card>}

      {/* ---------------------------------------------------- every area -- */}
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Full rights</h3>
          <p className="mt-1 text-[12.5px] text-grey">
            Adds these people to every tab below in one go. Nobody already on a tab is removed.
          </p>
        </div>
        <MultiSelect
          values={everyArea}
          onChange={(v) => { setEveryArea(v); setSaved(null); }}
          options={options}
          placeholder="Select people"
          searchable
          chips
          disabled={busy !== null}
        />
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void grantEveryArea()} disabled={busy !== null || everyArea.length === 0}>
            {busy === "every" ? "Saving…" : "Give rights on every tab"}
          </Button>
          {saved === "every" && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        </div>
      </Card>

      {/* ------------------------------------------------------- per area -- */}
      <Card className="space-y-5 p-5">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Rights per tab</h3>
          <p className="mt-1 text-[12.5px] text-grey">
            Save each tab after changing it. Taking someone out removes their edit right on that tab straight away.
          </p>
        </div>
        {CENTRAL_MASTER_AREAS.map((a) => (
          <div key={a.key} className="space-y-2 border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <span className="text-[13.5px] font-medium text-navy">{a.label}</span>
                <span className="ml-2 text-[12px] text-grey-2">{a.hint}</span>
              </div>
              {(picked[a.key] ?? []).length === 0 && (
                <span className="text-[11.5px] text-grey-2">Nobody assigned — admins only</span>
              )}
            </div>
            <MultiSelect
              values={picked[a.key] ?? []}
              onChange={(v) => {
                setPicked((p) => ({ ...p, [a.key]: v }));
                setDirty((d) => new Set(d).add(a.key));
                setSaved(null);
              }}
              options={options}
              placeholder="Select people"
              searchable
              chips
              disabled={busy !== null || !grantsQ.data}
            />
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => void saveArea(a.key)} disabled={busy !== null || !grantsQ.data}>
                {busy === a.key ? "Saving…" : "Save"}
              </Button>
              {saved === a.key && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
            </div>
          </div>
        ))}
      </Card>

      {/* --------------------------------------------------------- summary -- */}
      <Card className="space-y-3 p-5">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Who can edit</h3>
          <p className="mt-1 text-[12.5px] text-grey">
            Everyone with at least one tab. They open it from their home menu, or at{" "}
            <span className="font-mono">{CENTRAL_MASTERS_PATH}</span>.
          </p>
        </div>
        <QueueTable<HolderRow>
          rows={holders}
          rowKey={(r) => r.userId}
          columns={columns}
          loading={grantsQ.isLoading}
          rowsLabel="people"
          initialSort={{ key: "name", dir: "asc" }}
          emptyTitle="Admins only"
          emptyMessage="Nobody else can edit Central Masters yet. Pick people above to give them rights."
          actions={(r) => (
            <Button
              size="sm"
              variant="ghost"
              className="!px-3 !py-1.5 text-[12.5px]"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm(`Remove every Central Masters right from ${r.name}?`)) void revokeAll(r.userId);
              }}
            >
              {busy === `revoke:${r.userId}` ? "Removing…" : "Remove all"}
            </Button>
          )}
          exportName="Central Masters Rights"
        />
      </Card>
    </div>
  );
}
