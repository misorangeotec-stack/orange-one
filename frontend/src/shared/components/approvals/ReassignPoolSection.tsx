import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import type { Profile, Department } from "@/core/platform/types";

/**
 * Who may RECEIVE a handover (admin) — the Setup half of the FMS approval
 * handover, shared by every module that has one.
 *
 * This list is the whole point of the feature. Without it the only safe picker
 * would be "every profile", which is precisely why the first version of Reassign
 * was removed (20260806123000_fms_import_remove_reassign.sql): an approval could
 * be handed to somebody with no authority at all. Naming the receivers up front
 * is what makes it safe to offer — so do not "helpfully" widen this to all
 * profiles in any module.
 *
 * DEPARTMENTS FILTER, USERS AUTHORISE. Picking a department narrows the user list
 * below and nothing more; every module's server-side helper reads only the user
 * ids. Same rule as Step Owners.
 *
 * ⚠ The module is passed in rather than inferred, because `moduleLevels[appId]`
 *   is what decides the warning and getting the wrong id would silently show no
 *   warning at all rather than fail.
 */
export default function ReassignPoolSection({
  appId,
  appLabel,
  profiles,
  departments,
  profileById,
  savedDepartmentIds,
  savedUserIds,
  onSave,
  /** Trailing sentence of the intro, e.g. how a hand-back works in this module. */
  emptyPoolNote,
  /** Trailing sentence under the People picker. */
  peopleNote,
}: {
  appId: string;
  appLabel: string;
  profiles: Profile[];
  departments: Department[];
  /** Takes a plain id — every caller passes one from `picked`, never null. Kept
   *  narrow so a store exposing `(id: string) => …` is assignable. */
  profileById: (id: string) => Profile | undefined;
  savedDepartmentIds: string[];
  savedUserIds: string[];
  onSave: (input: { departmentIds: string[]; userIds: string[] }) => Promise<void>;
  emptyPoolNote: string;
  peopleNote: string;
}) {
  const [deptIds, setDeptIds] = useState<string[]>(savedDepartmentIds);
  const [picked, setPicked] = useState<string[]>(savedUserIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * ⚠ RE-SYNC WHEN THE SAVED VALUES ARRIVE. `useState(saved…)` reads its argument
   *   ONCE, so a section that mounts before the store's query resolves keeps the
   *   empty arrays it was born with — the picker shows nothing and a reload looks
   *   like the save was lost. Import and Purchase never hit it because their
   *   Setup tab is opened by a click, which is always after the data lands;
   *   Office Supplies puts this on the DEFAULT tab and it failed immediately.
   *
   *   This is React's documented "adjust state when a prop changes" pattern —
   *   a render-phase set, not an effect, so there is no flash of stale values.
   *   It cannot clobber an unsaved edit in practice: the only thing that moves
   *   these props is a refetch, and the refetch after a save carries back exactly
   *   what was just picked.
   */
  const savedKey = `${[...savedUserIds].sort().join(",")}|${[...savedDepartmentIds].sort().join(",")}`;
  const [syncedKey, setSyncedKey] = useState(savedKey);
  if (savedKey !== syncedKey) {
    setSyncedKey(savedKey);
    setDeptIds(savedDepartmentIds);
    setPicked(savedUserIds);
  }

  const deptOptions: MultiOption[] = useMemo(
    () => departments.map((d) => ({ value: d.id, label: d.name })),
    [departments]
  );

  /**
   * Employees in any chosen department — plus anyone ALREADY on the list, whatever
   * their department. Narrowing the filter must not make a saved receiver vanish
   * from the control that is showing them; that reads as a silent removal.
   */
  const peopleOptions: MultiOption[] = useMemo(() => {
    const chosen = new Set(deptIds);
    return [...profiles]
      .filter(
        (p) => chosen.size === 0 || (p.departmentId && chosen.has(p.departmentId)) || picked.includes(p.id)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));
  }, [profiles, deptIds, picked]);

  /**
   * A receiver with no edit grant on this module is a dead end: RequireModule
   * sends them to /home, and several modules ALSO refuse them server-side —
   * fms_supplies_can_act and fms_travel_can_act both open with
   * module_can_edit(...). Warn rather than block: the admin can grant access and
   * set this list in either order.
   */
  const blocked = useMemo(
    () =>
      picked
        .map((id) => profileById(id))
        .filter((p) => !!p && p.role !== "admin" && p.moduleLevels[appId] !== "edit")
        .map((p) => p!.name),
    [picked, profileById, appId]
  );

  const dirty = useMemo(() => {
    const key = (a: string[]) => [...a].sort().join(",");
    return key(picked) !== key(savedUserIds) || key(deptIds) !== key(savedDepartmentIds);
  }, [picked, deptIds, savedUserIds, savedDepartmentIds]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await onSave({ departmentIds: deptIds, userIds: picked });
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
            An approver can pass a single item to anyone on this list. It leaves their queue and
            appears in that person&rsquo;s. {emptyPoolNote}
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
              : `${picked.length} of ${peopleOptions.length} selected · ${peopleNote}`}
          </span>
        </FieldLabel>

        {blocked.length > 0 && (
          <p className="rounded-lg bg-[#FEF6E0] px-3 py-2 text-[12.5px] leading-snug text-[#946200]">
            <strong className="font-semibold">
              {blocked.join(", ")} {blocked.length === 1 ? "has" : "have"} no edit access to{" "}
              {appLabel}.
            </strong>{" "}
            An approval handed over to them cannot be opened. Grant it in Admin &rarr; Users &rarr;
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
