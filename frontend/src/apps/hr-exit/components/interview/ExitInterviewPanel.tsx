import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import DueCell from "@/shared/components/ui/DueCell";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { FieldLabel, Select, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { useExitStore } from "../../store";
import { exitDocUrl, uploadInterviewDoc } from "../../data/exitWrites";
import type { ExitCase } from "../../types";

/** Open the private file in a new tab. This prefix is HR-confidential in storage too. */
async function openDoc(path: string) {
  const url = await exitDocUrl(path);
  if (url) window.open(url, "_blank", "noreferrer");
}

/**
 * The structured questionnaire. It lives HERE, in code, and lands in a single `jsonb`
 * column — deliberately.
 *
 * A column per question would make "HR adds a question" a migration, and dropping one
 * would erase the answers people had already given. Adding a row to this array is the
 * whole change; every interview recorded before it simply has no value for that key,
 * which is the truth.
 */
const QUESTIONS: { key: string; label: string }[] = [
  { key: "role_clarity", label: "Clarity of the role & what was expected" },
  { key: "manager_support", label: "Support from the reporting manager" },
  { key: "growth", label: "Learning, growth & career path" },
  { key: "compensation", label: "Compensation & benefits" },
  { key: "culture", label: "Team & culture" },
  { key: "workload", label: "Workload & work–life balance" },
];

const SCALE = [1, 2, 3, 4, 5];

const RATING_CLASS = (n: number) =>
  n <= 2 ? "text-ryg-red" : n === 3 ? "text-yellow" : "text-ryg-green";

/**
 * ⭐⭐ THE EXIT INTERVIEW — THE CONFIDENTIAL SATELLITE.
 *
 * ⚠⚠ THIS COMPONENT IS RENDERED **ONLY** WHEN `store.canReadConfidential` IS TRUE.
 *
 *   admin ∨ a process coordinator ∨ `fms_exit_is_hr_confidential` (the owner of
 *   hr_verification | hr_head_approval | exit_interview). AND NOBODY ELSE.
 *
 *   NOT the reporting manager. NOT the employee. NOT the IT / Admin / Travel-Desk
 *   clearance owners, who are exit staff and read the case header quite happily.
 *
 *   An exit interview exists to say things ABOUT the reporting manager. If the manager
 *   can read it, it is not an exit interview — it is a performance review with extra
 *   steps, and the next person asked to be candid will not be.
 *
 *   `ExitDetail` renders a bare "Recorded ✓ / Not yet" chip in its place for everyone
 *   else, driven by `case.interviewDoneAt` on the WIDE-READ header — so the fact is
 *   visible to the queue and the stepper without a word of the content leaking. That
 *   chip is NEVER driven from this satellite: a non-reader gets zero rows from RLS, and
 *   "I cannot see it" is a different fact from "it did not happen".
 *
 * The gate is enforced in three independent places, and it has to be: RLS on
 * `fms_exit_interviews` (the real one), `fms_exit_can_act('exit_interview', …)` inside
 * the RPC, and a **restrictive** storage policy on `cases/<id>/interview/…`. This
 * component is only the fourth — the courtesy layer.
 */
export default function ExitInterviewPanel({ case: c }: { case: ExitCase }) {
  const s = useExitStore();
  const i = s.interviewFor(c.id);
  const skip = s.skipsFor(c.id).find((k) => k.stepKey === "exit_interview");

  const [conductedBy, setConductedBy] = useState(i?.conductedBy ?? "");
  // A business date, yyyy-mm-dd, straight out of a date input. NEVER toISOString().
  const [conductedOn, setConductedOn] = useState(i?.conductedOn ?? "");
  const [reasonId, setReasonId] = useState(i?.primaryReasonId ?? "");
  const [wouldRehire, setWouldRehire] = useState<string>(
    i?.wouldRehire === null || i?.wouldRehire === undefined ? "" : String(i.wouldRehire),
  );
  const [remarks, setRemarks] = useState(i?.remarks ?? "");
  const [ratings, setRatings] = useState<Record<string, number>>(i?.feedback?.ratings ?? {});
  const [whatWorked, setWhatWorked] = useState(String(i?.feedback?.what_worked ?? ""));
  const [whatWouldHaveKept, setWhatWouldHaveKept] = useState(
    String(i?.feedback?.what_would_have_kept ?? ""),
  );
  const [portalDone, setPortalDone] = useState(i?.portalFeedbackDone ?? false);
  const [file, setFile] = useState<File | null>(null);

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const closed = !s.isOpenCase(c) && c.status !== "on_hold";
  // Mirrors fms_exit_can_act('exit_interview', …). It is NOT a manager step, so the
  // manager branch of can_act never fires for it — this is the step's configured owner,
  // a coordinator, or an admin. `lwd` is in the list because the RPC refuses without
  // one: the interview is dated from the last working day (and held before it).
  const mayAct = !closed && !skip && !!c.lwd && s.canActOn("exit_interview", c);

  const person = (uid: string | null) => (uid ? (s.profileById(uid)?.name ?? "Unknown") : "—");
  const reasonName = s.reasons.find((r) => r.id === i?.primaryReasonId)?.name ?? null;

  // The reason on the RESIGNATION LETTER, kept side by side with the one given in the
  // room. THE GAP BETWEEN THEM IS THE FINDING — a letter that says "better opportunity"
  // against an interview that says "manager" is the single most useful row in the
  // attrition report, and folding them into one field would erase it.
  const letterReason = s.reasons.find((r) => r.id === c.reasonId)?.name ?? null;

  const showForm = mayAct && (editing || !i);

  const options = [...s.profiles]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: p.name, sublabel: p.email ?? undefined }));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Upload FIRST, so a save can never succeed against a form that is not there. No
      // upload leaves the existing file alone (the RPC coalesces), so ticking "feedback
      // updated on the portal" cannot silently detach the interview form.
      const up = file ? await uploadInterviewDoc(c.id, file) : null;
      await s.recordInterview(c, {
        conductedBy: conductedBy || null,
        conductedOn: conductedOn || null,
        primaryReasonId: reasonId || null,
        // Tri-state: "" is genuinely "not answered", which is not the same as "no".
        wouldRehire: wouldRehire === "" ? null : wouldRehire === "true",
        remarks: remarks.trim() || null,
        feedback: {
          ratings,
          what_worked: whatWorked.trim() || undefined,
          what_would_have_kept: whatWouldHaveKept.trim() || undefined,
        },
        portalFeedbackDone: portalDone,
        filePath: up?.path ?? null,
        fileName: up?.name ?? null,
      });
      setFile(null);
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 border-navy/15 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-navy">Exit interview</h2>
            {/* Said out loud, on the screen, to the people who CAN read it — so nobody
                writes a remark believing the manager will see it and soften it. */}
            <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy">
              HR confidential
            </span>
          </div>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-grey-2">
            Visible only to HR, the HR Head and the process coordinators. The reporting manager and the
            employee see that it happened — never a word of what was said.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {c.interviewDoneAt ? (
            <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-semibold text-ryg-green">
              Recorded
            </span>
          ) : (
            c.lwd && (
              <span className="text-[12.5px] text-grey">
                Due <DueCell dueIso={s.dueIsoFor(c, "exit_interview")} />
              </span>
            )
          )}
        </div>
      </div>

      {/* A waived step is complete-with-a-reason — an absconder is not interviewed. */}
      {skip && (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-navy">
          <span className="font-semibold">This step was waived</span> — {skip.reason}
        </p>
      )}

      {!c.lwd && !skip && (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
          Nothing yet. Confirm the last working day first — the interview is dated from it, and is held
          before the person leaves.
        </p>
      )}

      {/* ---- What was recorded. ---- */}
      {i && !showForm && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Conducted by" value={person(i.conductedBy)} />
            <Field label="Conducted on" value={formatDateDMY(i.conductedOn)} />
            <Field label="Would we re-hire?">
              {i.wouldRehire === null ? (
                <span className="text-grey-2">Not answered</span>
              ) : (
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    i.wouldRehire ? "bg-[#E9F7EF] text-ryg-green" : "bg-[#FDECEC] text-ryg-red"
                  }`}
                >
                  {i.wouldRehire ? "Yes" : "No"}
                </span>
              )}
            </Field>

            {/* ⭐ The two reasons, side by side. The GAP is the finding. */}
            <Field label="Reason on the letter" value={letterReason} />
            <Field label="Reason given in the room" value={reasonName} />
            <Field label="Feedback updated on the portal">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                  i.portalFeedbackDone ? "bg-[#E9F7EF] text-ryg-green" : "bg-[#FFF7E6] text-yellow"
                }`}
              >
                {i.portalFeedbackDone ? "Done" : "Not yet"}
              </span>
            </Field>
          </div>

          {Object.keys(i.feedback?.ratings ?? {}).length > 0 && (
            <>
              <SectionHeading>Ratings</SectionHeading>
              <ul className="grid gap-2 sm:grid-cols-2">
                {QUESTIONS.filter((q) => i.feedback?.ratings?.[q.key] !== undefined).map((q) => {
                  const n = i.feedback!.ratings![q.key];
                  return (
                    <li
                      key={q.key}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2"
                    >
                      <span className="text-[13px] text-navy">{q.label}</span>
                      <span className={`text-[14px] font-bold ${RATING_CLASS(n)}`}>{n}/5</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {(i.feedback?.what_worked || i.feedback?.what_would_have_kept || i.remarks) && (
            <SectionHeading>What was said</SectionHeading>
          )}
          <div className="grid gap-4">
            {i.feedback?.what_worked ? (
              <Field label="What worked" value={String(i.feedback.what_worked)} />
            ) : null}
            {i.feedback?.what_would_have_kept ? (
              <Field label="What would have kept them" value={String(i.feedback.what_would_have_kept)} />
            ) : null}
            {i.remarks && <Field label="Remarks" value={i.remarks} />}
            {i.filePath && (
              <Field label="Interview form">
                <button
                  type="button"
                  onClick={() => void openDoc(i.filePath!)}
                  className="font-semibold text-orange hover:underline"
                >
                  {i.fileName ?? "Open"} →
                </button>
              </Field>
            )}
          </div>

          {mayAct && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Correct the interview
              </Button>
            </div>
          )}
        </>
      )}

      {/* A reader who is not the owner, on a case where nobody has held it yet. */}
      {!i && !showForm && c.lwd && !skip && (
        <p className="rounded-xl border border-line bg-page px-4 py-3 text-[13px] text-grey-2">
          {c.interviewDoneAt
            ? "Recorded — but the content is not available to you."
            : "Not recorded yet. HR holds the interview before the last working day."}
        </p>
      )}

      {/* ---- Record it. ---- */}
      {showForm && (
        <div className="space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FieldLabel label="Conducted by" hint="whoever actually held it">
              <Combobox
                value={conductedBy}
                onChange={setConductedBy}
                options={options}
                placeholder="Choose the interviewer"
              />
            </FieldLabel>
            <FieldLabel label="Conducted on">
              <TextInput
                type="date"
                value={conductedOn}
                onChange={(e) => setConductedOn(e.target.value)}
              />
            </FieldLabel>

            <FieldLabel
              label="Primary reason, as they gave it"
              hint={letterReason ? `the letter said “${letterReason}”` : "the reason in the room"}
            >
              <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
                <option value="">Not stated</option>
                {s.reasons
                  .filter((r) => r.active || r.id === reasonId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </FieldLabel>

            <FieldLabel label="Would we re-hire them?">
              <Select value={wouldRehire} onChange={(e) => setWouldRehire(e.target.value)}>
                <option value="">Not answered</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            </FieldLabel>
          </div>

          <SectionHeading>Ratings</SectionHeading>
          <ul className="space-y-2">
            {QUESTIONS.map((q) => (
              <li
                key={q.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5"
              >
                <span className="text-[13px] text-navy">{q.label}</span>
                <div className="flex items-center gap-1.5">
                  {SCALE.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() =>
                        setRatings((prev) => {
                          const next = { ...prev };
                          // Clicking the same number again clears it — an unanswered
                          // question must stay unanswered rather than defaulting to a
                          // number nobody said.
                          if (next[q.key] === n) delete next[q.key];
                          else next[q.key] = n;
                          return next;
                        })
                      }
                      className={`h-8 w-8 rounded-lg border text-[13px] font-semibold transition ${
                        ratings[q.key] === n
                          ? "border-orange bg-orange/10 text-orange"
                          : "border-line text-grey-2 hover:border-orange/40"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <FieldLabel label="What worked" hint="optional">
            <TextArea
              rows={2}
              value={whatWorked}
              onChange={(e) => setWhatWorked(e.target.value)}
              placeholder="What they would keep, if they were running it."
            />
          </FieldLabel>

          <FieldLabel label="What would have kept them" hint="optional — the useful one">
            <TextArea
              rows={2}
              value={whatWouldHaveKept}
              onChange={(e) => setWhatWouldHaveKept(e.target.value)}
              placeholder="The one thing that would have changed the decision."
            />
          </FieldLabel>

          <FieldLabel label="Remarks" hint="optional">
            <TextArea
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Anything else worth recording. HR, the HR Head and the coordinators can read this — nobody else, and never the reporting manager."
            />
          </FieldLabel>

          <label className="flex items-center gap-2.5 text-[13px] text-navy">
            <input
              type="checkbox"
              checked={portalDone}
              onChange={(e) => setPortalDone(e.target.checked)}
            />
            The exit feedback has been updated on the portal
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-navy">
              Signed interview form
            </span>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[12px] text-grey file:mr-2 file:rounded-lg file:border-0 file:bg-page file:px-2.5 file:py-1.5 file:text-[12px] file:font-semibold file:text-navy hover:file:bg-line/60"
            />
            <span className="mt-1 block text-[11.5px] text-grey-2">
              Stored under <code>cases/…/interview/</code> — HR-confidential in storage too, not just
              here.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : i ? "Save the correction" : "Record the interview"}
            </Button>
            {i && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
            )}
            {/* Correcting an interview updates it IN PLACE — the case id is the primary
                key, so there is one interview and never a second version of the truth.
                The step's completion timestamp is NOT re-stamped by a correction. */}
            {i && (
              <span className="text-[12px] text-grey">
                This replaces what is on record; it does not re-date the step.
              </span>
            )}
          </div>
        </div>
      )}

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
    </Card>
  );
}
