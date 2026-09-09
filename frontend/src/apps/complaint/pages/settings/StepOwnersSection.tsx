import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useComplaintStore } from "../../store";
import { STEPS, type StepKey } from "../../lib/steps";

/**
 * Step Owners (admin).
 *
 * ⚠ `raise` IS LISTED HERE, unlike every other FMS, and that is the point: it is
 *   how an admin restricts WHO MAY RAISE a complaint. Leave it empty and any user
 *   with an edit grant may raise one — an empty owner list means "anyone", not
 *   "nobody", or a freshly installed module would be unusable on day one.
 *
 * ⚠ THE EMPLOYEES ARE THE AUTHORITY. The department picker only narrows the people
 *   list; the SQL `fms_complaint_is_step_owner` reads `employee_ids` and nothing
 *   else. Saving a department with no employees grants nobody.
 *
 * There is no source split here (contrast Sampling's Domestic/Export): RM and FG
 * complaints run the same steps and the same people handle both.
 */
export default function StepOwnersSection() {
  const s = useComplaintStore();
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  /** Narrowing the departments drops anyone the new filter no longer offers. */
  const changeDepts = (next: string[]) => {
    setDeptIds(next);
    if (next.length === 0) return;
    const chosen = new Set(next);
    const allowed = new Set(
      s.profiles.filter((p) => p.departmentId && chosen.has(p.departmentId)).map((p) => p.id),
    );
    setEmpIds((prev) => prev.filter((id) => allowed.has(id)));
  };

  const open = (stepKey: StepKey) => {
    const cur = s.ownerFor(stepKey);
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
      await s.saveStepOwner({
        stepKey: editing,
        departmentIds: deptIds,
        designationId: null,
        employeeIds: empIds,
      });
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => s.personName(id);

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-4 pb-1">
        <p className="text-[12.5px] text-grey">
          Who is notified and authorized at each step. Leaving <strong>Complaint Raised</strong>{" "}
          unassigned lets anyone with the module raise one.
        </p>
      </div>
      <ScrollableTable>
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-grey-2 border-b border-line">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Step</th>
              <th className="px-4 py-2.5 font-medium">Owners</th>
              <th className="px-4 py-2.5 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map((st) => {
              const owner = s.ownerFor(st.key);
              const ids = owner?.employeeIds ?? [];
              return (
                <tr key={st.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-grey-2">{st.index}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-navy">{st.title}</div>
                    {st.noQueue && (
                      <div className="text-[11px] text-grey-2">
                        Raising is the step — it has no queue
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {ids.length ? (
                      <span className="text-ink">{ids.map(nameOf).join(", ")}</span>
                    ) : (
                      <span className="text-grey-2">
                        {st.key === "raise" ? "Anyone with the module" : "Not assigned"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => open(st.key)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Owners — ${STEPS.find((x) => x.key === editing)?.title}` : ""}
      >
        <div className="space-y-4">
          <FieldLabel label="Departments" hint="narrows the people list only">
            <MultiSelect
              values={deptIds}
              onChange={changeDepts}
              options={deptOptions}
              placeholder="Any department"
            />
          </FieldLabel>
          <FieldLabel label="People" hint="this is what actually grants access">
            <MultiSelect
              values={empIds}
              onChange={setEmpIds}
              options={peopleOptions}
              placeholder="Select people"
            />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
