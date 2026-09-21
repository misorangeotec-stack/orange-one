import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { SectionHeading, SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import CheckinRow from "./CheckinRow";
import { checkinStepKey } from "../../lib/steps";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import { stepByKey } from "../../lib/steps";
import { CHECKIN_DAYS, type Probation } from "../../types";

/** Open the private file in a new tab. Nothing in the fms-hr-docs bucket is public. */
async function openDoc(path: string) {
  const url = await hrDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * The probation of one hire — the HOD's monthly work.
 *
 * Three reviews, then the decision those reviews exist to support:
 *   • Approve → capture the date they become permanent and their final employee ID
 *   • Reject  → record why, and STOP. The requisition does NOT reopen: this person
 *               joined and filled the seat, so replacing them is a new MRF.
 *   • Extend  → one more month, a Month-4 review, then Approve / Reject.
 *
 * The HOD here is, as everywhere in this app, whoever raised the MRF —
 * `fms_hr_can_act()` is the real gate and re-checks every one of these actions.
 */
export default function ProbationPanel({
  probation,
  open,
  onClose,
}: {
  probation: Probation;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const p = s.probationById(probation.id) ?? probation;
  const c = s.candidateById(p.candidateId);
  const r = s.requisitionById(p.requisitionId);
  const checkins = s.checkinsFor(p.id);
  const pendingStep = s.probationPendingStep(p);
  const mayAct = s.canEdit && s.canActOnProbation(p);

  const extended = p.outcome === "extended";
  const decided = !!p.finalStatus;

  // Which decision is on the table: the three-month one, or the one that closes an
  // extension? They are different RPCs because they are different facts.
  const decisionDue = pendingStep === "probation_final";
  const isExtensionDecision = decisionDue && extended;

  // The Employee ID is captured ONCE, at onboarding — this decision reuses it rather
  // than asking HR to re-type it. Editable only if the onboarding never recorded one.
  const onboardingCode = s.onboardingForCandidate(p.candidateId)?.employeeCode ?? "";

  const [decision, setDecision] = useState<"approve" | "reject" | "extend">("approve");
  const [remarks, setRemarks] = useState("");
  const [permanentFrom, setPermanentFrom] = useState(todayIso());
  const [employeeCode, setEmployeeCode] = useState(onboardingCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitDecision = async () => {
    setBusy(true);
    setErr(null);
    try {
      const permFrom = decision === "approve" ? permanentFrom : null;
      const code = decision === "approve" ? employeeCode.trim() : null;
      if (isExtensionDecision) {
        // An extended probation ends in approve or reject — it cannot extend again.
        await s.decideExtension(p, decision === "reject" ? "reject" : "approve", remarks.trim(), permFrom, code);
      } else {
        await s.decideProbation(p, decision, remarks.trim(), permFrom, code);
      }
      setRemarks("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const choices: Array<{ key: "approve" | "reject" | "extend"; label: string; hint: string }> = [
    { key: "approve", label: "Approve", hint: "Confirm them as permanent" },
    { key: "reject", label: "Reject", hint: "They have not cleared probation" },
    ...(isExtensionDecision
      ? []
      : [{ key: "extend" as const, label: "Extend by 1 month", hint: "A Month-4 review appears" }]),
  ];

  const decisionBlocked = decision === "approve" && (!permanentFrom || !employeeCode.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Probation — ${c?.name ?? "New hire"}`}
      subtitle={
        r
          ? `${r.mrfNo} · ${r.jobTitle} · joined ${formatDateDMY(p.joiningDate)}`
          : `Joined ${formatDateDMY(p.joiningDate)}`
      }
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {/* ---- Where this probation stands ---- */}
        <div className="flex flex-wrap items-center gap-2">
          {decided ? (
            <span
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${
                p.finalStatus === "approved" ? "bg-[#E9F7EF] text-ryg-green" : "bg-[#FDECEC] text-ryg-red"
              }`}
            >
              {p.finalStatus === "approved" ? "Confirmed permanent" : "Probation not cleared"}
            </span>
          ) : (
            <span className="rounded-full bg-[#FFF7E6] px-2.5 py-1 text-[11.5px] font-semibold text-yellow">
              On probation
            </span>
          )}
          {extended && (
            <span className="rounded-full bg-page px-2.5 py-1 text-[11.5px] font-semibold text-grey-2">
              Extended by {p.extensionMonths} month{p.extensionMonths === 1 ? "" : "s"}
            </span>
          )}
          {pendingStep && (
            /* "Now due:" is the label; the review's name and its date are the data. They
               used to share one grey span, so the sentence read as a single mumble. */
            <span className="text-[12.5px] text-grey">
              Now due:{" "}
              <span className="font-semibold text-navy">{stepByKey(pendingStep)?.title ?? pendingStep}</span> ·{" "}
              <DueCell dueIso={s.probationDueIso(p)} />
            </span>
          )}
        </div>

        {decided && (
          <div
            className={`rounded-xl border px-4 py-3 ${
              p.finalStatus === "approved"
                ? "border-ryg-green/30 bg-[#E9F7EF]/50"
                : "border-ryg-red/30 bg-[#FDECEC]/50"
            }`}
          >
            {p.finalStatus === "approved" ? (
              <p className="text-[13px] text-navy">
                Confirmed permanent from <strong>{formatDateDMY(p.permanentFrom)}</strong>
                {p.employeeCode && (
                  <>
                    {" "}
                    · employee ID <strong>{p.employeeCode}</strong>
                  </>
                )}
                .
              </p>
            ) : (
              <>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-ryg-red">
                  Probation not cleared
                </div>
                <p className="mt-1 text-[13px] text-navy">
                  {p.extensionRemarks ?? p.outcomeRemarks ?? "No reason recorded."}
                </p>
                <p className="mt-1 text-[12px] text-grey-2">
                  {r?.mrfNo ?? "The requisition"} stays closed — this person did fill the seat. Hiring a
                  replacement means raising a new requisition.
                </p>
              </>
            )}
            <p className="mt-1 text-[12px] text-grey-2">
              Decided {formatDateTimeDMY(p.finalStatusAt)}
              {p.extensionOutcomeBy || p.outcomeBy
                ? ` · ${s.profileById((p.extensionOutcomeBy ?? p.outcomeBy)!)?.name ?? "Unknown"}`
                : ""}
            </p>
          </div>
        )}

        {/* ---- NR-10 · the Day 7/15/30/60/90 check-ins ---- */}
        <div>
          <SectionHeading>Check-ins</SectionHeading>
          <p className="mt-1.5 text-[12px] text-grey">
            Day 7, 15, 30, 60 and 90 — <strong>calendar</strong> days after joining, not working days.
            Each one is written twice: by the head of department, and by the new joiner from their own
            account. It counts as done only when both are in.
          </p>
          <ul className="mt-2 space-y-2.5">
            {CHECKIN_DAYS.map((d) => (
              <CheckinRow
                key={d}
                probation={p}
                day={d}
                checkin={checkins.find((c) => c.dayNo === d)}
                isPending={pendingStep === checkinStepKey(d)}
                readOnly={!mayAct || decided}
              />
            ))}
          </ul>
        </div>

        {/* ---- The decision. Only offered once its review is actually in. ---- */}
        {!decided && (
          <div className={`rounded-xl border p-4 ${decisionDue ? "border-orange/40" : "border-line bg-page/40"}`}>
            {/* Already inside a bordered card — the class, not the component, so we
                don't stack a second hairline rule on top of the card's own border. */}
            <h3 className={SECTION_HEADING_CLASS}>
              {isExtensionDecision ? "Close the extended probation" : "Decision after three months"}
            </h3>
            {!decisionDue ? (
              <p className="mt-0.5 text-[12px] text-grey-2">
                {extended
                  ? "Record the Month-4 review first — the decision follows from it."
                  : "Record all three monthly reviews first — the decision follows from them."}
              </p>
            ) : !mayAct ? (
              <p className="mt-0.5 text-[12px] text-grey-2">
                This is the hiring manager's call — you can see it, but not take it.
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-[12px] text-grey-2">
                  {isExtensionDecision
                    ? "The extra month is up. This ends in approve or reject — it cannot be extended again."
                    : "Approve them, reject them, or buy one more month."}
                </p>

                <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                  {choices.map((ch) => (
                    <button
                      key={ch.key}
                      type="button"
                      onClick={() => setDecision(ch.key)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${
                        decision === ch.key ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-navy">{ch.label}</div>
                      <div className="text-[11.5px] text-grey-2">{ch.hint}</div>
                    </button>
                  ))}
                </div>

                {/* Approving is what makes someone permanent, so it captures both facts. */}
                {decision === "approve" && (
                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <FieldLabel label="Permanent from" required>
                      <TextInput
                        type="date"
                        value={permanentFrom}
                        onChange={(e) => setPermanentFrom(e.target.value)}
                      />
                    </FieldLabel>
                    <FieldLabel
                      label="Final employee ID"
                      required
                      hint={onboardingCode ? "fetched from onboarding" : undefined}
                    >
                      <TextInput
                        value={employeeCode}
                        onChange={(e) => setEmployeeCode(e.target.value)}
                        placeholder="e.g. OOT-1043"
                        disabled={!!onboardingCode}
                      />
                    </FieldLabel>
                  </div>
                )}

                <div className="mt-2.5">
                  <FieldLabel label="Remarks" required={decision === "reject"}>
                    <TextArea
                      rows={2}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder={
                        decision === "reject"
                          ? "Why has this person not cleared probation?"
                          : "Anything to note with this decision"
                      }
                    />
                  </FieldLabel>
                </div>

                <div className="mt-2.5">
                  <Button
                    size="sm"
                    disabled={busy || decisionBlocked || (decision === "reject" && !remarks.trim())}
                    onClick={() => void submitDecision()}
                  >
                    {busy
                      ? "Saving…"
                      : decision === "approve"
                        ? "Confirm as permanent"
                        : decision === "reject"
                          ? "Record the rejection"
                          : "Extend by one month"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        {!mayAct && !decided && (
          <p className="text-[12.5px] text-grey-2">You can see this probation, but not change it.</p>
        )}
      </div>
    </Modal>
  );
}
