import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";

const SEGMENTS = [
  {
    label: "Active",
    color: "bg-green-500",
    description: "Customer has at least one sales invoice, receipt, or credit note recorded in Apr 2025 – Mar 2026.",
  },
  {
    label: "No Activity",
    color: "bg-slate-400",
    description: "Customer has zero sales, zero receipts, and zero credit notes in the period. Only an opening balance may exist.",
  },
];

export function ActivityLegendPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Activity segment definitions">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <p className="text-xs font-semibold text-foreground mb-2">Activity Segment Definitions</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Based on transactions in <span className="font-medium">Apr 2025 – Mar 2026</span>. Opening balances do not count as activity.
        </p>
        <div className="space-y-3">
          {SEGMENTS.map((s) => (
            <div key={s.label} className="flex items-start gap-2">
              <span className={`mt-0.5 h-2.5 w-2.5 rounded-full shrink-0 ${s.color}`} />
              <div>
                <span className="text-xs font-semibold text-foreground">{s.label}</span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
