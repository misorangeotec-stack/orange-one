/**
 * A small chip beside the page's Refresh button: when the figures on screen were read from Tally,
 * and — while a background re-read runs behind saved figures — how far it has got.
 */
export default function FreshnessBar({ asOf, refreshing, progress }: {
  asOf: Date | null;
  refreshing: boolean;
  progress: [number, number];
}) {
  if (!asOf) return null;
  const [done, total] = progress;
  const when = asOf.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const share = Math.round((done / Math.max(1, total)) * 100);
  return refreshing ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-orange/30 bg-orange/5 px-3 py-1.5 text-[12px] text-navy"
      title={`Showing figures saved at ${when}; a fresh read from Tally is running`}>
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-orange" />
      Updating from Tally… {total > 0 && <b className="tabular-nums">{share}%</b>}
      <span className="text-grey">· showing {when}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] text-grey">
      <span className="inline-block h-2 w-2 rounded-full bg-teal" />
      Tally data as of <b className="font-semibold text-navy">{when}</b>
    </span>
  );
}
