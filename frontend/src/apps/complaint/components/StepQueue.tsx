import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Tabs from "@/shared/components/ui/Tabs";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import StepModal from "./StepModal";
import StatusPill from "./StatusPill";
import { useComplaintStore } from "../store";
import { requestHref } from "../lib/routes";
import { stepByKey, type StepKey } from "../lib/steps";
import {
  COMPLAINT_TYPE_TONE,
  RM_ORIGIN_TONE,
  STATUS_LABEL,
  dmy,
  formatDateTime,
  rmOriginLabelOf,
} from "../lib/format";
import { COMPLAINT_TYPE_LABEL, type ComplaintRequest } from "../types";

/**
 * One queue row: the complaint AND the step it is waiting at. A desk that
 * owns several steps (Management Approval) sees one list, so the step travels
 * with the row — it picks the button, the due date and the modal.
 */
interface QRow {
  key: string;
  step: StepKey;
  r: ComplaintRequest;
}

/** What the Stage column calls each management step. */
const STAGE_LABEL: Partial<Record<StepKey, string>> = {
  approval: "Commercial approval (FG)",
  rm_management: "RM / supplier complaint",
  management_review: "Final review",
};

/** The button on a row, per step, where the step's short name is not clear enough. */
const ACTION_LABEL: Partial<Record<StepKey, string>> = {
  approval: "Approve",
  rm_management: "Review",
  management_review: "Close",
};

/**
 * One step's queue: what is PENDING here, and what this step has already done.
 *
 * ONE component serves all seven steps — the only thing that varies is the step
 * key, so a per-step copy would be seven places to fix a column.
 *
 * ⚠ PENDING IS `myQueue`, NOT every row at this step. `myQueue` runs `canActOn`,
 *   which is the same rule the server enforces — so a person only ever sees work
 *   they can actually do, and the button they see always works.
 *
 * ⚠ FLAT. No `groupBy`: banding would make the group the primary sort and hide
 *   the most overdue row mid-page.
 */
