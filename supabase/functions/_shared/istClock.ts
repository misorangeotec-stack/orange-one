/**
 * Where the Indian clock actually comes from — and where it does NOT.
 *
 * ── Two things that do not work, both tried against the live project ──────────
 *   1. `supabase secrets set TZ=Asia/Kolkata` — accepted, no effect. The runtime
 *      still resolved to UTC on the very next deploy.
 *   2. `Deno.env.set("TZ", "Asia/Kolkata")` — throws `NotSupported`. Worse, it
 *      throws during module evaluation, so it surfaces as a bare WORKER_ERROR
 *      with nothing whatsoever in the logs.
 *
 * ── What does work ────────────────────────────────────────────────────────────
 * The correction lives in the bundle instead: `supabase/worksnapshot/istWorkingDays.ts`
 * replaces `shared/lib/workingDays` at build time and adds 5h30m to every instant
 * on the way in, so a UTC host reading "local" components reads Indian ones.
 * India has no DST, so a constant is exact rather than an approximation.
 *
 * This module is what is left: the diagnostic that made the above knowable, kept
 * because the next person to wonder "what timezone is this thing on?" should be
 * able to ask it in one HTTP call instead of rediscovering both dead ends.
 */
export const IST = "Asia/Kolkata";

/** What the runtime thinks its zone is. Expect "UTC" — that is not a bug. */
export const resolvedTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Today in India, independent of the bundle, for cross-checking against it. */
export const istToday = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
