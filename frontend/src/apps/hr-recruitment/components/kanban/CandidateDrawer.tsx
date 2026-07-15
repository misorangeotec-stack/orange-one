import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import { STAGE_LABEL } from "../../lib/board";
import type { Candidate } from "../../types";

/** Everything known about one candidate, plus their resume and interview history. */
export default function CandidateDrawer({
  candidate: c,
  open,
  onClose,
}: {
  candidate: Candidate;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);

  // Resumes live in a private bucket; a short-lived signed URL is the only way in.
  useEffect(() => {
    let alive = true;
    if (c.resumePath) {
      void hrDocUrl(c.resumePath).then((u) => {
        if (alive) setResumeUrl(u);
      });
    }
    return () => {
      alive = false;
    };
  }, [c.resumePath]);

  const rounds = s.interviewsFor(c.id).sort((a, b) => a.round - b.round);
  const person = (id: string | null) => (id ? (s.profileById(id)?.name ?? "Unknown") : null);
  const dupes = s.duplicatesOf(c.phone, c.email, c.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Two columns of fields plus the interview and history lists need more than the
      // default 448px, or every row fights for the same few pixels.
      size="lg"
      title={c.name}
      subtitle={`${c.candidateNo ?? ""} · ${STAGE_LABEL[c.stage]}`}
      footer={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <SectionHeading>Contact</SectionHeading>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4">
          <Field label="Phone" value={c.phone} />
          <Field label="Email" value={c.email} className="truncate" />
          <Field label="Current company" value={c.currentCompany} />
          <Field label="Experience" value={c.experienceYears !== null ? `${c.experienceYears} yrs` : null} />
        </div>

        {c.skills.length > 0 && (
          <div>
            <SectionHeading>Skills</SectionHeading>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.skills.map((sk) => (
                <span key={sk} className="rounded-full bg-page px-2 py-0.5 text-[12px] font-medium text-navy">
                  {sk}
                </span>
              ))}
            </div>
          </div>
        )}

        {dupes.length > 0 && (
          <p className="rounded-xl border border-yellow/40 bg-[#FFF7E6] px-3.5 py-2.5 text-[12.5px] text-navy">
            This person has also applied to{" "}
            {dupes.map((d) => s.requisitionById(d.requisitionId)?.mrfNo ?? "another vacancy").join(", ")}.
          </p>
        )}

        <div>
          <SectionHeading>Resume</SectionHeading>
          <div className="mt-2">
            {c.resumePath ? (
              resumeUrl ? (
                <a
                  href={resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] font-semibold text-orange hover:underline"
                >
                  {c.resumeName ?? "Open resume"} →
                </a>
              ) : (
                <span className="text-[13px] text-grey">Preparing link…</span>
              )
            ) : (
              <span className="text-[13px] text-grey">No resume uploaded</span>
            )}
          </div>
          {c.parseStatus === "failed" && (
            <p className="mt-1 text-[11.5px] text-grey">
              The resume couldn't be read automatically — these details were typed in.
            </p>
          )}
        </div>

        {rounds.length > 0 && (
          <div>
            <SectionHeading>Interviews</SectionHeading>
            <ul className="mt-2 space-y-2">
              {rounds.map((iv) => (
                <li key={iv.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-navy">
                      {iv.round === 0 ? "Telephonic screen" : `Round ${iv.round}`}
                    </span>
                    <span
                      className={
                        iv.status === "selected"
                          ? "font-semibold text-ryg-green"
                          : iv.status === "rejected"
                            ? "font-semibold text-ryg-red"
                            : "text-grey"
                      }
                    >
                      {iv.heldAt ? iv.status.replace(/_/g, " ") : "not yet held"}
                    </span>
                  </div>
                  {/* The interviewer and the date are the data here — they were grey-on-grey
                      against their own heading, which is the bug this pass is fixing. */}
                  <div className="mt-0.5 font-medium text-navy">
                    {person(iv.interviewerId) ?? iv.interviewerName ?? (
                      <span className="font-normal text-grey">Interviewer not set</span>
                    )}
                    {iv.scheduledOn && <span className="text-grey"> · {formatDateDMY(iv.scheduledOn)}</span>}
                  </div>
                  {iv.remarks && <div className="mt-1 text-navy">{iv.remarks}</div>}
                  {iv.videoUrl && (
                    <a
                      href={iv.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-[12px] font-semibold text-orange hover:underline"
                    >
                      Video link →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(c.decisionRemarks || c.disqualificationReasonId || c.disqualificationNote) && (
          <div>
            <SectionHeading>Decision</SectionHeading>
            <div className="mt-2 space-y-1.5">
              {c.disqualificationReasonId && (
                <Field
                  label="Disqualification reason"
                  value={s.disqualificationReasons.find((r) => r.id === c.disqualificationReasonId)?.name ?? null}
                />
              )}
              {c.disqualificationNote && <Field label="Disqualification note" value={c.disqualificationNote} />}
              {c.decisionRemarks && <Field label="Decision remark" value={c.decisionRemarks} />}
            </div>
          </div>
        )}

        <div>
          <SectionHeading>History</SectionHeading>
          <ul className="mt-2 space-y-1.5">
            <li className="text-[13px] text-navy">
              CV received <span className="text-grey">· {formatDateTimeDMY(c.uploadedAt)}</span>
            </li>
            {s
              .activityFor("candidate", c.id)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((a) => (
                <li key={a.id} className="text-[13px] text-navy">
                  {a.note ?? a.type} <span className="text-grey">· {formatDateTimeDMY(a.createdAt)}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
