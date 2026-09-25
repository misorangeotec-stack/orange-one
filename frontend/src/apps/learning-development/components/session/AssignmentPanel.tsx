import { useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, NotYours, useRun } from "./panelKit";
import DocField from "../DocField";
import type { TrainingSession } from "../../types";

/**
 * Steps 15, 16 and 17 — the assignment.
 *
 * ⚠ NO MARKS AND NO PASS MARK. The client, 21-09-2026: "We don't have to do the
 *   proper assessment, like a test or marks. We just need to track whether all
 *   the employees have submitted their assignment." Issued, submitted, reviewed —
 *   three timestamps and a file.
 *
 * ⚠ A ROW EXISTS FOR EVERY ATTENDEE FROM THE MOMENT IT IS ISSUED, with no
 *   submission. "Who has NOT submitted" is the thing being tracked, and it is
 *   unanswerable if rows only appear when somebody submits.
 */
export default function AssignmentPanel({
  session: x,
  onError,
}: {
  session: TrainingSession;
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { user } = useSession();
  const { busy, run } = useRun(onError);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [reworkFor, setReworkFor] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [briefFile, setBriefFile] = useState<File | null>(null);
  const [myFile, setMyFile] = useState<File | null>(null);
  const briefRef = useRef<HTMLInputElement>(null);
  const myRef = useRef<HTMLInputElement>(null);

  const mayIssue = s.canActOnSession("assignment_issue", x.id);
  const mayReview = s.canActOnSession("assignment_review", x.id);
  const assignment = (s.data?.assignments ?? []).find((a) => a.sessionId === x.id);
  const subs = (s.data?.submissions ?? []).filter((v) => v.assignmentId === assignment?.id);
  const mine = subs.find((v) => v.employeeId === user?.id);

  if (!assignment) {
    if (!mayIssue) {
      return (
        <Panel title="Assignment">
          <NotYours stepKey="assignment_issue" what="Issuing the assignment" />
        </Panel>
      );
    }
    return (
      <Panel title="Assignment" hint="What people do with what they learned. Optional — skip it if there isn't one.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="What is the assignment?" required>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Write up one change you will make" />
          </FieldLabel>
          <FieldLabel label="Due by" hint="Leave blank to use the default from Setup.">
            <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </FieldLabel>
        </div>
        <FieldLabel label="Brief">
          <TextArea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} />
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => briefRef.current?.click()}>
            {briefFile ? briefFile.name.slice(0, 26) : "Attach a handout (optional)"}
          </Button>
          <input
            ref={briefRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
            onChange={(e) => setBriefFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button
          disabled={busy || !title.trim()}
          onClick={() =>
            void run(async () => {
              // Upload first, record second — an orphaned object is invisible, a
              // saved path pointing at nothing is a link that never opens.
              const filePath = briefFile ? await s.writes.uploadAssignmentBrief(x.id, briefFile) : null;
              await s.writes.issueAssignment(x.id, {
                title: title.trim(),
                brief: brief.trim() || null,
                dueAt: due || null,
                filePath,
              });
            })
          }
        >
          Issue it to everyone who attended
        </Button>
      </Panel>
    );
  }

  const submitted = subs.filter((v) => v.submittedAt).length;
  const onTime = subs.filter(
    (v) => v.submittedAt && assignment.dueAt && v.submittedAt.slice(0, 10) <= assignment.dueAt,
  ).length;

  return (
    <Panel
      title="Assignment"
      hint={`${assignment.title} · due ${dmy(assignment.dueAt)} · ${submitted} of ${subs.length} submitted${
        submitted ? `, ${onTime} on time` : ""
      }`}
    >
      {assignment.brief && <p className="text-[13px] text-grey">{assignment.brief}</p>}
      {assignment.filePath && (
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-grey-2">Handout</span>
          <DocField path={assignment.filePath} disabled onUpload={async () => {}} />
        </div>
      )}

      {/* ---- my own submission ------------------------------------------- */}
      {mine && (
        <div className="rounded-lg border border-orange/40 bg-[#FFF8F4] p-3 space-y-2">
          {mine.submittedAt ? (
            <p className="text-[13.5px] text-navy">
              You submitted on {dmy(mine.submittedAt)}.
              {mine.outcome === "accepted" && <span className="text-ryg-green"> Accepted.</span>}
              {mine.outcome === "needs_rework" && (
                <span className="text-ryg-red"> Needs rework: {mine.reviewerRemarks}</span>
              )}
            </p>
          ) : (
            <>
              <p className="text-[13.5px] text-navy">Your assignment is due {dmy(assignment.dueAt)}.</p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[16rem] flex-1">
                  <TextInput
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Your answer, or a note about the file"
                  />
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => myRef.current?.click()}>
                  {myFile ? myFile.name.slice(0, 22) : "Attach a file"}
                </Button>
                <input
                  ref={myRef}
                  type="file"
                  className="hidden"
                  accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                  onChange={(e) => setMyFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  size="sm"
                  // Either a written answer or a file is enough — insisting on
                  // both would block somebody whose whole answer IS the document.
                  disabled={busy || (!note.trim() && !myFile)}
                  onClick={() =>
                    void run(async () => {
                      const filePath = myFile
                        ? await s.writes.uploadSubmission(assignment.id, myFile)
                        : null;
                      await s.writes.submitAssignment(assignment.id, {
                        note: note.trim() || null,
                        filePath,
                      });
                    })
                  }
                >
                  Submit
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {subs.map((v) => (
          <div
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
          >
            <div className="min-w-0">
              <span className="text-[13.5px] text-navy">{s.personName(v.employeeId)}</span>
              {v.submittedAt ? (
                <span className="ml-2 text-[12px] text-grey-2">submitted {dmy(v.submittedAt)}</span>
              ) : (
                <span className="ml-2 text-[12px] text-ryg-red">not submitted</span>
              )}
              {v.escalatedAt && <span className="ml-2 text-[12px] text-yellow">escalated to their HOD</span>}
              {v.filePath && (
                <span className="ml-2 inline-block align-middle">
                  <DocField path={v.filePath} disabled onUpload={async () => {}} />
                </span>
              )}
              {v.note && <p className="mt-0.5 text-[12.5px] text-grey">{v.note}</p>}
            </div>
            <div className="flex items-center gap-2">
              {v.outcome && (
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                    (v.outcome === "accepted" ? "bg-[#E8F7EE] text-ryg-green" : "bg-[#FFF7E6] text-yellow")
                  }
                >
                  {v.outcome === "accepted" ? "Accepted" : "Needs rework"}
                </span>
              )}
              {mayReview && v.submittedAt && !v.outcome && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => s.writes.reviewSubmission(v.id, "accepted", null))}
                  >
                    Accept
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReworkFor(v.id)}>
                    Needs rework
                  </Button>
                </>
              )}
              {mayReview && !v.submittedAt && !v.escalatedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => s.writes.escalateSubmission(v.id))}
                >
                  Escalate to HOD
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {reworkFor && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-[#F8FAFD] p-3">
          <div className="min-w-[18rem] flex-1">
            <TextInput
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="What needs reworking?"
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !remarks.trim()}
            onClick={() =>
              void run(
                () => s.writes.reviewSubmission(reworkFor, "needs_rework", remarks),
                () => {
                  setReworkFor(null);
                  setRemarks("");
                },
              )
            }
          >
            Send back
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setReworkFor(null)}>Cancel</Button>
        </div>
      )}
    </Panel>
  );
}
