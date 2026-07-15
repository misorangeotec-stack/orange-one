import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDate } from "@/shared/lib/time";
import ApprovalModal from "../../components/ApprovalModal";
import HandoverModal from "../../components/HandoverModal";
import StatusPill from "../../components/StatusPill";
import { dmy, requestTypeLabel } from "../../lib/format";
import { useSuppliesStore } from "../../store";
import type { SupplyRequest } from "../../types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
      <div className="text-[14px] text-navy mt-0.5">{children}</div>
    </div>
  );
}

/** One approval / handover stage in the progress panel. */
function Stage({
  title,
  when,
  by,
  remarks,
  state,
}: {
  title: string;
  when: string | null;
  by: string | null;
  remarks: string | null;
  state: "done" | "current" | "pending" | "skipped" | "rejected";
}) {
  const tone =
    state === "done"
      ? "text-ryg-green"
      : state === "current"
        ? "text-orange"
        : state === "rejected"
          ? "text-ryg-red"
          : "text-grey-2";
  const dot =
    state === "done" ? "bg-ryg-green" : state === "current" ? "bg-orange" : state === "rejected" ? "bg-ryg-red" : "bg-line";
  const label =
    state === "done" ? "Done" : state === "current" ? "In progress" : state === "skipped" ? "Not required" : state === "rejected" ? "Rejected" : "Pending";
  return (
    <div className="flex gap-3">
      <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-navy">{title}</span>
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
        </div>
        {when && (
          <div className="text-[12.5px] text-grey-2">
            {formatDate(when)}
            {by ? ` · ${by}` : ""}
          </div>
        )}
        {remarks && <div className="text-[12.5px] text-grey mt-0.5">"{remarks}"</div>}
      </div>
    </div>
  );
}

