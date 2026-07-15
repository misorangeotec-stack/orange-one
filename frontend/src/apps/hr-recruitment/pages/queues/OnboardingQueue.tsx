import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import OnboardingPanel from "../../components/onboarding/OnboardingPanel";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { inr } from "../../lib/format";
import type { Onboarding } from "../../types";

const OFFER_LABEL: Record<string, string> = {
  pending: "Awaiting answer",
  accepted: "Accepted",
  declined: "Declined",
  no_show: "Did not join",
};

/**
 * Everyone HR is currently onboarding.
 *
 * Rows come from `store.myQueue("onboarding")` — the SAME entries lib/queues.ts
 * feeds the Kanban and (from Phase 8) the Control Center, so this page's overdue
 * count and theirs cannot drift: there is only one due date.
 *
 * Declined / no-show hires drop off deliberately. That seat is back on the
 * requisition, and filling it is the open work — not chasing someone who left.
 */
export default function OnboardingQueue() {
  const s = useHrStore();
  const [open, setOpen] = useState<Onboarding | null>(null);

  const rows = useMemo(
    () =>
      s
        .myQueue("onboarding")
        .map((e) => s.onboardingById(e.entityId))
        .filter((o): o is Onboarding => !!o),
    [s],
  );

  // Coordinators chase everything, and fms_hr_can_act already lets them act — so the
  // page must not lock out someone whose own queue has rows in it.
  if (!s.isStepOwner("onboarding") && !s.isProcessCoordinator) return <AccessDenied />;

  const dueOf = (o: Onboarding) => s.onboardingDueIso(o);
  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const candOf = (o: Onboarding) => s.candidateById(o.candidateId);
  const reqOf = (o: Onboarding) => s.requisitionById(o.requisitionId);

  const progress = (o: Onboarding) => {
    const checks = s.checksFor(o.id);
    return { done: checks.filter((k) => k.done).length, total: checks.length };
  };

  const columns: QueueColumn<Onboarding>[] = [
    {
      key: "name",
      header: "New hire",
      cell: (o) => {
        const c = candOf(o);
        return (
          <div>
            <div className="font-medium text-navy">{c?.name ?? "Unknown"}</div>
            <div className="text-[12px] text-grey-2">
              {c?.phone ?? "—"}
              {s.canViewSalary && c?.offeredCtc !== null && c?.offeredCtc !== undefined && ` · ${inr(c.offeredCtc)}`}
            </div>
          </div>
        );
      },
      sortValue: (o) => candOf(o)?.name ?? "",
      filter: { kind: "text", get: (o) => candOf(o)?.name ?? "" },
      exportValue: (o) => candOf(o)?.name ?? "Unknown",
    },
    {
      key: "position",
      header: "Position",
      cell: (o) => <span className="text-grey">{reqOf(o)?.jobTitle ?? "—"}</span>,
      sortValue: (o) => reqOf(o)?.jobTitle ?? "",
      filter: { kind: "text", get: (o) => reqOf(o)?.jobTitle ?? "" },
    },
    {
      key: "mrf",
      header: "Vacancy",
      cell: (o) => {
        const r = reqOf(o);
        if (!r) return <span className="text-grey-2">—</span>;
        return (
          <Link
            to={`/hr-recruitment/requisitions/${r.id}`}
            className="font-semibold text-orange hover:underline"
          >
            {r.mrfNo}
          </Link>
        );
      },
      sortValue: (o) => reqOf(o)?.mrfNo ?? "",
      filter: { kind: "text", get: (o) => reqOf(o)?.mrfNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "joining",
      header: "Joining date",
      cell: (o) =>
        o.joiningDate ? (
          <span className="text-grey">{formatDateDMY(o.joiningDate)}</span>
        ) : (
          <span className="text-yellow font-medium">not set</span>
        ),
      sortValue: (o) => o.joiningDate ?? "9999",
      exportValue: (o) => (o.joiningDate ? formatDateDMY(o.joiningDate) : "not set"),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "offer",
      header: "Offer",
      cell: (o) => (
        <span className={o.offerStatus === "accepted" ? "text-ryg-green" : "text-grey"}>
          {OFFER_LABEL[o.offerStatus] ?? o.offerStatus}
        </span>
      ),
      filter: { kind: "select", get: (o) => OFFER_LABEL[o.offerStatus] ?? o.offerStatus },
    },
    {
      key: "progress",
      header: "Checklist",
      cell: (o) => {
        const p = progress(o);
        if (p.total === 0) return <span className="text-grey-2">locked</span>;
        return (
          <span className={p.done === p.total ? "text-ryg-green font-medium" : "text-grey"}>
            {p.done} / {p.total}
          </span>
        );
      },
      sortValue: (o) => {
        const p = progress(o);
        return p.total === 0 ? -1 : p.done / p.total;
      },
      exportValue: (o) => {
        const p = progress(o);
        return p.total === 0 ? "locked — no joining date" : `${p.done} of ${p.total}`;
      },
    },
    {
      key: "due",
      header: "Due",
      cell: (o) => <DueCell dueIso={dueOf(o)} />,
      sortValue: (o) => dueOf(o) ?? "9999",
      exportValue: (o) => formatDateDMY(dueOf(o)),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Onboarding</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Everyone who has been offered the job. Set the joining date to open their checklist, record whether
          they accepted, then work the list. If someone drops out, their seat goes straight back to the
          vacancy.
        </p>
      </div>

      <QueueTable<Onboarding>
        rows={rows}
        rowKey={(o) => o.id}
        columns={columns}
        groupBy={{
          idOf: (o) => reqOf(o)?.departmentId ?? null,
          nameOf: deptName,
          allLabel: "All departments",
          label: "Department",
        }}
        rowsLabel="new hires"
        rowClassName={(o) => overdueRowClass(dueOf(o))}
        emptyTitle="Nobody to onboard"
        emptyMessage="Once a candidate is finalized on the board, their onboarding appears here."
        initialSort={{ key: "due", dir: "asc" }}
        exportName="HR_Onboarding"
        exportTitle="Onboarding"
        exportNotes={[
          "Onboardings still in progress. Someone who declined or never turned up drops off deliberately — their seat has gone back to the vacancy, and filling it is the open work now.",
          "'Checklist' is items ticked out of items seeded from the master at the time HR set the joining date. 'Locked' means the joining date has not been set yet.",
          "Every checklist item's own due date is counted in working days from the joining date.",
          "Contains candidate names, phone numbers and agreed salaries — treat the file as personal data.",
        ]}
        actions={(o) => (
          <Button size="sm" onClick={() => setOpen(o)}>
            Open
          </Button>
        )}
      />

      {open && <OnboardingPanel onboarding={open} open={!!open} onClose={() => setOpen(null)} />}
    </div>
  );
}
