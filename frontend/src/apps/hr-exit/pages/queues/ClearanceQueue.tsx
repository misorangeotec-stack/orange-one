import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import Modal from "@/shared/components/ui/Modal";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateDMY } from "@/shared/lib/date";
import ClearancePanel from "../../components/clearance/ClearancePanel";
import AssetPanel from "../../components/assets/AssetPanel";
import HandoverPanel from "../../components/handover/HandoverPanel";
import CompletedExitTable from "../../components/CompletedExitTable";
import AccessDenied from "../system/AccessDenied";
import { useExitStore } from "../../store";
import type { QueueEntry, StageEntry } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import type { ClearanceCheck, ExitCase } from "../../types";

/**
 * The clearance queue — **one row per outstanding CHECKLIST ITEM**, not per case, plus
 * the two sign-off STEPS that settle checklist rows of their own.
 *
 * This is the screen the whole per-check design exists for. A clearance row is owned
 * by a DIFFERENT PERSON PER ROW: the IT person owns the laptop row and nothing else,
 * owns no workflow step at all, and must see exactly that. `store.myQueue` reads each
 * entry's `ownerIds` (falling back to `canActOn` only where there are none), so this
 * table is already narrowed to what YOU owe.
 *
 * ⭐ THE ASSET RETURN AND THE HANDOVER LIVE HERE TOO (Phase 4), and they must. They are
 * first-class STEPS — each carries two signatures (HOD/manager, then HR), which a
 * checklist tick cannot hold: a tick has one actor and these have two. But they are
 * ALSO clearance duties of Admin, IT and the reporting manager, and completing the STEP
 * auto-ticks those ROWS. Hiding the steps on a separate screen while their checklist
 * rows sat here wearing an "auto-ticked by asset return" badge would send their owners
 * hunting for a page they had never heard of. The work is one thing; so is the queue.
 *
 * ⚠ ROW IDENTITY IS `${stepKey}:${entityId}:${checkId}`. One case contributes as many
 * rows as it has outstanding items — `entityId` alone is NOT unique here, and a
 * duplicate React key silently drops rows. That per-step counts can exceed the
 * open-case count is correct and intended (Purchase documents the same).
 *
 * Each row carries **its own** due date: the last working day plus that item's SIGNED
 * offset, which is normally negative — due BEFORE the person walks out.
 */
type Row = QueueEntry & { case: ExitCase; check: ClearanceCheck | null };

/** How each step reads in the Work column. The two sign-off steps are named, not lumped. */
const WORK_LABEL: Partial<Record<StepKey, string>> = {
  clearance: "Clearance item",
  asset_return: "Asset return",
  handover: "Handover & KT",
};

