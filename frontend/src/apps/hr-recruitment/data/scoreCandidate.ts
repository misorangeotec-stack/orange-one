import { supabase } from "@/core/platform/supabase";
import type { FitAxis, FitAxisKey } from "../types";

/**
 * The browser half of AI fit scoring.
 *
 * Sends ONE field — the candidate id — and nothing else. Everything the model
 * reads (the CV, the job description, the skill and qualification names) is
 * fetched server-side using the caller's own JWT, so two people scoring the same
 * candidate always get the same job description, and the score cannot be gamed
 * by a doctored payload.
 *
 * NEVER THROWS. Same contract as parseJd.ts: a discriminated union, so the panel
 * renders a sentence rather than a stack trace.
 */

/** What came back when it worked. `overall` is computed, not the model's arithmetic. */
export interface ScoredFit {
  overall: number;
  verdict: "strong" | "possible" | "weak";
  axes: FitAxis[];
  notes: string;
  cvQuality: "text" | "scanned" | "thin";
  jdQuality: "full" | "thin";
  model: string;
}

export type ScoreFailure =
  /** No CV on file, the file is gone, or the caller may not open it. */
  | "no_cv"
  /** The vacancy has no job description to score against (pre-15-Aug MRFs). */
  | "no_jd"
  /** Legacy .doc and anything neither we nor the model can read. */
  | "unsupported"
  /** Reached the model; nothing usable came back (blank scan, refusal, hollow). */
  | "unreadable"
  /** The caller may not see this candidate. */
  | "forbidden"
  /** Scored too many times in the last hour. */
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "error";

export type ScoreResult = { ok: true; data: ScoredFit } | { ok: false; reason: ScoreFailure };

/**
 * How long to wait before giving up.
 *
 * A CV scores in 15–30 seconds. This sits just above the function's own 90s
 * ceiling so the server's honest error normally arrives first, and this only
 * catches what never returns at all.
 */
const TIMEOUT_MS = 100_000;

/** An aborted fetch arrives wrapped in FunctionsFetchError, with the DOMException inside. */
const isAbort = (e: unknown): boolean => {
  const ctx = (e as { context?: unknown } | null)?.context;
  return (
    (ctx instanceof Error || ctx instanceof DOMException) &&
    (ctx.name === "AbortError" || ctx.name === "TimeoutError")
  );
};

/**
 * A 422 carries two very different meanings — "no CV" and "couldn't read it" —
 * so unlike parseJd we read the body, not just the status. FunctionsHttpError
 * holds the raw unread Response, so .json() works; the status map below is the
 * fallback if it ever doesn't.
 */
async function errorCode(e: unknown): Promise<string> {
  try {
    const res = (e as { context?: Response }).context;
    const body = await res?.clone().json();
    const code = (body as { error?: unknown } | null)?.error;
    return typeof code === "string" ? code : "";
  } catch {
    return "";
  }
}

const LABELS: Record<FitAxisKey, string> = {
  must_have_skills: "Must-have skills",
  experience: "Experience",
  role_fit: "Done the job",
  preferred_skills: "Good to have",
  qualifications: "Education",
};

/** Score ONE candidate's CV against their vacancy's JD. Never throws. */
export async function scoreCandidate(
  candidateId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ScoreResult> {
  try {
    const { data: body, error } = await supabase.functions.invoke("score-candidate", {
      body: { candidate_id: candidateId },
      signal: opts.signal,
      timeout: TIMEOUT_MS,
    });

    if (error) {
      if (isAbort(error)) return { ok: false, reason: opts.signal?.aborted ? "cancelled" : "timeout" };

      const status = (error as { context?: Response }).context?.status;
      if (status === 403) {
        // The function returns 403 both for "not your candidate" and for "you
        // can't open the CV" — the body tells them apart, and they read very
        // differently to whoever is standing there.
        const code = await errorCode(error);
        return { ok: false, reason: code === "no_cv" ? "no_cv" : "forbidden" };
      }
      if (status === 409) return { ok: false, reason: "no_jd" };
      if (status === 415) return { ok: false, reason: "unsupported" };
      if (status === 429) return { ok: false, reason: "rate_limited" };
      if (status === 413) return { ok: false, reason: "unreadable" };
      if (status === 422) {
        const code = await errorCode(error);
        return { ok: false, reason: code === "no_cv" ? "no_cv" : "unreadable" };
      }
      return { ok: false, reason: "error" };
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const rawAxes = Array.isArray(b.axes) ? (b.axes as Record<string, unknown>[]) : [];

    const axes: FitAxis[] = rawAxes.map((a) => ({
      key: a.key as FitAxisKey,
      label: typeof a.label === "string" ? a.label : (LABELS[a.key as FitAxisKey] ?? ""),
      score: Math.max(0, Math.min(10, Math.round(Number(a.score) || 0))),
      weight: Number(a.weight) || 0,
      applicable: a.applicable !== false,
      evidence: typeof a.evidence === "string" ? a.evidence.trim() : "",
    }));

    // A response with no axes is not a zero — it is a failed read, and shipping
    // it as "0 / 10 — Light on paper" would put a fabricated verdict on a person.
    if (axes.length === 0) return { ok: false, reason: "unreadable" };

    return {
      ok: true,
      data: {
        overall: Math.max(0, Math.min(10, Math.round(Number(b.overall) || 0))),
        verdict:
          b.verdict === "strong" || b.verdict === "weak"
            ? b.verdict
            : "possible",
        axes,
        notes: typeof b.notes === "string" ? b.notes.trim() : "",
        cvQuality: b.cv_quality === "scanned" || b.cv_quality === "thin" ? b.cv_quality : "text",
        jdQuality: b.jd_quality === "thin" ? "thin" : "full",
        model: typeof b.model === "string" ? b.model : "",
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** What to put on screen when it didn't work. One sentence, no jargon. */
export const scoreFailureMessage = (reason: ScoreFailure): string =>
  ({
    no_cv: "There's no CV on file for this candidate, or you don't have access to it.",
    no_jd: "This vacancy has no job description to score against.",
    unsupported: "We can't read this file type. Re-upload the CV as a PDF.",
    unreadable: "We couldn't get a usable read of this CV.",
    forbidden: "You don't have access to this candidate.",
    rate_limited: "This CV has been scored several times in the last hour. Read the score you already have.",
    timeout: "That took too long. Try again in a moment.",
    cancelled: "Scoring was stopped.",
    error: "That didn't work. Try again in a moment.",
  })[reason];
