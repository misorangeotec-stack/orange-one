import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import SharedKpi from "@/shared/components/ui/Kpi";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDate } from "@/shared/lib/time";
import { EMPTY_COUNTS, bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { useProcurementStore } from "../../store";
import { inr } from "../../lib/format";
import { STEPS, stepByKey, type StepKey } from "../../lib/steps";
import type { QueueEntry } from "../../lib/queues";
import { ownerResolver } from "../../lib/owners";
import { linkResolver } from "../../lib/links";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StepPipeline, { type StepPipelineNode } from "@/shared/components/ui/StepPipeline";
import type { RequestItem } from "../../types";
import { appName } from "@/apps/appInfo";

/** What the table is currently showing. Clicking a pipeline step pins this to "delayed". */
type Scope = "delayed" | "today" | "noDate" | "all";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "delayed", label: "Delayed" },
  { value: "today", label: "Due today" },
  { value: "noDate", label: "No date" },
  { value: "all", label: "All" },
];

/** The steps that can hold queue work. `request` is declared `noQueue` — it never enters one. */
const PIPELINE_STEPS = STEPS.filter((s) => !s.noQueue);

/**
 * Purchase FMS Control Center — the process coordinator's view of what is late.
 *
 * Everything derives from `store.queueEntries` (the shared `buildQueueEntries`
 * output), which is the exact list the cross-FMS scoreboard counts. So the
 * Delayed KPI here always equals Purchase's Delayed there — they cannot drift.
 *
 * An entry is one (step, entity) work-item, so the same PO can appear at two
 * steps at once. That is intentional: it is two units of work.
 */
