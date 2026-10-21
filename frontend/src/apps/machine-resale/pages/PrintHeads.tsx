import { useState } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { savePrintHead, setPrintHeadActive, slugify } from "../data/mrWrites";
import { PageHeader } from "../components/Pills";
import { useMrStore } from "../store";
import type { PrintHead } from "../types";

/**
 * Print heads, each under one category (the website's subcategories). One flat
 * list: Category is an ordinary column to sort and filter by, not a grouping.
 */
export default function PrintHeads() {
  const s = useMrStore();
  // MasterCrud shows a failed Activate/Deactivate only inside its edit dialog.
  const [notice, setNotice] = useState<string | null>(null);

  const catName = (h: PrintHead) => s.categoryById(h.categoryId)?.name ?? "";
  const machines = (h: PrintHead) => s.machines.filter((m) => m.subcategoryId === h.id).length;

  const columns: MasterColumn<PrintHead>[] = [
    { header: "Print head", render: (h) => <span className="font-medium text-navy">{h.name}</span> },
    { header: "Category", render: (h) => <span className="text-grey">{catName(h)}</span> },
    { header: "Web name", render: (h) => <span className="font-mono text-[12.5px] text-grey">{h.slug}</span> },
    { header: "Machines", render: (h) => machines(h), sortValue: machines, className: "text-right" },
    { header: "Order", render: (h) => h.sortOrder, sortValue: (h) => h.sortOrder, className: "text-right" },
  ];

  const categoryOptions = s.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (switched off)` }));

  const fields: MasterFieldDef[] = [
    { key: "categoryId", label: "Category", type: "select", required: true, options: categoryOptions },
    { key: "name", label: "Print head", type: "text", required: true, placeholder: "Epson I3200" },
    { key: "slug", label: "Web name", type: "text", hint: "Used in the website address. Leave blank to make it from the name.", placeholder: "epson-i3200" },
    { key: "sortOrder", label: "Order", type: "text", hint: "Lower numbers come first within the category", placeholder: "1" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Print heads" sub="The print heads under each category. A machine is listed under one of them." />
      {notice && <p className="rounded-lg bg-[#FFF4F4] px-3 py-2 text-[13px] text-ryg-red">{notice}</p>}
      <MasterCrud<PrintHead>
        singular="Print head"
        rows={s.printHeads}
        columns={columns}
        fields={fields}
        searchText={(h) => `${h.name} ${catName(h)} ${h.slug}`}
        defaultOrder={(h) => (s.categoryById(h.categoryId)?.sortOrder ?? 0) * 1000 + h.sortOrder}
        canManage={s.canEdit}
        statusNote="Switching a print head off takes every machine under it off the website. The machines keep their records."
        emptyValues={{ categoryId: "", name: "", slug: "", sortOrder: "" }}
        toValues={(h) => ({ categoryId: h.categoryId, name: h.name, slug: h.slug, sortOrder: String(h.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const slug = slugify(v.slug || v.name);
          if (!slug) throw new Error("The name needs at least one letter or number.");
          if (v.sortOrder && !/^-?\d+$/.test(v.sortOrder.trim())) throw new Error("Order must be a whole number.");
          await savePrintHead(id, {
            categoryId: v.categoryId,
            name: v.name,
            slug,
            sortOrder: v.sortOrder.trim() ? Number(v.sortOrder) : 0,
            active,
          });
          await s.refresh();
        }}
        onToggleActive={async (h, active) => {
          setNotice(null);
          try {
            await setPrintHeadActive(h.id, active);
            await s.refresh();
          } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </div>
  );
}
