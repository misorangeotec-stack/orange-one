import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { ChevronDown } from "lucide-react";

interface Props {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  triggerClassName?: string;
}

export function SalesPersonMultiSelect({ options, value, onChange, triggerClassName }: Props) {
  const toggle = (sp: string) => {
    onChange(value.includes(sp) ? value.filter((v) => v !== sp) : [...value, sp]);
  };

  const label =
    value.length === 0 || value.length === options.length
      ? "All Sales Persons"
      : value.length <= 2
      ? value.join(", ")
      : `${value.length} Persons`;

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
      <PopoverContent className="w-52 p-2 max-h-72 overflow-y-auto" align="start">
        <div className="space-y-1">
          {options.map((sp) => (
            <label
              key={sp}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 text-sm select-none"
            >
              <Checkbox
                checked={value.includes(sp)}
                onCheckedChange={() => toggle(sp)}
              />
              {sp}
            </label>
          ))}
          <div className="border-t border-border my-1" />
          {value.length < options.length ? (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
              onClick={() => onChange([...options])}
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
