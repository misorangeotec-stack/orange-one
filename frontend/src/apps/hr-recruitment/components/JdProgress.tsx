/**
 * What the HOD watches while a JD is being read.
 *
 * Reading a JD takes 10–20 seconds: the file goes up, the text comes out of it,
 * and a model matches every skill and qualification against the masters. A bare
 * spinner over that long reads as "stuck" — the first person to try it asked
 * whether anything was happening at all — so this shows three things a spinner
 * can't:
 *
 *  • WHERE IT IS. A stage line that changes, plus the seconds counting up. A
 *    number that keeps moving is the cheapest possible proof of life.
 *  • THAT WAITING IS OPTIONAL. The form below stays live, and the JD only fills
 *    fields nobody has touched — so "carry on, we'll fill the blanks" is a
 *    genuine instruction, not a platitude.
 *  • A WAY OUT. Stop waiting, and the file is still attached.
 *
 * The bar is an easing curve, not a measurement — nothing observable comes back
 * from the function until it returns. It approaches 92% and stops, because a bar
 * that sits at 100% while nothing happens is the exact lie it exists to avoid.
 */

interface Props {
  /** Seconds since the upload began. */
  secs: number;
  fileName: string;
  onCancel: () => void;
}

/** Reaches ~76% at 10s and ~87% at 15s — the honest shape of a 15-second wait. */
const percent = (secs: number) => Math.min(92, Math.round(100 * (1 - Math.exp(-secs / 7))));

/** The stages are the real sequence of work, timed to how long each usually takes. */
function stage(secs: number, fileName: string): string {
  if (secs < 3) return `Sending ${fileName}…`;
  if (secs < 8) return "Reading the document…";
  if (secs < 15) return "Pulling out the role, duties and pay…";
  if (secs < 25) return "Matching skills and qualifications to your lists…";
  if (secs < 45) return "Nearly there…";
  return "Still going — long or scanned JDs take more time.";
}

export default function JdProgress({ secs, fileName, onCancel }: Props) {
  return (
    <div className="rounded-xl border border-line bg-page px-3.5 py-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="inline-block w-3.5 h-3.5 shrink-0 rounded-full border-2 border-orange border-r-transparent animate-spin" />
        <p className="grow text-[12.5px] font-medium text-navy">{stage(secs, fileName)}</p>
        <span className="shrink-0 tabular-nums text-[12px] text-grey-2">{secs}s</span>
      </div>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-orange transition-[width] duration-1000 ease-out"
          style={{ width: `${percent(secs)}%` }}
        />
      </div>

      {/* Held back a few seconds: on a fast read it would flash by unread, and
          "you can leave" is only worth saying once the wait is real. */}
      {secs >= 6 && (
        <p className="mt-2 text-[12px] leading-relaxed text-grey">
          No need to wait — carry on filling the form below. Anything you type is kept; the JD only fills
          the blanks.{" "}
          <button
            type="button"
            onClick={onCancel}
            className="font-semibold text-grey underline underline-offset-2 hover:text-navy"
          >
            Stop waiting
          </button>
        </p>
      )}
    </div>
  );
}
