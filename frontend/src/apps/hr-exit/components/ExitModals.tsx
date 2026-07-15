import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import Modal from "@/shared/components/ui/Modal";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useExitStore } from "../store";
import { STEPS, type StepKey } from "../lib/steps";
import type { HeadDecision, ExitCase, ManagerRecommendation } from "../types";

/* -------------------------------------------------------------------------- */
/*  1. The reporting manager's review                                          */
/* -------------------------------------------------------------------------- */

/**
 * Accept / Reject / Discuss — a **RECOMMENDATION, and it never blocks**.
 *
 * The case advances to HR whichever is chosen. You cannot legally refuse a
 * resignation, and only the HR Head can terminally stop a case. The modal says so
 * out loud, because a manager clicking "Reject" and expecting the person to stay is a
 * far worse outcome than a manager who knew it was only advice.
 *
 * "Discuss" additionally records that a conversation is wanted — and deliberately
 * does NOT restart the clock. Re-clocking would turn it into an SLA dodge.
 */
export function ManagerReviewModal({
  case: c,
  open,
  onClose,
}: {
  case: ExitCase;
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const [recommendation, setRecommendation] = useState<ManagerRecommendation>("accept");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsReason = recommendation !== "accept";
  const invalid = needsReason && !remarks.trim();

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.managerReview(c, recommendation, remarks.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choices: { key: ManagerRecommendation; label: string; hint: string }[] = [
    { key: "accept", label: "Accept", hint: "You are content for them to go" },
    { key: "reject", label: "I'd rather not lose them", hint: "Recorded for HR — it does not stop the exit" },
    { key: "discuss", label: "I want to discuss it", hint: "Recorded. The clock is not restarted" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Your review — ${c.exitNo}`}
      subtitle={`${c.employeeName} · ${c.employeeCode}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Saving…" : "Submit"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="rounded-xl border border-line bg-page px-3.5 py-2.5 text-[12.5px] leading-relaxed text-grey">
          This is a <span className="font-semibold text-navy">recommendation</span>. Whatever you choose, the case
          moves on to HR — only the HR Head can stop an exit.
        </p>

        <div className="grid gap-2">
          {choices.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setRecommendation(o.key)}
              className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                recommendation === o.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
              }`}
            >
              <div className="text-[13.5px] font-semibold text-navy">{o.label}</div>
              <div className="text-[12px] text-grey-2">{o.hint}</div>
            </button>
          ))}
        </div>

        <FieldLabel
          label={needsReason ? "Reason" : "Remarks"}
          required={needsReason}
          hint={needsReason ? undefined : "optional"}
        >
          <TextArea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="HR will read this."
          />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. HR verification                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The notice period, whether the policy applies, and the **PROPOSED** last working day.
 *
 * Proposed, not confirmed: `lwd` is set at the next step, because seven downstream
 * SLAs and the entire clearance checklist hang off it and must not move under a
 * proposal that is still being argued about.
 */
export function HrVerifyModal({
  case: c,
  open,
  onClose,
}: {
  case: ExitCase;
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const [noticeDays, setNoticeDays] = useState(String(c.noticePeriodDays ?? s.policy.defaultNoticeDays));
  const [waived, setWaived] = useState(c.noticeWaived);
  const [applicable, setApplicable] = useState(c.policyApplicable);
  const [naReason, setNaReason] = useState(c.policyNaReason ?? "");
  const [proposedLwd, setProposedLwd] = useState(c.proposedLwd ?? "");
  const [remarks, setRemarks] = useState(c.hrRemarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const invalid = !proposedLwd || (!applicable && !naReason.trim());

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.hrVerify(c, {
        noticePeriodDays: Number(noticeDays) || null,
        noticeWaived: waived,
        policyApplicable: applicable,
        policyNaReason: applicable ? null : naReason.trim(),
        proposedLwd,
        hrRemarks: remarks.trim() || null,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`HR verification — ${c.exitNo}`}
      subtitle={`${c.employeeName} · joined ${formatDateDMY(c.dateOfJoining)}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Saving…" : "Send to the HR Head"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <FieldLabel label="Notice period (days)" required>
            <TextInput
              type="number"
              min={0}
              value={noticeDays}
              onChange={(e) => setNoticeDays(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Proposed last working day" required>
            <TextInput type="date" value={proposedLwd} onChange={(e) => setProposedLwd(e.target.value)} />
          </FieldLabel>
        </div>

        <label className="flex items-center gap-2.5 text-[13px] text-navy">
          <input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} />
          Notice period waived
        </label>
        <label className="flex items-center gap-2.5 text-[13px] text-navy">
          <input type="checkbox" checked={applicable} onChange={(e) => setApplicable(e.target.checked)} />
          The notice policy applies to this exit
        </label>

        {!applicable && (
          <FieldLabel label="Why the policy does not apply" required>
            <TextArea rows={2} value={naReason} onChange={(e) => setNaReason(e.target.value)} />
          </FieldLabel>
        )}

        <FieldLabel label="Remarks" hint="optional">
          <TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>

        <p className="text-[11.5px] leading-snug text-grey-2">
          This date is a <span className="font-semibold">proposal</span>. The last working day is confirmed at the
          next step — the clearance checklist and seven deadlines are all built from it.
        </p>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. The HR Head's decision                                                  */
/* -------------------------------------------------------------------------- */

/** Approve → clearance begins. Reject → terminal. **The only terminal reject there is.** */
export function HeadDecisionModal({
  case: c,
  open,
  onClose,
}: {
  case: ExitCase;
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const [decision, setDecision] = useState<HeadDecision>("approve");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const invalid = decision === "reject" && !remarks.trim();

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.decideCase(c, decision, remarks.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choices: { key: HeadDecision; label: string; hint: string }[] = [
    { key: "approve", label: "Approve", hint: "Confirm the last working day next — that starts clearance" },
    { key: "reject", label: "Reject", hint: "Terminal. This exit will not proceed" },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`HR Head decision — ${c.exitNo}`}
      subtitle={`${c.employeeName} · proposed last working day ${formatDateDMY(c.proposedLwd)}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || invalid}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-2">
          {choices.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setDecision(o.key)}
              className={`rounded-xl border px-3.5 py-2.5 text-left transition ${
                decision === o.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
              }`}
            >
              <div className="text-[13.5px] font-semibold text-navy">{o.label}</div>
              <div className="text-[12px] text-grey-2">{o.hint}</div>
            </button>
          ))}
        </div>

        {c.managerRecommendation && (
          <div className="rounded-xl border border-line bg-page px-3.5 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
              The reporting manager said
            </div>
            <p className="mt-1 text-[13px] text-navy">
              {c.managerRecommendation === "accept"
                ? "Accepted"
                : c.managerRecommendation === "reject"
                  ? "Would rather not lose them"
                  : "Wants to discuss it"}
              {c.managerRemarks ? ` — ${c.managerRemarks}` : ""}
            </p>
          </div>
        )}

        <FieldLabel
          label={decision === "reject" ? "Reason" : "Remarks"}
          required={decision === "reject"}
          hint={decision === "reject" ? undefined : "optional"}
        >
          <TextArea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Confirm the last working day — the pivot of the whole application        */
/* -------------------------------------------------------------------------- */

/**
 * Confirming the LWD does **two** things, and only one of them is a date.
 *
 *   1. It finalises the day the person actually leaves. SEVEN downstream deadlines
 *      hang off it — clearance, the asset return, the handover, the exit interview,
 *      leave, payroll and the F&F — and every one of them moves when it moves.
 *   2. It **generates the departmental clearance checklist**, from the items in
 *      Masters, snapshotted onto this case.
 *
 * The modal says both out loud, because someone typing a date into a box has no
 * reason to expect eight departments to be paged. Changing it later is allowed and
 * safe (the list is never rebuilt, only re-dated) — but it moves everyone's deadline,
 * so it says that too.
 */
export function ConfirmLwdModal({
  case: c,
  open,
  onClose,
}: {
  case: ExitCase;
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const [lwd, setLwd] = useState(c.lwd ?? c.proposedLwd ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const again = !!c.lwd;
  const items = s.activeClearanceItems.length;

  const submit = async () => {
    if (!lwd) return;
    setBusy(true);
    setErr(null);
    try {
      await s.confirmLwd(c, lwd);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${again ? "Change" : "Confirm"} the last working day — ${c.exitNo}`}
      subtitle={`${c.employeeName} · ${c.employeeCode}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !lwd}>
            {busy ? "Saving…" : again ? "Move the date" : "Confirm & open clearance"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Last working day" required>
          <TextInput type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} />
        </FieldLabel>

        {c.proposedLwd && (
          <p className="text-[12.5px] text-grey-2">
            HR proposed <span className="font-semibold text-navy">{formatDateDMY(c.proposedLwd)}</span>.
          </p>
        )}

        {again ? (
          <p className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-navy">
            <span className="font-semibold">This moves every deadline.</span> Clearance, the asset return, the
            handover, the exit interview, leave, payroll and the F&amp;F are all dated from this one day. The
            checklist itself is <span className="font-semibold">not</span> rebuilt — nothing already ticked is
            lost, and no new row appears.
          </p>
        ) : (
          <p className="rounded-xl border border-line bg-page px-3.5 py-2.5 text-[12.5px] leading-relaxed text-grey">
            This <span className="font-semibold text-navy">generates the clearance checklist</span> —{" "}
            {items || "no"} item{items === 1 ? "" : "s"} from Masters, one per department, each with its own
            owner and its own deadline (most of them fall <span className="font-semibold text-navy">before</span>{" "}
            the last working day). Seven other deadlines are dated from it too. You can change it later; it
            re-dates everything and rebuilds nothing.
          </p>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  5. Hold / resume / withdraw                                                */
/* -------------------------------------------------------------------------- */

/**
 * Park a case, un-park it, or retract it.
 *
 * `on_hold` is a STATUS, never a step: a held case leaves EVERY queue and is counted
 * on its own strip, never inside a red one. Withdrawing is the employee's own act
 * (HR and the raiser can do it for them), and it is allowed right up until the F&F
 * has actually been paid — after that, changing your mind is a re-hire.
 */
export function HoldWithdrawModal({
  case: c,
  mode,
  open,
  onClose,
}: {
  case: ExitCase;
  mode: "hold" | "resume" | "withdraw";
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsReason = mode !== "resume";

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "withdraw") await s.withdrawCase(c, reason.trim());
      else await s.holdCase(c, mode === "hold", reason.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "withdraw" ? "Withdraw this exit" : mode === "hold" ? "Put on hold" : "Take off hold";
  const subtitle =
    mode === "withdraw"
      ? "The person is staying. Everything already recorded is kept, not deleted."
      : mode === "hold"
        ? "The case pauses exactly where it is and leaves everyone's queue. Nothing is lost."
        : "The case resumes at the step its own record says it had reached.";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${title} — ${c.exitNo}`}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || (needsReason && !reason.trim())}>
            {busy ? "Saving…" : "Confirm"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {needsReason && (
          <FieldLabel label="Reason" required>
            <TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldLabel>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  6. Skip a step                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Waive a step, with a reason.
 *
 * The ONE generic mechanism that covers every real-world hole: an absconder has no
 * handover, a terminated employee gets no relieving letter, Training clearance is
 * "if applicable". A skipped step is **complete-with-a-reason** — it emits no queue
 * entry, shows ⊘ on the stepper, and satisfies the downstream guards.
 *
 * The approval chain and `archive` are absent from the list on purpose: those steps
 * drive the case's status, so skipping one would leave the status and the open work
 * disagreeing. The RPC refuses them too.
 */
const SKIPPABLE: StepKey[] = [
  "clearance",
  "asset_return",
  "handover",
  "exit_interview",
  "leave_verification",
  "payroll_inputs",
  "fnf_generate",
  "fnf_approve",
  "fnf_payment",
  "documents",
];

export function SkipStepModal({
  case: c,
  open,
  onClose,
}: {
  case: ExitCase;
  open: boolean;
  onClose: () => void;
}) {
  const s = useExitStore();
  const already = new Set(s.skipsFor(c.id).map((k) => k.stepKey));
  const [step, setStep] = useState<StepKey | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!step) return;
    setBusy(true);
    setErr(null);
    try {
      await s.skipStep(c, step, reason.trim());
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const options = SKIPPABLE.filter((k) => !already.has(k)).map((k) => ({
    value: k,
    label: STEPS.find((x) => x.key === k)?.title ?? k,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Skip a step — ${c.exitNo}`}
      subtitle="Some steps genuinely do not apply. Skipping one records why, and lets everything after it proceed."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !step || !reason.trim()}>
            {busy ? "Saving…" : "Skip it"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Step" required>
          <Combobox
            value={step}
            onChange={(v) => setStep(v as StepKey)}
            options={options}
            placeholder="Which step does not apply?"
          />
        </FieldLabel>
        <FieldLabel label="Why not?" required>
          <TextArea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Absconded — there is nobody to hand over to."
          />
        </FieldLabel>
        {options.length === 0 && (
          <p className="text-[12.5px] text-grey-2">Every skippable step on this case has already been waived.</p>
        )}
        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
