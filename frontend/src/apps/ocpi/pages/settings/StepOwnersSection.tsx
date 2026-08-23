import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";
import { setStepOwners } from "../../data/ocpiWrites";
import { STEPS } from "../../lib/steps";

/**
 * Who owns each step — which, for the two approval steps, is who approves.
 *
 * ⚠ THERE IS NO SEPARATE "APPROVERS" SETTING, and that is the design. The
 *   approval gates are ordinary workflow steps, so the people who approve a
 *   quotation are simply the owners of `quotation_approval`. Inventing a second
 *   list would have meant two places to look when somebody cannot approve, and
 *   they would disagree within a month. This is the same shape Order to Dispatch
 *   and Procurement use.
 *
 * ⚠ THE ORIGIN STEP IS SPECIAL, AND IT SAYS SO. With NO owners on `quotation`,
 *   anyone holding an edit grant may raise one; name owners and only they can.
 *   That is a genuinely useful setting and a genuinely confusing one, so the
 *   consequence is spelled out rather than left to be discovered.
 *
 * ⚠ THE LIST IS AUTHORITY, NOT NOTIFICATION. `fms_ocpi_can_act` reads exactly
 *   this, so removing somebody here removes their ability to act, not merely
 *   their alerts.
 */
export default function StepOwnersSection() {
  const s = useOcpiStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
        .map((p) => ({
          value: p.id,
          label: p.name,
          sublabel: p.designation ?? undefined,
        })),
    [people],
  );

  async function save(stepKey: string, ids: string[]) {
    setBusy(stepKey);
    setError(null);
    setSaved(null);
    try {
      await setStepOwners(stepKey, ids);
      await s.refresh();
      setSaved(stepKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-[15px] font-bold text-navy">Who does what</h2>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          The people named against a step are the only ones who can action it — approvers included.
          Admins and process coordinators can always act.
        </p>
      </div>

      {STEPS.map((step) => {
        const current = s.ownersOf(step.key);
        const isOrigin = step.key === "quotation";
        return (
          <div key={step.key} className="rounded-lg border border-line p-3">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-navy">
                {step.index}. {step.title}
              </span>
              {saved === step.key && !busy && (
                <span className="text-[12px] text-grey-2">Saved</span>
              )}
            </div>

            <MultiSelect
              values={current}
              onChange={(ids) => void save(step.key, ids)}
              options={options}
              placeholder={
                isOrigin && current.length === 0
                  ? "Anyone with access can raise a quotation"
                  : "Nobody assigned yet"
              }
              disabled={!s.isAdmin || busy === step.key}
            />

            {isOrigin && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                {current.length === 0
                  ? "Left empty, anyone with edit access to OCPI can raise a quotation. Name people here to restrict it to them."
                  : "Only these people can raise a quotation. Clear the list to open it to everyone with edit access."}
              </p>
            )}
            {step.key === "quotation_approval" && current.length === 0 && (
              <p className="mt-1.5 text-[12px] text-ryg-red">
                Nobody can approve quotations until somebody is named here — a salesperson will be
                able to send one for approval and it will sit there.
              </p>
            )}
          </div>
        );
      })}

      {error && <p className="text-[13px] text-ryg-red">{error}</p>}
      {!s.isAdmin && (
        <p className="text-[12.5px] text-grey-2">Only an admin can change these.</p>
      )}
    </Card>
  );
}
