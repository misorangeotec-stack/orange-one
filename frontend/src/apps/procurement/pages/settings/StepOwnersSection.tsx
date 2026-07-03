import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useProcurementStore } from "../../store";
import { STEPS, type StepKey } from "../../lib/steps";

/**
 * Step Owners config (admin). Assign the responsible Department / Designation /
 * Employees for each of the 10 workflow steps. Owners are the people authorized
 * to action that stage and who get notified when work reaches it.
 */
export default function StepOwnersSection() {
  const s = useProcurementStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptId, setDeptId] = useState("");
  const [desigId, setDesigId] = useState("");
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deptOptions: ComboOption[] = useMemo(
    () => [{ value: "", label: "— None —" }, ...s.departments.map((d) => ({ value: d.id, label: d.name }))],
    [s.departments]
  );
  const desigOptions: ComboOption[] = useMemo(
    () => [{ value: "", label: "— None —" }, ...s.activeDesignations.map((d) => ({ value: d.id, label: d.name }))],
    [s.activeDesignations]
  );
  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles]
  );

  const open = (stepKey: StepKey) => {
    const cur = s.stepOwnerFor(stepKey);
    setDeptId(cur?.departmentId ?? "");
    setDesigId(cur?.designationId ?? "");
    setEmpIds(cur?.employeeIds ?? []);
    setErr(null);
    setEditing(stepKey);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setStepOwner(editing, {
        departmentId: deptId || null,
        designationId: desigId || null,
        employeeIds: empIds,
      });
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editingStep = STEPS.find((st) => st.key === editing);

  return (
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
            {STEPS.map((st) => {
              const owner = s.stepOwnerFor(st.key);
              const names = (owner?.employeeIds ?? []).map((id) => s.profileById(id)?.name ?? "Unknown");
              return (
                <tr key={st.key} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                  <td className="px-4 py-3 text-grey-2">{st.index}</td>
                  <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                  <td className="px-4 py-3">
                    {names.length ? (
                      <span className="text-navy">{names.join(", ")}</span>
                    ) : (
                      <span className="text-grey-2">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => open(st.key)} className="text-[12.5px] font-semibold text-orange hover:underline">
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${editingStep?.title ?? ""}`}
        subtitle="Who is responsible for this step. Listed employees can action it and are notified."
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
          <FieldLabel label="Department">
            <Combobox value={deptId} onChange={setDeptId} options={deptOptions} placeholder="— None —" autoAdvance />
          </FieldLabel>
          <FieldLabel label="Designation">
            <Combobox value={desigId} onChange={setDesigId} options={desigOptions} placeholder="— None —" autoAdvance />
          </FieldLabel>
          <FieldLabel label="Employees">
            <MultiSelect values={empIds} onChange={setEmpIds} options={peopleOptions} placeholder="Select owners" />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </Card>
  );
}
