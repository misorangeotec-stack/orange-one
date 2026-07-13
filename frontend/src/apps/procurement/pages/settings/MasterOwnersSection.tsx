import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useProcurementStore } from "../../store";
import { MASTER_TYPES, type MasterType } from "../../types";

/**
 * Master Owners (admin only) — who may open each master. An owner can CRUD that
 * master and resolve its new-entry requests; a request with no owner assigned
 * falls back to the admins. Writes replace the whole set for a type.
 */
export default function MasterOwnersSection() {
  const s = useProcurementStore();
  const [editing, setEditing] = useState<MasterType | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles]
  );

  const open = (mt: MasterType) => {
    setPicked(s.managerIdsFor(mt));
    setErr(null);
    setEditing(mt);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setMasterManagers(editing, picked);
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <p className="text-[12.5px] text-grey">
          Each master's owner reviews the "request a new entry" submissions raised from the forms — they can approve
          (adjusting the details first), or reject with a reason. Leave a master unassigned and its requests go to the
          admins.
        </p>
      </div>
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="font-medium px-4 py-3">Master</th>
            <th className="font-medium px-4 py-3">Owners</th>
            <th className="font-medium px-4 py-3">Pending requests</th>
            <th className="font-medium px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {MASTER_TYPES.map((mt) => {
            const ids = s.managerIdsFor(mt.value);
            const names = ids.map((id) => s.profileById(id)?.name ?? "Unknown");
            const pending = s.pendingRequests.filter((r) => r.masterType === mt.value).length;
            return (
              <tr key={mt.value} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                <td className="px-4 py-3 font-medium text-navy">{mt.plural}</td>
                <td className="px-4 py-3">
                  {names.length ? (
                    <span className="text-navy">{names.join(", ")}</span>
                  ) : (
                    <span className="text-grey-2">Unassigned — requests fall back to the admins</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {pending ? <span className="text-orange font-semibold">{pending}</span> : <span className="text-grey-2">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => open(mt.value)} className="text-[12.5px] font-semibold text-orange hover:underline">
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${MASTER_TYPES.find((m) => m.value === editing)?.plural ?? ""}`}
        subtitle="They can add/edit this master and approve new-entry requests for it."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <MultiSelect values={picked} onChange={setPicked} options={peopleOptions} placeholder="Select owners" />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </Card>
  );
}
