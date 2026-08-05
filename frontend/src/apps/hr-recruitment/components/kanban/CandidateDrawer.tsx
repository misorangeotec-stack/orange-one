import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { Field, SectionHeading } from "@/shared/components/ui/Readout";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import { STAGE_LABEL } from "../../lib/board";
import { inr } from "../../lib/format";
import { panelNames } from "../../lib/interviewers";
import CandidateDocuments from "./CandidateDocuments";
import type { Candidate } from "../../types";

/**
 * Everything known about one candidate.
 *
 * LANDSCAPE, two columns: who they are and what we hold on them sits on the left,
 * what the process decided sits on the right. Portrait made this a long scroll in
 * which the interview history — the thing you open this dialog to read — was
 * always below the fold.
 */
export default function CandidateDrawer({
  candidate: c,
  open,
  onClose,
  onOpenOnboarding,
}: {
  candidate: Candidate;
  open: boolean;
  onClose: () => void;
  /** Hands off to the onboarding dialog. The board owns it, so this one closes first. */
  onOpenOnboarding?: (c: Candidate) => void;
}) {
  const s = useHrStore();

  // Private bucket: a short-lived signed URL is the only way in. Signed on click.
  const openDoc = async (path: string) => {
    const url = await hrDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  };

  const rounds = s.interviewsFor(c.id).sort((a, b) => a.round - b.round);
  const dupes = s.duplicatesOf(c.phone, c.email, c.id);

  const offered = c.stage === "finalized" || c.stage === "hired";
  const onb = offered ? s.onboardingForCandidate(c.id) : undefined;
  const checks = onb ? s.checksFor(onb.id) : [];
  const ticked = checks.filter((k) => k.done).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={c.name}
      subtitle={`${c.candidateNo ?? ""} · ${STAGE_LABEL[c.stage]}`}
      footer={
        <>
          {onb && onOpenOnboarding && (
            <Button
              size="sm"
              onClick={() => {
                onClose();
                onOpenOnboarding(c);
              }}
            >
              Open the onboarding
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {/* ---- Left: who they are, and every file we hold ---- */}
        <div className="space-y-4">
          <div>
            <SectionHeading>Contact</SectionHeading>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-4">
              <Field label="Phone" value={c.phone} />
              <Field label="Email" value={c.email} className="truncate" />
              <Field label="Current company" value={c.currentCompany} />
              <Field label="Experience" value={c.experienceYears !== null ? `${c.experienceYears} yrs` : null} />
            </div>
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
            <SectionHeading>Documents &amp; recordings</SectionHeading>
            <div className="mt-2">
              <CandidateDocuments candidate={c} />
            </div>
            {c.parseStatus === "failed" && (
              <p className="mt-1.5 text-[11.5px] text-grey">
                The resume couldn't be read automatically — these details were typed in.
              </p>
            )}
          </div>
        </div>

        {/* ---- Right: what the process decided ---- */}
        <div className="space-y-4 md:border-l md:border-line md:pl-6">
          {/* The offer and its onboarding are the same fact seen twice — the board
              says an offer went out, the onboarding is where the joining details
              live. From Made Offer this is the way through to them. */}
          {offered && (
            <div>
              <SectionHeading>Offer</SectionHeading>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                  {s.canViewSalary && (
                    <Field label="Agreed salary" value={c.offeredCtc !== null ? `${inr(c.offeredCtc)}/month` : null} />
                  )}
                  <Field label="Joining date" value={onb?.joiningDate ? formatDateDMY(onb.joiningDate) : null} />
                </div>

                {onb ? (
                  <div className="rounded-xl border border-line bg-page/40 px-3.5 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold text-navy">Onboarding</span>
                      <span className="text-[12px] text-grey-2">
                        {onb.completedAt
                          ? `Completed ${formatDateDMY(onb.completedAt)}`
                          : checks.length > 0
                            ? `${ticked} of ${checks.length} done`
                            : "Checklist not started"}
                      </span>
                    </div>
                    {checks.length > 0 && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.round((ticked / checks.length) * 100)}%`,
                            background: onb.completedAt ? "#27AE60" : "#FF6A1F",
                          }}
                        />
                      </div>
                    )}
                    {onOpenOnboarding && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenOnboarding(c);
                        }}
                        className="mt-2 text-[12.5px] font-semibold text-orange hover:underline"
                      >
                        Open the onboarding →
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-grey-2">
                    No onboarding has been opened for them yet.
                  </p>
                )}
              </div>
            </div>
          )}

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
                    <div className="mt-0.5 font-medium text-navy">
                      {panelNames(iv.interviewerIds, iv.interviewerName, (id) => s.profileById(id)?.name) || (
                        <span className="font-normal text-grey">Interviewer not set</span>
                      )}
                      {iv.scheduledOn && <span className="text-grey"> · {formatDateDMY(iv.scheduledOn)}</span>}
                    </div>
                    {iv.remarks && <div className="mt-1 text-navy">{iv.remarks}</div>}
                    {/* Deliberately repeated from the Documents index: this is where
                        you look for THIS round's evidence. */}
                    {(iv.videoUrl || iv.documentPath) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {iv.videoUrl && (
                          <a
                            href={iv.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[12px] font-semibold text-orange hover:underline"
                          >
                            Watch the interview →
                          </a>
                        )}
                        {iv.documentPath && (
                          <button
                            type="button"
                            onClick={() => void openDoc(iv.documentPath!)}
                            className="text-[12px] font-semibold text-orange hover:underline"
                          >
                            {iv.documentName ?? "Feedback form"} →
                          </button>
                        )}
                      </div>
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
      </div>
    </Modal>
  );
}
