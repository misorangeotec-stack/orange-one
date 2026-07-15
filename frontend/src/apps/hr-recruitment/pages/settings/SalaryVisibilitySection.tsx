import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";

/**
 * Who may see the OFFERED salary (admin).
 *
 * The requisition's salary RANGE stays public — it is the band HR advertises and
 * approves against. What this gates is the *offered/finalized* CTC on the board, the
 * onboarding panel and the reports. Admins and whoever finalizes a candidate always
 * see it; this widens the audience to whole departments and named people.
 *
 * UI-level only: the number still reaches the browser. True isolation would need a
 * server-side satellite table (a tracked follow-up).
 */
export default function SalaryVisibilitySection() {
  const s = useHrStore();
  const [depts, setDepts] = useState<string[]>(s.salaryViewers.departmentIds);
  const [people, setPeople] = useState<string[]>(s.salaryViewers.personIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const deptOptions: MultiOption[] = useMemo(
    () => [...s.departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name })),
    [s.departments],
  );
  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const key = (a: string[]) => [...a].sort().join(",");
  const dirty =
    key(depts) !== key(s.salaryViewers.departmentIds) || key(people) !== key(s.salaryViewers.personIds);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setSalaryViewers(depts, people);
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
        <p className="text-[12.5px] text-grey-2">
          Choose who may see the <strong>offered salary</strong> — the agreed CTC recorded when a candidate is
          finalized. The requisition's salary range stays visible to everyone; only the finalized figure is hidden.
          Admins, and whoever finalizes a candidate, always see it.
        </p>

        <FieldLabel label="Departments that may see offered salary" hint="everyone in these departments">
          <MultiSelect
            values={depts}
            onChange={(v) => {
              setDepts(v);
              setSaved(false);
            }}
            options={deptOptions}
            placeholder="Select departments"
          />
        </FieldLabel>

        <FieldLabel label="Specific people who may see offered salary" hint="named individuals">
          <MultiSelect
            values={people}
            onChange={(v) => {
              setPeople(v);
              setSaved(false);
            }}
            options={peopleOptions}
            placeholder="Select people"
          />
        </FieldLabel>

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
