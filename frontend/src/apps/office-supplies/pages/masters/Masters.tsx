import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import RequestMasterModal from "../../components/RequestMasterModal";
import { useSuppliesStore } from "../../store";
import type { Category, Company, Department, Item, ServiceType } from "../../types";

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** Categories — the routing switch lives here (requires_approval). */
function CategoriesMaster() {
  const s = useSuppliesStore();
  const columns: MasterColumn<Category>[] = [
    { header: "Category", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "Route",
      render: (r) =>
        r.requiresApproval ? (
          <span className="text-orange font-medium">First + second approval</span>
        ) : (
          <span className="text-grey">Straight to handover</span>
        ),
      className: "w-56",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];
  const fields: MasterFieldDef[] = [
    { key: "name", label: "Category", type: "text", required: true },
    {
      key: "requiresApproval",
      label: "Needs first + second approval?",
      type: "select",
      required: true,
      options: YES_NO,
      hint: "Yes = HOD then Management approval (like Computer & Tech Accessories). No = straight to handover.",
    },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];
  return (
    <MasterCrud<Category>
      singular="Category"
      rows={s.categories}
      columns={columns}
      fields={fields}
      searchText={(r) => r.name}
      canManage={s.canManage("category")}
      emptyValues={{ name: "", requiresApproval: "no", sortOrder: "0" }}
      toValues={(r) => ({ name: r.name, requiresApproval: r.requiresApproval ? "yes" : "no", sortOrder: String(r.sortOrder) })}
      onSubmit={async (id, v, active) => {
        const input = {
          name: v.name.trim(),
          requiresApproval: v.requiresApproval === "yes",
          active,
          sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
        };
        if (id) await s.updateCategory(id, input);
        else await s.insertCategory(input);
      }}
      onToggleActive={async (row, active) =>
        s.updateCategory(row.id, { name: row.name, requiresApproval: row.requiresApproval, active, sortOrder: row.sortOrder })
      }
    />
  );
}

/** Items — scoped to a category. */
function ItemsMaster() {
  const s = useSuppliesStore();
  const catOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories],
  );
  const columns: MasterColumn<Item>[] = [
    { header: "Item", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Category", render: (r) => <span className="text-grey-2">{s.categoryById(r.categoryId)?.name ?? "—"}</span>, className: "w-56" },
    { header: "Unit", render: (r) => <span className="text-grey-2">{r.unit ?? "—"}</span>, className: "w-24" },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];
  const fields: MasterFieldDef[] = [
    { key: "categoryId", label: "Category", type: "select", required: true, options: catOptions },
    { key: "name", label: "Item", type: "text", required: true, placeholder: "e.g. Wireless mouse" },
    { key: "unit", label: "Unit", type: "text", placeholder: "e.g. pcs, box (optional)" },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];
  return (
    <MasterCrud<Item>
      singular="Item"
      rows={s.items}
      columns={columns}
      fields={fields}
      searchText={(r) => `${r.name} ${s.categoryById(r.categoryId)?.name ?? ""}`}
      canManage={s.canManage("item")}
      emptyValues={{ categoryId: catOptions[0]?.value ?? "", name: "", unit: "", sortOrder: "0" }}
      toValues={(r) => ({ categoryId: r.categoryId, name: r.name, unit: r.unit ?? "", sortOrder: String(r.sortOrder) })}
      onSubmit={async (id, v, active) => {
        const input = {
          categoryId: v.categoryId,
          name: v.name.trim(),
          unit: v.unit.trim() || null,
          active,
          sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
        };
        if (id) await s.updateItem(id, input);
        else await s.insertItem(input);
      }}
      onToggleActive={async (row, active) =>
        s.updateItem(row.id, { categoryId: row.categoryId, name: row.name, unit: row.unit, active, sortOrder: row.sortOrder })
      }
    />
  );
}

/** Companies. */
function CompaniesMaster() {
  const s = useSuppliesStore();
  const columns: MasterColumn<Company>[] = [
    { header: "Company", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];
  const fields: MasterFieldDef[] = [
    { key: "name", label: "Company", type: "text", required: true },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];
  return (
    <MasterCrud<Company>
      singular="Company"
      rows={s.companies}
      columns={columns}
      fields={fields}
      searchText={(r) => r.name}
      canManage={s.canManage("company")}
      emptyValues={{ name: "", sortOrder: "0" }}
      toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
      onSubmit={async (id, v, active) => {
        const input = { name: v.name.trim(), active, sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)) };
        if (id) await s.updateCompany(id, input);
        else await s.insertCompany(input);
      }}
      onToggleActive={async (row, active) => s.updateCompany(row.id, { name: row.name, active, sortOrder: row.sortOrder })}
    />
  );
}

