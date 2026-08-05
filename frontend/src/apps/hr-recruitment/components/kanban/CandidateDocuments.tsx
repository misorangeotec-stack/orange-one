import { useMemo } from "react";
import { formatDateDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import { hrDocUrl } from "../../data/hrWrites";
import type { Candidate } from "../../types";

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
      {groups.map((g) => (
        <div key={g}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{g}</div>
          <ul className="mt-1.5 space-y-1.5">
            {items
              .filter((d) => d.group === g)
              .map((d) => (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => void open(d)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-left transition hover:border-orange/50 hover:bg-orange/[0.03]"
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
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
