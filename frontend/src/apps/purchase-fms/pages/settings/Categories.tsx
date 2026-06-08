import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useFmsStore } from "../../mock/store";

/**
 * Category ↔ unit master (mock in Phase 1). Selecting a category on the New Order
 * form auto-fills its unit. From the source sheet's "Validation" tab.
 */
export default function Categories() {
  const { categories, addCategory, updateCategory, deleteCategory } = useFmsStore();
  const [edit, setEdit] = useState<{ id: string | null } | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (id: string | null, n = "", u = "") => { setErr(null); setEdit({ id }); setName(n); setUnit(u); };
  const save = async () => {
    if (!name.trim() || !unit.trim() || !edit) return;
    setBusy(true);
    setErr(null);
    try {
      if (edit.id) await updateCategory(edit.id, { name, unit });
      else await addCategory({ name, unit });
      setEdit(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the category.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setErr(null);
    try {
      await deleteCategory(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the category.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-grey">Purchase categories and the unit each one drives.</p>
        <Button size="sm" onClick={() => open(null)}>+ Add category</Button>
      </div>

      {err && !edit && <p className="text-[12.5px] text-ryg-red font-medium">{err}</p>}

      <Card className="overflow-hidden">
        {categories.length === 0 ? (
          <EmptyState title="No categories yet" message="Add the categories orders can be raised under." actionLabel="+ Add category" onAction={() => open(null)} />
        ) : (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-wide text-grey-2 border-b border-line">
                <th className="px-4 py-2.5 font-semibold">Category</th>
                <th className="px-4 py-2.5 font-semibold">Unit</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-navy font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-grey">{c.unit}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => open(c.id, c.name, c.unit)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-ryg-red" onClick={() => remove(c.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit category" : "Add category"}
        footer={<><Button variant="ghost" size="sm" onClick={() => setEdit(null)}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></>}
      >
        <div className="space-y-4">
          <FieldLabel label="Category name" required>
            <TextInput value={name} placeholder="e.g. RAW MATERIAL" autoFocus onChange={(e) => setName(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Unit" required>
            <TextInput value={unit} placeholder="e.g. KGS" onChange={(e) => setUnit(e.target.value)} />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red font-medium">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
