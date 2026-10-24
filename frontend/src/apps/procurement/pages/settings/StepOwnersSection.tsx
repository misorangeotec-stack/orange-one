import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { FitCell } from "@/shared/components/ui/ColumnResizer";
import { FIT } from "@/shared/lib/tableLook";
import { useColumnWidths } from "@/shared/lib/useColumnWidths";
import { OwnerCompanyScopeFields, ownerNamesWithScope, pruneScope, type ScopeCompany } from "@/shared/components/ui/OwnerCompanyScope";
import type { OwnerCompanyScope } from "@/shared/lib/fmsOwners";
import { useProcurementStore } from "../../store";
import type { StepOwner } from "../../types";
import { STEPS, type StepKey } from "../../lib/steps";

/**
 * Step Owners config (admin). Pick one or more Departments, then one or more
 * Employees drawn from them — a step can be co-owned across departments. Every
 * selected employee may action the step and all are notified. Designation is not
 * chosen here; it follows from the employee and is shown beside their name.
 *
 * Each owner can be limited to some companies (like O2D's per-location owners):
 * Bharat Singh → Enterprise, Gorakh Pawar → O-tec. They stay owners of the step;
 * they just get dues only for their companies' requisitions and POs.
 */
export default function StepOwnersSection() {
  const s = useProcurementStore();
  /** PF-20: one line per row, a long owner list cut and whole on hover. A settings matrix: no drag. */
  const fit = useColumnWidths("tb", ["step", "owners"]);
  const [editing, setEditing] = useState<StepKey | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [scope, setScope] = useState<OwnerCompanyScope>({});
  const [catScope, setCatScope] = useState<OwnerCompanyScope>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scopeCompanies: ScopeCompany[] = useMemo(
    () => s.companies.filter((c) => c.active).map((c) => ({ id: c.id, label: s.companyLabel(c.id) })),
    [s]
  );
  /** Purchase Domestic only: an owner can also be limited to some categories (Neha → expense heads). */
  const scopeCategories: ScopeCompany[] = useMemo(
    () => s.categories.filter((c) => c.active).map((c) => ({ id: c.id, label: c.name })),
    [s.categories]
  );
  const personName = (id: string) => s.profileById(id)?.name ?? "Unknown";
  /** "Neha (Enterprise Surat · FIXED ASSET, OTHER PURCHASE)" — both scopes in one cell. */
  const ownerLabel = (owner: StepOwner | undefined) => {
    const ids = owner?.employeeIds ?? [];
    const byCompany = ownerNamesWithScope(ids, owner?.companyScope, () => "", scopeCompanies);
    const byCategory = ownerNamesWithScope(ids, owner?.categoryScope, () => "", scopeCategories);
    return ids.map((id, i) => {
      const parts = [byCompany[i], byCategory[i]].map((t) => t.replace(/^ \((.*)\)$/, "$1")).filter(Boolean);
      return parts.length ? `${personName(id)} (${parts.join(" · ")})` : personName(id);
    });
  };

  const deptOptions: MultiOption[] = useMemo(
    () => s.departments.map((d) => ({ value: d.id, label: d.name })),
    [s.departments]
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
    if (next.length === 0) return; // no filter — every employee stays selectable
    const chosen = new Set(next);
    const allowed = new Set(s.profiles.filter((p) => p.departmentId && chosen.has(p.departmentId)).map((p) => p.id));
    setEmpIds((prev) => prev.filter((id) => allowed.has(id)));
  };

  const open = (stepKey: StepKey) => {
    const cur = s.stepOwnerFor(stepKey);
    setDeptIds(cur?.departmentIds ?? []);
    setEmpIds(cur?.employeeIds ?? []);
    setScope(s.ownerCompanyScopes[stepKey] ?? {});
    setCatScope(s.ownerCategoryScopes[stepKey] ?? {});
    setErr(null);
    setEditing(stepKey);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setStepOwner(editing, {
        departmentIds: deptIds,
        // Designation is derived from each employee, never chosen for the step.
        designationId: null,
        employeeIds: empIds,
      });
      await s.setOwnerCompanyScope(editing, pruneScope(scope, empIds));
      await s.setOwnerCategoryScope(editing, pruneScope(catScope, empIds));
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
              <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
              <th className="font-medium px-4 py-3 w-10">#</th>
              <th className="font-medium px-4 py-3">Step</th>
              <th className="font-medium px-4 py-3">Owners</th>
            </tr>
          </thead>
          <tbody {...fit.tbodyProps}>
            {STEPS.map((st) => {
              const owner = s.stepOwnerFor(st.key);
              const names = ownerLabel(owner);
              return (
                <tr key={st.key} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button onClick={() => open(st.key)} className="text-[12.5px] font-semibold text-orange hover:underline">
                      Edit
                    </button>
                  </td>
                  <td className="px-4 py-3 text-grey-2">{st.index}</td>
                  <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                  <td className="px-4 py-3">
                    <FitCell fit={fit} col="owners" cap={FIT.CUT}>
                      {names.length ? (
                        <span className="text-navy">{names.join(", ")}</span>
                      ) : (
                        <span className="text-grey-2">Unassigned</span>
                      )}
                    </FitCell>
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
          <OwnerCompanyScopeFields
            employeeIds={empIds}
            personName={personName}
            companies={scopeCompanies}
            value={scope}
            onChange={setScope}
          />
          <OwnerCompanyScopeFields
            employeeIds={empIds}
            personName={personName}
            companies={scopeCategories}
            value={catScope}
            onChange={setCatScope}
            label="Categories"
            allLabel="All categories"
            note="Combined with Companies: e.g. Neha → Enterprise + the expense categories she books. A PO with several categories goes to an owner if any of its lines is theirs."
          />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </Card>
  );
}
