import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useTravelStore } from "../../store";

/**
 * Who a coordinator may raise a trip for.
 *
 * ⚠ THIS EXISTS BECAUSE THE DIRECTORY IS DEPARTMENT-SCOPED. A coordinator who is
 *   not an admin reads `profiles` through RLS — self, downline, own department —
 *   so the Traveller picker showed her own team and nobody else. The people named
 *   here come back through fms_travel_raise_for_people() instead, to coordinators
 *   only.
 *
 * ⚠ IT GRANTS THE PEOPLE ON IT NOTHING. They are travellers, not users of the
 *   module: no Travel Desk access is needed or given, and the trip still prices
 *   on THEIR band and routes to THEIR managers at submit.
 */
export default function RaiseForSection() {
  const s = useTravelStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: people } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(
    () =>
      (people ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [people],
  );

  const save = async (ids: string[]) => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setRaiseFor(ids);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-bold text-navy">Coordinators can raise for</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-grey-2">
        The people a coordinator may pick as the <strong>Traveller</strong>, whatever department
        they sit in. They do not need Travel Desk access themselves — only their name appears in
        the coordinator&rsquo;s list. A coordinator&rsquo;s own team is always there as well.
      </p>

      <div className="mt-3 max-w-xl">
        <MultiSelect
          values={s.config.raiseFor}
          onChange={save}
          options={options}
          placeholder="— Nobody —"
          disabled={busy}
        />
        {saved && <span className="text-[12px] font-medium text-ryg-green">✓ Saved</span>}
        {err && <p className="mt-2 break-words text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Card>
  );
}
