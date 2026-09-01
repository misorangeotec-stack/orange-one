import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { ORG_PEOPLE_DETAIL_QUERY } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";

/**
 * Which departments the Salesperson picker draws its roster from.
 *
 * ⚠ THIS EXISTS SO THE ROSTER IS NOT A CONSTANT IN THE CODE. The quotation
 *   form's Salesperson list used to be `distinct salesperson_name` over the
 *   deals table — whatever had been typed before — and the obvious replacement
 *   was to hard-code "department = Sales". That would have been one deploy away
 *   from every future change: Management, where both Directors carry a book, or
 *   a new Sales sub-org. It is config instead.
 *
 * ⚠ AN EMPTY LIST OFFERS NOBODY, DELIBERATELY. The tempting fallback — no
 *   departments chosen, so show everyone — would put all 63 users on the list a
 *   salesperson picks from, warehouse and quality lab included, and that name
 *   prints at the head of the customer's quotation. The form says so plainly and
 *   points back here rather than guessing.
 *
 * ⚠ THE OPTIONS COME FROM THE SAME READ THE PICKER USES, not from
 *   `useDirectory()`. One source means the department names offered here are
 *   exactly the ones the roster filter matches on; two sources would be two
 *   things to keep in step. It also keeps OCPI off the RLS-scoped directory
 *   entirely — `list_org_people_detail()` is a definer function, and a
 *   department whose people this admin cannot see would otherwise be missing.
 */
export default function SalespeopleSection() {
  const s = useOcpiStore();
  const [picked, setPicked] = useState<string[]>(s.config.salespersonDepartmentIds);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data: people } = useQuery(ORG_PEOPLE_DETAIL_QUERY);

  /**
   * Every department that actually has somebody in it, with a head-count.
   *
   * The count is the point of the label: choosing a department here is choosing
   * how many names appear in the picker, and "Sales" alone does not say whether
   * that is three people or thirty. A department already chosen but now empty is
   * still listed, so a saved value can never vanish from its own control.
   */
  const options: MultiOption[] = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>();
    for (const p of people ?? []) {
      if (!p.departmentId) continue;
      const row = byId.get(p.departmentId);
      if (row) row.count += 1;
      else byId.set(p.departmentId, { name: p.department ?? "Unnamed department", count: 1 });
    }
    for (const id of picked) {
      if (!byId.has(id)) byId.set(id, { name: "No longer a department", count: 0 });
    }
    return [...byId.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, d]) => ({
        value: id,
        label: `${d.name} · ${d.count} ${d.count === 1 ? "person" : "people"}`,
      }));
  }, [people, picked]);

  const chosenHeadcount = useMemo(() => {
    const wanted = new Set(picked);
    return (people ?? []).filter((p) => p.departmentId && wanted.has(p.departmentId)).length;
  }, [people, picked]);

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setSalespersonDepartments(picked);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Salespeople</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          The departments whose people can be named as the <b>salesperson</b> on a quotation. That
          name prints at the head of the customer&rsquo;s copy. A person is added or moved in{" "}
          <b>Admin &rsaquo; Users</b>, not here &mdash; this only says which departments count.
        </p>
      </div>

      <MultiSelect
        values={picked}
        onChange={(v) => {
          setPicked(v);
          setSaved(false);
        }}
        options={options}
        placeholder="Select departments"
        disabled={!s.isAdmin}
      />

      <p className="text-[12.5px] text-grey-2">
        {picked.length === 0 ? (
          <>
            No departments chosen &mdash; the Salesperson list will offer <b>nobody</b>, and every
            deal will have to be typed by hand.
          </>
        ) : (
          <>
            {chosenHeadcount} {chosenHeadcount === 1 ? "person" : "people"} will appear in the
            Salesperson list.
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || !s.isAdmin}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