export default function ClearanceQueue() {
  const s = useExitStore();
  const [working, setWorking] = useState<{ case: ExitCase; step: StepKey } | null>(null);

  // Three steps, one table. `myQueue` has already narrowed each to what this user may
  // action — per-ROW for the clearance entries (they carry their own `ownerIds`), and
  // per-CASE via `canActOn` for the two sign-off steps (the case's own reporting
  // managers, plus whoever owns the step globally).
  const entries = useMemo(
    () => [...s.myQueue("clearance"), ...s.myQueue("asset_return"), ...s.myQueue("handover")],
    [s],
  );

  // The `clearance` step's owner chases the whole list; a row's owner sees their rows.
  // Anyone with a row in their queue belongs here — which is the ONLY way the IT /
  // Admin / Travel-Desk people (who own no step) get in at all. The two sign-off steps
  // are added for the same reason: a reporting manager owns them PER CASE, through
  // reporting_manager_ids, and owns no configured step whatsoever.
  const canSeePage =
    s.isProcessCoordinator ||
    s.isStepOwner("clearance") ||
    s.isStepOwner("asset_return") ||
    s.isStepOwner("handover") ||
    s.ownsClearanceItem ||
    entries.length > 0;

  const rows: Row[] = useMemo(() => {
    const checkById = new Map(s.clearanceChecks.map((k) => [k.id, k]));
    return entries
      .map((e) => {
        const c = s.caseById(e.caseId);
        return c ? { ...e, case: c, check: e.checkId ? (checkById.get(e.checkId) ?? null) : null } : null;
      })
      .filter((r): r is Row => !!r);
  }, [entries, s]);

  const completed = useMemo(
    () => ["clearance", "asset_return", "handover"].flatMap((k) => s.completedFor(k as StepKey)),
    [s],
  );
  const stage = useStageMode(completed, s.userId);
  const openEntry = (e: StageEntry<ExitCase>) => setWorking({ case: e.row, step: e.stepKey });

  if (!canSeePage) return <AccessDenied />;

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";

  /**
   * WHO OWES THIS ROW.
   *
   * A clearance entry already carries its own `ownerIds` (that is the whole point of
   * the per-check design). The two sign-off steps carry none, because they are owed by
   * the case's OWN reporting managers plus the step's configured owners — additively,
   * exactly as `fms_exit_can_act()` says, because an asset return needs an HOD signature
   * AND an HR one, and a manager who never responds must not be able to wedge the case.
   */
  const ownerIdsOf = (r: Row): string[] =>
    r.ownerIds ??
    Array.from(
      new Set([...r.case.reportingManagerIds, ...(s.stepOwnerFor(r.stepKey)?.employeeIds ?? [])]),
    );

  const owners = (r: Row) =>
    ownerIdsOf(r)
      .map((id) => s.profileById(id)?.name ?? "Unknown")
      .join(", ") || "Unassigned";

  /**
   * The department whose clearance this row settles.
   *
   * For a checklist entry that is simply its own department. For the two sign-off steps
   * it is the department(s) of the rows the step AUTO-TICKS — Admin and IT for the asset
   * return, the Reporting Manager for the handover — which is the honest answer to "what
   * does finishing this clear?" and keeps the auto-tick legible from the queue itself.
   */
  const clearingDept = (r: Row): string => {
    if (r.check) return r.check.departmentLabel;
    const labels = s
      .checksFor(r.caseId)
      .filter((k) => k.satisfiedByStep === r.stepKey)
      .map((k) => k.departmentLabel);
    return Array.from(new Set(labels)).join(", ") || "—";
  };

  /** The one-line "what is left" under each row's name. */
  const detail = (r: Row): string | null => {
    if (r.stepKey === "asset_return") {
      const assets = s.assetsFor(r.caseId);
      const pending = assets.filter(s.isAssetPending).length;
      if (!assets.length) return "No asset rows on this case";
      if (pending > 0) return `${pending} of ${assets.length} still pending`;
      if (!r.case.assetsHodSignedAt) return "All settled — waiting on the HOD's signature";
      return "HOD signed — waiting on HR's signature";
    }
    if (r.stepKey === "handover") {
      const h = s.handoverFor(r.caseId);
      if (!h) return "Nobody named yet — who is taking the work over?";
      const to = h.handoverToUserId
        ? (s.profileById(h.handoverToUserId)?.name ?? "Unknown")
        : (h.handoverToName ?? "Unknown");
      if (!h.managerConfirmedAt) return `To ${to} — waiting on the manager's confirmation`;
      return `To ${to} — waiting on HR's confirmation`;
    }
    return r.check?.pendingReason ? `Pending — ${r.check.pendingReason}` : null;
  };

  const columns: QueueColumn<Row>[] = [
    {
      key: "exitNo",
      header: "Exit",
      cell: (r) => (
        <Link to={`/hr-exit/exits/${r.caseId}`} className="font-semibold text-orange hover:underline">
          {r.case.exitNo}
        </Link>
      ),
      sortValue: (r) => r.case.exitNo,
      filter: { kind: "text", get: (r) => r.case.exitNo },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "employee",
      header: "Employee",
      cell: (r) => (
        <div>
          <div className="font-medium text-navy">{r.case.employeeName}</div>
          <div className="text-[12px] text-grey-2">{r.case.employeeCode}</div>
        </div>
      ),
      sortValue: (r) => r.case.employeeName,
      filter: { kind: "text", get: (r) => `${r.case.employeeName} ${r.case.employeeCode}` },
      exportValue: (r) => `${r.case.employeeName} (${r.case.employeeCode})`,
    },
    {
      // The two sign-off steps carry two signatures each and settle clearance rows of
      // their own. Filterable, so an IT owner can hide everything that is not theirs.
      key: "work",
      header: "Work",
      cell: (r) => (
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            r.stepKey === "clearance" ? "bg-page text-grey" : "bg-orange/10 text-orange"
          }`}
        >
          {WORK_LABEL[r.stepKey] ?? r.stepKey}
        </span>
      ),
      filter: { kind: "select", get: (r) => WORK_LABEL[r.stepKey] ?? r.stepKey },
      exportValue: (r) => WORK_LABEL[r.stepKey] ?? r.stepKey,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "dept",
      header: "Clearing dept",
      cell: (r) => <span className="text-grey">{clearingDept(r)}</span>,
      filter: { kind: "select", get: clearingDept },
      exportValue: clearingDept,
    },
    {
      key: "item",
      header: "Item",
      cell: (r) => {
        // The EMPTY-CHECKLIST hole: the clearance step is open but has no rows (every
        // master item was inactive when this case was seeded), so it can never clear
        // itself. It is dated on the LWD and shows here in red rather than vanishing.
        if (r.stepKey === "clearance" && !r.check) {
          return (
            <span className="font-medium text-ryg-red">
              No checklist items — this exit cannot clear itself
            </span>
          );
        }
        const d = detail(r);
        return (
          <div>
            <div className="font-medium text-navy">
              {r.check ? r.check.name : (WORK_LABEL[r.stepKey] ?? r.stepKey)}
            </div>
            {d && (
              <div className={`text-[12px] ${r.check ? "text-yellow" : "text-grey-2"}`}>{d}</div>
            )}
          </div>
        );
      },
      sortValue: (r) => r.check?.name ?? (WORK_LABEL[r.stepKey] ?? ""),
      filter: { kind: "text", get: (r) => r.check?.name ?? (WORK_LABEL[r.stepKey] ?? "") },
      exportValue: (r) => r.check?.name ?? (WORK_LABEL[r.stepKey] ?? "(no checklist items)"),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (r) => <span className="text-grey">{owners(r)}</span>,
      filter: { kind: "text", get: owners },
      exportValue: owners,
    },
    {
      key: "lwd",
      header: "Last working day",
      cell: (r) => <span className="text-grey">{formatDateDMY(r.case.lwd)}</span>,
      sortValue: (r) => r.case.lwd ?? "9999",
      exportValue: (r) => formatDateDMY(r.case.lwd),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      cell: (r) => <DueCell dueIso={r.dueIso} />,
      sortValue: (r) => r.dueIso ?? "9999",
      exportValue: (r) => formatDateDMY(r.dueIso),
      tdClassName: "whitespace-nowrap",
    },
  ];

  const title =
    working?.step === "asset_return"
      ? "Asset return"
      : working?.step === "handover"
        ? "Handover & KT"
        : "Clearance";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Clearance</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          The checklist rows waiting on you — one per item, not one per exit — plus the{" "}
          <span className="font-semibold text-navy">asset return</span> and the{" "}
          <span className="font-semibold text-navy">handover</span>, which each need two signatures and tick
          their own clearance rows when they are done. Most of it falls{" "}
          <span className="font-semibold text-navy">before</span> the person's last working day: you cannot
          chase a laptop after they have gone.
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={rows.length}
        completedCount={completed.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote={s.stageScopeNote}
      />

      {stage.showingCompleted ? (
        <CompletedExitTable
          rows={stage.rows}
          exportName="HR_Exit_Clearance_Completed"
          emptyMessage="Cleared cases, asset sign-offs and handovers you complete will appear here. The signed steps become a record; a cleared checklist stays reopenable until the case is closed."
          onEdit={openEntry}
          onView={openEntry}
        />
      ) : (
        <QueueTable<Row>
          rows={rows}
          // COMPOSITE. One case contributes one row per outstanding item PLUS a row for
          // each open sign-off step, so `entityId` alone is not unique and React would
          // silently drop the duplicates.
          rowKey={(r) => `${r.stepKey}:${r.entityId}:${r.checkId ?? ""}`}
          columns={columns}
          groupBy={{
            idOf: (r) => r.departmentId,
            nameOf: deptName,
            allLabel: "All departments",
            label: "Employee's department",
          }}
          rowsLabel="items"
          rowClassName={(r) => overdueRowClass(r.dueIso)}
          emptyTitle="Nothing waiting on you"
          emptyMessage="Clearance items, asset returns and handovers assigned to you will appear here once a last working day is confirmed."
          initialSort={{ key: "due", dir: "asc" }}
          exportName="HR_Exit_Clearance"
          exportTitle="Exit clearance"
          exportNotes={[
            "One row per OUTSTANDING clearance item — an exit with three items still open appears three times. That is correct: they are three different people's work.",
            "The asset return and the handover are STEPS, not checklist items: each needs two signatures (the HOD / reporting manager first, then HR). HR's signature completes the step AND auto-ticks the clearance rows it settles — Admin + IT for the asset return, the Reporting Manager for the handover — with no file asked of anyone.",
            "The due date is the last working day plus that item's own offset, in working days (Mon–Sat; only Sunday is skipped). A negative offset means it is due BEFORE the last working day.",
            "An item is settled when it is ticked OR marked not-applicable. The exit clears itself when the last one is settled — that is decided by the database, not by this screen.",
          ]}
          actions={(r) => (
            <Button size="sm" onClick={() => setWorking({ case: r.case, step: r.stepKey })}>
              Open
            </Button>
          )}
        />
      )}

      {/* The panel itself, in place — so an IT owner never has to learn what an "exit
          case detail page" is just to say the laptop came back, and a reporting manager
          can sign the asset return from the same list that told them it was due. */}
      {working && (
        <Modal
          open={!!working}
          onClose={() => setWorking(null)}
          size="xl"
          title={`${title} — ${working.case.exitNo}`}
          subtitle={`${working.case.employeeName} · last working day ${formatDateDMY(working.case.lwd)}`}
          footer={
            <Button variant="ghost" size="sm" onClick={() => setWorking(null)}>
              Close
            </Button>
          }
        >
          {/* Re-read from the store so the panel re-renders on its own writes. */}
          {(() => {
            const c = s.caseById(working.case.id) ?? working.case;
            if (working.step === "asset_return") return <AssetPanel case={c} />;
            if (working.step === "handover") return <HandoverPanel case={c} />;
            return <ClearancePanel case={c} />;
          })()}
        </Modal>
      )}
    </div>
  );
}
