import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import { useProductionStore } from "../../store";
import { masterFields } from "../../lib/masterFields";
import { PRODUCTION_MASTER_TYPES, type NamedMaster, type ProductionMasterType } from "../../types";

/**
 * Production Masters — four flat lists (Category, Raw Material, FG Item, Unit),
 * each a MasterCrud surface. Editable by admins and each master's assigned owner
 * (Setup → Master Owners). Anyone can request a missing entry on Master Requests.
 */
export default function Masters() {
  const s = useProductionStore();
  const [tab, setTab] = useState<ProductionMasterType>("category");

  const tabs = PRODUCTION_MASTER_TYPES.map((m) => ({ key: m.value, label: m.plural, count: s.masterList(m.value).length }));

  const columns: MasterColumn<NamedMaster>[] = [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];

  const singular = PRODUCTION_MASTER_TYPES.find((m) => m.value === tab)?.label ?? "Entry";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          The controlled lists that drive every job card. Managed by admins and each master's assigned owner (Setup → Master Owners).
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as ProductionMasterType)} />

      <MasterCrud<NamedMaster>
        key={tab}
        singular={singular}
        rows={s.masterList(tab)}
        columns={columns}
        fields={masterFields(tab)}
        searchText={(r) => r.name}
        canManage={s.canManage(tab)}
        emptyValues={{ name: "", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = { name: v.name.trim(), active, sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)) };
          if (id) await s.updateMaster(tab, id, input);
          else await s.insertMaster(tab, input);
        }}
        onToggleActive={async (row, active) => s.updateMaster(tab, row.id, { name: row.name, active, sortOrder: row.sortOrder })}
      />
    </div>
  );
}
