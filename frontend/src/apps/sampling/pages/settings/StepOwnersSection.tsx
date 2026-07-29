import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useSamplingStore } from "../../store";
import { STEPS, branchLabelsOf, isSourceScoped, type StepDef, type StepKey } from "../../lib/steps";
import { SAMPLING_SOURCES, SAMPLING_SOURCE_LABEL, type SamplingSource } from "../../types";

/**
 * Step Owners (admin). `request` is never owned — every granted user may raise one,
 * so it is barred (CHECK constraint) and absent here. Every other step's owners are
 * the notified / authorized actors for that step.
 *
 * THE THREE OUTWARD STEPS GET TWO ROWS EACH — Domestic and Export — because a
 * dispatch abroad and one down the road are different people's work. Those rows
 * write to a different table (`fms_sampling_step_source_owners`), which for those
 * steps is the ONLY authority: the server answers empty from the flat table for
 * them, so nothing an admin cannot see here can ever grant rights.
 *
 * `result_handover` is single-rowed on purpose: its actor is already chosen per
 * request ("Result handover to"), so a source split would be redundant.
 */
type OwnerRow = { st: StepDef; source: SamplingSource | null };

export default function StepOwnersSection() {
  const s = useSamplingStore();
  const [editing, setEditing] = useState<{ stepKey: StepKey; source: SamplingSource | null } | null>(null);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ownerRows = useMemo<OwnerRow[]>(
    () =>
      STEPS.filter((st) => st.key !== "request").flatMap<OwnerRow>((st) =>
        isSourceScoped(st.key)
          ? SAMPLING_SOURCES.map((source) => ({ st, source }))
          : [{ st, source: null }],
      ),
    [],
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

  const ownerOf = (stepKey: StepKey, source: SamplingSource | null) =>
    source ? s.stepSourceOwnerFor(stepKey, source) : s.ownersFor(stepKey, null);

  const open = (stepKey: StepKey, source: SamplingSource | null) => {
    const cur = ownerOf(stepKey, source);
    setDeptIds(cur?.departmentIds ?? []);
    setEmpIds(cur?.employeeIds ?? []);
    setErr(null);
    setEditing({ stepKey, source });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      const input = { departmentIds: deptIds, designationId: null, employeeIds: empIds };
      if (editing.source) await s.setStepSourceOwner(editing.stepKey, editing.source, input);
      else await s.setStepOwner(editing.stepKey, input);
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editingStep = STEPS.find((st) => st.key === editing?.stepKey);
  const editingScope = [editingStep ? branchLabelsOf(editingStep) : "", editing?.source ? SAMPLING_SOURCE_LABEL[editing.source] : ""]
    .filter(Boolean)
    .join(" · ");

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
              {ownerRows.map(({ st, source }) => {
                const owner = ownerOf(st.key, source);
                const names = (owner?.employeeIds ?? []).map((id) => s.profileById(id)?.name ?? "Unknown");
                return (
                  <tr key={`${st.key}:${source ?? ""}`} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button onClick={() => open(st.key, source)} className="text-[12.5px] font-semibold text-orange hover:underline">
                        Edit
                      </button>
                    </td>
                    {/* The number belongs to the STEP, so both of a split step's rows carry it. */}
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">
                      {st.title}
                      {/* Which branch — this is a flat list, and two steps share the
                          title "Result Received" (lab's result_received, outward's result). */}
                      {branchLabelsOf(st) && (
                        <span className="ml-2 text-[11.5px] font-normal text-grey-2">{branchLabelsOf(st)}</span>
                      )}
                      {source && (
                        <span className="ml-1.5 text-[11.5px] font-semibold text-orange">
                          · {SAMPLING_SOURCE_LABEL[source]}
                        </span>
                      )}
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

      <p className="text-[12.5px] text-grey-2">
        Sample Sent, Receipt Confirmed and Result Received are owned <strong className="font-semibold text-navy">separately
        for Domestic and Export</strong> dispatches — an Export owner never sees a Domestic request, and the other way
        round. Receipt confirmers in Masters can confirm on top of these owners. A legacy inward request sitting at
        Result Received counts as Domestic.
      </p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${editingStep?.title ?? ""}${editingScope ? ` (${editingScope})` : ""}`}
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
