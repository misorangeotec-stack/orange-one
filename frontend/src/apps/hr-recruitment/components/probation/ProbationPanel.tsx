import { useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { SectionHeading, SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { addMonths, localDateIso } from "@/shared/lib/workingDays";
import { useHrStore } from "../../store";
import { hrDocUrl, uploadProbationDoc } from "../../data/hrWrites";
import { stepByKey } from "../../lib/steps";
import type { Probation, ProbationReview, ProbationReviewStatus } from "../../types";

const REVIEW_LABEL: Record<ProbationReviewStatus, string> = {
  satisfactory: "Satisfactory",
  needs_improvement: "Needs improvement",
  unsatisfactory: "Unsatisfactory",
};

const REVIEW_CLASS: Record<ProbationReviewStatus, string> = {
  satisfactory: "bg-[#E9F7EF] text-ryg-green",
  needs_improvement: "bg-[#FFF7E6] text-yellow",
  unsatisfactory: "bg-[#FDECEC] text-ryg-red",
};

/** Open the private file in a new tab. Nothing in the fms-hr-docs bucket is public. */
async function openDoc(path: string) {
  const url = await hrDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * When month N's review is due. The same rule the queue uses — N CALENDAR months
 * after joining, clamped at a short month end (31-Jan + 1 = 28-Feb).
 */
const monthDueIso = (joiningDate: string, month: number): string | null => {
  const from = new Date(`${joiningDate}T00:00:00`);
  if (Number.isNaN(from.getTime())) return null;
  return localDateIso(addMonths(from, month));
};

/**
 * One month's review: the status, the HOD's remarks, and an optional file.
 *
 * `reviewed_at` is stamped by the RPC — the HOD never types a date. Re-recording a
 * month is allowed (a correction) right up until the final decision closes it.
 */
function ReviewRow({
  probation,
  month,
  review,
  isPending,
  readOnly,
}: {
  probation: Probation;
  month: number;
  review: ProbationReview | undefined;
  isPending: boolean;
  readOnly: boolean;
}) {
  const s = useHrStore();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ProbationReviewStatus>(review?.status ?? "satisfactory");
  const [remarks, setRemarks] = useState(review?.remarks ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Upload first, so a review can never be recorded against a file that isn't there.
      let filePath = review?.filePath ?? null;
      let fileName = review?.fileName ?? null;
      if (file) {
        const up = await uploadProbationDoc(probation.id, month, file);
        filePath = up.path;
        fileName = up.name;
      }
      await s.recordProbationReview(probation, month, status, remarks.trim(), filePath, fileName);
      setFile(null);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const done = !!review;
  const editable = !readOnly && (isPending || done);

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        done ? "border-ryg-green/30 bg-[#E9F7EF]/40" : isPending ? "border-orange/40" : "border-line bg-page/40"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border text-[10px] font-bold ${
                done ? "border-ryg-green bg-ryg-green text-white" : "border-grey-2/50 text-transparent"
              }`}
              aria-hidden
            >
              ✓
            </span>
            <span className="text-[13.5px] font-semibold text-navy">
              {month === 4 ? "Month-4 review (extended)" : `Month-${month} review`}
            </span>
            {review && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${REVIEW_CLASS[review.status]}`}>
                {REVIEW_LABEL[review.status]}
              </span>
            )}
          </div>

          {review ? (
            <>
              <p className="mt-1 pl-6 text-[12px] text-grey-2">
                Reviewed {formatDateTimeDMY(review.reviewedAt)}
                {review.reviewerId && ` · ${s.profileById(review.reviewerId)?.name ?? "Unknown"}`}
              </p>
              {review.remarks && <p className="mt-1 pl-6 text-[13px] text-navy">{review.remarks}</p>}
              {review.filePath && (
                <button
                  type="button"
                  onClick={() => void openDoc(review.filePath!)}
                  className="mt-1 pl-6 text-[12px] font-semibold text-orange hover:underline"
                >
                  {review.fileName ?? "Open file"} →
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 pl-6 text-[12px] text-grey-2">
              {isPending ? "This is the review you owe now." : "Not due yet — the earlier months come first."}
            </p>
          )}
        </div>

        <span className="shrink-0 text-[12px] text-grey-2">
          Due <DueCell dueIso={monthDueIso(probation.joiningDate, month)} />
        </span>
      </div>

      {editable && !open && (
        <div className="mt-2 pl-6">
          <Button size="sm" variant={done ? "ghost" : "primary"} onClick={() => setOpen(true)}>
            {done ? "Edit this review" : "Record this review"}
          </Button>
        </div>
      )}

      {editable && open && (
        <div className="mt-3 grid gap-2.5 pl-6">
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(REVIEW_LABEL) as ProbationReviewStatus[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatus(k)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  status === k ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                }`}
              >
                <div className="text-[13px] font-semibold text-navy">{REVIEW_LABEL[k]}</div>
              </button>
            ))}
          </div>

          <FieldLabel label="Remarks">
            <TextArea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="How is this person doing in their first months?"
            />
          </FieldLabel>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">Attach a file (optional)</span>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy"
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save the review"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      )}
    </li>
  );
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
  const reviews = s.reviewsFor(p.id);
  const pendingStep = s.probationPendingStep(p);
  const mayAct = s.canActOnProbation(p);

  const extended = p.outcome === "extended";
  const decided = !!p.finalStatus;
  const months = extended ? [1, 2, 3, 4] : [1, 2, 3];

  // Which decision is on the table: the three-month one, or the one that closes an
  // extension? They are different RPCs because they are different facts.
  const decisionDue = pendingStep === "probation_final";
  const isExtensionDecision = decisionDue && extended;

  const [decision, setDecision] = useState<"approve" | "reject" | "extend">("approve");
  const [remarks, setRemarks] = useState("");
  const [permanentFrom, setPermanentFrom] = useState(todayIso());
  const [employeeCode, setEmployeeCode] = useState("");
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

        {/* ---- The monthly reviews ---- */}
        <div>
          <SectionHeading>Monthly reviews</SectionHeading>
          <p className="mt-1.5 text-[12px] text-grey">
            Each review is due one calendar month after the joining date — not a count of working days.
          </p>
          <ul className="mt-2 space-y-2.5">
            {months.map((m) => (
              <ReviewRow
                key={m}
                probation={p}
                month={m}
                review={reviews.find((rv) => rv.month === m)}
                isPending={pendingStep === (m === 4 ? "probation_extension" : `probation_m${m}`)}
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
                    <FieldLabel label="Final employee ID" required>
                      <TextInput
                        value={employeeCode}
                        onChange={(e) => setEmployeeCode(e.target.value)}
                        placeholder="e.g. OOT-1043"
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
