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
 * The SEVEN HOD steps (hod_shortlist, interview_2, probation_m1/m2/m3,
 * probation_final, probation_extension — HOD_STEPS in lib/steps.ts) are different,
 * and since NR-4 they are editable too. They are owned per-requisition by the hiring
 * manager who raised the MRF, so a Sachin Plant vacancy is shortlisted and reviewed
 * by the Sachin Plant head automatically, with no setup at all. Naming somebody here
 * ADDS to that. It never replaces it.
 *
 * ⚠ THE `OR` IS THE WHOLE DESIGN, and this file used to argue the opposite. The
 *   original objection was that an owner list on these steps "would send every
 *   department's candidates to one person, which is exactly the bug this design
 *   avoids". That is true of a SWAP and false of an OR: the hiring manager keeps the
 *   step, keeps the queue entry, keeps the bell and keeps the daily digest, and the
 *   people named here merely gain the button as well — so HR can move a card when a
 *   head has stalled. Mirrors fms_hr_is_natural_step_owner in SQL; change one list
 *   and change the other.
 *
 * ⚠ NAMING SOMEBODY ON ANY STEP BUT `mrf` IS A PII GRANT, not just a button. See the
 *   note rendered in the modal — it is on screen because it is easy to miss here.
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

  /**
   * ⚠ NOTHING MAY BE EDITED FROM A TABLE THAT HAS NOT YET SEEN WHAT IS SAVED.
   *   This modal seeds itself from the store at click time, so opening it before the
   *   fetch lands gives an EMPTY picker over a non-empty saved row — and Save then
   *   writes `[]`, silently revoking everyone on it. That is not hypothetical: it
   *   happened here on 09-09-2026 and wiped Riya Kumari off HR Head Approval, the
   *   same failure PipelineViewersSection was rewritten to avoid. The Edit buttons
   *   and Save are both gated on `s.isLoading`; see [[usestate-of-store-value-wipes-the-list]].
   */
  const open = (stepKey: StepKey) => {
    if (s.isLoading) return;
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
  const editingIsHod = editing ? isHodStep(editing) : false;
  /**
   * `mrf` is "may raise a requisition", which every department head holds. It is the
   * one step that grants no sight of candidates — fms_hr_is_recruitment_staff()
   * excludes it by name — so it is the one step this warning must NOT appear on.
   */
  const editingGrantsPii = editing !== null && editing !== "mrf";

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
                      {/* NR-4: every row is editable now, the seven HOD steps included.
                          They keep the tint because they still behave differently — the
                          hiring manager owns them whether or not anyone is named. */}
                      <button
                        onClick={() => open(st.key)}
                        disabled={s.isLoading}
                        className="text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                      >
                        Edit
                      </button>
                    </td>
                    <td className="px-4 py-3 text-grey-2">{st.index}</td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{st.title}</td>
                    <td className="px-4 py-3">
                      {/* A HOD step always names the hiring manager first, because that is
                          true whether or not anybody is listed. Anyone named is shown as an
                          addition, never as a replacement. (The old copy here claimed Round 2
                          was offered to "anyone set up to raise an MRF" — that describes the
                          nav gate in `isStepOwner`, not who may act, and it was misleading.) */}
                      {hod ? (
                        <span className="text-grey-2">
                          The hiring manager who raised it
                          {names.length ? (
                            <>
                              , plus <span className="text-navy">{names.join(", ")}</span>
                            </>
                          ) : null}
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
        The tinted steps follow the requisition on their own — whoever raises an MRF shortlists its CVs, takes
        Interview Round&nbsp;2 and does that hire's probation reviews, with no setup at all. Anyone you name on one of
        them can act on it <strong className="font-semibold text-navy">as well</strong>, on every position; the hiring
        manager keeps it either way, and keeps the queue entry and the reminders.
      </p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Owners — ${editingStep?.title ?? ""}`}
        subtitle={
          editingIsHod
            ? "The hiring manager who raised the requisition always owns this step. Anyone you add here can act on it as well, on every position — the work and the reminders stay with the hiring manager."
            : "Pick a department, then every employee who owns this step. All of them can action it and are notified."
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy || s.isLoading}>
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
          {editingGrantsPii && (
            <p className="rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
              <strong className="font-semibold">This is a data grant, not just a button.</strong> Naming somebody on any
              step but Manpower Requisition makes them recruitment staff: they can then read every candidate in the
              module — name, phone, email, expected salary — every interview, onboarding and probation record, and
              every CV and job description in the document store, on every position, not only this step's. Remove the
              name to take it back.
            </p>
          )}
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
