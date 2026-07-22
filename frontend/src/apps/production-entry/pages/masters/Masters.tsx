import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useProductionStore } from "../../store";
import { masterFields } from "../../lib/masterFields";
import { PRODUCTION_MASTER_TYPES, type NamedMaster, type ProductionMasterType, type RawMaterial } from "../../types";

/**
 * Production Masters — flat lists (Raw Material, FG Item, Unit), each a
 * MasterCrud surface. Editable by admins and each master's assigned owner
 * (Setup → Master Owners). Anyone can request a missing entry on Master Requests.
 *
 * Raw materials additionally carry their own unit (from the Units master), shown
 * automatically when the material is picked on a job card.
 */
export default function Masters() {
  const s = useProductionStore();
  const [tab, setTab] = useState<ProductionMasterType>("raw_material");

  const tabs = PRODUCTION_MASTER_TYPES.map((m) => ({ key: m.value, label: m.plural, count: s.masterList(m.value).length }));

  const isRm = tab === "raw_material";
  const unitOptions: ComboOption[] = s.activeUnits.map((u) => ({ value: u.id, label: u.name }));
  const unitName = (r: NamedMaster) => s.unitById((r as RawMaterial).unitId)?.name ?? "—";

  const fields: MasterFieldDef[] = isRm
    ? [
        ...masterFields(tab),
        {
          key: "unit_id",
          label: "Unit",
          type: "select",
          options: unitOptions,
          placeholder: "Select unit",
          hint: "Shown automatically when this raw material is picked on a job card.",
        },
      ]
    : masterFields(tab);

  const columns: MasterColumn<NamedMaster>[] = [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    ...(isRm ? [{ header: "Unit", render: (r: NamedMaster) => <span className="text-grey-2">{unitName(r)}</span>, className: "w-28" }] : []),
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
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage(tab)}
        emptyValues={isRm ? { name: "", sortOrder: "0", unit_id: "" } : { name: "", sortOrder: "0" }}
        toValues={(r): Record<string, string> =>
          isRm
            ? { name: r.name, sortOrder: String(r.sortOrder), unit_id: (r as RawMaterial).unitId ?? "" }
            : { name: r.name, sortOrder: String(r.sortOrder) }
        }
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            ...(isRm ? { unitId: v.unit_id || null } : {}),
          };
          if (id) await s.updateMaster(tab, id, input);
          else await s.insertMaster(tab, input);
        }}
        onToggleActive={async (row, active) =>
          s.updateMaster(tab, row.id, {
            name: row.name,
            active,
            sortOrder: row.sortOrder,
            ...(isRm ? { unitId: (row as RawMaterial).unitId ?? null } : {}),
          })
        }
      />
    </div>
  );
}