export default function RequestDetail() {
  const { id } = useParams();
  const s = useSuppliesStore();
  const session = useSession();
  const r = id ? s.requestById(id) : undefined;

  const [approving, setApproving] = useState<"first" | "second" | null>(null);
  const [handingOver, setHandingOver] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!r) {
    return (
      <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
        <h1 className="text-[18px] font-bold text-navy">Request not found</h1>
        <p className="text-[13.5px] text-grey-2 mt-2">It may not exist, or you may not have access to it.</p>
        <Link to="/office-supplies/requests" className="mt-4 inline-block text-[13px] font-semibold text-orange hover:underline">
          Back to all requests
        </Link>
      </Card>
    );
  }

  const name = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "—") : "—");
  const canFirst = r.status === "pending_first_approval" && s.canActOn("first_approval", r);
  const canSecond = r.status === "pending_second_approval" && s.canActOn("second_approval", r);
  const canHandover = r.status === "pending_handover" && s.canActOn("handover", r);
  const isCoordinatorish = s.isAdmin || s.isProcessCoordinator;
  const canHold = isCoordinatorish && (s.isOpenRequest(r) || r.status === "on_hold");
  const canCancel =
    (r.raisedBy === session.user.id || isCoordinatorish) && (s.isOpenRequest(r) || r.status === "on_hold");

  const runReason = async (fn: (r: SupplyRequest, reason: string) => Promise<void>, close: () => void) => {
    if (!reason.trim()) {
      setErr("A reason is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await fn(r, reason.trim());
      setReason("");
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const firstState = r.rejectStage === "first_approval" ? "rejected" : r.firstApprovedAt ? "done" : r.status === "pending_first_approval" ? "current" : !r.requiresApproval ? "skipped" : "pending";
  const secondState = r.rejectStage === "second_approval" ? "rejected" : r.secondApprovedAt ? "done" : r.status === "pending_second_approval" ? "current" : !r.requiresApproval ? "skipped" : "pending";
  const handoverState = r.deliveredAt ? "done" : r.status === "pending_handover" ? "current" : r.status === "cancelled" || r.status === "rejected" ? "pending" : "pending";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-navy">{r.reqNo}</h1>
            <StatusPill status={r.status} />
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">
            For {r.requestedForName}
            {r.raisedOnBehalf ? ` · raised by ${name(r.raisedBy)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {canFirst && <Button size="sm" onClick={() => setApproving("first")}>Review (first approval)</Button>}
          {canSecond && <Button size="sm" onClick={() => setApproving("second")}>Review (second approval)</Button>}
          {canHandover && <Button size="sm" onClick={() => setHandingOver(true)}>Handover</Button>}
          {canHold && (
            <Button size="sm" variant="ghost" onClick={() => (r.status === "on_hold" ? void s.holdRequest(r, false, "") : setHoldOpen(true))}>
              {r.status === "on_hold" ? "Resume" : "Hold"}
            </Button>
          )}
          {canCancel && <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)} className="!text-ryg-red">Cancel</Button>}
        </div>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Field label="Company">{s.companyById(r.companyId)?.name ?? "—"}</Field>
          <Field label="Location">{r.location}</Field>
          <Field label="Department">{s.departmentById(r.departmentId)?.name ?? "—"}</Field>
          <Field label="Type">{requestTypeLabel(r.requestType)}</Field>
          {r.requestType === "new_requirement" ? (
            <Field label="Category">{r.categoryId ? (s.categoryById(r.categoryId)?.name ?? "—") : "—"}</Field>
          ) : (
            <Field label="Service">{r.serviceTypeId ? (s.serviceTypeById(r.serviceTypeId)?.name ?? "—") : "—"}</Field>
          )}
          <Field label="Item / Service">{r.itemName ?? "—"}</Field>
          <Field label="Quantity">{r.quantity}</Field>
          <Field label="Submitted">{formatDate(r.submittedAt)}</Field>
          <Field label="Route">{r.requiresApproval ? "Two approvals → handover" : "Straight to handover"}</Field>
        </div>
        {r.reason && (
          <div className="mt-4 pt-4 border-t border-line">
            <Field label="Reason">{r.reason}</Field>
          </div>
        )}
        {r.status === "on_hold" && r.holdReason && (
          <div className="mt-4 rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">On hold: {r.holdReason}</div>
        )}
        {r.status === "cancelled" && r.cancelReason && (
          <div className="mt-4 rounded-xl bg-page px-3.5 py-2.5 text-[12.5px] text-grey">Cancelled: {r.cancelReason}</div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-bold text-navy">Progress</h2>
        {r.requiresApproval && (
          <>
            <Stage title="First approval (HOD)" when={r.firstApprovedAt} by={name(r.firstApproverId)} remarks={r.firstRemarks} state={firstState} />
            <Stage title="Second approval (Management)" when={r.secondApprovedAt} by={name(r.secondApproverId)} remarks={r.secondRemarks} state={secondState} />
          </>
        )}
        <Stage
          title="Final confirmation / handover"
          when={r.deliveredAt ?? r.handedOverAt}
          by={name(r.handoverBy)}
          remarks={r.handoverRemarks}
          state={handoverState}
        />
        {(r.tentativeDeliveryDate || r.actualDeliveryDate) && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-line">
            <Field label="Tentative delivery">{dmy(r.tentativeDeliveryDate)}</Field>
            <Field label="Actual delivery">{dmy(r.actualDeliveryDate)}</Field>
          </div>
        )}
      </Card>

      <ApprovalModal open={approving !== null} onClose={() => setApproving(null)} request={r} stage={approving ?? "first"} />
      <HandoverModal open={handingOver} onClose={() => setHandingOver(false)} request={r} />

      <Modal
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        title={`Hold ${r.reqNo}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setHoldOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => runReason((req, rs) => s.holdRequest(req, true, rs), () => setHoldOpen(false))} disabled={busy}>
              {busy ? "Saving…" : "Hold"}
            </Button>
          </>
        }
      >
        <FieldLabel label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being held?" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red mt-2">{err}</p>}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel ${r.reqNo}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(false)} disabled={busy}>Keep it</Button>
            <Button size="sm" onClick={() => runReason((req, rs) => s.cancelRequest(req, rs), () => setCancelOpen(false))} disabled={busy} className="!bg-ryg-red">
              {busy ? "Cancelling…" : "Cancel request"}
            </Button>
          </>
        }
      >
        <FieldLabel label="Reason" required>
          <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being cancelled?" />
        </FieldLabel>
        {err && <p className="text-[12.5px] text-ryg-red mt-2">{err}</p>}
      </Modal>
    </div>
  );
}
