import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import { formatDateDMY } from "@/shared/lib/date";
import DocumentsPanel from "../../components/documents/DocumentsPanel";
import { useExitStore } from "../../store";
import type { QueueEntry } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import type { ExitCase } from "../../types";

/**
 * The closure queue — the last two steps, in one table.
 *
 * ⚠ **TWO STEPS, ONE TABLE ⇒ THE COMPOSITE ROW KEY IS MANDATORY.** `entityId` alone is not
 *   unique (Purchase and both Control Centers use the same idiom), and React would silently
 *   drop rows. They cannot in fact be open at once here — `archive` opens only once
 *   `documents` is done — but the key is not an optimisation, it is a correctness rule for
 *   any mixed-step table, and the next person to add a step to this page will not re-derive it.
 *
 * ⚠ **"ISSUED" IS NOT "ACKNOWLEDGED", AND THIS TABLE SAYS SO.** The Evidence column reads the
 *   documents themselves, not the header stamp: a case whose letters went out and whose signed
 *   copies never came back shows *"2 of 3 acknowledged"*, in amber, sitting in the `archive`
 *   step where it will be refused. That row is the entire reason this phase exists — it is the
 *   commonest real failure of an exit, and on a merged step it would be invisible.
 *
 * ⚠ **NO GATE ON THE PAGE.** Unlike Settlement and Interviews, closure is not confidential:
 *   nothing here is a rupee or a word of anyone's exit interview. It follows Approvals and
 *   Clearance — you see it if you have rows in it, and RLS hands you none if you have no
 *   business here.
 */
type Row = QueueEntry & { case: ExitCase };

const STEPS_HERE: StepKey[] = ["documents", "archive"];

const WORK_LABEL: Partial<Record<StepKey, string>> = {
  documents: "Issue the documents",
  archive: "Acknowledge & archive",
};

export default function ClosureQueue() {
  const s = useExitStore();
  const [working, setWorking] = useState<ExitCase | null>(null);

  const rows: Row[] = useMemo(() => {
    const entries = STEPS_HERE.flatMap((k) => s.myQueue(k));
    return entries
      .map((e) => {
        const c = s.caseById(e.caseId);
        return c ? { ...e, case: c } : null;
      })
      .filter((r): r is Row => !!r);
  }, [s]);

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";

  /** Issued / acknowledged, read from the documents themselves. */
  const tally = (caseId: string) => {
    const docs = s.documentsFor(caseId);
    const issued = docs.filter((d) => !!d.issuedOn);
    return { total: docs.length, issued: issued.length, acked: issued.filter((d) => !!d.ackSignedPath).length };
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
          <div className="text-[12px] text-grey-2">
            {r.case.employeeCode}
            {r.case.designation && ` · ${r.case.designation}`}
          </div>
        </div>
      ),
      sortValue: (r) => r.case.employeeName,
      filter: { kind: "text", get: (r) => `${r.case.employeeName} ${r.case.employeeCode}` },
      exportValue: (r) => `${r.case.employeeName} (${r.case.employeeCode})`,
    },
    {
      key: "work",
      header: "Work",
      cell: (r) => (
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            r.stepKey === "archive" ? "bg-navy/10 text-navy" : "bg-orange/10 text-orange"
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
      /**
       * ⭐ THE COLUMN THIS PHASE EXISTS FOR. "Issued" is a promise; "acknowledged" is a fact.
       * A row reading "3 issued · 1 acknowledged" is a case where two people have no relieving
       * letter on file and nobody knows it.
       */
      key: "evidence",
      header: "Documents",
      cell: (r) => {
        const t = tally(r.caseId);
        if (t.total === 0) return <span className="text-[12.5px] text-grey-2">None prepared</span>;
        const shortfall = t.issued - t.acked;
        return (
          <span className="text-[12.5px]">
            <span className="text-grey">
              {t.issued}/{t.total} issued
            </span>
            {t.issued > 0 && (
              <>
                {" · "}
                <span className={shortfall > 0 ? "font-semibold text-yellow" : "font-semibold text-ryg-green"}>
                  {t.acked}/{t.issued} acknowledged
                </span>
              </>
            )}
          </span>
        );
      },
      sortValue: (r) => {
        const t = tally(r.caseId);
        return t.issued - t.acked; // the ones missing a signature sort to the top
      },
      exportValue: (r) => {
        const t = tally(r.caseId);
        return `${t.issued}/${t.total} issued, ${t.acked}/${t.issued} acknowledged`;
      },
      tdClassName: "whitespace-nowrap",
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Closure</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Issue the experience and relieving letters — then{" "}
          <span className="font-semibold text-navy">get the signed acknowledgement back</span>. The archive
          refuses without it, and without the employee's own copy of the final F&amp;F. A case whose letters
          went out and whose signed copies never returned is the commonest way an exit quietly goes wrong;
          this is the screen where it is visible.
        </p>
      </div>

      <QueueTable<Row>
        rows={rows}
        // COMPOSITE — mandatory on any mixed-step table.
        rowKey={(e) => `${e.stepKey}:${e.entityId}:${e.checkId ?? ""}`}
        columns={columns}
        groupBy={{
          idOf: (r) => r.departmentId,
          nameOf: deptName,
          allLabel: "All departments",
          label: "Department",
        }}
        rowsLabel="items"
        rowClassName={(r) => overdueRowClass(r.dueIso)}
        emptyTitle="Nothing waiting on you"
        emptyMessage="Exits appear here once their full & final is approved — the letters go out, the signed acknowledgement comes back, and the case is archived."
        initialSort={{ key: "due", dir: "asc" }}
        exportName="HR_Exit_Closure"
        exportTitle="Exits at closure"
        exportNotes={[
          "One row per OPEN closure step. The letters (`documents`) are issued once the F&F is APPROVED — not once it is paid: bank transfers lag, and the leaver needs their relieving letter to start elsewhere.",
          "ISSUED IS NOT ACKNOWLEDGED. The Documents column shows both, because a case whose letters went out and whose signed copies never came back reads as done everywhere else — and it is the commonest real failure of an exit.",
          "An exit cannot be archived until clearance is complete, the F&F is paid, every document is issued, the SIGNED ACKNOWLEDGEMENT is attached for every document actually issued, and the employee's own copy of the final F&F is on file. Any of those steps can be waived with a reason (an absconder gets no relieving letter) — the evidence rule then applies only to what was actually issued.",
          "Working days are Mon–Sat; only Sunday is skipped.",
        ]}
        actions={(r) => (
          <Button size="sm" onClick={() => setWorking(r.case)}>
            Open
          </Button>
        )}
      />

      {/* The panel in place, so HR never has to go hunting for the case page. Same component
          the detail page renders. */}
      {working && (
        <Modal
          open={!!working}
          onClose={() => setWorking(null)}
          size="xl"
          title={`Closure — ${working.exitNo}`}
          subtitle={`${working.employeeName} · last working day ${formatDateDMY(working.lwd)}`}
          footer={
            <Button variant="ghost" size="sm" onClick={() => setWorking(null)}>
              Close
            </Button>
          }
        >
          {/* Re-read from the store so the panel re-renders on its own writes. */}
          <DocumentsPanel case={s.caseById(working.id) ?? working} />
        </Modal>
      )}
    </div>
  );
}
