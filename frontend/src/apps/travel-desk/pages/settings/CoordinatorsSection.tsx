import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useTravelStore } from "../../store";

/**
 * The Travel Desk itself.
 *
 * ⚠ A COORDINATOR CAN ACT ON EVERY STEP, so this is a short list of named
 *   people and not a department. `fms_travel_can_act` returns true for them
 *   before it looks at any step owner, which is what lets the desk book a trip,
 *   upload a ticket, record a refund and raise a request on behalf of senior
 *   management (PRD §3).
 *
 * ⚠ IT DOES NOT LET THEM APPROVE THEIR OWN TRAVEL. That is the one thing the
 *   blanket authority is explicitly cut back on: `fms_travel_decide` refuses
 *   when the traveller is the person deciding, coordinator or not. Without that
 *   guard the desk could raise a trip for themselves and wave it through, and
 *   `can_act` would have said yes.
 */
export default function CoordinatorsSection() {
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
      await s.setCoordinators(ids);
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
      <h2 className="text-[15px] font-bold text-navy">Travel Desk coordinators</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-grey-2">
        The people who run the desk. They can action any step and raise a request on somebody's
        behalf — but not approve their own travel, which the database refuses for everyone.
      </p>

      <div className="mt-3 max-w-xl">
        <MultiSelect
          values={s.config.processCoordinators}
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
