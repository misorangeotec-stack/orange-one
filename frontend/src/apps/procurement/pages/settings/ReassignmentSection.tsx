import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useProcurementStore } from "../../store";

/**
 * Who may RECEIVE a handover (admin). An approver holding a requisition can pass
 * that one requisition to somebody on this list; it then leaves the band's queue
 * and appears in theirs.
 *
 * This list is the whole point of the feature. Without it the only safe picker
 * would be "every profile", which is precisely why Import's first attempt at
 * Reassign was removed (20260806123000_fms_import_remove_reassign.sql): an
 * approval could be handed to somebody with no authority at all. Naming the
 * receivers up front is what makes it safe to offer — so do not "helpfully"
 * widen this to all profiles.
 *
 * DEPARTMENTS FILTER, USERS AUTHORISE. Picking a department narrows the user
 * list below and nothing more; the server reads only the user ids
 * (fms_purchase_can_receive_reassignment). Same rule as Step Owners.
 *
 * ⚠ It sits under the Approval Matrix tab on purpose. Reassign only ever moves a
 *   requisition off a BAND, so the two controls are read together — and the modal
 *   also offers that requisition's own band members, so a hand-back needs no
 *   entry here at all.
 */
export default function ReassignmentSection() {
  const s = useProcurementStore();
  const [deptIds, setDeptIds] = useState<string[]>(s.reassignPoolDepartmentIds);
  const [picked, setPicked] = useState<string[]>(s.reassignPoolUserIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const deptOptions: MultiOption[] = useMemo(
    () => s.departments.map((d) => ({ value: d.id, label: d.name })),
    [s.departments]
  );

  /**
   * Employees in any chosen department — plus anyone ALREADY on the list, whatever
   * their department. Narrowing the filter must not make a saved receiver vanish
   * from the control that is showing them; that reads as a silent removal.
   */
  const peopleOptions: MultiOption[] = useMemo(() => {
    const chosen = new Set(deptIds);
    return [...s.profiles]
      .filter(
        (p) => chosen.size === 0 || (p.departmentId && chosen.has(p.departmentId)) || picked.includes(p.id)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));
  }, [s.profiles, deptIds, picked]);

  /**
   * A receiver with no edit grant on this module is a dead end: RequireModule
   * sends them to /home, and every write gate folds `canEditModule("procurement")`.
   * The handover would land somewhere they cannot open. Warn rather than block —
   * the admin can grant access and set this list in either order.
   */
  const blocked = useMemo(
    () =>
      picked
        .map((id) => s.profileById(id))
        .filter((p) => !!p && p.role !== "admin" && p.moduleLevels["procurement"] !== "edit")
        .map((p) => p!.name),
    [picked, s]
  );

  const dirty = useMemo(() => {
    const key = (a: string[]) => [...a].sort().join(",");
    return (
      key(picked) !== key(s.reassignPoolUserIds) || key(deptIds) !== key(s.reassignPoolDepartmentIds)
    );
  }, [picked, deptIds, s.reassignPoolUserIds, s.reassignPoolDepartmentIds]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setReassignPool({ departmentIds: deptIds, userIds: picked });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 max-w-xl">
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold text-navy">Who can be handed an approval</h3>
          <p className="text-[12.5px] text-grey-2 mt-1">
            An approver can pass a single requisition to anyone on this list. It leaves the band&rsquo;s
            queue and appears in that person&rsquo;s. Leave it empty and a requisition can only be
            passed between the approvers of its own band.
          </p>
        </div>

        <FieldLabel label="Departments" hint="optional filter">
          <MultiSelect
            values={deptIds}
            onChange={(v) => {
              setDeptIds(v);
              setSaved(false);
            }}
            options={deptOptions}
            placeholder="All departments"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Filters the people below. It grants nothing on its own &mdash; only the names you pick
            can receive an approval.
          </span>
        </FieldLabel>

        <FieldLabel label="People" hint="select one or more">
          <MultiSelect
            values={picked}
            onChange={(v) => {
              setPicked(v);
              setSaved(false);
            }}
            options={peopleOptions}
            placeholder="Select who may receive an approval"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            {peopleOptions.length === 0
              ? "No employees are mapped to the selected department(s)."
              : `${picked.length} of ${peopleOptions.length} selected · a requisition can always be handed back to its own band.`}
          </span>
        </FieldLabel>

        {blocked.length > 0 && (
          <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] leading-snug text-[#946200]">
            <strong className="font-semibold">
              {blocked.join(", ")} {blocked.length === 1 ? "has" : "have"} no edit access to Purchase
              RM Domestic.
            </strong>{" "}
            A requisition handed over to them cannot be opened. Grant it in Admin &rarr; Users &rarr;
            Module access.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {saved && !dirty && <span className="text-[12.5px] text-ryg-green font-medium">Saved</span>}
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
