import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import PillToggle from "@/shared/components/ui/PillToggle";
import { useAssetStore } from "../../store";
import { dmy, duePhrase, inr } from "../../lib/format";
import { liveTracks, soonestDue } from "../../lib/schedules";
import type { Asset } from "../../types";

type Scope = "active" | "retired" | "all";

/**
 * The register. One row per asset, with the SOONEST thing due on it — the single
 * most useful fact about an asset in a list, and the reason this is not just a
 * table of purchases.
 *
 * An asset with no live tracks is called out rather than left blank: it is
 * invisible to the reminder engine, which is a silent failure worth seeing.
 */
export default function AssetsList() {
  const s = useAssetStore();
  const [scope, setScope] = useState<Scope>("active");

  const rows = useMemo(() => {
    if (scope === "active") return s.assets.filter((a) => a.active);
    if (scope === "retired") return s.assets.filter((a) => !a.active);
    return s.assets;
  }, [s.assets, scope]);

  const untracked = useMemo(
    () => s.assets.filter((a) => a.active && liveTracks(a.schedules).length === 0).length,
    [s.assets],
  );

  const columns: QueueColumn<Asset>[] = [
    {
      key: "assetNo",
      header: "Asset no.",
      cell: (a) => (
        <Link to={`/asset-maintenance/assets/${a.id}`} className="font-semibold text-navy hover:text-orange">
          {a.assetNo}
        </Link>
      ),
      sortValue: (a) => a.assetNo,
      filter: { kind: "text", get: (a) => a.assetNo },
    },
    {
      key: "name",
      header: "Asset",
      cell: (a) => (
        <div className="min-w-0">
          <div className="truncate text-navy">{a.name}</div>
          {a.serialNo && <div className="truncate text-[12px] text-grey-2">{a.serialNo}</div>}
        </div>
      ),
      sortValue: (a) => a.name,
      filter: { kind: "text", get: (a) => `${a.name} ${a.serialNo ?? ""}` },
    },
    {
      key: "category",
      header: "Category",
      cell: (a) => <span className="text-grey">{s.masterName("category", a.categoryId)}</span>,
      sortValue: (a) => s.masterName("category", a.categoryId),
      filter: { kind: "select", get: (a) => s.masterName("category", a.categoryId) },
    },
    {
      key: "location",
      header: "Location",
      cell: (a) => <span className="text-grey">{s.masterName("location", a.locationId)}</span>,
      sortValue: (a) => s.masterName("location", a.locationId),
      filter: { kind: "select", get: (a) => s.masterName("location", a.locationId) },
    },
    {
      key: "custodian",
      header: "Custodian",
      cell: (a) => <span className="text-grey">{s.personName(a.custodianUserId)}</span>,
      sortValue: (a) => s.personName(a.custodianUserId),
      filter: { kind: "select", get: (a) => s.personName(a.custodianUserId) },
    },
    {
      key: "nextDue",
      header: "Next due",
      cell: (a) => {
        const next = soonestDue(a.schedules);
        if (!next) {
          return a.active ? (
            <span className="text-[12.5px] font-semibold text-[#946200]">Nothing tracked</span>
          ) : (
            <span className="text-grey-2">—</span>
          );
        }
        const overdue = (next.nextDueDate as string) < s.todayIso;
        return (
          <div className="min-w-0">
            <div className={`whitespace-nowrap ${overdue ? "font-semibold text-ryg-red" : "text-navy"}`}>
              {dmy(next.nextDueDate)}
            </div>
            <div className="truncate text-[12px] text-grey-2">
              {s.scheduleTypeName(next.scheduleTypeId)} · {duePhrase(next.nextDueDate, s.todayIso)}
            </div>
          </div>
        );
      },
      sortValue: (a) => soonestDue(a.schedules)?.nextDueDate ?? "9999-12-31",
      exportValue: (a) => dmy(soonestDue(a.schedules)?.nextDueDate ?? null),
    },
    {
      key: "tracks",
      header: "Tracks",
      align: "right",
      cell: (a) => <span className="text-grey">{liveTracks(a.schedules).length}</span>,
      sortValue: (a) => liveTracks(a.schedules).length,
    },
    {
      key: "cost",
      header: "Purchase cost",
      align: "right",
      cell: (a) => <span className="text-grey whitespace-nowrap">{inr(a.purchaseCost)}</span>,
      sortValue: (a) => a.purchaseCost ?? 0,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Asset register</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Everything the company owns, and when each is next due for attention.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {s.canRaise && (
            <Link to="/asset-maintenance/assets/import">
              <Button variant="ghost" size="sm">Bulk import</Button>
            </Link>
          )}
          {s.canRaise && (
            <Link to="/asset-maintenance/assets/new">
              <Button size="sm">Add asset</Button>
            </Link>
          )}
        </div>
      </div>

      {untracked > 0 && scope === "active" && (
        <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] text-[#946200]">
          <strong>{untracked}</strong> active {untracked === 1 ? "asset has" : "assets have"} nothing
          tracked, so {untracked === 1 ? "it will" : "they will"} never remind anybody. Open{" "}
          {untracked === 1 ? "it" : "them"} and add a track.
        </p>
      )}

      <PillToggle
        value={scope}
        onChange={(x) => setScope(x as Scope)}
        options={[
          { value: "active", label: `In use (${s.assets.filter((a) => a.active).length})` },
          { value: "retired", label: `Retired (${s.assets.filter((a) => !a.active).length})` },
          { value: "all", label: `All (${s.assets.length})` },
        ]}
      />

      <QueueTable<Asset>
        rows={rows}
        rowKey={(a) => a.id}
        columns={columns}
        rowsLabel="assets"
        initialSort={{ key: "nextDue", dir: "asc" }}
        emptyTitle="No assets yet"
        emptyMessage="Add one, or bulk-import the existing register from Excel."
        exportName="Asset_Register"
      />
    </div>
  );
}
