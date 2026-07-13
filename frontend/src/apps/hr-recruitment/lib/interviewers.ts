import type { Department, Profile } from "@/core/platform/types";
import type { Requisition } from "../types";

/**
 * WHO MAY TAKE EACH INTERVIEW ROUND.
 *
 * Offering the whole company for every round is not just noise — it lets the wrong
 * person be recorded as the interviewer, which quietly corrupts the one thing this app
 * exists to know: who owes what. Each round has a real owner:
 *
 *   R1 — HR's screening call  → the HR department
 *   R2 — the manager's round  → whoever raised THIS requisition, plus who the role reports to
 *   R3 — the final call       → the directors
 *
 * This lives here, not in a modal, because an interview can be booked from two places
 * (dragging a card into a round, and scheduling a round the system auto-advanced into
 * after a "selected" result). Both must offer the same people, or the rule isn't a rule.
 */
export interface InterviewerPool {
  /** The people to offer. Falls back to everyone when the rule matches nobody. */
  people: Profile[];
  /** False when we fell back — the caller should say why rather than pretend. */
  restricted: boolean;
  /** Who this round is for, in one line. */
  hint: string;
  /** Why the list isn't filtered, when it isn't. */
  fallbackNote: string;
}

export function interviewerPool(
  round: 1 | 2 | 3,
  profiles: Profile[],
  departments: Department[],
  requisition: Requisition | undefined,
): InterviewerPool {
  const hrDeptId = departments.find((d) => /human resource|^hr$/i.test(d.name))?.id ?? null;

  let pool: Profile[] = [];
  if (round === 1) {
    pool = hrDeptId ? profiles.filter((p) => p.departmentId === hrDeptId) : [];
  } else if (round === 2) {
    // The hiring manager IS whoever raised the MRF — that rule holds everywhere in this app.
    const ids = new Set([...(requisition?.hiringManagerIds ?? []), ...(requisition?.reportingToIds ?? [])]);
    pool = profiles.filter((p) => ids.has(p.id));
  } else {
    // "Director - Sales" is still a director, so match the word, not the whole title.
    pool = profiles.filter((p) => /director/i.test(p.designation ?? ""));
  }

  const hint =
    round === 1
      ? "The HR team."
      : round === 2
        ? "The manager who raised this requisition, and whoever the role reports to."
        : "Directors.";

  const fallbackNote =
    round === 1
      ? "No Human Resources department is set up, so everyone is listed."
      : round === 2
        ? "This requisition has no hiring manager or reporting-to recorded, so everyone is listed."
        : "Nobody is listed as a Director, so everyone is listed.";

  // Never dead-end: an empty dropdown would block a real booking. Fall back to everyone
  // and say so. The free-text interviewer box covers external consultants either way.
  const restricted = pool.length > 0;
  return { people: restricted ? pool : profiles, restricted, hint, fallbackNote };
}

/** The people, sorted and labelled for a Combobox. */
export const interviewerOptions = (people: Profile[]) =>
  [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));
