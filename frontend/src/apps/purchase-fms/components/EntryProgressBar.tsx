import { cn } from "@/shared/lib/cn";

/**
 * Compact pipeline-progress bar for list rows: a filled track plus an
 * "x / total" label. Turns green once every stage is done.
 */
export default function EntryProgressBar({
  done,
  total,
  className,
  showLabel = true,
}: {
  done: number;
  total: number;
  className?: string;
  showLabel?: boolean;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const complete = done >= total;
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="h-1.5 flex-1 min-w-[70px] overflow-hidden rounded-full bg-[#eef1f6]">
        <span
          className={cn("block h-full rounded-full transition-all", complete ? "bg-ryg-green" : "bg-orange")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn("text-[11.5px] font-semibold tabular-nums", complete ? "text-[#1f9d57]" : "text-grey")}>
          {done}/{total}
        </span>
      )}
    </div>
  );
}
