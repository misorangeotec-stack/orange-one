import { useRef, useState } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { mediaUrl, removeMedia, uploadMedia } from "../data/client";
import { saveCategory, setCategoryActive, slugify } from "../data/mrWrites";
import { PageHeader } from "../components/Pills";
import { useMrStore } from "../store";
import type { Category } from "../types";

/** The category picture: upload straight away, the form keeps the PATH. */
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = mediaUrl(value);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {url ? (
        <img src={url} alt="" className="h-16 w-24 rounded-lg border border-line object-cover" />
      ) : (
        <span className="text-[12.5px] text-grey-2">No picture</span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:border-orange disabled:opacity-50"
      >
        {busy ? "Uploading..." : url ? "Change picture" : "Add picture"}
      </button>
      {url && (
        <button type="button" onClick={() => onChange("")} className="text-[12.5px] font-medium text-ryg-red hover:underline">
          Remove
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setErr(null);
          setBusy(true);
          try {
            onChange(await uploadMedia(file, "categories"));
          } catch (x) {
            setErr(x instanceof Error ? x.message : String(x));
          } finally {
            setBusy(false);
          }
        }}
      />
      {err && <span className="w-full text-[12.5px] text-ryg-red">{err}</span>}
    </div>
  );
}

export default function Categories() {
  const s = useMrStore();
  // MasterCrud shows a failed Activate/Deactivate only inside its edit dialog.
  const [notice, setNotice] = useState<string | null>(null);

  const heads = (c: Category) => s.printHeads.filter((h) => h.categoryId === c.id && h.active).length;
  const machines = (c: Category) => s.machines.filter((m) => m.categoryId === c.id).length;

  const columns: MasterColumn<Category>[] = [
    {
      header: "Picture",
      render: (c) => {
        const url = mediaUrl(c.imagePath);
        return url ? <img src={url} alt="" className="h-9 w-14 rounded-md border border-line object-cover" /> : <span className="text-grey-2">None</span>;
      },
      filter: { get: (c) => (c.imagePath ? "Has a picture" : "No picture") },
      sortValue: (c) => (c.imagePath ? 0 : 1),
      resize: false,
    },
    { header: "Category", render: (c) => <span className="font-medium text-navy">{c.name}</span> },
    { header: "Web name", render: (c) => <span className="font-mono text-[12.5px] text-grey">{c.slug}</span> },
    { header: "Print heads", render: (c) => heads(c), sortValue: heads, className: "text-right" },
    { header: "Machines", render: (c) => machines(c), sortValue: machines, className: "text-right" },
    { header: "Order", render: (c) => c.sortOrder, sortValue: (c) => c.sortOrder, className: "text-right" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Category name", type: "text", required: true, placeholder: "Sublimation Printer" },
    { key: "slug", label: "Web name", type: "text", hint: "Used in the website address. Leave blank to make it from the name.", placeholder: "sublimation-printer" },
    { key: "intro", label: "Introduction", type: "textarea", hint: "A short paragraph shown on the category's page" },
    { key: "sortOrder", label: "Order", type: "text", hint: "Lower numbers come first", placeholder: "1" },
    { key: "imagePath", label: "Picture", type: "custom", render: (v, onChange) => <ImageField value={v} onChange={onChange} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Categories" sub="The printer types buyers browse by on the website. Each has print heads under it." />
      {notice && <p className="rounded-lg bg-[#FFF4F4] px-3 py-2 text-[13px] text-ryg-red">{notice}</p>}
      <MasterCrud<Category>
        singular="Category"
        rows={s.categories}
        columns={columns}
        fields={fields}
        searchText={(c) => `${c.name} ${c.slug}`}
        defaultOrder={(c) => c.sortOrder}
        canManage={s.canEdit}
        statusNote="Switching a category off takes it, and every machine in it, off the website. The machines keep their records."
        emptyValues={{ name: "", slug: "", intro: "", sortOrder: "", imagePath: "" }}
        toValues={(c) => ({ name: c.name, slug: c.slug, intro: c.intro ?? "", sortOrder: String(c.sortOrder), imagePath: c.imagePath ?? "" })}
        onSubmit={async (id, v, active) => {
          const slug = slugify(v.slug || v.name);
          if (!slug) throw new Error("The name needs at least one letter or number.");
          if (v.sortOrder && !/^-?\d+$/.test(v.sortOrder.trim())) throw new Error("Order must be a whole number.");
          const before = id ? s.categoryById(id)?.imagePath ?? null : null;
          await saveCategory(id, {
            name: v.name,
            slug,
            intro: v.intro.trim() || null,
            imagePath: v.imagePath || null,
            sortOrder: v.sortOrder.trim() ? Number(v.sortOrder) : 0,
            active,
          });
          if (before && before !== v.imagePath) await removeMedia([before]).catch(() => undefined);
          await s.refresh();
        }}
        onToggleActive={async (c, active) => {
          setNotice(null);
          try {
            await setCategoryActive(c.id, active);
            await s.refresh();
          } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </div>
  );
}
