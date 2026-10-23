import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useComplaintStore } from "../../store";
import { CN_STEPS, MANAGEMENT_OWNER_KEYS, STEPS, type StepKey } from "../../lib/steps";

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
 * ⚠ `assignee` IS DELIBERATELY ABSENT FROM THIS TABLE. It is the one step with
 *   no configurable owners: management NAME the person when they reassign an
 *   imported-material complaint, so the step is owned by whoever is on that row.
 *   Listing it would offer an admin a setting that grants nothing — and, worse,
 *   would read as though the people saved in it were the ones who get assigned.
 *
 * There is no source split here (contrast Sampling's Domestic/Export): the raw-
 * material branch runs DIFFERENT steps from the finished-good one, but each step
 * is still one desk with one owner list, so this table needs no notion of it.
 */

/**
 * The steps an admin may staff. See the ⚠ above for the one that is missing.
 */
/**
 * One Setup row. Usually one step; the MANAGEMENT row stands for every step
 * management own (FG approval, RM / other-supplier review, final review and
 * customer compensation approval) — the user wants management staffed ONCE.
 * Saving it writes the same people to each of those keys, which is what the
 * live RPCs check.
 */
interface OwnerRow {
  id: string;
  title: string;
  note?: string;
  keys: StepKey[];
}

const OWNER_ROWS: OwnerRow[] = (() => {
  const rows: OwnerRow[] = [];
  let mgmtAdded = false;
  for (const st of [...STEPS, ...CN_STEPS]) {
    if (st.key === "assignee") continue;
    if (MANAGEMENT_OWNER_KEYS.includes(st.key)) {
      if (!mgmtAdded) {
        rows.push({
          id: "management",
          title: "Management Approval",
          note: "Every approval: Finished Good, Raw Material, Other Supplier and Customer Compensation",
          keys: MANAGEMENT_OWNER_KEYS,
        });
        mgmtAdded = true;
      }
      continue;
    }
    rows.push({ id: st.key, title: st.title, keys: [st.key] });
  }
  return rows;
})();

const NOTES: Partial<Record<string, string>> = {
  raise: "Raising is the step — it has no queue",
  purchase: "Domestic raw-material complaints only",
  cn_tally: "Posts the approved compensation in Tally and closes it",
};
export default function StepOwnersSection() {
  const s = useComplaintStore();
  const [editing, setEditing] = useState<OwnerRow | null>(null);
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

  /**
   * Do the row's steps hold DIFFERENT people today? Only possible on the
   * management row (four keys). Saving gives everyone shown ALL of them, so
   * the row says so rather than widening anyone's rights silently.
   */
  const differs = (row: OwnerRow) => {
    const sets = row.keys.map((k) => [...(s.ownerFor(k)?.employeeIds ?? [])].sort().join(","));
    return new Set(sets).size > 1;
  };

  /** Everyone on any of the row's keys — for the management row, the union. */
  const idsOf = (row: OwnerRow, pick: "departmentIds" | "employeeIds") =>
    [...new Set(row.keys.flatMap((k) => s.ownerFor(k)?.[pick] ?? []))];

  const open = (row: OwnerRow) => {
    setDeptIds(idsOf(row, "departmentIds"));
    setEmpIds(idsOf(row, "employeeIds"));
    setErr(null);
    setEditing(row);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.saveStepOwners(
        editing.keys.map((stepKey) => ({ stepKey, departmentIds: deptIds, designationId: null, employeeIds: empIds })),
      );
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
            {OWNER_ROWS.map((row, i) => {
              const ids = idsOf(row, "employeeIds");
              const note = row.note ?? NOTES[row.id];
              return (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-grey-2">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-navy">{row.title}</div>
                    {note && <div className="text-[11px] text-grey-2">{note}</div>}
                    {differs(row) && (
                      <div className="text-[11px] text-amber-700">
                        Different people own these approvals today — saving gives everyone listed all of them.
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {ids.length ? (
                      <span className="text-ink">{ids.map(nameOf).join(", ")}</span>
                    ) : (
                      <span className="text-grey-2">
                        {row.id === "raise" ? "Anyone with the module" : "Not assigned"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => open(row)}>
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
        title={editing ? `Owners — ${editing.title}` : ""}
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
