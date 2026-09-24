import type { Effectiveness, TrainingRequest, TrainingSession } from "../types";

/**
 * Closing a training record — what is still owed, and whether it can close.
 *
 * Kept beside `queues.ts` rather than inside it because closure is the only step
 * that cannot be decided from the request alone: it depends on every session
 * hanging off it and on every 30-day review those sessions created.
 *
 * ⚠ THE SERVER IS THE GATE, NOT THIS. `fms_ld_close_request` re-runs the same
 *   checks and refuses with the same wording. This exists so the screen can show
 *   the reader WHAT is outstanding before they press anything, instead of a
 *   button that fails with a sentence they then have to decode.
 */
export interface Blocker {
  what: string;
  count: number;
}

export function closureBlockers(
  r: TrainingRequest,
  sessions: TrainingSession[],
  effectiveness: Effectiveness[],
): Blocker[] {
  const mine = sessions.filter((s) => s.requestId === r.id);
  const out: Blocker[] = [];

  // A cancelled session owes nothing — it never ran, so there is no attendance
  // to close and nobody to ask about its effect.
  const open = mine.filter((s) => !s.attendanceClosedAt && s.outcome !== "cancelled");
  if (open.length > 0) out.push({ what: "session(s) with attendance still open", count: open.length });

  const ids = new Set(mine.map((s) => s.id));
  const owed = effectiveness.filter((e) => ids.has(e.sessionId) && !e.submittedAt);
  if (owed.length > 0) out.push({ what: "30-day review(s) not yet answered", count: owed.length });

  return out;
}

/** Has this training reached the point where only closure is left? */
export function readyToClose(
  r: TrainingRequest,
  sessions: TrainingSession[],
  effectiveness: Effectiveness[],
): boolean {
  if (r.status !== "scheduled") return false;
  const mine = sessions.filter((s) => s.requestId === r.id);
  // Nothing to close if it never got a session.
  if (mine.length === 0) return false;
  return closureBlockers(r, sessions, effectiveness).length === 0;
}
