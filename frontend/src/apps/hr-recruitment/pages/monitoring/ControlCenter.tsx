import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import SharedKpi from "@/shared/components/ui/Kpi";
import StepPipeline, { type StepPipelineNode } from "@/shared/components/ui/StepPipeline";
import { SectionHeading } from "@/shared/components/ui/Readout";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { EMPTY_COUNTS, bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { formatDate } from "@/shared/lib/time";
import { useHrStore } from "../../store";
import { STAGES, STEPS, stepByKey, type StepKey } from "../../lib/steps";
import type { QueueEntry } from "../../lib/queues";

/**
 * HR Recruitment Control Center — the process coordinator's view of what is late,
 * across every vacancy, candidate and new hire.
 *
 * Everything derives from `store.queueEntries` — the output of `lib/queues.ts`,
 * which is the SAME list the individual queue pages narrow and the cross-FMS
 * scoreboard counts. So the Delayed number here is Purchase-style identical to the
 * HR row on the master Control Center: not because two calculations agree, but
 * because there is only one calculation.
 *
 * An entry is one **(step, entity)** work-item, not an entity — the unit a
 * coordinator actually chases. A requisition being approved and a candidate on it
 * awaiting an interview are two rows, because they are two calls to make.
 */

type Scope = "delayed" | "today" | "noDate" | "all";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "delayed", label: "Delayed" },
  { value: "today", label: "Due today" },
  { value: "noDate", label: "No date" },
  { value: "all", label: "All" },
];

/** Steps that can hold work. `mrf` is declared `noQueue` — raising it IS the event. */
const QUEUE_STEPS = STEPS.filter((s) => !s.noQueue);

/**
 * The stage grouping lives in lib/steps.ts — the scoreboard's HR row groups by the same
 * four stages, and two hand-kept lists is how the two screens would come to describe the
 * same workflow differently.
 *
 * The bottleneck and the severity bars are still scaled across ALL steps (see StepPipeline):
 * probation naturally carries smaller numbers than CV screening, and scaling each stage
 * against itself would flatter it into looking like a crisis.
 */
