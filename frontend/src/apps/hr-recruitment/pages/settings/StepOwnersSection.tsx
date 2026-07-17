import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useHrStore } from "../../store";
import { STEPS, isHodStep, type StepKey } from "../../lib/steps";

/**
 * Step Owners config (admin). Pick one or more Departments, then one or more
 * Employees drawn from them — a step can be co-owned. Every selected employee may
 * action the step and all are notified.
 *
 * The five HOD steps are shown but NOT assignable: they are owned per-requisition
 * by whoever raised the MRF, so a Sachin Plant vacancy is shortlisted and reviewed
 * by the Sachin Plant head automatically. Assigning them globally here would send
 * every department's candidates to one person, which is exactly the bug this
 * design avoids.
 */
export default function StepOwnersSection() {
  const s = useHrStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deptOptions: MultiOption[] = useMemo(
    () => s.departments.map((d) => ({ value: d.id, label: d.name })),
    [s.departments],
  );

  /** Employees in ANY chosen department (all of them when none is chosen). */
  const peopleOptions: MultiOption[] = useMemo(() => {
    const chosen = new Set(deptIds);
    return [...s.profiles]
      .filter((p) => chosen.size === 0 || (p.departmentId && chosen.has(p.departmentId)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));
  }, [s.profiles, deptIds]);

  /** Narrowing the departments drops any picked employee who is no longer offered. */
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
      // Designation is derived from each employee, never chosen for the step.
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
              {STEPS.map((st) => {
                const hod = isHodStep(st.key);
                const owner = s.stepOwnerFor(st.key);
                const names = (owner?.employeeIds ?? []).map((id) => s.profileById(id)?.name ?? "Unknown");
                return (
                  <tr
                    key={st.key}
                    className={`border-b border-line/70 last:border-0 ${hod ? "bg-page/40" : "hover:bg-page/60"}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {hod ? (
                        <span className="text-[12px] text-grey-2">Automatic</span>
                      ) : (
                        <button
                          onClick={() => open(st.key)}
                          className="text-[12.5px] font-semibold text-orange hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                    <td className="px-4 py-3">
                      {hod ? (
                        <span className="text-grey-2">
                          The hiring manager who raised the requisition
                        </span>
                      ) : names.length ? (
                        <span className="text-navy">{names.join(", ")}</span>
                      ) : (
                        <span className="text-grey-2">Unassigned</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <p className="text-[12.5px] text-grey-2">
        The greyed-out steps follow the requisition automatically — whoever raises an MRF shortlists its CVs, takes
        Interview Round&nbsp;2, and does that hire's monthly reviews. No setup needed.
      </p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${editingStep?.title ?? ""}`}
        subtitle="Pick a department, then every employee who owns this step. All of them can action it and are notified."
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
        <div className="space-y-3.5">
          <FieldLabel label="Departments" hint="select one or more">
            <MultiSelect values={deptIds} onChange={changeDepts} options={deptOptions} placeholder="All departments" />
            <span className="mt-1 block text-[11px] leading-snug text-grey-2">
              Filters the employees below. Pick several to co-own a step across departments; leave empty for all.
            </span>
          </FieldLabel>
          <FieldLabel label="Employees" hint="select one or more">
            <MultiSelect values={empIds} onChange={setEmpIds} options={peopleOptions} placeholder="Select owners" />
            <span className="mt-1 block text-[11px] leading-snug text-grey-2">
              {peopleOptions.length === 0
                ? "No employees are mapped to the selected department(s)."
                : `${empIds.length} of ${peopleOptions.length} selected · every owner can action this step.`}
            </span>
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
