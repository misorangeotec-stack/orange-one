import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { dmy, inr } from "../../lib/format";
import { planAdherence, type PlanAdherence } from "../../data/ldWrites";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/**
 * The year's training plan — what HR intends to run, month by month.
 *
 * This is the half of the module the source document does not describe. It is
 * request-driven throughout; Saloni's KPI sheet scores "annual training calendar
 * published by January" and "planned sessions completed as scheduled", and
 * neither means anything without a plan to measure against.
 *
 * ⚠ PUBLISHING IS ONE-WAY. A published plan is frozen and a change makes a new
 *   revision that supersedes it, keeping the original readable. That is what
 *   makes the publication date evidence rather than decoration: a plan that can
 *   be quietly rewritten in November can be back-fitted to whatever happened.
 */
export default function AnnualPlan() {
  const s = useLdStore();
  const d = s.data;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adherence, setAdherence] = useState<PlanAdherence | null>(null);

  // new-line form
  const [month, setMonth] = useState("");
  const [title, setTitle] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [headcount, setHeadcount] = useState("");
  const [hours, setHours] = useState("");
  const [cost, setCost] = useState("");

  const plans = d?.plans ?? [];
  const live = useMemo(
    () =>
      [...plans]
        .filter((p) => p.status !== "superseded")
        .sort((a, b) => b.fyCode.localeCompare(a.fyCode) || b.revision - a.revision)[0],
    [plans],
  );
  const lines = (d?.planLines ?? []).filter((l) => l.planId === live?.id);
  const mayPlan = s.isPipelineStaff;

  useEffect(() => {
    void planAdherence().then(setAdherence).catch(() => setAdherence(null));
  }, [d?.sessions, d?.planLines]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      await s.refresh();
      after?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!live) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Annual training plan</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            What you intend to run this year, month by month. Publishing it is what makes
            &ldquo;did we run what we planned&rdquo; answerable.
          </p>
        </div>
        <Card className="p-6 text-center">
          <p className="text-[13.5px] text-navy">No plan started for this year yet.</p>
          {mayPlan ? (
            <Button
              className="mt-4"
              disabled={busy}
              onClick={() =>
                void run(() => s.writes.createPlan({ title: `Training plan ${new Date().getFullYear()}` }))
              }
            >
              Start this year&rsquo;s plan
            </Button>
          ) : (
            <p className="mt-2 text-[13px] text-grey-2">HR builds the plan.</p>
          )}
          {err && <p className="mt-3 text-[13px] text-[#B42318]">{err}</p>}
        </Card>
      </div>
    );
  }

  const draft = live.status === "draft";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">{live.title}</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {draft ? (
              <>Draft — nobody sees this as a commitment until it is published.</>
            ) : (
              <>
                Published {dmy(live.publishedAt)}
                {live.revision > 1 && ` · revision ${live.revision}`}
              </>
            )}
          </p>
        </div>
        {mayPlan && (
          <div className="flex gap-2">
            {draft ? (
              <Button disabled={busy || lines.length === 0} onClick={() => void run(() => s.writes.publishPlan(live.id))}>
                Publish the plan
              </Button>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => s.writes.revisePlan(live.id))}>
                Start a revision
              </Button>
            )}
          </div>
        )}
      </div>

      {adherence && !draft && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-navy mb-3">Are we running what we planned?</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <div className="text-[11.5px] uppercase tracking-wide text-grey-2">Adherence</div>
              <div className="text-[22px] font-bold text-navy">
                {adherence.adherence_pct === null ? "—" : `${adherence.adherence_pct}%`}
              </div>
              <div className="text-[12px] text-grey-2">
                {adherence.lines_met} of {adherence.lines_due} due so far
              </div>
            </div>
            <div>
              <div className="text-[11.5px] uppercase tracking-wide text-grey-2">Planned this year</div>
              <div className="text-[22px] font-bold text-navy">{adherence.lines_total}</div>
            </div>
            <div>
              <div className="text-[11.5px] uppercase tracking-wide text-grey-2">Ad-hoc</div>
              <div className="text-[22px] font-bold text-navy">{adherence.ad_hoc_sessions}</div>
              <div className="text-[12px] text-grey-2">Run but not planned</div>
            </div>
            <div>
              <div className="text-[11.5px] uppercase tracking-wide text-grey-2">Published</div>
              <div className="text-[14px] font-semibold text-navy">{dmy(adherence.published_at)}</div>
            </div>
          </div>
          {/* Only months that have ARRIVED count. A plan published in January is
              not failing because December has not happened. */}
          <p className="mt-2 text-[12px] text-grey-2">
            Adherence counts only the months that have already come round, and a planned training counts
            as done only once its session was actually conducted.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-navy mb-3">
          The plan {lines.length > 0 && `· ${lines.length} trainings`}
        </h2>
        {lines.length === 0 ? (
          <p className="text-[13px] text-grey-2">Nothing planned yet.</p>
        ) : (
          <div className="space-y-1.5">
            {lines.map((l) => {
              const linked = s.sessions.find((x) => x.planLineId === l.id);
              return (
                <div
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="inline-block w-24 text-[12.5px] font-semibold text-grey-2">
                      {MONTHS[Number(l.plannedMonth.slice(5, 7)) - 1]}
                    </span>
                    <span className="text-[13.5px] text-navy">{l.title}</span>
                    {l.plannedHeadcount && (
                      <span className="ml-2 text-[12px] text-grey-2">{l.plannedHeadcount} people</span>
                    )}
                    {l.estimatedCost != null && (
                      <span className="ml-2 text-[12px] text-grey-2">{inr(l.estimatedCost)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {linked ? (
                      <span
                        className={
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                          (linked.outcome === "conducted" || linked.outcome === "partially_conducted"
                            ? "bg-[#E8F7EE] text-ryg-green"
                            : "bg-[#EAF1FE] text-blue")
                        }
                      >
                        {linked.outcome ? "Ran" : "Scheduled"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#F1F4F9] px-2 py-0.5 text-[11px] font-semibold text-grey-2">
                        Not scheduled
                      </span>
                    )}
                    {mayPlan && draft && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void run(() => s.writes.deletePlanLine(l.id))}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {mayPlan && draft && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FieldLabel label="Month" required>
                <Combobox
                  value={month}
                  onChange={setMonth}
                  options={MONTHS.map((m, i) => {
                    const y = new Date().getFullYear();
                    return { value: `${y}-${String(i + 1).padStart(2, "0")}-01`, label: `${m} ${y}` };
                  })}
                  placeholder="Pick a month"
                />
              </FieldLabel>
              <FieldLabel label="What training?" required>
                <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="How many people?">
                <TextInput type="number" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="Estimated cost">
                <TextInput type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
              </FieldLabel>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Type">
                <MultiSelect
                  values={typeIds}
                  onChange={setTypeIds}
                  chips
                  options={(d?.sessionTypes ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                  placeholder="Any"
                />
              </FieldLabel>
              <FieldLabel label="Who is it for?" hint="Leave empty for the whole company.">
                <MultiSelect
                  values={deptIds}
                  onChange={setDeptIds}
                  chips
                  options={s.orgDepartments.map((x) => ({ value: x.id, label: x.name }))}
                  placeholder="Everyone"
                />
              </FieldLabel>
            </div>
            <div className="flex items-end gap-2">
              <FieldLabel label="Hours">
                <TextInput type="number" value={hours} onChange={(e) => setHours(e.target.value)} className="w-24" />
              </FieldLabel>
              <Button
                disabled={busy || !month || !title.trim()}
                onClick={() =>
                  void run(
                    () =>
                      s.writes.upsertPlanLine({
                        planId: live.id,
                        plannedMonth: month,
                        title: title.trim(),
                        sessionTypeIds: typeIds,
                        departmentIds: deptIds,
                        plannedHeadcount: headcount === "" ? null : Number(headcount),
                        plannedHours: hours === "" ? null : Number(hours),
                        estimatedCost: cost === "" ? null : Number(cost),
                      }),
                    () => {
                      setTitle("");
                      setHeadcount("");
                      setHours("");
                      setCost("");
                      setTypeIds([]);
                      setDeptIds([]);
                    },
                  )
                }
              >
                Add to the plan
              </Button>
            </div>
          </div>
        )}

        {err && <p className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
        {!draft && mayPlan && (
          <p className="mt-3 text-[12px] text-grey-2">
            This plan is published and frozen. Start a revision to change it — the published version stays
            readable, which is what makes its date mean anything.
          </p>
        )}
      </Card>
    </div>
  );
}
