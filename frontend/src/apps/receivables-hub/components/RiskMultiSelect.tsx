import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { ChevronDown } from "lucide-react";

const RISK_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High" },
  { value: "medium",   label: "Medium" },
  { value: "low",      label: "Low" },
];

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  triggerClassName?: string;
}

export function RiskMultiSelect({ value, onChange, triggerClassName }: Props) {
  const toggle = (risk: string) => {
    onChange(value.includes(risk) ? value.filter((v) => v !== risk) : [...value, risk]);
  };

  const label =
    value.length === 0
      ? "All Risk Levels"
      : value.length === RISK_OPTIONS.length
      ? "All Risk Levels"
      : value.length <= 2
      ? value.map((v) => RISK_OPTIONS.find((o) => o.value === v)?.label ?? v).join(", ")
      : `${value.length} Levels`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`justify-between font-normal ${triggerClassName ?? "w-44 h-9 text-sm rounded-input"}`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2" align="start">
        <div className="space-y-1">
          {RISK_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 text-sm select-none"
            >
              <Checkbox
                checked={value.includes(opt.value)}
                onCheckedChange={() => toggle(opt.value)}
              />
              {opt.label}
            </label>
          ))}
          <div className="border-t border-border my-1" />
          {value.length < RISK_OPTIONS.length ? (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
              onClick={() => onChange(RISK_OPTIONS.map((o) => o.value))}
            >
              Select all
            </button>
          ) : (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
              onClick={() => onChange([])}
            >
              Clear selection
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
