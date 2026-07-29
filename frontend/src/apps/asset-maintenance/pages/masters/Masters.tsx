import { useMemo, useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { useAssetStore } from "../../store";
import {
  emptyValuesFor,
  masterFields,
  masterTypeLabel,
  type MasterValues,
} from "../../lib/masterFields";
import { ASSET_MASTER_TYPES, type AssetMasterType, type NamedMaster } from "../../types";
import { frequencyLabel, KIND_LABEL } from "../../lib/format";
import type { AssetCategory, ScheduleType, Vendor } from "../../types";

const GROUPS: { key: string; label: string }[] = [
  { key: "register", label: "Register" },
  { key: "service", label: "Service" },
  { key: "org", label: "Organisation" },
];

/** Keys that hold a number and must not be written back as a string. */
const NUMERIC = new Set(["default_frequency_value", "default_lead_days"]);

/** snake_case bag key → the camelCase property on the mapped row. */
const camel = (k: string) => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

export default function Masters() {
  const s = useAssetStore();
  const [group, setGroup] = useState("register");
  const inGroup = ASSET_MASTER_TYPES.filter((m) => m.group === group);
  const [active, setActive] = useState<AssetMasterType>(inGroup[0].value);

  const current = inGroup.some((m) => m.value === active) ? active : inGroup[0].value;

  const scheduleTypeOptions = useMemo(
    () => s.activeOf(s.scheduleTypes).map((t) => ({ value: t.id, label: t.name })),
    [s],
  );

  /**
   * The category master's "pre-offer these tracks" picker. Supplied from here
   * because MasterCrud's value bag is flat `Record<string,string>` — a custom
   * control must serialise itself into ONE string, so the id list is comma-joined.
   */
  const ctx = {
    renderScheduleTypePicker: (value: string, onChange: (next: string) => void) => (
      <MultiSelect
        values={value ? value.split(",").filter(Boolean) : []}
        onChange={(next) => onChange(next.join(","))}
        options={scheduleTypeOptions}
        placeholder="Select tracks…"
        searchable
      />
    ),
  };

  const extraColumns = (mt: AssetMasterType): MasterColumn<NamedMaster>[] => {
    if (mt === "schedule_type") {
      return [
        {
          header: "Kind",
          render: (r) => <span className="text-grey">{KIND_LABEL[(r as ScheduleType).kind]}</span>,
        },
        {
          header: "Default frequency",
          render: (r) => {
            const t = r as ScheduleType;
            return (
              <span className="text-grey">
                {t.defaultFrequencyUnit
                  ? frequencyLabel(t.defaultFrequencyValue, t.defaultFrequencyUnit)
                  : "—"}
              </span>
            );
          },
        },
        {
          header: "Lead days",
          render: (r) => <span className="text-grey">{(r as ScheduleType).defaultLeadDays}</span>,
        },
      ];
    }
    if (mt === "category") {
      return [
        {
          header: "Lead days",
          render: (r) => <span className="text-grey">{(r as AssetCategory).defaultLeadDays ?? "—"}</span>,
        },
        {
          header: "Pre-offered tracks",
          render: (r) => {
            const ids = (r as AssetCategory).defaultScheduleTypeIds;
            if (!ids.length) return <span className="text-grey-2">—</span>;
            return <span className="text-grey">{ids.map((id) => s.scheduleTypeName(id)).join(", ")}</span>;
          },
        },
      ];
    }
    if (mt === "vendor") {
      return [
        { header: "Contact", render: (r) => <span className="text-grey">{(r as Vendor).contactPerson ?? "—"}</span> },
        { header: "Phone", render: (r) => <span className="text-grey">{(r as Vendor).phone ?? "—"}</span> },
      ];
    }
    return [];
  };

  const columns: MasterColumn<NamedMaster>[] = [
    { header: "Name", render: (r) => <span className="font-semibold text-navy">{r.name}</span> },
    ...extraColumns(current),
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span> },
  ];

  const toValues = (row: NamedMaster): MasterValues => {
    const bag = emptyValuesFor(current);
    const out: MasterValues = { ...bag };
    const rec = row as unknown as Record<string, unknown>;
    for (const key of Object.keys(bag)) {
      if (key === "sortOrder") { out.sortOrder = String(row.sortOrder ?? 0); continue; }
      const v = rec[camel(key)];
      out[key] = Array.isArray(v) ? v.join(",") : v === null || v === undefined ? "" : String(v);
    }
    return out;
  };

  const toExtra = (v: MasterValues): Record<string, unknown> => {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(emptyValuesFor(current))) {
      if (key === "name" || key === "sortOrder") continue;
      const raw = (v[key] ?? "").trim();
      if (key === "default_schedule_type_ids") {
        extra[key] = raw ? raw.split(",").filter(Boolean) : [];
        continue;
      }
      extra[key] = raw ? (NUMERIC.has(key) ? Number(raw) : raw) : null;
    }
    return extra;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          The lists every asset and every track picks from. Each master can be exported to Excel,
          edited and re-imported.
        </p>
      </div>

      <Tabs
        tabs={GROUPS.map((g) => ({ key: g.key, label: g.label }))}
        active={group}
        onChange={(k) => {
          setGroup(k);
          const first = ASSET_MASTER_TYPES.find((m) => m.group === k);
          if (first) setActive(first.value);
        }}
      />

      <Tabs
        tabs={inGroup.map((m) => ({ key: m.value, label: m.plural, count: s.masterList(m.value).length }))}
        active={current}
        onChange={(k) => setActive(k as AssetMasterType)}
      />

      {current === "schedule_type" && (
        <p className="rounded-lg bg-[#EEF3FF] px-3 py-2 text-[12.5px] text-navy">
          This is the master that decides what can be tracked. Add one here — “Lift Licence”, “Fire
          Extinguisher Refill” — and it is immediately available on every asset. Mark it a{" "}
          <strong>renewal</strong> if it is a document that lapses and is replaced: those ask for the
          new expiry date when their job is closed, rather than computing one.
        </p>
      )}

      <MasterCrud<NamedMaster>
        key={current}
        singular={masterTypeLabel(current)}
        rows={s.masterList(current)}
        columns={columns}
        fields={masterFields(current, ctx)}
        searchText={(r) => r.name}
        canManage={s.canManage(current)}
        emptyValues={emptyValuesFor(current)}
        toValues={toValues}
        onSubmit={async (id, v, isActive) => {
          const input = {
            name: String(v.name ?? "").trim(),
            active: isActive,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            extra: toExtra(v),
          };
          if (id) await s.updateMaster(current, id, input);
          else await s.insertMaster(current, input);
        }}
        onToggleActive={async (row, isActive) => {
          await s.setMasterActive(current, row.id, isActive);
        }}
      />
    </div>
  );
}
