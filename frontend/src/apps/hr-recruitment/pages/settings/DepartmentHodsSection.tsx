import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { personOptions } from "../../lib/people";
import { useHrStore } from "../../store";

/**
 * Department HODs (admin) — who normally owns a department's hiring.
 *
 * ⚠ THIS IS A DEFAULT, NOT A GRANT, and that is the whole design. Nothing in the
 * database reads this table: not `fms_hr_can_read_requisition`, not
 * `fms_hr_is_natural_step_owner`, not one RLS policy. Being named here reveals no
 * candidate and no CV. It pre-fills both people boxes on the NEXT requisition raised
 * for that department, and the person raising it can still change them.
 *
 * ⚠ AND IT MUST NEVER RETRO-WRITE A LIVE POSITION. A department changing head next
 * March must not silently move HOD shortlist and Round 2 on eleven mid-pipeline
 * vacancies. Moving an existing one is the Hiring team dialog on the position, which
 * is audited and notifies the people it affects. Saving here moves nothing.
 *
 * WHY IT OPENS PRE-FILLED. The portal already knows who the heads are — everyone
 * holding the `hod` role, sitting in a department. Seven of twelve active departments
 * resolve to exactly one name that way; Sales resolves to six and Supply Chain to two,
 * so a person still has to choose. The suggestion is SHOWN and never saved on its own,
 * so nothing HR did not confirm is ever stored as fact.
 *
 * ⚠ NOT derived from `user_hods`. That is a reporting line and cannot be aggregated
 *   into a department head — Accounting & Finance alone names five different people
 *   across its 17 staff, and 13 of 23 departments name nobody at all.
 *
 * ── The empty-save trap, which this screen is shaped around ──────────────────
 * A per-row control is structurally `StepOwnersSection`, and that is the section that
 * wiped a Director off `hr_head_approval` on 09-09-2026: seeding inside a click handler
 * looks safe because it reads the store at click time, but `?? []` swallows `undefined`
 * into `[]` before the fetch lands and Save then writes an empty list. So BOTH guards
 * are applied here — the editor follows the store until the first edit (`edited ?? …`),
 * and every Edit and every Save is disabled while `s.isLoading`.
 *
 * Per-row writes are themselves the containment: an early Save on one department
 * cannot reach the other twenty-two.
 */
export default function DepartmentHodsSection() {
  const s = useHrStore();

  /** `null` = following the saved row. An array = this admin has edited it. */
  const [openDept, setOpenDept] = useState<string | null>(null);
  const [edited, setEdited] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedDept, setSavedDept] = useState<string | null>(null);

  const peopleOptions: MultiOption[] = useMemo(
    () => personOptions(s.orgPeople, s.moduleUserIds, s.moduleEditUserIds),
    [s.orgPeople, s.moduleUserIds, s.moduleEditUserIds],
  );

  // Active departments first, then the rest — live positions are still being raised
  // against inactive ones, so hiding them would leave those vacancies unanswerable.
  const departments = useMemo(
    () =>
      [...s.departments].sort((a, b) => {
        const act = Number(b.active ?? true) - Number(a.active ?? true);
        return act !== 0 ? act : a.name.localeCompare(b.name);
      }),
    [s.departments],
  );

  const nameOf = (id: string) => s.personName(id);

  const picked = (deptId: string) => (openDept === deptId ? (edited ?? s.departmentHodsFor(deptId)) : s.departmentHodsFor(deptId));

  const open = (deptId: string) => {
    // Nothing may be opened from a store that has not yet said what is saved.
    if (s.isLoading) return;
    setOpenDept(deptId);
    setEdited(null);
    setErr(null);
    setSavedDept(null);
  };

  const save = async (deptId: string) => {
    if (s.isLoading) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setDepartmentHods(deptId, picked(deptId));
      setOpenDept(null);
      setEdited(null);
      setSavedDept(deptId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unsetCount = departments.filter(
    (d) => (d.active ?? true) && s.departmentHodsFor(d.id).length === 0,
  ).length;

  return (
    <Card className="p-5">
      <div className="space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-navy">Department HODs</h2>
          <p className="mt-1 text-[12.5px] leading-snug text-grey-2">
            Who normally owns each department's hiring. This is a{" "}
            <strong className="font-semibold text-navy">starting point for new requisitions</strong>, not a
            permission — nobody gains sight of a candidate or a CV by being listed here, and saving this{" "}
            <strong className="font-semibold text-navy">does not move any position that already exists</strong>.
            To change who owns a live vacancy, open it and use <em>Hiring team</em>.
          </p>
          {unsetCount > 0 && (
            <p className="mt-1.5 text-[12px] text-grey-2">
              {unsetCount} of {departments.filter((d) => d.active ?? true).length} active{" "}
              {unsetCount === 1 ? "department is" : "departments are"} not set. A requisition for one of
              those falls back to naming whoever raises it.
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-grey-2">
                <th className="py-2 pr-3 font-semibold">Department</th>
                <th className="py-2 pr-3 font-semibold">Head of department</th>
                <th className="py-2 pr-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => {
                const saved = s.departmentHodsFor(d.id);
                const suggested = s.suggestedHodsFor(d.id);
                const isOpen = openDept === d.id;
                const dirty =
                  isOpen &&
                  (picked(d.id).length !== saved.length ||
                    !picked(d.id).every((x) => saved.includes(x)));

                return (
                  <tr key={d.id} className="border-b border-line/60 align-top">
                    <td className="py-2.5 pr-3 text-navy">
                      {d.name}
                      {!(d.active ?? true) && (
                        <span className="ml-1.5 text-[11px] text-grey-2">· inactive</span>
                      )}
                    </td>

                    <td className="py-2.5 pr-3">
                      {isOpen ? (
                        <div className="max-w-md">
                          <MultiSelect
                            values={picked(d.id)}
                            onChange={(v) => setEdited(v)}
                            options={peopleOptions}
                            placeholder="Search anyone in the company"
                          />
                        </div>
                      ) : saved.length > 0 ? (
                        <span className="text-navy">{saved.map(nameOf).join(", ")}</span>
                      ) : suggested.length > 0 ? (
                        // A SUGGESTION, drawn as one. It is what the portal already knows,
                        // not something anybody has stated, so it is never saved on its own.
                        <span className="text-grey-2">
                          Not set — {suggested.map(nameOf).join(", ")}{" "}
                          {suggested.length === 1
                            ? "is on record as the head"
                            : "are on record as heads"}
                        </span>
                      ) : (
                        <span className="text-grey-2">Not set — nobody is on record as its head</span>
                      )}
                    </td>

                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {isOpen ? (
                        <span className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => save(d.id)}
                            disabled={busy || !dirty || s.isLoading}
                          >
                            {busy ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setOpenDept(null);
                              setEdited(null);
                            }}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => open(d.id)}
                            disabled={s.isLoading}
                          >
                            {saved.length > 0 ? "Edit" : "Set"}
                          </Button>
                          {saved.length === 0 && suggested.length > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy || s.isLoading}
                              onClick={async () => {
                                if (s.isLoading) return;
                                setBusy(true);
                                setErr(null);
                                try {
                                  await s.setDepartmentHods(d.id, suggested);
                                  setSavedDept(d.id);
                                } catch (e) {
                                  setErr((e as Error).message);
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Use this
                            </Button>
                          )}
                          {savedDept === d.id && (
                            <span className="text-[12px] font-medium text-ryg-green">Saved</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Card>
  );
}
