import { useMemo, useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import { emptyValuesFor, masterFields } from "../../lib/masterFields";
import { useProcurementStore } from "../../store";
import type { Company, Category, ItemGroup, Item, Vendor } from "../../types";

/**
 * Masters admin — Companies, Categories, Item Groups, Items, Vendors. Each tab
 * is a MasterCrud surface driven by the shared `masterFields` descriptor (the
 * same one the request + approve modals use), with the relational tabs (Item
 * Groups → Category, Items → Item Group) sourcing their options from the store.
 * Who owns each master is configured in Setup → Master Owners.
 */
export default function Masters() {
  const s = useProcurementStore();
  const [tab, setTab] = useState("company");

  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );
  const itemGroupOptions: ComboOption[] = useMemo(
    () =>
      s.itemGroups
        .filter((g) => g.active)
        .map((g) => ({ value: g.id, label: g.name, sublabel: s.categoryById(g.categoryId)?.name })),
    [s.itemGroups, s]
  );

  const ctx = { categoryOptions, itemGroupOptions };

  const tabs = [
    { key: "company", label: "Companies", count: s.companies.length },
    { key: "category", label: "Categories", count: s.categories.length },
    { key: "item_group", label: "Item Groups", count: s.itemGroups.length },
    { key: "item", label: "Items", count: s.items.length },
    { key: "vendor", label: "Vendors", count: s.vendors.length },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Controlled lists that drive every purchase request. Managed by admins and each master's assigned manager.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "company" && (
        <MasterCrud<Company>
          singular="Company"
          rows={s.companies}
          canManage={s.canManage("company")}
          searchText={(r) => `${r.name} ${r.location ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Location", render: (r) => r.location || <span className="text-grey-2">—</span> },
          ] as MasterColumn<Company>[]}
          fields={masterFields("company", ctx)}
          emptyValues={emptyValuesFor("company")}
          toValues={(r) => ({ name: r.name, location: r.location ?? "" })}
          onSubmit={async (id, v, active) => {
            const input = { name: v.name.trim(), location: v.location.trim() || null, active, sortOrder: s.companyById(id)?.sortOrder ?? 0 };
            if (id) await s.editCompany(id, input);
            else await s.createCompany(input);
          }}
          onToggleActive={async (r, active) =>
            s.editCompany(r.id, { name: r.name, location: r.location, active, sortOrder: r.sortOrder })
          }
        />
      )}

      {tab === "category" && (
        <MasterCrud<Category>
          singular="Category"
          rows={s.categories}
          canManage={s.canManage("category")}
          searchText={(r) => r.name}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Item Groups", render: (r) => s.itemGroupsByCategory(r.id).length },
          ] as MasterColumn<Category>[]}
          fields={masterFields("category", ctx)}
          emptyValues={emptyValuesFor("category")}
          toValues={(r) => ({ name: r.name })}
          onSubmit={async (id, v, active) => {
            const input = { name: v.name.trim(), active, sortOrder: s.categoryById(id)?.sortOrder ?? 0 };
            if (id) await s.editCategory(id, input);
            else await s.createCategory(input);
          }}
          onToggleActive={async (r, active) => s.editCategory(r.id, { name: r.name, active, sortOrder: r.sortOrder })}
        />
      )}

      {tab === "item_group" && (
        <MasterCrud<ItemGroup>
          singular="Item Group"
          rows={s.itemGroups}
          canManage={s.canManage("item_group")}
          searchText={(r) => `${r.name} ${s.categoryById(r.categoryId)?.name ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Category", render: (r) => s.categoryById(r.categoryId)?.name ?? <span className="text-grey-2">—</span> },
            { header: "Items", render: (r) => s.itemsByGroup(r.id).length },
          ] as MasterColumn<ItemGroup>[]}
          fields={masterFields("item_group", ctx)}
          emptyValues={emptyValuesFor("item_group")}
          toValues={(r) => ({ category_id: r.categoryId, name: r.name })}
          onSubmit={async (id, v, active) => {
            const input = { categoryId: v.category_id, name: v.name.trim(), active, sortOrder: s.itemGroupById(id)?.sortOrder ?? 0 };
            if (id) await s.editItemGroup(id, input);
            else await s.createItemGroup(input);
          }}
          onToggleActive={async (r, active) =>
            s.editItemGroup(r.id, { categoryId: r.categoryId, name: r.name, active, sortOrder: r.sortOrder })
          }
        />
      )}

      {tab === "item" && (
        <MasterCrud<Item>
          singular="Item"
          rows={s.items}
          canManage={s.canManage("item")}
          searchText={(r) => {
            const g = s.itemGroupById(r.itemGroupId);
            return `${r.name} ${g?.name ?? ""} ${g ? s.categoryById(g.categoryId)?.name ?? "" : ""}`;
          }}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Item Group", render: (r) => s.itemGroupById(r.itemGroupId)?.name ?? <span className="text-grey-2">—</span> },
            {
              header: "Category",
              render: (r) => {
                const g = s.itemGroupById(r.itemGroupId);
                return (g && s.categoryById(g.categoryId)?.name) || <span className="text-grey-2">—</span>;
              },
            },
            { header: "Unit", render: (r) => r.unit || <span className="text-grey-2">—</span> },
          ] as MasterColumn<Item>[]}
          fields={masterFields("item", ctx)}
          emptyValues={emptyValuesFor("item")}
          toValues={(r) => ({ item_group_id: r.itemGroupId, name: r.name, unit: r.unit })}
          onSubmit={async (id, v, active) => {
            const input = { itemGroupId: v.item_group_id, name: v.name.trim(), unit: v.unit.trim(), active, sortOrder: s.itemById(id)?.sortOrder ?? 0 };
            if (id) await s.editItem(id, input);
            else await s.createItem(input);
          }}
          onToggleActive={async (r, active) =>
            s.editItem(r.id, { itemGroupId: r.itemGroupId, name: r.name, unit: r.unit, active, sortOrder: r.sortOrder })
          }
        />
      )}

      {tab === "vendor" && (
        <MasterCrud<Vendor>
          singular="Vendor"
          rows={s.vendors}
          canManage={s.canManage("vendor")}
          searchText={(r) => `${r.name} ${r.gstin ?? ""} ${r.contactName ?? ""} ${r.phone ?? ""} ${r.email ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "GSTIN", render: (r) => r.gstin || <span className="text-grey-2">—</span> },
            { header: "Contact", render: (r) => r.contactName || <span className="text-grey-2">—</span> },
            { header: "Phone", render: (r) => r.phone || <span className="text-grey-2">—</span> },
            { header: "Email", render: (r) => r.email || <span className="text-grey-2">—</span> },
          ] as MasterColumn<Vendor>[]}
          fields={masterFields("vendor", ctx)}
          emptyValues={emptyValuesFor("vendor")}
          toValues={(r) => ({
            name: r.name,
            gstin: r.gstin ?? "",
            contact_name: r.contactName ?? "",
            phone: r.phone ?? "",
            email: r.email ?? "",
            address: r.address ?? "",
          })}
          onSubmit={async (id, v, active) => {
            const input = {
              name: v.name.trim(),
              gstin: v.gstin.trim() || null,
              contactName: v.contact_name.trim() || null,
              phone: v.phone.trim() || null,
              email: v.email.trim() || null,
              address: v.address.trim() || null,
              active,
            };
            if (id) await s.editVendor(id, input);
            else await s.createVendor(input);
          }}
          onToggleActive={async (r, active) =>
            s.editVendor(r.id, {
              name: r.name,
              gstin: r.gstin,
              contactName: r.contactName,
              phone: r.phone,
              email: r.email,
              address: r.address,
              active,
            })
          }
        />
      )}

    </div>
  );
}
