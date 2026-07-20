import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { formatDate, formatDateTime } from "@/shared/lib/time";
import ReceiveModal from "../../components/ReceiveModal";
import SendModal from "../../components/SendModal";
import ConfirmModal from "../../components/ConfirmModal";
import TestingModal from "../../components/TestingModal";
import ResultModal from "../../components/ResultModal";
import StatusPill from "../../components/StatusPill";
import { directionLabel, dmy, receiveViaLabel, requestSubject, requirementTypeLabel } from "../../lib/format";
import { openStep } from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import { useSamplingStore } from "../../store";
import type { SamplingRequest } from "../../types";

type StageState = "done" | "current" | "pending";

/** One step in the progress panel. */
function Stage({
  title,
  when,
  by,
  detail,
  state,
}: {
  title: string;
  when: string | null;
  by: string | null;
  detail: string | null;
  state: StageState;
}) {
  const tone = state === "done" ? "text-ryg-green" : state === "current" ? "text-orange" : "text-grey-2";
  const dot = state === "done" ? "bg-ryg-green" : state === "current" ? "bg-orange" : "bg-line";
  const label = state === "done" ? "Done" : state === "current" ? "In progress" : "Pending";
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
        {detail && <div className="text-[12.5px] text-grey mt-0.5">{detail}</div>}
      </div>
    </div>
  );
}

type OpenModal = "receive" | "send" | "confirm" | "testing" | "result" | null;

export default function RequestDetail() {
  const { id } = useParams();
  const s = useSamplingStore();
  const session = useSession();
  const r = id ? s.requestById(id) : undefined;

  const [modal, setModal] = useState<OpenModal>(null);
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
        <Link to="/sampling/requests" className="mt-4 inline-block text-[13px] font-semibold text-orange hover:underline">
          Back to all requests
        </Link>
      </Card>
    );
  }

  const name = (uid: string | null) => (uid ? s.personName(uid) : "—");
  const isCoordinatorish = s.isAdmin || s.isProcessCoordinator;
  const canHold = isCoordinatorish && (s.isOpenRequest(r) || r.status === "on_hold");
  const canCancel = (r.raisedBy === session.user.id || isCoordinatorish) && (s.isOpenRequest(r) || r.status === "on_hold");

  // The one action the request's current step offers, if this user owns it.
  const cur = openStep(r);
  const canActNow = cur ? s.canActOn(cur as StepKey, r) : false;
  const action: { label: string; modal: OpenModal } | null =
    !canActNow ? null
    : r.status === "awaiting_receipt" ? { label: "Record receipt", modal: "receive" }
    : r.status === "awaiting_send" ? { label: "Record dispatch", modal: "send" }
    : r.status === "awaiting_confirm" ? { label: "Confirm receipt", modal: "confirm" }
    : r.status === "awaiting_testing" ? { label: "Record testing", modal: "testing" }
    : r.status === "awaiting_result" ? { label: "Record result", modal: "result" }
    : null;

  const runReason = async (fn: (r: SamplingRequest, reason: string) => Promise<void>, close: () => void) => {
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

  const stateFor = (step: StepKey, doneAt: string | null): StageState =>
    doneAt ? "done" : cur === step ? "current" : "pending";

  const activity = s.activityFor("request", r.id);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-bold text-navy">{r.reqNo}</h1>
            <StatusPill status={r.status} />
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">
            {directionLabel(r.direction)} · {requestSubject(r)} · raised by {r.requesterName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {action && <Button size="sm" onClick={() => setModal(action.modal)}>{action.label}</Button>}
          {canHold && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (r.status === "on_hold" ? void s.holdRequest(r, false, "") : setHoldOpen(true))}
            >
              {r.status === "on_hold" ? "Resume" : "Hold"}
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)} className="!text-ryg-red">
              Cancel
            </Button>
          )}
        </div>
      </div>

      <Card className="p-5">
        <SectionHeading>Request</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-3">
          <Field label="Company" value={s.companyById(r.companyId)?.name ?? "—"} />
          <Field label="Sample source" value={receiveViaLabel(r.receiveVia)} />
          <Field label="Direction" value={directionLabel(r.direction)} />
          {r.direction === "inward" && <Field label="Requirement type" value={requirementTypeLabel(r.requirementType)} />}
          <Field label={r.direction === "outward" ? "Send to" : "Party"} value={r.partyName} />
          <Field label="Requester" value={r.requesterName} />
          <Field label="Product / description" value={r.productDesc} className="col-span-2 sm:col-span-3" />
          {r.direction === "inward" && r.requirementType === "competitor" && (
            <>
              <Field label="Colour & quantity" value={r.colourQty} />
              <Field label="Collected by" value={r.collectorName} />
              <Field label="Hand to" value={r.handoverName} />
            </>
          )}
          {(r.transportBorne) && <Field label="Transport borne" value={r.transportBorne} />}
          <Field label="Submitted" value={formatDate(r.submittedAt)} />
        </div>
        {(r.desiredResult || r.additionalInfo) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-line">
            <Field label="Desired result" value={r.desiredResult} />
            <Field label="Additional information" value={r.additionalInfo} />
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
        {r.direction === "inward" ? (
          <Stage
            title="Sample received"
            when={r.receivedAt}
            by={name(r.receivedBy)}
            detail={r.receivedDate ? `Received ${dmy(r.receivedDate)}` : null}
            state={stateFor("receive_sample", r.receivedAt)}
          />
        ) : (
          <>
            <Stage
              title="Sample sent"
              when={r.sentAt}
              by={name(r.sentBy)}
              detail={r.sentDate ? `Sent ${dmy(r.sentDate)}` : null}
              state={stateFor("send_sample", r.sentAt)}
            />
            <Stage
              title="Receipt confirmed"
              when={r.confirmedAt}
              by={name(r.confirmedBy)}
              detail={r.partyReceivedDate ? `Party received ${dmy(r.partyReceivedDate)}` : null}
              state={stateFor("confirm_receipt", r.confirmedAt)}
            />
          </>
        )}
        <Stage
          title="Testing"
          when={r.testedAt}
          by={name(r.testedBy)}
          detail={
            r.testingCompletedDate
              ? `Completed ${dmy(r.testingCompletedDate)}${r.internalRef ? ` · ${r.internalRef}` : ""}${r.tentativeResultDate ? ` · result by ${dmy(r.tentativeResultDate)}` : ""}`
              : null
          }
          state={stateFor("testing", r.testedAt)}
        />
        <Stage
          title="Result"
          when={r.resultedAt}
          by={name(r.resultedBy)}
          detail={r.resultComment}
          state={stateFor("result", r.resultedAt)}
        />
      </Card>

      {activity.length > 0 && (
        <Card className="p-5">
          <h2 className="text-[15px] font-bold text-navy">Activity</h2>
          <ul className="mt-3 space-y-2.5">
            {activity
              .slice()
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((a) => (
                <li key={a.id} className="flex gap-3 text-[12.5px]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
                  <div className="min-w-0">
                    <div className="text-navy">{a.note ?? a.type}</div>
                    <div className="text-grey-2">
                      {formatDateTime(a.createdAt)}
                      {a.actorId ? ` · ${name(a.actorId)}` : ""}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <ReceiveModal open={modal === "receive"} onClose={() => setModal(null)} request={r} />
      <SendModal open={modal === "send"} onClose={() => setModal(null)} request={r} />
      <ConfirmModal open={modal === "confirm"} onClose={() => setModal(null)} request={r} />
      <TestingModal open={modal === "testing"} onClose={() => setModal(null)} request={r} />
      <ResultModal open={modal === "result"} onClose={() => setModal(null)} request={r} />

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
