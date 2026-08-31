import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useTravelStore } from "../../store";
import { STEPS, MANAGER_STEPS } from "../../lib/steps";

/**
 * Who owns each step — which, at the two approval gates, is who may approve.
 *
 * ⚠ THERE IS NO SEPARATE "APPROVERS" LIST, and that is the design. The gates are
 *   ordinary workflow steps, so the people who can approve a trip are simply the
 *   owners of `manager_approval` and `director_approval`. A second list would be
 *   a second place to look when somebody cannot approve, and the two would
 *   disagree within a month.
 *
 * ⚠ THE TWO MANAGER STEPS ARE **ADDITIVE**, NOT REPLACEMENTS. `manager_approval`
 *   and `claim_review` route per-trip to the traveller's own reporting managers,
 *   snapshotted from `user_hods` when the trip was submitted. Naming people here
 *   ADDS them — it does not take the manager's authority away — and that is what
 *   gives HR the PRD's "same permissions as the HOD" without being named on
 *   every trip. `fms_travel_can_act` deliberately does not early-return on that
 *   arm; hr-recruitment's equivalent does, and hr-exit names that as the bug it
 *   avoided.
 *
 *   It is also the safety net for the 19 of 60 people who have no reporting
 *   manager on record: their trips route here rather than dead-ending.
 *
 * ⚠ THE ORIGIN STEP IS SPECIAL AND SAYS SO. With NO owners on `request`, anyone
 *   holding an edit grant may raise a trip; name owners and only they can. That
 *   is a genuinely useful setting and a genuinely surprising one, so the
 *   consequence is spelled out rather than left to be discovered.
 *
 * ⚠ THIS LIST IS AUTHORITY, NOT NOTIFICATION. `fms_travel_can_act` reads exactly
 *   it, so removing somebody removes their ability to act, not merely their
 *   alerts.
 */
export default function StepOwnersSection() {
  const s = useTravelStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [people],
  );

  const save = async (stepKey: string, ids: string[]) => {
    setBusy(stepKey);
    setErr(null);
    setSaved(null);
    try {
      await s.setStepOwners(stepKey as never, { employeeIds: ids });
      setSaved(stepKey);
      setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-bold text-navy">Step owners</h2>
      <p className="mt-1 max-w-3xl text-[13px] text-grey-2">
        Who may action each step. This is authority, not a mailing list — removing somebody here
        takes away what they can do, not just what they are told about.
      </p>

      {err && <p className="mt-3 break-words text-[12.5px] text-ryg-red">{err}</p>}

      <div className="mt-4 space-y-4">
        {STEPS.map((st) => {
          const ids = s.ownersOf(st.key);
          const isManagerStep = MANAGER_STEPS.includes(st.key);
          return (
            <div key={st.key} className="grid gap-2 border-b border-line pb-4 last:border-b-0 last:pb-0 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <div className="text-[13px] font-semibold text-navy">
                  {st.index}. {st.title}
                </div>
                <div className="text-[11.5px] text-grey-2">
                  {st.key === "request" ? (
                    ids.length ? (
                      <>Only these people may raise a trip.</>
                    ) : (
                      <>
                        <strong className="text-navy">Nobody named</strong> — anyone with an edit
                        grant may raise a trip. Name someone to restrict it.
                      </>
                    )
                  ) : isManagerStep ? (
                    <>
                      Added <strong className="text-navy">alongside</strong> the traveller's own
                      reporting manager, never instead of them. This is also where a trip goes when
                      the traveller has no manager on record.
                    </>
                  ) : ids.length ? (
                    <>{ids.length === 1 ? "1 person owns" : `${ids.length} people own`} this step.</>
                  ) : (
                    <span className="text-ryg-red">
                      Nobody owns this step, so nothing can move past it.
                    </span>
                  )}
                </div>
              </div>
              <div>
                <MultiSelect
                  values={ids}
                  onChange={(v) => save(st.key, v)}
                  options={options}
                  placeholder="— Nobody —"
                  disabled={busy === st.key}
                />
                {saved === st.key && (
                  <span className="text-[12px] font-medium text-ryg-green">✓ Saved</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
