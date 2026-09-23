/**
 * Three scoring rules, one person, one period (KPI-3, read-only).
 *
 * Saloni's document gives TWO rules and the hub already runs a THIRD, and on the
 * client's own MIS figures they disagree by several points. Which one governs is the
 * first question HR has to answer, and it is much easier to answer looking at the three
 * numbers on real data than reading three formulas.
 *
 *   1 · The live scorecard (KPI-1)   on time 1, late ½, not done 0, over work given.
 *                                    Volume-weighted across everything she works.
 *   2 · The document's own formula   (completion % × 50) + (on-time % × 50), where the
 *                                    on-time rate divides by work DONE, not given.
 *   3 · This framework               Σ (achievement × weight) over 44 declared lines.
 *
 * They are not variants of one rule. The first two measure the same pool of work two
 * ways; the third measures a different thing entirely and only overlaps at KRA 3.
 */
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import { useSession } from "@/core/platform/session";
import { computeDownlineIds, useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";
import { saloniFramework } from "../framework/saloni";
import { useLabData } from "../data/actuals";
import { docFiftyFifty, fmt, kpi1Score } from "../lib/achievement";
import { kpi1Counts, overallTotals, scoreLines } from "../lib/rows";
import { loadManual, type ManualMap } from "../lib/manual";
import { defaultPeriod, periodLabel, type Period } from "../lib/period";
import PeriodBar from "../components/PeriodBar";

function Rule({
  n,
  name,
  score,
  basis,
  note,
  strong,
}: {
  n: number;
  name: string;
  score: string;
  basis: string;
  note: string;
  strong?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${strong ? "border-orange/40 bg-orange/[0.04]" : "border-line bg-white"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">Rule {n}</span>
        <span className="text-[32px] font-bold leading-none tabular-nums text-navy">{score}</span>
      </div>
      <div className="mt-2 text-[13px] font-semibold text-navy">{name}</div>
      <div className="mt-0.5 font-mono text-[11px] text-grey">{basis}</div>
      <p className="mt-2 text-[11.5px] leading-snug text-grey">{note}</p>
    </div>
  );
}

export default function Compare() {
  const { user, isAdmin } = useSession();
  const { profiles } = useDirectory();
  const framework = saloniFramework;
  const [period, setPeriod] = useState<Period>(defaultPeriod);

  const pool = useMemo<Profile[]>(() => {
    const by = (a: Profile, b: Profile) => a.name.localeCompare(b.name);
    if (isAdmin) return profiles.filter((p) => !p.isExternal || p.id === user.id).sort(by);
    const ids = new Set([user.id, ...computeDownlineIds(profiles, user.id)]);
    const list = profiles.filter((p) => ids.has(p.id));
    if (!list.some((p) => p.id === user.id)) list.push(user);
    return list.sort(by);
  }, [isAdmin, profiles, user]);

  const saloni = pool.find((p) => /saloni/i.test(p.name));
  const [personId, setPersonId] = useState<string>("");
  const activeId = personId || saloni?.id || user.id;
  const person = pool.find((p) => p.id === activeId) ?? user;

  const [manual, setManual] = useState<ManualMap>({});
  useEffect(() => {
    setManual(loadManual(framework.id, activeId, period.from, period.to));
  }, [framework.id, activeId, period.from, period.to]);

  // ⚠ The SAME params the scorecard fetched with. Passing {} here scored rule 3 without
  // the TAT a reader had typed on the other tab, so the two pages showed 83.8 and 91.5
  // for one person in one month — the kind of disagreement that discredits the whole
  // demonstration. `useLabData` keys its cache on these, so both tabs share one fetch.
  const params = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [code, e] of Object.entries(manual)) out[code] = e.param ?? null;
    return out;
  }, [manual]);

  const q = useLabData(activeId, period.from, period.to, params);
  const data = q.data ?? { report: null, hr: {}, hrError: null };

  const counts = useMemo(() => kpi1Counts(data), [data]);
  const totals = useMemo(() => overallTotals(scoreLines(framework, data, manual)), [framework, data, manual]);

  const live = kpi1Score(counts.given, counts.done, counts.onTime);
  const doc = docFiftyFifty(counts.given, counts.done, counts.onTime);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-orange/35 bg-orange/[0.05] px-4 py-2.5 text-[12px] text-navy">
        <span className="font-semibold">A comparison of the three scoring rules.</span> Nothing here is written anywhere.
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="w-full sm:w-auto">
            <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">Person</label>
            <Combobox
              value={activeId}
              onChange={setPersonId}
              disabled={pool.length <= 1}
              className="w-full sm:min-w-[260px]"
              options={pool.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.designation ?? undefined,
                icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
              }))}
            />
          </div>
          <PeriodBar period={period} onChange={setPeriod} />
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-grey">
          {person.name} · {periodLabel(period)} · {counts.given} given, {counts.done} done, {counts.onTime} on time
          across every module she works.
        </p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Rule
          n={1}
          name="The live KRA / KPI Scorecard"
          score={fmt(live)}
          basis="(on time + ½ late) ÷ given"
          note="What the hub scores her at today, across Task Management and every FMS module. Volume-weighted: the busiest row dominates."
        />
        <Rule
          n={2}
          name="The document's own formula"
          score={fmt(doc, 2)}
          basis="(done ÷ given × 50) + (on time ÷ done × 50)"
          note="Its 'Common Orange Hub Scoring Logic' box. Same pool of work as rule 1, scored differently — and the on-time half divides by work done, not work given."
        />
        <Rule
          n={3}
          name="This weighted framework"
          score={fmt(totals.onWhatWeHave)}
          basis="Σ (achievement × weight)"
          note={`Over the ${totals.scoredWeight}% of the sheet that could be measured. A different question entirely — it scores the job description, not the workload.`}
          strong
        />
      </div>

      <Card className="p-4 sm:p-5">
        <h2 className="text-[13px] font-semibold text-navy">Why they differ, on the client&apos;s own figures</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-grey">
          The weekly MIS sheet the client keeps by hand shows 127 given, 118 done and 110 on time. Rule 1 scores that{" "}
          <span className="font-semibold text-navy">{fmt(kpi1Score(127, 118, 110))}</span>; rule 2 scores it{" "}
          <span className="font-semibold text-navy">{fmt(docFiftyFifty(127, 118, 110), 2)}</span>. Same three numbers,
          three and a quarter points apart — because rule 1 gives a late task half a mark, and rule 2 gives every
          completed task a full mark in its first half and then judges lateness only among the ones that finished.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-grey">
          Rule 3 cannot be reconciled with either, and is not meant to be. It asks whether the <em>role</em> was
          performed — a position closed inside its TAT counts for ten times a training assignment circulated on time,
          no matter how many of each there were. That is the choice in front of HR: rules 1 and 2 measure throughput,
          rule 3 measures the job.
        </p>
        <p className="mt-2 text-[11.5px] text-grey-2">
          My reading is that the document intends rule 2 as the <em>per-line</em> rule for its task-shaped KPIs, with
          rule 3&apos;s weights rolling those up — but the document does not say so, and the two are printed as if they
          were one thing.
        </p>
      </Card>
    </div>
  );
}