export default function StepQueue({
  step,
  steps: stepsProp,
  title: titleProp,
  top,
}: {
  step?: StepKey;
  /** Several steps in one list (Management Approval). Overrides `step`. */
  steps?: StepKey[];
  title?: string;
  /** Rendered under the page title, above the tabs (Management Approval's compensations). */
  top?: ReactNode;
}) {
  const s = useComplaintStore();
  const [tab, setTab] = useState("pending");
  const [acting, setActing] = useState<QRow | null>(null);

  const steps = useMemo(() => stepsProp ?? (step ? [step] : []), [stepsProp, step]);
  const multi = steps.length > 1;
  const def = stepByKey(steps[0]);
  const title = titleProp ?? def?.title ?? steps[0];
  const slug = steps.join("-");

  const pending = useMemo<QRow[]>(
    () =>
      steps.flatMap((st) =>
        s
          .myQueue(st)
          .map((e) => s.requestById(e.requestId))
          .filter((r): r is ComplaintRequest => !!r)
          .map((r) => ({ key: `${st}:${r.id}`, step: st, r })),
      ),
    [s, steps],
  );

  const completedEntries = useMemo(
    () => steps.flatMap((st) => s.completedFor(st)).sort((a, b) => a.atIso.localeCompare(b.atIso)),
    [s, steps],
  );
  const completed = useMemo<QRow[]>(
    () => completedEntries.map((e) => ({ key: `${e.stepKey}:${e.row.id}`, step: e.stepKey, r: e.row })),
    [completedEntries],
  );

  /** The columns both tabs share — a queue and its history describe the same thing. */
  const stageCol: QueueColumn<QRow> = {
    key: "stage",
    header: "Stage",
    cell: ({ step: st }) => <span className="whitespace-nowrap">{STAGE_LABEL[st] ?? stepByKey(st)?.title ?? st}</span>,
    sortValue: ({ step: st }) => STAGE_LABEL[st] ?? st,
    filter: { kind: "select", get: ({ step: st }) => STAGE_LABEL[st] ?? st },
  };

  const base: QueueColumn<QRow>[] = [
    {
      key: "complaintNo",
      header: "Complaint",
      cell: ({ r }) => (
        <Link to={requestHref(r.id)} className="font-semibold text-orange hover:underline">
          {r.complaintNo}
        </Link>
      ),
      sortValue: ({ r }) => r.complaintNo,
      // No filter, as on the requests list: every complaint number is unique.
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "type",
      header: "Type",
      cell: ({ r }) => (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${COMPLAINT_TYPE_TONE[r.complaintType]}`}
        >
          {COMPLAINT_TYPE_LABEL[r.complaintType]}
        </span>
      ),
      sortValue: ({ r }) => COMPLAINT_TYPE_LABEL[r.complaintType],
      filter: { kind: "select", get: ({ r }) => COMPLAINT_TYPE_LABEL[r.complaintType] },
    },
    {
      // Domestic / Import — blank on every finished-good row, because there is
      // no such thing there. A filterable column rather than a second badge on
      // the Type cell above: the two answer different questions ("which side of
      // the business" vs "whose desk"), and the grid's select filter can only
      // narrow on a column of its own.
      key: "rmOrigin",
      header: "Domestic / Import",
      cell: ({ r }) =>
        r.rmOrigin ? (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${RM_ORIGIN_TONE[r.rmOrigin]}`}
          >
            {rmOriginLabelOf(r.rmOrigin)}
          </span>
        ) : (
          "—"
        ),
      sortValue: ({ r }) => rmOriginLabelOf(r.rmOrigin),
      filter: { kind: "select", get: ({ r }) => rmOriginLabelOf(r.rmOrigin) },
    },
    {
      key: "party",
      header: "Customer / Vendor",
      cell: ({ r }) => r.partyName ?? "—",
      sortValue: ({ r }) => r.partyName ?? "",
      filter: { kind: "select", get: ({ r }) => r.partyName ?? "—" },
    },
    {
      key: "item",
      header: "Item",
      cell: ({ r }) => r.itemName ?? "—",
      sortValue: ({ r }) => r.itemName ?? "",
      filter: { kind: "select", get: ({ r }) => r.itemName ?? "—" },
    },
    {
      key: "lot",
      header: "LOT No.",
      cell: ({ r }) => r.lotNo ?? "—",
      sortValue: ({ r }) => r.lotNo ?? "",
      filter: { kind: "select", get: ({ r }) => r.lotNo ?? "—" },
      tdClassName: "whitespace-nowrap",
    },
  ];

  const withStage = (cols: QueueColumn<QRow>[]) => (multi ? [cols[0], stageCol, ...cols.slice(1)] : cols);

  const pendingColumns: QueueColumn<QRow>[] = withStage([
    ...base,
    {
      key: "due",
      header: "Due",
      cell: ({ r, step: st }) => <DueCell dueIso={s.dueIsoFor(r, st)} />,
      sortValue: ({ r, step: st }) => s.dueIsoFor(r, st) ?? "9999-12-31",
      filter: { kind: "date", get: ({ r, step: st }) => s.dueIsoFor(r, st) ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: ({ r }) => <StatusPill status={r.status} />,
      sortValue: ({ r }) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: ({ r }) => STATUS_LABEL[r.status] },
    },
  ]);

  const completedColumns: QueueColumn<QRow>[] = withStage([
    ...base,
    {
      key: "status",
      header: "Now at",
      cell: ({ r }) => <StatusPill status={r.status} />,
      sortValue: ({ r }) => STATUS_LABEL[r.status],
      filter: { kind: "select", get: ({ r }) => STATUS_LABEL[r.status] },
    },
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">{title}</h1>

      {top}

      <Tabs
        tabs={[
          { key: "pending", label: `Pending (${pending.length})` },
          { key: "done", label: `Completed (${completed.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pending" ? (
        <QueueTable<QRow>
          rows={pending}
          rowKey={(x) => x.key}
          columns={pendingColumns}
          rowsLabel="complaints"
          initialSort={{ key: "due", dir: "asc" }}
          exportName={`complaint-${slug}`}
          exportTitle={title}
          emptyTitle="Nothing waiting on you here"
          emptyMessage={multi ? "Complaints waiting for management will appear here." : "Complaints needing this step, that you can act on, will appear here."}
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(x) => (
            <Button size="sm" onClick={() => setActing(x)}>
              {ACTION_LABEL[x.step] ?? stepByKey(x.step)?.short ?? "Record"}
            </Button>
          )}
        />
      ) : (
        <QueueTable<QRow>
          rows={completed}
          rowKey={(x) => x.key}
          columns={completedColumns}
          rowsLabel="complaints"
          exportName={`complaint-${slug}-done`}
          exportTitle={`${title} — completed`}
          emptyTitle="Nothing completed yet"
          emptyMessage="What you record at this step will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(x) => {
            const entry = completedEntries.find((e) => e.row.id === x.r.id && e.stepKey === x.step);
            // A locked entry says WHY rather than simply refusing — the server is
            // the gate, this is the explanation.
            if (entry?.lockReason) {
              return <span className="text-[11.5px] text-grey-2" title={entry.lockReason}>Locked</span>;
            }
            // No inline correction in this chain: each step is recorded once and
            // the next bucket sees it. A mistake is fixed by the bucket that owns
            // the step, not by re-opening a completed one.
            return <span className="text-[11.5px] text-grey-2">Done</span>;
          }}
        />
      )}

      {tab === "done" && completedEntries.length > 0 && (
        <p className="text-[11.5px] text-grey-2">
          Last recorded {formatDateTime(completedEntries[completedEntries.length - 1].atIso)} ·{" "}
          {dmy(completedEntries[completedEntries.length - 1].atIso)}
        </p>
      )}

      {acting && (
        <StepModal step={acting.step} request={acting.r} onClose={() => setActing(null)} />
      )}
    </div>
  );
}
