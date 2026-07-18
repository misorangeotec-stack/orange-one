import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useSuppliesStore } from "../../store";
import { STEPS, type StepKey } from "../../lib/steps";

/**
 * Step Owners (admin). Two steps are deliberately absent:
 *   `request`        — every employee may raise one, so it is never owned.
 *   `first_approval` — belongs to the request's department HOD and ONLY to them
 *                      (fms_supplies_departments.hod_user_id, set in Masters).
 *                      It used to be listed here as an "additive fallback", but a
 *                      name in that list could read EVERY request in EVERY
 *                      department — which is exactly how one department's HOD
 *                      ended up seeing another's requests. The list is gone.
 */
export default function StepOwnersSection() {
  const s = useSuppliesStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const assignableSteps = useMemo(
    () => STEPS.filter((st) => st.key !== "request" && st.key !== "first_approval"),
    [],
  );

  const deptsWithoutHod = useMemo(
    () => s.activeDepartments.filter((d) => !d.hodUserId),
    [s.activeDepartments],
  );

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
  const hint = (key: StepKey) =>
    key === "second_approval" ? "The Management approvers." : "The fulfilment / handover team.";

  return (
    <div className="space-y-3">
      <Card className="px-4 py-3">
        <p className="text-[13px] text-navy font-medium">First Approval is the department&apos;s HOD</p>
        <p className="text-[12.5px] text-grey-2 mt-0.5">
          It is not assigned here. Each request goes to the HOD of the requester&apos;s own department, and to
          nobody else — set that in <span className="font-medium text-navy">Masters → Departments</span>.
        </p>
        {deptsWithoutHod.length > 0 && (
          <p className="text-[12.5px] text-ryg-red mt-1.5">
            No HOD set for: {deptsWithoutHod.map((d) => d.name).join(", ")}. Requests needing approval cannot be
            raised for {deptsWithoutHod.length === 1 ? "it" : "them"} until one is chosen.
          </p>
        )}
      </Card>

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
                      <button onClick={() => open(st.key)} className="text-[12.5px] font-semibold text-orange hover:underline">
                        Edit
                      </button>
                    </td>
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">
                      {st.title}
                      <div className="text-[11px] font-normal text-grey-2">{hint(st.key)}</div>
                    </td>
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
