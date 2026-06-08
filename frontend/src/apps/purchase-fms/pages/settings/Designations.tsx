import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useFmsStore } from "../../mock/store";

/**
 * Designation master (mock in Phase 1; a Supabase table in Phase 2). Used by the
 * Workflow Setup screen to tag each step's owning role.
 */
export default function Designations() {
  const { designations, addDesignation, updateDesignation, deleteDesignation } = useFmsStore();
  const [edit, setEdit] = useState<{ id: string | null } | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (id: string | null, current = "") => { setErr(null); setEdit({ id }); setName(current); };
  const save = async () => {
    if (!name.trim() || !edit) return;
    setBusy(true);
    setErr(null);
    try {
      if (edit.id) await updateDesignation(edit.id, name);
      else await addDesignation(name);
      setEdit(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the designation.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setErr(null);
    try {
      await deleteDesignation(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the designation.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-grey">Job designations available across the workflow setup.</p>
        <Button size="sm" onClick={() => open(null)}>+ Add designation</Button>
      </div>

      {err && !edit && <p className="text-[12.5px] text-ryg-red font-medium">{err}</p>}

      <Card className="overflow-hidden">
        {designations.length === 0 ? (
          <EmptyState title="No designations yet" message="Add the roles your workflow steps map to." actionLabel="+ Add designation" onAction={() => open(null)} />
        ) : (
          <ul className="divide-y divide-line">
            {designations.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-[13.5px] text-navy font-medium">{d.name}</span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => open(d.id, d.name)}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-ryg-red" onClick={() => remove(d.id)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? "Edit designation" : "Add designation"}
        footer={<><Button variant="ghost" size="sm" onClick={() => setEdit(null)}>Cancel</Button><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></>}
      >
        <FieldLabel label="Designation name" required>
          <TextInput value={name} placeholder="e.g. Purchase Manager" autoFocus onChange={(e) => setName(e.target.value)} />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red font-medium mt-3">{err}</p>}
      </Modal>
    </div>
  );
}
