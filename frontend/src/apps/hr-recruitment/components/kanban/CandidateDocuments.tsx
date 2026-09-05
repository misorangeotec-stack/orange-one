import { useMemo, useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import type { AttachmentRef, Candidate } from "../../types";

/**
 * Every file and recording attached to one person, from anywhere in the process.
 *
 * The pieces were always stored — they were just scattered across four tables and
 * three screens: the CV on the candidate, feedback forms and video links on each
 * interview round, the joining paperwork on the onboarding checklist, and the
 * review forms on probation. "Show me everything we hold on this person" had no
 * answer short of opening four screens, so this is that answer.
 *
 * Storage paths are signed on click rather than upfront: a candidate with twelve
 * documents would otherwise fire twelve signing requests every time the drawer
 * opened, for links nobody clicked.
 *
 * (NR-5) It is also the ONE place any of it can be changed. The same file is
 * rendered on PriorRounds, CandidateMeetings and ResumeViewer as well; those stay
 * read-only on purpose. Put Remove on four screens and the next fix lands on one
 * of them. Every row here routes through `replaceAttachment` / `removeAttachment`,
 * which hold the module's only storage delete.
 */

type DocKind = "file" | "link" | "video";

interface DocItem {
  key: string;
  /** Which part of the process produced it. */
  group: string;
  /** What it is — "Round 2 feedback", "PAN card", … */
  label: string;
  name: string;
  kind: DocKind;
  /** Private-bucket path, signed on click. */
  path?: string;
  /** Already a URL (a Drive link or a meeting recording). */
  url?: string;
  meta?: string;
  /** Which row to write and which permission to test. */
  ref: AttachmentRef;
}

const ICONS: Record<DocKind, React.ReactNode> = {
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  video: (
    <>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </>
  ),
};

export default function CandidateDocuments({ candidate: c }: { candidate: Candidate }) {
  const s = useHrStore();

  /** The row whose Remove was pressed — held until the confirm is answered. */
  const [removing, setRemoving] = useState<DocItem | null>(null);
  /** The row whose Replace was pressed, waiting on the file picker. */
  const replacingRef = useRef<DocItem | null>(null);
  /** The link row being retyped. A recording is a URL, so it is edited, not uploaded. */
  const [editingLink, setEditingLink] = useState<DocItem | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = useMemo<DocItem[]>(() => {
    const out: DocItem[] = [];

    if (c.resumePath) {
      out.push({
        key: "resume",
        group: "Application",
        label: "Resume",
        name: c.resumeName ?? "Resume",
        kind: "file",
        path: c.resumePath,
        meta: formatDateDMY(c.uploadedAt),
        ref: { kind: "resume", candidateId: c.id, path: c.resumePath },
      });
    }

    for (const iv of s.interviewsFor(c.id).sort((a, b) => a.round - b.round)) {
      const round = iv.round === 0 ? "Telephonic screen" : `Round ${iv.round}`;
      const when = iv.heldAt ? formatDateDMY(iv.heldAt) : iv.scheduledOn ? `booked ${formatDateDMY(iv.scheduledOn)}` : undefined;
      if (iv.videoUrl) {
        out.push({
          key: `iv-video-${iv.id}`,
          group: "Interviews",
          label: `${round} — recording`,
          name: "Open the video",
          kind: "video",
          url: iv.videoUrl,
          meta: when,
          ref: { kind: "interviewVideo", candidateId: c.id, round: iv.round },
        });
      }
      if (iv.documentPath) {
        out.push({
          key: `iv-doc-${iv.id}`,
          group: "Interviews",
          label: `${round} — feedback form`,
          name: iv.documentName ?? "Feedback form",
          kind: "file",
          path: iv.documentPath,
          meta: when,
          ref: { kind: "interviewDoc", candidateId: c.id, round: iv.round, path: iv.documentPath },
        });
      }
    }

    const onb = s.onboardingForCandidate(c.id);
    if (onb) {
      for (const k of s.checksFor(onb.id)) {
        if (k.filePath) {
          out.push({
            key: `onb-file-${k.id}`,
            group: "Onboarding",
            label: k.name,
            name: k.fileName ?? "Document",
            kind: "file",
            path: k.filePath,
            meta: k.doneAt ? formatDateDMY(k.doneAt) : undefined,
            ref: { kind: "onboardingFile", checkId: k.id, done: k.done, path: k.filePath },
          });
        }
        if (k.linkUrl) {
          out.push({
            key: `onb-link-${k.id}`,
            group: "Onboarding",
            label: k.name,
            name: "Open the link",
            kind: "link",
            url: k.linkUrl,
            meta: k.doneAt ? formatDateDMY(k.doneAt) : undefined,
            ref: { kind: "onboardingLink", checkId: k.id, done: k.done },
          });
        }
      }

      const prob = s.probationForOnboarding(onb.id);
      if (prob) {
        for (const rv of s.reviewsFor(prob.id)) {
          if (rv.filePath) {
            out.push({
              key: `prob-${rv.id}`,
              group: "Probation",
              label: `Month ${rv.month} review`,
              name: rv.fileName ?? "Review form",
              kind: "file",
              path: rv.filePath,
              ref: { kind: "probationFile", probationId: prob.id, month: rv.month, path: rv.filePath },
            });
          }
        }
      }
    }

    return out;
  }, [s, c]);

  /** Signed on demand — the same pattern PriorRounds uses for its feedback form. */
  const open = async (d: DocItem) => {
    if (d.url) {
      window.open(d.url, "_blank", "noopener");
      return;
    }
    if (!d.path) return;
    const url = await hrDocUrl(d.path);
    if (url) window.open(url, "_blank", "noopener");
  };

  const askReplace = (d: DocItem) => {
    setErr(null);
    replacingRef.current = d;
    if (fileInput.current) {
      fileInput.current.value = ""; // so picking the same file twice still fires
      fileInput.current.click();
    }
  };

  const onPicked = async (file: File | undefined) => {
    const d = replacingRef.current;
    replacingRef.current = null;
    if (!d || !file) return;
    setBusy(true);
    setErr(null);
    try {
      await s.replaceAttachment(d.ref, file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not replace that file");
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async () => {
    if (!editingLink) return;
    setBusy(true);
    setErr(null);
    try {
      await s.setAttachmentLink(editingLink.ref, linkDraft);
      setEditingLink(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save that link");
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    setErr(null);
    try {
      await s.removeAttachment(removing.ref);
      setRemoving(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove that file");
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[12.5px] text-grey-2">
        Nothing has been attached to this candidate yet — no CV, no interview feedback, no recordings.
      </p>
    );
  }

  // Preserve the order the process produced them in, but keep each source together.
  const groups = ["Application", "Interviews", "Onboarding", "Probation"].filter((g) =>
    items.some((d) => d.group === g),
  );

  return (
    <div className="space-y-3">
      {err && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>
      )}

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => void onPicked(e.target.files?.[0])}
      />

      {groups.map((g) => (
        <div key={g}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{g}</div>
          <ul className="mt-1.5 space-y-1.5">
            {items
              .filter((d) => d.group === g)
              .map((d) => {
                const mine = s.canChangeAttachment(d.ref);
                // A recording is a URL somebody typed, not a file we hold, so
                // "replace" for it means editing the link — that belongs on the
                // interview form, not behind a file picker.
                const isLink = d.kind === "video" || d.kind === "link";
                const canReplace = mine && !isLink;
                return (
                  <li key={d.key} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      onClick={() => void open(d)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-left transition hover:border-orange/50 hover:bg-orange/[0.03]"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4 shrink-0 text-grey-2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {ICONS[d.kind]}
                      </svg>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-navy">{d.label}</span>
                        <span className="block truncate text-[11.5px] text-grey-2">
                          {d.name}
                          {d.meta && ` · ${d.meta}`}
                        </span>
                      </span>
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5 shrink-0 text-grey-2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>

                    {mine && isLink && (
                      <button
                        type="button"
                        title="Edit this link"
                        aria-label={`Edit the link for ${d.label}`}
                        disabled={busy}
                        onClick={() => {
                          setErr(null);
                          setLinkDraft(d.url ?? "");
                          setEditingLink(d);
                        }}
                        className="grid w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-grey-2 transition hover:border-orange/50 hover:text-orange disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
                        </svg>
                      </button>
                    )}

                    {canReplace && (
                      <button
                        type="button"
                        title="Replace this file"
                        aria-label={`Replace ${d.label}`}
                        disabled={busy}
                        onClick={() => askReplace(d)}
                        className="grid w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-grey-2 transition hover:border-orange/50 hover:text-orange disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      </button>
                    )}

                    {mine && (
                      <button
                        type="button"
                        title="Remove this permanently"
                        aria-label={`Remove ${d.label}`}
                        disabled={busy}
                        onClick={() => {
                          setErr(null);
                          setRemoving(d);
                        }}
                        className="grid w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-grey-2 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}

      <Modal
        open={!!editingLink}
        onClose={() => !busy && setEditingLink(null)}
        title={editingLink?.ref.kind === "interviewVideo" ? "Recording link" : "Link"}
        subtitle={editingLink?.label}
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditingLink(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void saveLink()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <input
            type="url"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-line px-3 py-2 text-[13px] text-navy outline-none focus:border-orange"
          />
          {/* The whole point of NR-5's set_interview_media: this works wherever the
              candidate is standing now. Correcting Round 1 used to mean dragging
              the card back, which deletes Rounds 2 and 3 outright. */}
          <p className="text-[12px] text-grey-2">
            Saving an empty box clears the link. This can be done at any time — it does not matter
            which round the candidate has reached since.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => !busy && setRemoving(null)}
        title={removing?.ref.kind === "interviewVideo" ? "Remove this recording link?" : "Remove this file?"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)} disabled={busy}>
              Keep it
            </Button>
            <Button size="sm" onClick={() => void confirmRemove()} disabled={busy}>
              {busy ? "Removing…" : "Remove it"}
            </Button>
          </>
        }
      >
        {removing && (
          <div className="space-y-3 text-[13px] text-navy">
            <p>
              <span className="font-semibold">{removing.label}</span>
              {" — "}
              <span className="text-grey-2">{removing.name}</span>
            </p>
            <p className="text-[12.5px] text-grey-2">
              {removing.ref.kind === "interviewVideo"
                ? "The link is cleared from this round. The recording itself is not ours to delete — it stays wherever it was recorded."
                : "The file is deleted from storage as well as from this record. There is no backup and no undo."}
            </p>
            {/* CandidateFit disables Run on !resumePath, so the score that already
                exists can never be recomputed once the CV is gone. Say so BEFORE
                the delete, not after — the score itself is kept, being a real
                reading made at a real time. */}
            {removing.ref.kind === "resume" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                Any AI fit score already worked out for this candidate stays on record, but it cannot be
                run again — there will be no CV to read.
              </p>
            )}
            <p className="text-[12.5px] text-grey-2">Who removed it, and when, is written to the trail.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
