import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useExitStore } from "../../store";
import { EXIT_MASTER_TYPES, type ExitMasterType } from "../../types";

/**
 * Master Owners (admin only) — who may open each HR Exit master. An owner can CRUD that
 * master and resolve its new-entry requests; a request for a master with no owner
 * assigned falls back to the admins, so nothing black-holes. Writes REPLACE the whole
 * set for a type (delete-then-insert), so removing someone actually removes them.
 *
 * ⭐ ALL FIVE MASTERS ARE OWNABLE — including the Clearance Checklist. Only FOUR are
 *    REQUESTABLE, and the checklist is the one that is not: it feeds no dropdown (it is
 *    seeded server-side onto each case at LWD confirmation) and is keyed on a slug rather
 *    than a name, so there is no "it's missing from this list" moment to serve. Its owner
 *    simply edits it on the Masters page. The database says exactly this: the CHECK on
 *    fms_exit_master_managers lists five types, the one on fms_exit_master_requests lists
 *    four. The table below spells the difference out rather than leaving it a surprise.
 */
export default function MasterOwnersSection() {
  const s = useExitStore();
  const [editing, setEditing] = useState<ExitMasterType | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const open = (mt: ExitMasterType) => {
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
          Each master's owner reviews the "request a new entry" submissions raised from the exit forms — they can approve
          (adjusting the details first), or reject with a reason. Leave a master unassigned and its requests go to the
          admins. The <span className="font-semibold text-navy">Clearance Checklist</span> can be owned too, but it feeds
          no dropdown, so it is never requested — its owner just edits it on the Masters page.
        </p>
      </div>
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-left text-grey-2 border-b border-line">
            <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
            <th className="font-medium px-4 py-3">Master</th>
            <th className="font-medium px-4 py-3">Owners</th>
            <th className="font-medium px-4 py-3">Requestable</th>
            <th className="font-medium px-4 py-3">Pending requests</th>
          </tr>
        </thead>
        <tbody>
          {EXIT_MASTER_TYPES.map((mt) => {
            const ids = s.managerIdsFor(mt.value);
            const names = ids.map((id) => s.profileById(id)?.name ?? "Unknown");
            const pending = s.pendingRequests.filter((r) => r.masterType === mt.value).length;
            const requestable = mt.value !== "clearance_item";
            return (
              <tr key={mt.value} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                <td className="px-4 py-3 whitespace-nowrap">
                  <button
                    onClick={() => open(mt.value)}
                    className="text-[12.5px] font-semibold text-orange hover:underline"
                  >
                    Edit
                  </button>
                </td>
                <td className="px-4 py-3 font-medium text-navy">{mt.plural}</td>
                <td className="px-4 py-3">
                  {names.length ? (
                    <span className="text-navy">{names.join(", ")}</span>
                  ) : (
                    <span className="text-grey-2">Unassigned — requests fall back to the admins</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {requestable ? (
                    <span className="text-navy">Yes</span>
                  ) : (
                    <span className="text-grey-2">No — edited on the Masters page</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {pending ? (
                    <span className="text-orange font-semibold">{pending}</span>
                  ) : (
                    <span className="text-grey-2">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${EXIT_MASTER_TYPES.find((m) => m.value === editing)?.plural ?? ""}`}
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
