import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { STEPS, isRowOwnedStep, type StepKey } from "../../lib/steps";

/**
 * Step Owners (admin).
 *
 * ⚠ `need_raised` WITH NO OWNERS MEANS EVERYONE MAY RAISE, not nobody. The
 *   document asks for "HOD / HR / Management creates a Training Request", i.e.
 *   open by default; naming owners narrows it. The database deliberately has no
 *   CHECK barring the origin step for exactly this reason.
 *
 * ⚠ THE FIVE ROW-OWNED STEPS ARE STILL LISTED, and that is deliberate. A
 *   nominee's RSVP and their HOD's effectiveness note are owed by the person the
 *   ROW names, so an owner set here is the FALLBACK for when the row names
 *   nobody — which today is 19 of 67 employees, who resolve to no HOD at all.
 *   Without a fallback their review would be owed by nobody and silently never
 *   happen. The rows say so rather than leaving an admin to guess why setting an
 *   owner appears to do nothing.
 */
export default function StepOwnersSection() {
  const s = useLdStore();
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

  // Narrowing the department must drop anybody who is no longer offered, or a
  // hidden selection survives and the saved list disagrees with the screen.
  const changeDepts = (next: string[]) => {
    setDeptIds(next);
    if (next.length === 0) return;
    const chosen = new Set(next);
    const allowed = new Set(
      s.profiles.filter((p) => p.departmentId && chosen.has(p.departmentId)).map((p) => p.id),
    );
    setEmpIds((prev) => prev.filter((id) => allowed.has(id)));
  };

  const open = (step: StepKey) => {
    const cur = s.data?.stepOwners.find((o) => o.stepKey === step);
    setDeptIds(cur?.departmentIds ?? []);
    setEmpIds(cur?.employeeIds ?? []);
    setErr(null);
    setEditing(step);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.writes.setStepOwner(editing, deptIds, empIds);
      await s.refresh();
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: string) => s.profileById(id)?.name ?? "Unknown";

  return (
    <>
      <Card className="p-5">
        <p className="text-[13px] text-grey-2 mb-4">
          Who is notified and who may act, per step. Nothing moves past a step with no owner —{" "}
          <strong className="text-navy">except the first one</strong>, where leaving it empty means anyone
          may raise a training need.
        </p>

        <div className="space-y-2">
          {STEPS.map((st) => {
            const owners = s.data?.stepOwners.find((o) => o.stepKey === st.key)?.employeeIds ?? [];
            const rowOwned = isRowOwnedStep(st.key);
            return (
              <div
                key={st.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-navy">
                      {st.index}. {st.title}
                    </span>
                    {rowOwned && (
                      <span className="rounded-full bg-[#EAF1FE] px-2 py-0.5 text-[11px] font-semibold text-blue">
                        Usually the row's own person
                      </span>
                    )}
                    {st.key === "mgmt_approval" && (
                      <span className="rounded-full bg-[#FFF7E6] px-2 py-0.5 text-[11px] font-semibold text-yellow">
                        Conditional
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-grey-2">
                    {owners.length > 0
                      ? owners.map(nameOf).join(", ")
                      : st.key === "need_raised"
                        ? "Nobody set — anyone may raise a training need"
                        : rowOwned
                          ? "Nobody set — nothing to fall back on when the row names no one"
                          : "Nobody set — this step cannot move"}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => open(st.key)}>
                  {owners.length > 0 ? "Change" : "Set owners"}
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? STEPS.find((x) => x.key === editing)?.title ?? "Step owners" : ""}
      >
        <div className="space-y-4">
          <FieldLabel label="Narrow by department" hint="Optional — it only filters the list below.">
            <MultiSelect values={deptIds} onChange={changeDepts} options={deptOptions} placeholder="Any department" chips />
          </FieldLabel>
          <FieldLabel label="Owners">
            <MultiSelect values={empIds} onChange={setEmpIds} options={peopleOptions} placeholder="Select people" chips />
          </FieldLabel>

          {editing && isRowOwnedStep(editing) && (
            <p className="rounded-lg bg-[#EAF1FE] px-3 py-2 text-[12.5px] text-navy">
              This step normally belongs to the person the row names — the nominee, or their HOD. Anyone
              set here is the fallback for rows where that person cannot be worked out.
            </p>
          )}

          {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