/** Departments — carry the HOD (first approver). */
function DepartmentsMaster() {
  const s = useSuppliesStore();
  const peopleOptions: ComboOption[] = useMemo(
    () =>
      [{ value: "", label: "No HOD (falls back to First Approval owners)" }].concat(
        [...s.profiles]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
      ),
    [s.profiles],
  );
  const columns: MasterColumn<Department>[] = [
    { header: "Department", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "HOD (first approver)",
      render: (r) => (r.hodUserId ? <span className="text-navy">{s.profileById(r.hodUserId)?.name ?? "Unknown"}</span> : <span className="text-grey-2">Unassigned</span>),
      className: "w-64",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];
  const fields: MasterFieldDef[] = [
    { key: "name", label: "Department", type: "text", required: true },
    {
      key: "hodUserId",
      label: "HOD (first approver)",
      type: "custom",
      hint: "Requests raised under this department route their first approval to this person.",
      render: (value, onChange) => (
        <Combobox value={value} onChange={onChange} options={peopleOptions} placeholder="Select the HOD" />
      ),
    },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];
  return (
    <MasterCrud<Department>
      singular="Department"
      rows={s.departments}
      columns={columns}
      fields={fields}
      searchText={(r) => r.name}
      canManage={s.canManage("department")}
      emptyValues={{ name: "", hodUserId: "", sortOrder: "0" }}
      toValues={(r) => ({ name: r.name, hodUserId: r.hodUserId ?? "", sortOrder: String(r.sortOrder) })}
      onSubmit={async (id, v, active) => {
        const input = {
          name: v.name.trim(),
          hodUserId: v.hodUserId || null,
          active,
          sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
        };
        if (id) await s.updateDepartment(id, input);
        else await s.insertDepartment(input);
      }}
      onToggleActive={async (row, active) =>
        s.updateDepartment(row.id, { name: row.name, hodUserId: row.hodUserId, active, sortOrder: row.sortOrder })
      }
    />
  );
}

/** Service types. */
function ServiceTypesMaster() {
  const s = useSuppliesStore();
  const columns: MasterColumn<ServiceType>[] = [
    { header: "Service", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];
  const fields: MasterFieldDef[] = [
    { key: "name", label: "Service", type: "text", required: true },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];
  return (
    <MasterCrud<ServiceType>
      singular="Service type"
      rows={s.serviceTypes}
      columns={columns}
      fields={fields}
      searchText={(r) => r.name}
      canManage={s.canManage("service_type")}
      emptyValues={{ name: "", sortOrder: "0" }}
      toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
      onSubmit={async (id, v, active) => {
        const input = { name: v.name.trim(), active, sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)) };
        if (id) await s.updateServiceType(id, input);
        else await s.insertServiceType(input);
      }}
      onToggleActive={async (row, active) => s.updateServiceType(row.id, { name: row.name, active, sortOrder: row.sortOrder })}
    />
  );
}

export default function Masters() {
  const s = useSuppliesStore();
  const [tab, setTab] = useState("categories");
  const [raising, setRaising] = useState(false);

  const tabs = [
    { key: "categories", label: "Categories", count: s.categories.length },
    { key: "items", label: "Items", count: s.items.length },
    { key: "services", label: "Service types", count: s.serviceTypes.length },
    { key: "companies", label: "Companies", count: s.companies.length },
    { key: "departments", label: "Departments", count: s.departments.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Masters</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            The controlled lists behind the supply forms. A category's <span className="font-semibold text-navy">route</span> and a
            department's <span className="font-semibold text-navy">HOD</span> are edited here. Each list is editable by the admins and
            its assigned owner (Setup → Master Owners).
          </p>
        </div>
        <Button size="sm" onClick={() => setRaising(true)}>
          Request new entry
        </Button>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "categories" && <CategoriesMaster />}
      {tab === "items" && <ItemsMaster />}
      {tab === "services" && <ServiceTypesMaster />}
      {tab === "companies" && <CompaniesMaster />}
      {tab === "departments" && <DepartmentsMaster />}

      <RequestMasterModal open={raising} onClose={() => setRaising(false)} masterType={null} />
    </div>
  );
}
