import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useExitStore } from "../../store";
import { STEPS, isManagerStep, type StepKey } from "../../lib/steps";

/**
 * Step Owners config (admin). Pick one or more Departments, then one or more
 * Employees drawn from them — a step can be co-owned. Every selected employee may
 * action the step and all are notified.
 *
 * ── TWO THINGS THIS SCREEN DOES DIFFERENTLY FROM HR RECRUITMENT ──────────────
 *
 * 1. `resignation` IS SKIPPED ENTIRELY. HR's equivalent (`mrf`) IS assignable — its
 *    owners are the people allowed to raise a requisition. Here EVERYONE may raise
 *    their own exit, so `resignation` must have no owner rows at all: the PII read
 *    gate is fms_exit_is_exit_staff() = "owns any step other than resignation", and
 *    if resigning made you an owner, the gate would be true for the entire company
 *    and hand out every person's salary and exit-interview transcript. The DB CHECKs
 *    the row away; this screen never offers it.
 *
 * 2. The MANAGER steps are shown greyed but NOT exclusive. HR's HOD steps route ONLY
 *    to the hiring manager. Here the case's own reporting manager is added to
 *    whatever owners are set here: asset_return needs an HOD sign AND an HR sign,
 *    handover needs both confirmations — and a manager who never responds must not be
 *    able to wedge the case.
 */
export default function StepOwnersSection() {
  const s = useExitStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Never `resignation` — see the header. It is barred by a DB CHECK, not just here. */
  const assignableSteps = useMemo(() => STEPS.filter((st) => st.key !== "resignation"), []);

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
                <th className="font-medium px-4 py-3 w-10">#</th>
                <th className="font-medium px-4 py-3">Step</th>
                <th className="font-medium px-4 py-3">Owners</th>
                <th className="font-medium px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignableSteps.map((st) => {
                const manager = isManagerStep(st.key);
                const owner = s.stepOwnerFor(st.key);
                const names = (owner?.employeeIds ?? []).map((id) => s.profileById(id)?.name ?? "Unknown");
                return (
                  <tr
                    key={st.key}
                    className={`border-b border-line/70 last:border-0 ${manager ? "bg-page/40" : "hover:bg-page/60"}`}
                  >
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                    <td className="px-4 py-3">
                      {manager ? (
                        <span className="text-grey-2">
                          The exiting employee's own reporting manager
                          {names.length ? <span className="text-navy"> (plus {names.join(", ")})</span> : " (plus any owners set here)"}
                        </span>
                      ) : names.length ? (
                        <span className="text-navy">{names.join(", ")}</span>
                      ) : (
                        <span className="text-grey-2">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => open(st.key)}
                        className="text-[12.5px] font-semibold text-orange hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <p className="text-[12.5px] text-grey-2">
        The greyed-out steps route to the exiting employee's own reporting manager automatically. Unlike the other FMS
        apps, that access is <span className="font-semibold text-navy">additive</span>: anyone you name here co-owns the
        step — asset return needs both an HOD sign and an HR sign, and a manager who never replies must not be able to
        stall the case.
      </p>
      <p className="text-[12.5px] text-grey-2">
        Raising a resignation is not listed, because it is not owned by anybody: every employee may raise their own.
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
          {editing && isManagerStep(editing) && (
            <p className="rounded-xl bg-page px-3 py-2 text-[12px] leading-snug text-grey-2">
              The case's own reporting manager always owns this step. Anyone you add here owns it{" "}
              <span className="font-semibold text-navy">as well</span> — they do not replace the manager.
            </p>
          )}
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
