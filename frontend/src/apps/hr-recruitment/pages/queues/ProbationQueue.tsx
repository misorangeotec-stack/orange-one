import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import ProbationPanel from "../../components/probation/ProbationPanel";
import AccessDenied from "../system/AccessDenied";
import { useHrStore } from "../../store";
import { stepByKey } from "../../lib/steps";
import type { Probation } from "../../types";

/**
 * The HOD's monthly work: everyone who has actually JOINED and is still on probation.
 *
 * Rows come from `store.queueEntries` — the SAME entries lib/queues.ts feeds the
 * Kanban and (from Phase 8) the Control Center, so this page's overdue count and
 * theirs cannot drift: there is only one due date, and it is a CALENDAR month from
 * the joining date, never a count of working days.
 *
 * Note the probations are gathered across all five probation steps rather than one:
 * a probation sits at exactly one of them at a time (its next unwritten review, or
 * the decision), so collecting them all yields each person exactly once.
 */
const PROBATION_STEPS = [
  "probation_m1",
  "probation_m2",
  "probation_m3",
  "probation_final",
  "probation_extension",
] as const;

export default function ProbationQueue() {
  const s = useHrStore();
  const [open, setOpen] = useState<Probation | null>(null);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: Probation[] = [];
    for (const step of PROBATION_STEPS) {
      for (const e of s.myQueue(step)) {
        if (seen.has(e.entityId)) continue;
        const p = s.probationById(e.entityId);
        if (!p) continue;
        seen.add(e.entityId);
        out.push(p);
      }
    }
    return out;
  }, [s]);

  // Coordinators chase everything, and fms_hr_can_act already lets them act — so the
  // page must not lock out someone whose own queue has rows in it.
  const owns = PROBATION_STEPS.some((k) => s.isStepOwner(k));
  if (!owns && !s.isProcessCoordinator) return <AccessDenied />;

  const dueOf = (p: Probation) => s.probationDueIso(p);
  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const candOf = (p: Probation) => s.candidateById(p.candidateId);
  const reqOf = (p: Probation) => s.requisitionById(p.requisitionId);
  const stageOf = (p: Probation) => {
    const step = s.probationPendingStep(p);
    return step ? (stepByKey(step)?.short ?? step) : "—";
  };

  const columns: QueueColumn<Probation>[] = [
    {
      key: "name",
      header: "On probation",
      cell: (p) => {
        const c = candOf(p);
        const o = s.onboardingById(p.onboardingId);
        return (
          <div>
            <div className="font-medium text-navy">{c?.name ?? "Unknown"}</div>
            <div className="text-[12px] text-grey-2">
              {reqOf(p)?.jobTitle ?? "—"}
              {o?.employeeCode && ` · ${o.employeeCode}`}
            </div>
          </div>
        );
      },
      sortValue: (p) => candOf(p)?.name ?? "",
      filter: { kind: "text", get: (p) => candOf(p)?.name ?? "" },
      exportValue: (p) => candOf(p)?.name ?? "Unknown",
    },
    {
      key: "position",
      header: "Position",
      cell: (p) => <span className="text-grey">{reqOf(p)?.jobTitle ?? "—"}</span>,
      sortValue: (p) => reqOf(p)?.jobTitle ?? "",
      filter: { kind: "text", get: (p) => reqOf(p)?.jobTitle ?? "" },
    },
    {
      key: "mrf",
      header: "Vacancy",
      cell: (p) => {
        const r = reqOf(p);
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
      sortValue: (p) => reqOf(p)?.mrfNo ?? "",
      filter: { kind: "text", get: (p) => reqOf(p)?.mrfNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "joined",
      header: "Joined",
      cell: (p) => <span className="text-grey">{formatDateDMY(p.joiningDate)}</span>,
      sortValue: (p) => p.joiningDate,
      exportValue: (p) => formatDateDMY(p.joiningDate),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "stage",
      header: "Waiting on",
      cell: (p) => <span className="text-navy">{stageOf(p)}</span>,
      sortValue: (p) => stageOf(p),
      filter: { kind: "select", get: (p) => stageOf(p) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "reviews",
      header: "Reviews",
      cell: (p) => {
        const total = p.outcome === "extended" ? 4 : 3;
        const done = s.reviewsFor(p.id).length;
        return (
          <span className={done === total ? "text-ryg-green font-medium" : "text-grey"}>
            {done} / {total}
          </span>
        );
      },
      sortValue: (p) => s.reviewsFor(p.id).length,
      exportValue: (p) => `${s.reviewsFor(p.id).length} of ${p.outcome === "extended" ? 4 : 3}`,
    },
    {
      key: "due",
      header: "Due",
      cell: (p) => <DueCell dueIso={dueOf(p)} />,
      sortValue: (p) => dueOf(p) ?? "9999",
      exportValue: (p) => formatDateDMY(dueOf(p)),
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Probation Reviews</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Everyone who has joined and is still on probation. Review them in month 1, month 2 and month 3, then
          approve, reject, or extend by a month. Each review is due one calendar month after they joined — so a
          31-Jan joiner is due on 28-Feb, not three days into March.
        </p>
      </div>

      <QueueTable<Probation>
        rows={rows}
        rowKey={(p) => p.id}
        columns={columns}
        groupBy={{
          idOf: (p) => reqOf(p)?.departmentId ?? null,
          nameOf: deptName,
          allLabel: "All departments",
          label: "Department",
        }}
        rowsLabel="people on probation"
        rowClassName={(p) => overdueRowClass(dueOf(p))}
        emptyTitle="Nobody on probation"
        emptyMessage="Once a new hire's onboarding is complete — they actually joined — their three monthly reviews open here."
        initialSort={{ key: "due", dir: "asc" }}
        exportName="HR_Probation"
        exportTitle="Probation reviews"
        exportNotes={[
          "People who have JOINED and are still on probation. A probation with a final verdict is history, not a work item, so it drops off this list.",
          "Each review is due one CALENDAR month after the joining date, not N working days — a 31-Jan joiner's Month-1 review is due 28-Feb.",
          "'Waiting on' is the single next thing owed: the earliest unwritten review, or the decision once all three are in.",
          "Contains employee names — treat the file as personal data.",
        ]}
        actions={(p) => (
          <Button size="sm" onClick={() => setOpen(p)}>
            Open
          </Button>
        )}
      />

      {open && <ProbationPanel probation={open} open={!!open} onClose={() => setOpen(null)} />}
    </div>
  );
}
