import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";

const RISK_LEVELS = [
  {
    label: "Critical",
    color: "bg-red-500",
    conditions: ["Max OD Days > 180", "Utilization > 100%"],
  },
  {
    label: "High",
    color: "bg-orange-400",
    conditions: ["Max OD Days 91–180", "Utilization 75–100%"],
  },
  {
    label: "Medium",
    color: "bg-amber-400",
    conditions: ["Max OD Days 31–90", "Utilization 50–75%"],
  },
  {
    label: "Low",
    color: "bg-green-500",
    conditions: ["Max OD Days ≤ 30", "Utilization < 50%"],
  },
];

export function RiskLegendPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Risk level definitions">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <p className="text-xs font-semibold text-foreground mb-2">Risk Level Definitions</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          A customer's risk is the <span className="font-medium">higher</span> of the two conditions (OD Days OR Utilization).
        </p>
        <div className="space-y-2">
          {RISK_LEVELS.map((r) => (
            <div key={r.label} className="flex items-start gap-2">
              <span className={`mt-0.5 h-2.5 w-2.5 rounded-full shrink-0 ${r.color}`} />
              <div>
                <span className="text-xs font-semibold text-foreground">{r.label}</span>
                <div className="text-[11px] text-muted-foreground">
                  {r.conditions.join(" OR ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
