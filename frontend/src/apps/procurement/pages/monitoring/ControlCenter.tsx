import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useProcurementStore } from "../../store";
import { inr, lineBadge, poStageBadge, LINE_STATUS_LABEL, PO_STAGE_LABEL } from "../../lib/format";
import { stepByKey } from "../../lib/steps";
import QueueTable, { type QueueColumn } from "../../components/QueueTable";
import type { LineStatus, RequestItem } from "../../types";

const OVERDUE_DAYS = 7;
const ageDays = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

interface MonitorEntry {
  key: string;
  entityType: "line" | "po";
  entityId: string;
  ref: string;
  to: string;
  detail: string;
  stageLabel: string;
  ownerIds: string[];
  companyId: string;
  value: number | null;
  badgeClass: string;
  statusLabel: string;
  age: number;
  reassignLine: RequestItem | null;
}

/**
 * Monitoring / Control Center — admins + process coordinators get an all-up view
 * of every in-flight item-line and open PO, with age-based "overdue" flagging and
 * Nudge / Escalate / Reassign levers. Read-all; the actions only send
 * notifications (and, for Reassign, set an approval line's override approver).
 * Uses the shared queue-style table (per-column filters, company grouping).
 */
export default function ControlCenter() {
  const s = useProcurementStore();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reassign, setReassign] = useState<RequestItem | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const entries = useMemo<MonitorEntry[]>(() => {
    const out: MonitorEntry[] = [];

    const lineOwners = (l: RequestItem): string[] => {
      if (l.status === "sourcing") return s.stepOwnerFor("sourcing")?.employeeIds ?? [];
      if (l.status === "approval" || l.status === "on_hold") {
        const ids = new Set<string>();
        const appr = s.approverForAmount(l.lineValue ?? 0);
        if (appr) ids.add(appr);
        if (l.assignedApproverId) ids.add(l.assignedApproverId);
        return [...ids];
      }
      if (l.status === "approved_pending_po") return s.stepOwnerFor("po")?.employeeIds ?? [];
      return [];
    };

    const IN_FLIGHT: LineStatus[] = ["sourcing", "approval", "on_hold", "approved_pending_po"];
    for (const l of s.requestItems) {
      if (!IN_FLIGHT.includes(l.status)) continue;
      const req = s.requestById(l.requestId);
      if (!req) continue;
      const canReassign = l.status === "approval" || l.status === "on_hold";
      out.push({
        key: `line:${l.id}`,
        entityType: "line",
        entityId: l.id,
        ref: req.requestNo,
        to: `/procurement/requests/${req.id}`,
        detail: s.itemLabel(l.itemId),
        stageLabel: l.status === "sourcing" ? "Sourcing" : l.status === "approved_pending_po" ? "PO Desk" : "Approval",
        ownerIds: lineOwners(l),
        companyId: req.companyId,
        value: l.lineValue,
        badgeClass: lineBadge(l.status),
        statusLabel: LINE_STATUS_LABEL[l.status],
        age: ageDays(l.createdAt),
        reassignLine: canReassign ? l : null,
      });
    }

    for (const po of s.pos) {
      if (po.currentStage === "closed" || po.currentStage === "cancelled") continue;
      out.push({
        key: `po:${po.id}`,
        entityType: "po",
        entityId: po.id,
        ref: po.poNo,
        to: `/procurement/pos/${po.id}`,
        detail: s.vendorById(po.vendorId)?.name ?? "—",
        stageLabel: stepByKey(po.currentStage)?.short ?? po.currentStage,
        ownerIds: s.stepOwnerFor(po.currentStage)?.employeeIds ?? [],
        companyId: po.companyId,
        value: po.totalValue,
        badgeClass: poStageBadge(po.currentStage),
        statusLabel: PO_STAGE_LABEL[po.currentStage] ?? po.currentStage,
        age: ageDays(po.createdAt),
        reassignLine: null,
      });
    }

    return out.sort((a, b) => b.age - a.age);
  }, [s]);

  const overdue = entries.filter((e) => e.age >= OVERDUE_DAYS).length;
  const lineCount = entries.filter((e) => e.entityType === "line").length;
  const poCount = entries.filter((e) => e.entityType === "po").length;

  // One-click "Overdue only" quick filter, layered on top of the shared table's
  // own per-column filters.
  const rows = useMemo(() => (overdueOnly ? entries.filter((e) => e.age >= OVERDUE_DAYS) : entries), [entries, overdueOnly]);

  const ownerNames = (ids: string[]) => {
    const names = ids.map((id) => s.profileById(id)?.name).filter(Boolean) as string[];
    return names.length ? names.join(", ") : "Unassigned";
  };

  const doNudge = async (e: MonitorEntry) => {
    setBusyKey(e.key);
    try {
      await s.nudge({ entityType: e.entityType, entityId: e.entityId, recipients: e.ownerIds, label: e.ref });
    } finally {
      setBusyKey(null);
    }
  };
  const doEscalate = async (e: MonitorEntry) => {
    setBusyKey(e.key);
    try {
      await s.escalate({ entityType: e.entityType, entityId: e.entityId, label: e.ref });
    } finally {
      setBusyKey(null);
    }
  };

  const columns: QueueColumn<MonitorEntry>[] = [
    { key: "ref", header: "Ref", cell: (e) => <Link to={e.to} className="font-semibold text-orange hover:underline">{e.ref}</Link>, sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "detail", header: "Item / Vendor", cell: (e) => e.detail, sortValue: (e) => e.detail, filter: { kind: "text", get: (e) => e.detail } },
    { key: "stage", header: "Stage", cell: (e) => <span className="text-grey">{e.stageLabel}</span>, sortValue: (e) => e.stageLabel, filter: { kind: "select", get: (e) => e.stageLabel }, tdClassName: "whitespace-nowrap" },
    { key: "owner", header: "Owner", cell: (e) => ownerNames(e.ownerIds), sortValue: (e) => ownerNames(e.ownerIds), filter: { kind: "select", get: (e) => ownerNames(e.ownerIds) }, tdClassName: "whitespace-nowrap" },
    { key: "value", header: "Value", cell: (e) => inr(e.value), sortValue: (e) => e.value ?? 0, filter: { kind: "number", get: (e) => e.value ?? 0 }, tdClassName: "whitespace-nowrap" },
    { key: "age", header: "Age", cell: (e) => <span className={e.age >= OVERDUE_DAYS ? "text-ryg-red font-semibold" : "text-grey"}>{e.age}d</span>, sortValue: (e) => e.age, filter: { kind: "number", get: (e) => e.age }, tdClassName: "whitespace-nowrap" },
    { key: "status", header: "Status", cell: (e) => <span className={e.badgeClass}>{e.statusLabel}</span>, sortValue: (e) => e.statusLabel, filter: { kind: "select", get: (e) => e.statusLabel }, tdClassName: "whitespace-nowrap" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Control Center</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Every in-flight request line and open PO, with age-based overdue flagging. Nudge the owner, escalate to coordinators, or reassign an approval.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="In-flight lines" value={lineCount} />
        <Kpi label="Open POs" value={poCount} />
        <Kpi label={`Overdue (≥${OVERDUE_DAYS}d)`} value={overdue} tone={overdue > 0 ? "red" : undefined} />
        <Kpi label="Total in flight" value={entries.length} />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            aria-pressed={overdueOnly}
            className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border text-[12.5px] font-semibold transition-colors ${
              overdueOnly ? "border-ryg-red/50 text-ryg-red bg-ryg-red/5" : "border-line text-grey-2 hover:border-grey-2/40 hover:text-grey"
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${overdueOnly ? "bg-ryg-red" : "bg-grey-2/40"}`} />
            Overdue only (≥{OVERDUE_DAYS}d)
          </button>
        </div>
        <QueueTable
          rows={rows}
          rowKey={(e) => e.key}
          columns={columns}
          companyIdOf={(e) => e.companyId}
          companyNameOf={(id) => s.companyById(id)?.name ?? "—"}
          initialSort={{ key: "age", dir: "desc" }}
          rowsLabel="entries"
          emptyTitle="Nothing in flight"
          emptyMessage="Open requests and POs that need attention will appear here."
          actions={(e) => (
            <div className="flex items-center justify-end gap-3 whitespace-nowrap">
              <button onClick={() => doNudge(e)} disabled={busyKey === e.key} className="text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-50">Nudge</button>
              <button onClick={() => doEscalate(e)} disabled={busyKey === e.key} className="text-[12.5px] font-semibold text-ryg-red hover:underline disabled:opacity-50">Escalate</button>
              {e.reassignLine && (
                <button onClick={() => setReassign(e.reassignLine)} className="text-[12.5px] font-semibold text-grey hover:text-navy">Reassign</button>
              )}
            </div>
          )}
        />
      </Card>

      <ReassignModal line={reassign} onClose={() => setReassign(null)} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "red" }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[11px] text-grey-2">{label}</div>
      <div className={`text-[20px] font-bold ${tone === "red" ? "text-ryg-red" : "text-navy"}`}>{value}</div>
    </Card>
  );
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
