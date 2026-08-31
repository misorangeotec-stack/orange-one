import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import type { Bucket } from "@/shared/lib/dueBuckets";
import { fmsAdapters } from "@/apps/fms-control-center/adapters/registry";
import type { FmsAdapter, StepBreak } from "@/apps/fms-control-center/adapters/types";
import OwnerContact from "../components/OwnerContact";
import { fetchPcStepOwners, indexStepOwners, stepOwnerKey } from "../data/pcStepOwners";
import type { PcStepOwner } from "../types";

const PC_OWNERS_QK = ["pc", "stepOwners"] as const;

/**
 * Every FMS at a glance, worst first, with the person to call on each stuck step.
 *
 * ⚠ THIS READS THE FMS CONTROL CENTER'S ADAPTERS AND CHANGES NOTHING IN THEM.
 *   The counts must agree with that screen and with each module's own queues, so
 *   they come from the same `fmsAdapters` registry rather than a second
 *   implementation. What this screen adds is the half that contract cannot
 *   express: the adapter stops at `Record<Bucket, number>`, so the PERSON on a
 *   step is joined in here from `pc_step_owner_contacts()`.
 *
 * ⚠ IT DOES NOT FILTER BY hasModule(), unlike MasterControlCenter — deliberately.
 *   That screen shows a viewer only the modules they were granted; this one is
 *   the coordinator's whole book, and the `process-coordinator` grant IS the
 *   permission (the Master Report makes the same call for the same reason).
 *   Reach into other modules' tables comes from the coordinator holding a VIEW
 *   grant on each — see the migration for why it must be `view` and not `edit`.
 *
 * ⚠ EXPANDING SHOWS ONLY THE STEPS THAT ARE DELAYED OR DUE TODAY. A full step
 *   list is what the module's own Control Center is for. A coordinator opens
 *   this to find the problem, so everything that is not a problem stays folded
 *   away.
 */
export default function Processes() {
  const { data: ownerRows, isLoading: ownersLoading } = useQuery({
    queryKey: PC_OWNERS_QK,
    queryFn: fetchPcStepOwners,
    staleTime: 5 * 60_000,
  });

  const ownersByStep = useMemo(() => indexStepOwners(ownerRows ?? []), [ownerRows]);

  const unownedSteps = useMemo(() => {
    let n = 0;
    for (const list of ownersByStep.values()) if (list.length === 0) n += 1;
    return n;
  }, [ownersByStep]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[19px] font-bold text-navy">Processes</h1>
        <p className="text-[13px] text-grey">
          Every process, worst first. Open one to see the steps that are stuck and who to call.
        </p>
      </header>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-page/60 text-left text-[12px] uppercase tracking-wide text-grey-2">
                <th className="px-4 py-2.5 font-semibold">Process</th>
                <th className="px-4 py-2.5 text-right font-semibold">Delayed</th>
                <th className="px-4 py-2.5 text-right font-semibold">Due today</th>
                <th className="px-4 py-2.5 text-right font-semibold">Next 2 days</th>
                <th className="px-4 py-2.5 text-right font-semibold">No date</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {fmsAdapters.map((a) => (
                <ProcessRow
                  key={a.key}
                  adapter={a}
                  open={open.has(a.key)}
                  onToggle={() => toggle(a.key)}
                  ownersByStep={ownersByStep}
                  ownersLoading={ownersLoading}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[12px] text-grey-2">
        <span className="font-semibold text-navy">Delayed</span> means the step's due date has
        already passed.{" "}
        {unownedSteps > 0 ? (
          <>
            <span className="font-semibold text-ryg-red">{unownedSteps}</span>{" "}
            {unownedSteps === 1 ? "step has" : "steps have"} nobody assigned — an unowned step is
            the one nobody is chasing.
          </>
        ) : (
          "Every configured step has an owner."
        )}
      </p>
    </div>
  );
}

/**
 * One process. Its own component because `adapter.useSnapshot()` is a HOOK — the
 * adapter list changes length as modules are added, so calling them in a loop
 * inside one component would break the Rules of Hooks. Same reason
 * `fms-control-center/components/FmsRow.tsx` exists.
 */
function ProcessRow({
  adapter,
  open,
  onToggle,
  ownersByStep,
  ownersLoading,
}: {
  adapter: FmsAdapter;
  open: boolean;
  onToggle: () => void;
  ownersByStep: Map<string, PcStepOwner[]>;
  ownersLoading: boolean;
}) {
  const navigate = useNavigate();
  const { snapshot, isLoading, error } = adapter.useSnapshot();

  if (adapter.status !== "live") return null;

  const cell = (b: Bucket, tone?: string) => (
    <td className={cn("px-4 py-3 text-right tabular-nums", tone)}>
      {snapshot ? (snapshot.total[b] || <span className="text-grey-2/50">·</span>) : "—"}
    </td>
  );

  /** Only what is actually a problem: delayed, or due today. */
  const stuckSteps: StepBreak[] = snapshot
    ? snapshot.steps.filter((s) => s.counts.delayed > 0 || s.counts.today > 0)
    : [];

  return (
    <>
      <tr
        className="cursor-pointer border-b border-line/70 transition hover:bg-page/50"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <span className="font-semibold text-navy">{adapter.name}</span>
          {error ? <span className="ml-2 text-[12px] text-ryg-red">couldn't load</span> : null}
          {isLoading ? <span className="ml-2 text-[12px] text-grey-2">loading…</span> : null}
        </td>
        {cell("delayed", "font-semibold text-ryg-red")}
        {cell("today")}
        {cell("tomorrow")}
        {cell("noDate", "text-grey-2")}
        <td className="px-2 py-3 text-center text-grey-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("inline transition-transform", open && "rotate-90")}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-line/70 bg-page/40">
          <td colSpan={6} className="px-4 py-3">
            {stuckSteps.length === 0 ? (
              <p className="text-[13px] text-grey">
                Nothing delayed or due today in {adapter.name}.
              </p>
            ) : (
              <div className="space-y-2.5">
                {stuckSteps.map((s) => (
                  <div
                    key={s.stepKey}
                    className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1.5 border-b border-line/50 pb-2.5 last:border-0 last:pb-0"
                  >
                    <div className="min-w-[180px]">
                      <div className="font-medium text-navy">{s.label}</div>
                      <div className="text-[12px] text-grey-2">
                        {s.counts.delayed > 0 ? (
                          <span className="font-semibold text-ryg-red">
                            {s.counts.delayed} delayed
                          </span>
                        ) : null}
                        {s.counts.delayed > 0 && s.counts.today > 0 ? " · " : ""}
                        {s.counts.today > 0 ? `${s.counts.today} due today` : ""}
                      </div>
                    </div>
                    {ownersLoading ? (
                      <span className="text-[13px] text-grey-2">loading owners…</span>
                    ) : (
                      <OwnerContact owners={ownersByStep.get(stepOwnerKey(adapter.appId, s.stepKey))} />
                    )}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate(adapter.controlCenterPath);
              }}
              className="mt-3 text-[13px] text-grey underline-offset-2 hover:text-orange hover:underline"
            >
              Open {adapter.name}
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