export default function ControlCenter() {
  const s = useHrStore();
  /** Empty = no step filter — the portal's multi-select convention. */
  const [selectedSteps, setSelectedSteps] = useState<StepKey[]>([]);
  const [scope, setScope] = useState<Scope>("delayed");

  const today = todayLocalIso();

  // ---- one pass: KPI totals + per-step delayed/today/total ----
  // One walk, one bucketing, so the tiles and the strip cannot disagree: every entry is
  // counted into both, or into neither.
  const { counts, nodes } = useMemo(() => {
    const totals: Record<Bucket, number> = { ...EMPTY_COUNTS };
    const perStep = new Map<StepKey, { delayed: number; today: number; total: number }>();
    for (const st of QUEUE_STEPS) perStep.set(st.key, { delayed: 0, today: 0, total: 0 });

    for (const e of s.queueEntries) {
      const b = bucketOf(e.dueIso, today);
      if (b) totals[b]++;
      const rec = perStep.get(e.stepKey);
      if (!rec) continue;
      rec.total++; // every item, whatever its date — this is what makes the ✓ honest
      if (b === "delayed") rec.delayed++;
      else if (b === "today") rec.today++;
    }

    const pipeline: StepPipelineNode<StepKey>[] = QUEUE_STEPS.map((st) => ({
      stepKey: st.key,
      index: st.index,
      label: st.short,
      ...perStep.get(st.key)!,
    }));
    return { counts: totals, nodes: pipeline };
  }, [s.queueEntries, today]);

  /**
   * Parked vacancies — counted SEPARATELY, and deliberately not as work-items.
   *
   * A held requisition is a status, not a job someone owes. Feeding it into the work
   * queue would have inflated the "no date" tile, reported it on the dashboard as work
   * owed by "Nobody", and silently moved the numbers on the cross-FMS scoreboard that
   * Purchase also reads — all with no code change and no review. But leaving it out
   * entirely is how a budget freeze in March quietly becomes a vacancy nobody reopened.
   * So: visible, dated, and never red.
   */
  const held = useMemo(
    () =>
      s.requisitions
        .filter((r) => r.status === "on_hold")
        .map((r) => ({
          r,
          days: r.holdAt
            ? Math.max(0, Math.floor((Date.now() - new Date(r.holdAt).getTime()) / 86_400_000))
            : null,
        }))
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    [s.requisitions],
  );

  const rows = useMemo(() => {
    const sel = new Set(selectedSteps);
    return s.queueEntries
      .filter((e) => {
        if (sel.size && !sel.has(e.stepKey)) return false;
        const b = bucketOf(e.dueIso, today);
        if (scope === "delayed") return b === "delayed";
        if (scope === "today") return b === "today";
        if (scope === "noDate") return b === "noDate";
        return true;
      })
      .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"));
  }, [s.queueEntries, selectedSteps, scope, today]);

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";

  const mrfOf = (e: QueueEntry) => (e.requisitionId ? s.requisitionById(e.requisitionId) : undefined);

  /** What this row is about, in one line — a job title, or the person it concerns. */
  const detailOf = (e: QueueEntry): string => {
    const r = mrfOf(e);
    if (e.entityType === "requisition") return r?.jobTitle ?? "—";
    return `${r?.jobTitle ?? "—"} · ${e.ref}`;
  };

  const ownerNames = (e: QueueEntry): string => {
    const names = s
      .queueOwnerIds(e)
      .map((id) => s.profileById(id)?.name)
      .filter(Boolean) as string[];
    return names.length ? names.join(", ") : "Unassigned";
  };

  const ownerCell = (e: QueueEntry) => {
    const owners = s
      .queueOwnerIds(e)
      .map((id) => s.profileById(id))
      .filter(Boolean);
    if (!owners.length) return <span className="text-grey-2">Unassigned</span>;
    return (
      <div className="space-y-0.5">
        {owners.map((p) => (
          <div key={p!.id} className="leading-tight">
            <div className="text-navy">{p!.name}</div>
            {p!.phone ? (
              <div className="text-[12px] tabular-nums text-grey-2">{p!.phone}</div>
            ) : (
              <div className="text-[12px] italic text-grey-2/60">no number</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const columns: QueueColumn<QueueEntry>[] = [
    {
      key: "mrf",
      header: "MRF",
      cell: (e) => {
        const r = mrfOf(e);
        if (!r) return <span className="text-grey-2">—</span>;
        return (
          <Link to={`/hr-recruitment/requisitions/${r.id}`} className="font-semibold text-orange hover:underline">
            {r.mrfNo}
          </Link>
        );
      },
      sortValue: (e) => mrfOf(e)?.mrfNo ?? "",
      filter: { kind: "text", get: (e) => mrfOf(e)?.mrfNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "detail",
      header: "Position / person",
      cell: (e) => <span className="text-navy">{detailOf(e)}</span>,
      sortValue: (e) => detailOf(e),
      filter: { kind: "text", get: (e) => detailOf(e) },
    },
    {
      key: "step",
      header: "Stage",
      cell: (e) => <span className="text-grey">{stepByKey(e.stepKey)?.short ?? e.stepKey}</span>,
      sortValue: (e) => stepByKey(e.stepKey)?.index ?? 0,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.short ?? e.stepKey },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "owner",
      header: "Owner",
      cell: ownerCell,
      sortValue: ownerNames,
      filter: { kind: "select", get: ownerNames },
      exportValue: ownerNames,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      cell: (e) => <DueChip dueIso={e.dueIso} todayIso={today} />,
      sortValue: (e) => e.dueIso ?? "9999-99-99",
      filter: { kind: "date", get: (e) => e.dueIso ?? "" },
      exportValue: (e) => (e.dueIso ? e.dueIso.split("-").reverse().join("-") : "No date"),
      tdClassName: "whitespace-nowrap",
    },
  ];

  const pending = counts.delayed + counts.today;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">HR Recruitment Control Center</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Pending recruitment work by the day it falls due. Each row is one <strong>step</strong> of work on one thing —
          the same vacancy can be waiting at two steps at once. Find what's late, then call the owner.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Today's pending" value={pending} hint="delayed + due today" hero tone={pending > 0 ? "red" : undefined} />
        <Kpi label="In queue (today)" value={counts.today} hint="due today" />
        <Kpi label="Delayed" value={counts.delayed} hint="past due" tone={counts.delayed > 0 ? "red" : undefined} />
        <Kpi label="Tomorrow" value={counts.tomorrow} hint="in queue" />
        <Kpi label="Day after" value={counts.dayAfter} hint="in queue" />
      </div>

      <Card className="p-4">
        <SectionHeading className="mb-3">Where it's stuck</SectionHeading>
        <StepPipeline<StepKey>
          nodes={nodes}
          selectedKeys={selectedSteps}
          groups={STAGES}
          onChange={(next) => {
            setSelectedSteps(next);
            // Picking a step means "show me what's late here" — leaving the scope on
            // "Delayed" is the only reading of that click which isn't a lie.
            if (next.length) setScope("delayed");
          }}
        />

        {held.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-grey">On hold</span>
              <span className="text-[12px] text-grey">
                {held.length} {held.length === 1 ? "vacancy" : "vacancies"} parked — paused on purpose, so never
                counted as late. But not forgotten either.
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {held.map(({ r, days }) => (
                <Link
                  key={r.id}
                  to={`/hr-recruitment/requisitions/${r.id}`}
                  title={r.holdReason ?? undefined}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-page/60 px-2.5 py-1.5 text-[12px] transition hover:border-orange/40"
                >
                  <span className="font-semibold text-navy">{r.mrfNo}</span>
                  <span className="max-w-[180px] truncate text-grey">{r.jobTitle}</span>
                  {days !== null && <span className="font-semibold text-grey-2">{days}d</span>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {SCOPES.map((sc) => {
              const n = sc.value === "all" ? null : counts[sc.value as Bucket];
              return (
                <button
                  key={sc.value}
                  type="button"
                  onClick={() => setScope(sc.value)}
                  aria-pressed={scope === sc.value}
                  className={`h-9 border-r border-line px-3.5 text-[12.5px] font-semibold transition-colors last:border-r-0 ${
                    scope === sc.value ? "bg-orange/10 text-orange" : "text-grey-2 hover:bg-page/60 hover:text-navy"
                  }`}
                >
                  {sc.label}
                  {n !== null && n > 0 && <span className="ml-1.5 text-[11px] opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          {selectedSteps.length > 0 && (
            <span className="text-[12px] text-grey">
              {selectedSteps.length} step{selectedSteps.length === 1 ? "" : "s"} selected
            </span>
          )}
        </div>

        <QueueTable<QueueEntry>
          rows={rows}
          rowKey={(e) => `${e.stepKey}:${e.entityId}`}
          columns={columns}
          groupBy={{
            idOf: (e) => e.departmentId,
            nameOf: deptName,
            allLabel: "All departments",
            label: "Department",
          }}
          rowClassName={(e) => (bucketOf(e.dueIso, today) === "delayed" ? "bg-[#FDECEC]/40" : "")}
          rowsLabel="work items"
          emptyTitle="Nothing here"
          emptyMessage="No recruitment work matches this step selection and filter."
          exportName="HR_Control_Center"
          exportTitle="HR work items"
          exportNotes={[
            "One row = one step of work on one requisition, candidate or new hire. The same vacancy can appear twice if it is waiting at two steps.",
            "Due dates come from the step's configured rule (Setup → Due Dates). Probation reviews are counted in calendar months from the joining date, everything else in working days (Mon–Sat).",
            "'Delayed' = due before today. 'No date' = the step has no rule configured, so it can never be late.",
            "Owner: HOD steps belong to whoever raised that requisition; every other step reads Setup → Step Owners.",
          ]}
          actions={(e) =>
            e.requisitionId ? (
              <Link
                to={`/hr-recruitment/requisitions/${e.requisitionId}`}
                className="text-[12.5px] font-semibold text-orange hover:underline"
              >
                Open
              </Link>
            ) : null
          }
        />
      </Card>
    </div>
  );
}

/** The entry's due date with a Delayed / Today / Tomorrow chip — the same four-way bucket the KPIs use. */
function DueChip({ dueIso, todayIso }: { dueIso: string | null; todayIso: string }) {
  if (!dueIso) return <span className="text-grey-2">No date</span>;
  const b = bucketOf(dueIso, todayIso);
  const chip =
    b === "delayed"
      ? { cls: "bg-[#FDECEC] text-ryg-red", text: "Delayed" }
      : b === "today"
        ? { cls: "bg-[#FFF7E6] text-yellow", text: "Today" }
        : b === "tomorrow"
          ? { cls: "bg-page text-grey-2", text: "Tomorrow" }
          : null;
  return (
    <span className={b === "delayed" ? "font-semibold text-ryg-red" : b === "today" ? "font-medium text-yellow" : "text-grey"}>
      {formatDate(dueIso)}
      {chip && (
        <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide ${chip.cls}`}>
          {chip.text}
        </span>
      )}
    </span>
  );
}

/** Same tile as the dashboard's, one size down — hence `size` on the shared component. */
function Kpi({ label, value, hint, tone, hero }: { label: string; value: number; hint?: string; tone?: "red"; hero?: boolean }) {
  return <SharedKpi label={label} value={value} hint={hint} tone={tone} size={hero ? "hero" : "md"} />;
}
