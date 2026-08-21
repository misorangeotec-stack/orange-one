import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../../store";
import {
  DISPATCH_MASTER_TYPES, isDirectMaster, REQUESTABLE_DISPATCH_MASTER_TYPES,
  type DispatchMasterType,
} from "../../types";

/**
 * HOW EACH MASTER IS RAISED — three answers, not a yes/no.
 *
 * ⚠ A boolean here started LYING the moment the mapping went direct (OD-9). It
 *   read REQUESTABLE_DISPATCH_MASTER_TYPES, so removing the mapping from that
 *   list would print "—" against a master whose owners are still named right
 *   next to it and still notified every time somebody maps something. Both
 *   halves would be true and the row would still be wrong.
 */
const raisedAs = (mt: DispatchMasterType): string =>
  isDirectMaster(mt) ? "Direct"
  : REQUESTABLE_DISPATCH_MASTER_TYPES.some((m) => m.value === mt) ? "Request"
  : "Tally only";

/**
 * Master Owners (admin).
 *
 * ⭐ ALL FIVE MASTERS ARE OWNABLE — an owner may CRUD that master and resolve its
 *    new-entry requests. But how a master is RAISED now varies, which is what
 *    the last column says (see `raisedAs`):
 *
 *      · Request — company location. Goes to the owner named here, as before.
 *      · Direct — the customer↔item mapping. The person raising the order makes
 *        it themselves (OD-9). The owner still matters: they are told each time,
 *        and they are still who maintains the master. There is just nothing to
 *        approve.
 *      · Tally only — company, customer, item. Created in Tally and synced in;
 *        nothing here can raise one (OD-2).
 *
 * A master with no owner falls back to admins — never to nobody.
 */
export default function MasterOwnersSection() {
  const s = useDispatchStore();
  const [editing, setEditing] = useState<DispatchMasterType | null>(null);
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

  const open = (mt: DispatchMasterType) => {
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

  const editingLabel = DISPATCH_MASTER_TYPES.find((m) => m.value === editing)?.plural ?? "";

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey max-w-2xl">
        Who may edit each master and approve requests for new entries. A master with no owner falls back to admins.
      </p>
      <Card className="overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line">
                <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
                <th className="font-medium px-4 py-3">Master</th>
                <th className="font-medium px-4 py-3">Owners</th>
                <th className="font-medium px-4 py-3 w-px whitespace-nowrap">How it&rsquo;s raised</th>
              </tr>
            </thead>
            <tbody>
              {DISPATCH_MASTER_TYPES.map((m) => {
                const names = s.managerIdsFor(m.value).map((id) => s.personName(id));
                return (
                  <tr key={m.value} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => open(m.value)}
                        className="text-[12.5px] font-semibold text-orange hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{m.plural}</td>
                    <td className="px-4 py-3">
                      {names.length ? (
                        <span className="text-navy">{names.join(", ")}</span>
                      ) : (
                        <span className="text-grey-2">Admins only</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-grey-2 whitespace-nowrap">
                      {raisedAs(m.value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${editingLabel}`}
        subtitle="They can edit this master and approve requests for new entries."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <MultiSelect values={picked} onChange={setPicked} options={peopleOptions} placeholder="Select owners" />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