export default function ControlCenter() {
  const s = useProcurementStore();
  const [reassign, setReassign] = useState<RequestItem | null>(null);
  /** Empty = no step filter (every step shows), matching the multi-select convention. */
  const [selectedSteps, setSelectedSteps] = useState<StepKey[]>([]);
  const [scope, setScope] = useState<Scope>("delayed");

  const todayIso = todayLocalIso();
  const bucketFor = (e: QueueEntry): Bucket | null => bucketOf(e.dueIso, todayIso);

  // ---- one pass: KPI totals + per-step delayed/today/total counts ----
  const { counts, nodes } = useMemo(() => {
    const totals: Record<Bucket, number> = { ...EMPTY_COUNTS };
    const perStep = new Map<StepKey, { delayed: number; today: number; total: number }>();
    for (const st of PIPELINE_STEPS) perStep.set(st.key, { delayed: 0, today: 0, total: 0 });

    for (const e of s.queueEntries) {
      const b = bucketOf(e.dueIso, todayIso);
      if (b) totals[b]++;
      const rec = perStep.get(e.stepKey);
      if (!rec) continue;
      // Counted regardless of bucket — including the far-future ones bucketOf returns
      // null for. This is what lets a step's ✓ mean "empty" instead of "nothing due in
      // the next 24 hours", which is what it used to claim while holding work.
      rec.total++;
      if (b === "delayed") rec.delayed++;
      else if (b === "today") rec.today++;
    }

    const pipeline: StepPipelineNode<StepKey>[] = PIPELINE_STEPS.map((st) => ({
      stepKey: st.key,
      index: st.index,
      label: st.short,
      ...perStep.get(st.key)!,
    }));
    return { counts: totals, nodes: pipeline };
  }, [s.queueEntries, todayIso]);

  const pending = counts.delayed + counts.today;

  // ---- row derivation: QueueEntry carries no owner / display detail ----
  const lineOf = (e: QueueEntry) => s.lineById(e.entityId);

  const detailOf = (e: QueueEntry): string => {
    if (e.entityType === "request") {
      const lines = s.itemsForRequest(e.entityId);
      const first = lines[0] ? s.itemById(lines[0].itemId)?.name ?? "" : "";
      return lines.length === 1 ? first : `${lines.length} items${first ? ` · ${first}…` : ""}`;
    }
    if (e.entityType === "line") {
      const l = lineOf(e);
      return l ? s.itemLabel(l.itemId) : "—";
    }
    return s.vendorById(s.poById(e.entityId)?.vendorId ?? null)?.name ?? "—";
  };

  // Owner + link rules live in lib/ so the home screen's My Work list can reuse
  // them without mounting this store. Memoised on the arrays they read.
  const linkOf = useMemo(() => linkResolver(s.requestItems), [s.requestItems]);
  const { ownerIdsOf } = useMemo(
    () => ownerResolver({ stepOwners: s.stepOwners, approvalBands: s.approvalBands, requestItems: s.requestItems }),
    [s.stepOwners, s.approvalBands, s.requestItems]
  );

  const ownerNames = (e: QueueEntry): string => {
    const names = ownerIdsOf(e)
      .map((id) => s.profileById(id)?.name)
      .filter(Boolean) as string[];
    return names.length ? names.join(", ") : "Unassigned";
  };

  const ownerCell = (e: QueueEntry) => {
    const owners = ownerIdsOf(e)
      .map((id) => s.profileById(id))
      .filter(Boolean);
    if (!owners.length) return <span className="text-grey-2">Unassigned</span>;
    return (
      <div className="space-y-0.5">
        {owners.map((p) => (
          <div key={p!.id} className="leading-tight">
            <div className="text-navy">{p!.name}</div>
            {p!.phone ? (
              <div className="text-[12px] text-grey-2 tabular-nums">{p!.phone}</div>
            ) : (
              <div className="text-[12px] text-grey-2/60 italic">no number</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // ---- filtering: selected steps (empty = all) + scope ----
  const rows = useMemo(() => {
    const sel = new Set(selectedSteps);
    return s.queueEntries
      .filter((e) => {
        if (sel.size && !sel.has(e.stepKey)) return false;
        const b = bucketOf(e.dueIso, todayIso);
        if (scope === "delayed") return b === "delayed";
        if (scope === "today") return b === "today";
        if (scope === "noDate") return b === "noDate";
        return true;
      })
      .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"));
  }, [s.queueEntries, selectedSteps, scope, todayIso]);

  const columns: QueueColumn<QueueEntry>[] = [
    {
      key: "ref",
      header: "Ref",
      cell: (e) => (
        <Link to={linkOf(e)} className="font-semibold text-orange hover:underline">
          {e.ref}
        </Link>
      ),
      sortValue: (e) => e.ref,
      filter: { kind: "text", get: (e) => e.ref },
      tdClassName: "whitespace-nowrap",
    },
    { key: "detail", header: "Item / Vendor", cell: (e) => detailOf(e), sortValue: (e) => detailOf(e), filter: { kind: "text", get: (e) => detailOf(e) } },
    {
      key: "step",
      header: "Stage",
      cell: (e) => <span className="text-grey">{stepByKey(e.stepKey)?.short ?? e.stepKey}</span>,
      sortValue: (e) => stepByKey(e.stepKey)?.index ?? 0,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.short ?? e.stepKey },
      tdClassName: "whitespace-nowrap",
    },
    { key: "owner", header: "Owner", cell: ownerCell, sortValue: (e) => ownerNames(e), filter: { kind: "select", get: (e) => ownerNames(e) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Value", cell: (e) => inr(e.value), sortValue: (e) => e.value ?? 0, filter: { kind: "number", get: (e) => e.value ?? 0 }, tdClassName: "whitespace-nowrap" },
    {
      key: "due",
      header: "Due",
      cell: (e) => <DueChip dueIso={e.dueIso} todayIso={todayIso} />,
      sortValue: (e) => e.dueIso ?? "9999-99-99",
      filter: { kind: "date", get: (e) => e.dueIso ?? "" },
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{appName("procurement")} Control Center</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Pending work by the day it falls due. Each count is one <strong>step</strong> of work on one entry — the same PO can
          be waiting at two steps. Click a step to see what's late there, then call the owner.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Today's pending" value={pending} hint="delayed + due today" hero tone={pending > 0 ? "red" : undefined} />
        <Kpi label="In queue (today)" value={counts.today} hint="due today" />
        <Kpi label="Delayed" value={counts.delayed} hint="past due" tone={counts.delayed > 0 ? "red" : undefined} />
        <Kpi label="Tomorrow" value={counts.tomorrow} hint="in queue" />
        <Kpi label="Day after" value={counts.dayAfter} hint="in queue" />
      </div>

      <Card className="p-4 space-y-3">
        <h2 className={SECTION_HEADING_CLASS}>Where it's stuck</h2>
        <StepPipeline
          nodes={nodes}
          selectedKeys={selectedSteps}
          onChange={(next) => {
            setSelectedSteps(next);
            // Picking a step means "show me what's late here". Clearing the last
            // one must NOT pin — the user is widening, not narrowing.
            if (next.length) setScope("delayed");
          }}
        />
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line overflow-hidden">
            {SCOPES.map((sc) => {
              const n = sc.value === "all" ? null : counts[sc.value as Bucket];
              return (
                <button
                  key={sc.value}
                  type="button"
                  onClick={() => setScope(sc.value)}
                  aria-pressed={scope === sc.value}
                  className={`h-9 px-3.5 text-[12.5px] font-semibold border-r border-line last:border-r-0 transition-colors ${
                    scope === sc.value ? "bg-orange/10 text-orange" : "text-grey-2 hover:text-navy hover:bg-page/60"
                  }`}
                >
                  {sc.label}
                  {n !== null && n > 0 && <span className="ml-1.5 text-[11px] opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          {selectedSteps.length > 0 && (
            <span className="text-[12.5px] text-grey-2">
              {selectedSteps.length === 1 ? "Step: " : "Steps: "}
              <strong className="text-navy">
                {selectedSteps.length <= 2
                  ? selectedSteps.map((k) => stepByKey(k)?.short ?? k).join(", ")
                  : `${selectedSteps.length} selected`}
              </strong>
            </span>
          )}
        </div>

        <QueueTable
          rows={rows}
          rowKey={(e) => `${e.stepKey}:${e.entityId}`}
          columns={columns}
          groupBy={{ idOf: (e) => e.companyId, nameOf: (id) => s.companyById(id)?.name ?? "—", allLabel: "All companies" }}
          rowClassName={(e) => (bucketFor(e) === "delayed" ? "bg-[#FDECEC]/40" : "")}
          rowsLabel="entries"
          emptyTitle="Nothing here"
          emptyMessage="No work matches this step selection and filter."
          actions={(e) => (
            <div className="flex items-center gap-3 whitespace-nowrap">
              {/* Reassign still targets a LINE (assigned_approver_id is per line).
                  A requisition-scoped entry reassigns via its first line still
                  under decision — the whole requisition is one decision anyway. */}
              {e.stepKey === "approval" && (
                <button
                  onClick={() =>
                    setReassign(
                      e.entityType === "request"
                        ? s.itemsForRequest(e.entityId).find((l) => l.status === "approval" || l.status === "on_hold") ?? null
                        : lineOf(e) ?? null
                    )
                  }
                  className="text-[12.5px] font-semibold text-grey hover:text-navy"
                >
                  Reassign
                </button>
              )}
              <Link to={linkOf(e)} className="text-[12.5px] font-semibold text-orange hover:underline">
                Open
              </Link>
            </div>
          )}
        />
      </Card>

      <ReassignModal line={reassign} onClose={() => setReassign(null)} />
    </div>
  );
}

/**
 * The entry's due date with a Delayed / Today / Tomorrow chip.
 *
 * Distinct from `DueCell`, which shows an overdue / due-today chip only: this one
 * colours by the Control Center's four-way bucket. Both now take an
 * already-computed `dueIso` from `lib/queues.ts`, so they can never disagree.
 */
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
    <span className={b === "delayed" ? "text-ryg-red font-semibold" : b === "today" ? "text-yellow font-medium" : "text-grey"}>
      {formatDate(dueIso)}
      {chip && (
        <span className={`ml-1.5 inline-block text-[10px] font-semibold uppercase tracking-wide rounded-full px-1.5 py-0.5 align-middle ${chip.cls}`}>
          {chip.text}
        </span>
      )}
    </span>
  );
}

function Kpi({ label, value, hint, tone, hero }: { label: string; value: number; hint?: string; tone?: "red"; hero?: boolean }) {
  return <SharedKpi label={label} value={value} hint={hint} tone={tone} size={hero ? "hero" : "md"} />;
}

/** Reassign an approval line to a chosen approver (coordinator/admin). */
function ReassignModal({ line, onClose }: { line: RequestItem | null; onClose: () => void }) {
  const s = useProcurementStore();
  const [approverId, setApproverId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = useMemo(
    () => s.profiles.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.profiles]
  );

  const submit = async () => {
    if (!line) return;
    if (!approverId) return setErr("Pick an approver.");
    setBusy(true);
    setErr(null);
    try {
      await s.reassignLine({ requestItemId: line.id, approverId, note: note.trim() || null });
      setApproverId("");
      setNote("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={line !== null}
      onClose={onClose}
      title="Reassign approval"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Reassigning…" : "Reassign"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-grey">
          {line ? `${s.itemLabel(line.itemId)} · ${inr(line.lineValue)}` : ""}. The chosen approver will be able to act on this line and is notified.
        </p>
        <FieldLabel label="Approver" required>
          <Combobox value={approverId} onChange={setApproverId} options={options} placeholder="Select approver…" searchable autoAdvance />
        </FieldLabel>
        <FieldLabel label="Note">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional message to the approver" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
