import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useDirectory } from "@/core/platform/store";
import { cn } from "@/shared/lib/cn";
import { PURCHASE_STAGES } from "../../config/stages";
import { useFmsStore } from "../../mock/store";
import { ownerNames } from "../../lib/owner";

/**
 * One-off setup: map each of the 9 pipeline steps to its Department, Designation
 * and the specific Employee(s) who own it. The assigned employees are notified
 * when an entry reaches their step. Seeded from the source sheet's named people.
 */
export default function WorkflowSetup() {
  const { profiles, departments, profileById, departmentById } = useDirectory();
  const { stepOwners, designations, ownerForStep, updateStepOwner } = useFmsStore();

  const [editKey, setEditKey] = useState<string | null>(null);
  const [deptId, setDeptId] = useState("");
  const [desigId, setDesigId] = useState("");
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openEdit = (stepKey: string) => {
    const owner = ownerForStep(stepKey);
    setErr(null);
    setEditKey(stepKey);
    setDeptId(owner?.departmentId ?? "");
    setDesigId(owner?.designationId ?? "");
    setEmpIds(owner?.employeeIds ?? []);
  };

  const candidates = deptId ? profiles.filter((p) => p.departmentId === deptId) : profiles;
  const toggleEmp = (id: string) => setEmpIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    if (!editKey) return;
    setBusy(true);
    setErr(null);
    try {
      await updateStepOwner(editKey, {
        departmentId: deptId || null,
        designationId: desigId || null,
        employeeIds: empIds,
        employeeNames: empIds.map((id) => profileById(id)?.name).filter((n): n is string => !!n),
      });
      setEditKey(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the step owner.");
    } finally {
      setBusy(false);
    }
  };

  const editingStage = PURCHASE_STAGES.find((s) => s.key === editKey);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-grey">
        Map each step to its owner(s). When an entry reaches a step, its assigned employees are notified and it appears in their queue.
        This is a one-time setup — revisit only when responsibilities change.
      </p>

      <div className="space-y-2.5">
        {PURCHASE_STAGES.map((s) => {
          const owner = ownerForStep(s.key);
          const names = ownerNames(owner, profileById);
          const dept = departmentById(owner?.departmentId ?? null)?.name;
          const desig = designations.find((d) => d.id === owner?.designationId)?.name;
          return (
            <Card key={s.key} className="p-4 flex flex-wrap items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-page text-navy text-[12.5px] font-bold flex items-center justify-center shrink-0">{s.index}</span>
              <div className="min-w-[180px] flex-1">
                <div className="text-[14px] font-semibold text-navy">{s.title}</div>
                <div className="text-[11.5px] text-grey-2">{s.how} · {s.when}</div>
              </div>
              <div className="min-w-[200px] text-[12.5px]">
                <div className="text-navy font-medium">{names.length ? names.join(", ") : "Unassigned"}</div>
                <div className="text-[11.5px] text-grey-2">
                  {[dept, desig].filter(Boolean).join(" · ") || "No department / designation set"}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => openEdit(s.key)}>Edit</Button>
            </Card>
          );
        })}
      </div>

      <Modal
        open={!!editKey}
        onClose={() => setEditKey(null)}
        title={editingStage ? `Owner — ${editingStage.title}` : "Edit owner"}
        subtitle="Set the department, designation and the specific people who own this step."
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditKey(null)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldLabel label="Department">
              <Combobox
                value={deptId}
                onChange={setDeptId}
                placeholder="— None —"
                options={[{ value: "", label: "— None —" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
              />
            </FieldLabel>
            <FieldLabel label="Designation">
              <Combobox
                value={desigId}
                onChange={setDesigId}
                placeholder="— None —"
                options={[{ value: "", label: "— None —" }, ...designations.map((d) => ({ value: d.id, label: d.name }))]}
              />
            </FieldLabel>
          </div>

          <div>
            <span className="block text-[13px] font-medium text-navy mb-2">Employees {deptId && <span className="text-grey-2 font-normal">(in selected department)</span>}</span>
            {candidates.length === 0 ? (
              <p className="text-[12.5px] text-grey-2">No matching employees in the directory.</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
                {candidates.map((p) => {
                  const on = empIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleEmp(p.id)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[12.5px] transition",
                        on ? "border-orange bg-orange-soft text-orange font-semibold" : "border-line text-navy hover:border-[#d9e2f0]"
                      )}
                    >
                      <Avatar name={p.name} color={p.avatarColor} size={20} />
                      {p.name}
                      {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11.5px] text-grey-2 mt-2">
              Tip: the original sheet named {editingStage?.defaultOwner}. Pick the matching directory user(s) here.
            </p>
          </div>
          {err && <p className="text-[12.5px] text-ryg-red font-medium">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
