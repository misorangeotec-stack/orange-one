/**
 * The twenty-five seconds while a CV is being scored.
 *
 * Same anatomy as JdProgress, which is this app's one long-AI-operation pattern:
 * a spinner alone reads as "stuck" past about fifteen seconds, so the copy moves
 * through stages and the seconds count up; the bar stops at 92% because sitting
 * at 100% while nothing happens is the exact lie it exists to avoid.
 *
 * Three deliberate differences from JdProgress:
 *
 *  - No file name. Nothing is being uploaded — the CV is already on file.
 *  - No "Stop waiting" link. JdProgress needs one because there is a form
 *    underneath you would rather be filling. Here there is nothing to fall back
 *    to, and stopping would throw away a call that is nearly done. The way out
 *    is instead the client-side 100s ceiling in scoreCandidate.ts, which turns a
 *    hung request into an honest sentence rather than an endless spinner.
 *  - The promise it makes is true: the panel does NOT abort on unmount, so
 *    pressing the next-candidate arrow really does leave the score to land.
 *
 * It also renders only inside the tab body, so the CV still scrolls, the
 * discussion still takes a comment, and the pager still works while it runs.
 * That is a consequence of this being a tab rather than a dialog — don't
 * "improve" it into a modal.
 */
export default function ScoreProgress({ secs }: { secs: number }) {
  const percent = Math.min(92, Math.round(100 * (1 - Math.exp(-secs / 7))));

  return (
    <div className="rounded-xl border border-line bg-page px-3.5 py-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-orange border-r-transparent"
          aria-hidden="true"
        />
        <p className="grow text-[12.5px] font-medium text-navy">{stage(secs)}</p>
        <span className="shrink-0 tabular-nums text-[12px] text-grey-2">{secs}s</span>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-orange transition-[width] duration-1000 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {secs >= 6 && (
        <p className="mt-2 text-[12px] leading-relaxed text-grey">
          No need to sit here — the score saves itself when it lands, so you can read the CV, post a
          note, or move on to the next candidate.
        </p>
      )}
    </div>
  );
}

function stage(secs: number): string {
  if (secs < 3) return "Reading the job description…";
  if (secs < 10) return "Going through the CV…";
  if (secs < 20) return "Comparing skills, experience and duties…";
  if (secs < 35) return "Putting the score together…";
  return "Still going — a long CV takes a little more.";
}
