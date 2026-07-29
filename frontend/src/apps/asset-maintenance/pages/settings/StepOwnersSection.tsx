import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useAssetStore } from "../../store";
import { STEPS, type StepKey } from "../../lib/steps";

/**
 * Who owns each step.
 *
 * ⚠ THIS IS A GO-LIVE STEP, NOT AN OPTION. Until owners are seeded every gate
 *   collapses to "admins only" and the module looks broken to everyone else —
 *   and, worse here than elsewhere, the nightly reminders have nobody to go to
 *   but the asset's custodian.
 *
 * `service_due` may be owned too: leaving it empty lets any granted user add an
 * asset and raise a job by hand; setting owners restricts that to them.
 */
export default function StepOwnersSection() {
  const s = useAssetStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [depts, setDepts] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (key: StepKey) => {
    const cur = s.stepOwnerFor(key);
    setDepts(cur?.departmentIds ?? []);
    setPeople(cur?.employeeIds ?? []);
    setError(null);
    setEditing(key);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      await s.setStepOwner(editing, { departmentIds: depts, designationId: null, employeeIds: people });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally { setBusy(false); }
  };

  const unowned = STEPS.filter((st) => (s.stepOwnerFor(st.key)?.employeeIds.length ?? 0) === 0 && !st.noQueue);

  return (
    <div className="space-y-4">
      {unowned.length > 0 && (
        <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] text-[#946200]">
          <strong>{unowned.length}</strong> queue {unowned.length === 1 ? "step has" : "steps have"} no
          owner, so only admins can action {unowned.length === 1 ? "it" : "them"} and reminders reach
          nobody but the custodian. Set owners before going live.
        </p>
      )}

      <Card className="p-5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Step</th>
              <th className="py-2 pr-3">Owners</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map((st) => {
              const names = s.ownerNamesFor(st.key);
              return (
                <tr key={st.key} className="border-b border-line/70">
                  <td className="py-2 pr-3">
                    {s.isAdmin && (
                      <button className="text-[12.5px] font-semibold text-orange hover:underline"
                        onClick={() => open(st.key)}>
                        Edit
                      </button>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-grey-2">{st.index}</td>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-navy">{st.title}</span>
                    {st.noQueue && (
                      <span className="ml-2 text-[11.5px] text-grey-2">
                        origin — leave empty to let anyone add assets
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-grey">
                    {names.length ? names.join(", ") : <span className="text-[#946200]">Not set</span>}
                  </td>
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
        title={editing ? `Owners — ${STEPS.find((x) => x.key === editing)?.title}` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save owners"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldLabel
            label="Departments"
            hint="Recorded for reference and shown on the job's progress rail. Authorisation comes SOLELY from the people below — fms_asset_is_step_owner reads employee_ids and nothing else."
          >
            <MultiSelect
              values={depts}
              onChange={setDepts}
              options={s.departments.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="All departments"
              searchable
            />
          </FieldLabel>
          <FieldLabel label="People" hint="These are the owners: they can action the step and they get its alerts.">
            <MultiSelect
              values={people}
              onChange={setPeople}
              options={s.people.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Select people…"
              searchable
            />
          </FieldLabel>
          {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}
