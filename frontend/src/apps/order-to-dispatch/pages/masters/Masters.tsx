import { useState } from "react";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import Tabs from "@/shared/components/ui/Tabs";
import { useDispatchStore } from "../../store";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import {
  emptyValuesFor, masterFields, masterTypePlural, type MasterValues,
} from "../../lib/masterFields";
import { DISPATCH_MASTER_TYPES, type DispatchMasterType, type NamedMaster } from "../../types";

type Group = "sales" | "stores" | "logistics" | "accounts";
const GROUPS: { key: Group; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "stores", label: "Stores" },
  { key: "logistics", label: "Logistics" },
  { key: "accounts", label: "Accounts" },
];

/**
 * All eighteen masters, grouped into four tab sets so it reads as four short
 * lists rather than one wall.
 *
 * Every tab renders through the shared MasterCrud, which is where search,
 * activate/deactivate and the Excel export/import round trip come from — none of
 * that is written here. The value bag (`emptyValuesFor`) IS the Excel schema, so
 * a key with no visible form field still survives the round trip.
 */
export default function Masters() {
  const s = useDispatchStore();
  const ctx = useMasterFieldCtx();
  const [group, setGroup] = useState<Group>("sales");
  const [tab, setTab] = useState<DispatchMasterType>("customer");

  const typesInGroup = DISPATCH_MASTER_TYPES.filter((m) => m.group === group);
  const active = typesInGroup.some((t) => t.value === tab) ? tab : typesInGroup[0].value;

  const rows = s.masterList(active);
  const fields = masterFields(active, ctx);

  /** Column set: the name, plus whatever that master's own fields are worth showing. */
  const columns: MasterColumn<NamedMaster>[] = [
    { header: masterTypePlural(active), render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    ...extraColumns(active, s),
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  /** The stored row → the string bag MasterCrud edits. Keys match emptyValuesFor. */
  const toValues = (r: NamedMaster): MasterValues => {
    const any = r as unknown as Record<string, unknown>;
    const out = emptyValuesFor(active);
    for (const key of Object.keys(out)) {
      if (key === "sortOrder") { out[key] = String(r.sortOrder ?? 0); continue; }
      if (key === "name") { out[key] = r.name; continue; }
      out[key] = valueOf(any, key);
    }
    return out;
  };

  /** The string bag → the snake_case columns the write layer sends. */
  const toExtra = (v: MasterValues): Record<string, unknown> => {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(emptyValuesFor(active))) {
      if (key === "name" || key === "sortOrder") continue;
      const raw = String(v[key] ?? "").trim();
      extra[key] = raw === "" ? null : NUMERIC_KEYS.has(key) ? Number(raw) : raw;
    }
    return extra;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Everything the seven steps pick from. Editable by admins and each master's owner
          (Setup → Master Owners). Use Export / Import on any tab to bulk-load from Excel.
        </p>
      </div>

      <div className="flex gap-1 border-b border-line">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => {
              setGroup(g.key);
              setTab(DISPATCH_MASTER_TYPES.find((m) => m.group === g.key)!.value);
            }}
            className={`px-3.5 py-2 text-[13px] font-semibold -mb-px border-b-2 ${
              group === g.key ? "border-orange text-navy" : "border-transparent text-grey-2 hover:text-navy"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <Tabs
        tabs={typesInGroup.map((t) => ({ key: t.value, label: t.plural, count: s.masterList(t.value).length }))}
        active={active}
        onChange={(k) => setTab(k as DispatchMasterType)}
      />

      <MasterCrud<NamedMaster>
        key={active}
        singular={DISPATCH_MASTER_TYPES.find((m) => m.value === active)!.label}
        rows={rows}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage(active)}
        emptyValues={emptyValuesFor(active)}
        toValues={toValues}
        onSubmit={async (id, v, isActive) => {
          const input = {
            name: String(v.name ?? "").trim(),
            active: isActive,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            extra: toExtra(v),
          };
          if (id) await s.updateMaster(active, id, input);
          else await s.insertMaster(active, input);
        }}
        onToggleActive={async (row, isActive) => {
          const v = toValues(row);
          await s.updateMaster(active, row.id, {
            name: row.name,
            active: isActive,
            sortOrder: row.sortOrder,
            extra: toExtra(v),
          });
        }}
      />
    </div>
  );
}

/** Value-bag keys that must be written as numbers, not strings. */
const NUMERIC_KEYS = new Set(["credit_limit", "credit_days", "days", "available_qty"]);

/** camelCase the snake_case bag key so it can be read off the mapped row. */
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const valueOf = (row: Record<string, unknown>, key: string): string => {
  const v = row[camel(key)];
  if (v === null || v === undefined) return "";
  return String(v);
};

/** Per-master extra display columns — enough to identify a row at a glance. */
function extraColumns(
  mt: DispatchMasterType,
  s: ReturnType<typeof useDispatchStore>,
): MasterColumn<NamedMaster>[] {
  const text = (header: string, get: (r: Record<string, unknown>) => unknown): MasterColumn<NamedMaster> => ({
    header,
    render: (r) => {
      const v = get(r as unknown as Record<string, unknown>);
      return <span className="text-grey-2">{v === null || v === undefined || v === "" ? "—" : String(v)}</span>;
    },
  });

  switch (mt) {
    case "customer":
      return [text("Code", (r) => r.code), text("Email", (r) => r.email), text("Credit days", (r) => r.creditDays)];
    case "ship_to":
      return [
        { header: "Customer", render: (r) => <span className="text-grey-2">{s.customerName((r as unknown as { customerId: string }).customerId)}</span> },
        text("City", (r) => r.city),
      ];
    case "item":
      return [
        { header: "Category", render: (r) => <span className="text-grey-2">{s.masterName("category", (r as unknown as { categoryId: string | null }).categoryId)}</span> },
        { header: "Unit", render: (r) => <span className="text-grey-2">{s.unitName((r as unknown as { unitId: string | null }).unitId)}</span> },
      ];
    case "lot":
      return [
        { header: "Item", render: (r) => <span className="text-grey-2">{s.itemName((r as unknown as { itemId: string | null }).itemId)}</span> },
        text("Available", (r) => r.availableQty),
        text("Expiry", (r) => r.expiryDate),
      ];
    case "vehicle":
      return [
        text("Type", (r) => r.vehicleType),
        { header: "Transporter", render: (r) => <span className="text-grey-2">{s.masterName("transporter", (r as unknown as { transporterId: string | null }).transporterId)}</span> },
      ];
    case "driver":
      return [
        text("Phone", (r) => r.phone),
        { header: "Portal user", render: (r) => <span className="text-grey-2">{s.personName((r as unknown as { userId: string | null }).userId)}</span> },
      ];
    case "transporter":
      return [text("Contact", (r) => r.contactName), text("Phone", (r) => r.phone)];
    case "payment_term":
      return [text("Days", (r) => r.days)];
    case "mail_template":
      return [text("Code", (r) => r.code), text("Subject", (r) => r.subject)];
    case "godown":
    case "gate":
    case "invoice_series":
      return [
        { header: "Company", render: (r) => <span className="text-grey-2">{s.masterName("company", (r as unknown as { companyId: string | null }).companyId)}</span> },
      ];
    default:
      return [];
  }
}
