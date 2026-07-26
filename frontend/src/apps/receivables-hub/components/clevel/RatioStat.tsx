import { cn } from "@hub/lib/utils";
import { fmtINRMoney } from "@hub/lib/utils";

/**
 * A single ratio read-out: big "x.xx : 1" value coloured by whether higher or lower is better,
 * its numerator/denominator legs, and an optional target line. Pure body — wrap in a WidgetCard.
 */
export interface RatioStatProps {
  ratio: number | null;
  goodWhen?: "high" | "low";
  target?: number;
  targetLabel?: string;
  numeratorLabel: string;
  numerator: number;
  denominatorLabel: string;
  denominator: number;
}

export default function RatioStat({
  ratio,
  goodWhen = "high",
  target,
  targetLabel,
  numeratorLabel,
  numerator,
  denominatorLabel,
  denominator,
}: RatioStatProps) {
  let tone = "text-navy";
  if (ratio != null && target != null) {
    const meets = goodWhen === "high" ? ratio >= target : ratio <= target;
    tone = meets ? "text-ryg-green" : "text-ryg-red";
  }
  return (
    <div className="flex flex-col h-full justify-center gap-2">
      <div className="flex items-baseline gap-1">
        <span className={cn("text-2xl font-bold leading-none", tone)}>
          {ratio == null ? "—" : `${ratio.toFixed(2)} : 1`}
        </span>
      </div>
      {target != null && (
        <div className="text-[11px] text-muted-foreground">
          {targetLabel ?? `Target: ${goodWhen === "high" ? "≥" : "≤"} ${target} : 1`}
        </div>
      )}
      <div className="mt-1 space-y-0.5 text-[11px]">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground truncate">{numeratorLabel}</span>
          <span className="font-medium text-foreground">{fmtINRMoney(numerator)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground truncate">{denominatorLabel}</span>
          <span className="font-medium text-foreground">{fmtINRMoney(denominator)}</span>
        </div>
      </div>
    </div>
  );
}
