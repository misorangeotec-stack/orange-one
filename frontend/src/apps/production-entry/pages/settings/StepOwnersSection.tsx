import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useProductionStore } from "../../store";
import { STEPS, type StepKey } from "../../lib/steps";

/**
 * Step Owners (admin). `issue_slip` is never owned — every granted user may raise a
 * job card, so it is barred (CHECK constraint) and absent here. Every other step's
 * owners are the notified / authorized actors for that step.
 */
export default function StepOwnersSection() {
  const s = useProductionStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assignableSteps = useMemo(() => STEPS.filter((st) => st.key !== "issue_slip"), []);

  const deptOptions: MultiOption[] = useMemo(
    () => s.orgDepartments.map((d) => ({ value: d.id, label: d.name })),
    [s.orgDepartments],
  );

  const peopleOptions: MultiOption[] = useMemo(() => {
    const chosen = new Set(deptIds);
    return [...s.profiles]
      .filter((p) => chosen.size === 0 || (p.departmentId && chosen.has(p.departmentId)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));
  }, [s.profiles, deptIds]);

  const changeDepts = (next: string[]) => {
    setDeptIds(next);
    if (next.length === 0) return;
    const chosen = new Set(next);
    const allowed = new Set(s.profiles.filter((p) => p.departmentId && chosen.has(p.departmentId)).map((p) => p.id));
    setEmpIds((prev) => prev.filter((id) => allowed.has(id)));
  };

  const open = (stepKey: StepKey) => {
    const cur = s.stepOwnerFor(stepKey);
    setDeptIds(cur?.departmentIds ?? []);
    setEmpIds(cur?.employeeIds ?? []);
    setErr(null);
    setEditing(stepKey);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setStepOwner(editing, { departmentIds: deptIds, designationId: null, employeeIds: empIds });
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editingStep = STEPS.find((st) => st.key === editing);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-grey-2 border-b border-line">
                <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
                <th className="font-medium px-4 py-3 w-10">#</th>
                <th className="font-medium px-4 py-3">Step</th>
                <th className="font-medium px-4 py-3">Owners</th>
              </tr>
            </thead>
            <tbody>
              {assignableSteps.map((st) => {
                const owner = s.stepOwnerFor(st.key);
                const names = (owner?.employeeIds ?? []).map((id) => s.profileById(id)?.name ?? "Unknown");
                return (
                  <tr key={st.key} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button onClick={() => open(st.key)} className="text-[12.5px] font-semibold text-orange hover:underline">Edit</button>
                    </td>
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                    <td className="px-4 py-3">
                      {names.length ? <span className="text-navy">{names.join(", ")}</span> : <span className="text-grey-2">Unassigned</span>}
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
        title={`Owners — ${editingStep?.title ?? ""}`}
        subtitle="Pick a department, then every employee who owns this step. All of them can action it and are notified."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <FieldLabel label="Departments" hint="filter only">
            <MultiSelect values={deptIds} onChange={changeDepts} options={deptOptions} placeholder="All departments" />
          </FieldLabel>
          <FieldLabel label="Employees" hint="select one or more">
            <MultiSelect values={empIds} onChange={setEmpIds} options={peopleOptions} placeholder="Select owners" />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
