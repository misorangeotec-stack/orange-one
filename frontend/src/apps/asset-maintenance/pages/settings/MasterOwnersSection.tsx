import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useAssetStore } from "../../store";
import { ASSET_MASTER_TYPES, REQUESTABLE_ASSET_MASTER_TYPES, type AssetMasterType } from "../../types";

/**
 * Who may edit each master and resolve its new-entry requests.
 *
 * A master with no owner falls to admins — never to nobody. That is why the
 * "Unassigned" note is informational rather than a warning: it is a working state,
 * just a narrower one.
 */
export default function MasterOwnersSection() {
  const s = useAssetStore();
  const [editing, setEditing] = useState<AssetMasterType | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestable = new Set(REQUESTABLE_ASSET_MASTER_TYPES.map((m) => m.value));

  const open = (mt: AssetMasterType) => {
    setPicked(s.managerIdsFor(mt));
    setError(null);
    setEditing(mt);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      await s.setMasterManagers(editing, picked);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card className="p-5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Master</th>
              <th className="py-2 pr-3">Owners</th>
              <th className="py-2 pr-3">Requestable</th>
            </tr>
          </thead>
          <tbody>
            {ASSET_MASTER_TYPES.map((m) => {
              const ids = s.managerIdsFor(m.value);
              return (
                <tr key={m.value} className="border-b border-line/70">
                  <td className="py-2 pr-3">
                    {s.isAdmin && (
                      <button className="text-[12.5px] font-semibold text-orange hover:underline"
                        onClick={() => open(m.value)}>
                        Edit
                      </button>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-semibold text-navy">{m.plural}</td>
                  <td className="py-2 pr-3 text-grey">
                    {ids.length
                      ? ids.map((id) => s.personName(id)).join(", ")
                      : <span className="text-grey-2">Unassigned — admins only</span>}
                  </td>
                  <td className="py-2 pr-3 text-grey-2">{requestable.has(m.value) ? "Yes" : "No"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!s.isAdmin && <p className="mt-3 text-[12.5px] text-grey-2">Admins only.</p>}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Owners — ${ASSET_MASTER_TYPES.find((m) => m.value === editing)?.plural}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save owners"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldLabel label="People" hint="They can add and edit this master, and approve requests for it.">
            <MultiSelect
              values={picked}
              onChange={setPicked}
              options={s.people.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Select people…"
              searchable
            />
          </FieldLabel>
          {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
