import { X } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";

export interface FilterChip {
  label: string;
  onRemove: () => void;
}

interface FilterChipsProps {
  chips: FilterChip[];
  onClearAll: () => void;
}

export function FilterChips({ chips, onClearAll }: FilterChipsProps) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <Badge
          key={chip.label}
          variant="secondary"
          className="gap-1 pr-1 text-xs font-normal"
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="ml-0.5 rounded-sm opacity-60 hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="h-6 px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        Clear all
      </Button>
    </div>
  );
}
