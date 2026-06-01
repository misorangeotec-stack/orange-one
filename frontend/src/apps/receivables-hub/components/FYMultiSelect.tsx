import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { ChevronDown, CalendarRange } from "lucide-react";
import { useFY, ALL_FYS, FY_LABELS, type FY } from "@hub/lib/fyContext";

export function FYMultiSelect() {
  const { selected, setSelected } = useFY();

  // Empty selection = Both — display all checkboxes as checked in that case
  const effectiveSelected = selected.length === 0 ? ALL_FYS : selected;

  const toggle = (fy: FY) => {
    const isSelected = effectiveSelected.includes(fy);
    let next: FY[];
    if (isSelected) {
      next = effectiveSelected.filter((v) => v !== fy);
    } else {
      next = [...effectiveSelected, fy];
    }
    // Don't allow zero selection — fall back to both
    if (next.length === 0) next = ALL_FYS;
    setSelected(next);
  };

  const triggerLabel =
    selected.length === 0 || selected.length === ALL_FYS.length
      ? "All FYs"
      : selected.map((fy) => FY_LABELS[fy]).join(", ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 font-normal text-sm rounded-input"
        >
          <CalendarRange className="h-3.5 w-3.5 opacity-70" />
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2" align="end">
        <div className="space-y-1">
          {ALL_FYS.map((fy) => (
            <label
              key={fy}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 text-sm select-none"
            >
              <Checkbox
                checked={effectiveSelected.includes(fy)}
                onCheckedChange={() => toggle(fy)}
              />
              {FY_LABELS[fy]}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
