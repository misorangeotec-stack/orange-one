import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { SlidersHorizontal } from "lucide-react";

export interface ColumnOption {
  key: string;
  label: string;
}

interface Props {
  columns: ColumnOption[];
  /** Keys currently shown. Empty/last-one is guarded so at least one stays visible. */
  visible: string[];
  onChange: (visible: string[]) => void;
  triggerClassName?: string;
}

/** Column chooser — toggle which table columns are shown (and exported). */
export function ColumnPicker({ columns, visible, onChange, triggerClassName }: Props) {
  const toggle = (key: string) => {
    if (visible.includes(key)) {
      if (visible.length <= 1) return; // never hide the last column
      onChange(visible.filter((k) => k !== key));
    } else {
      onChange([...visible, key]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`rounded-button border-border font-normal ${triggerClassName ?? "h-8 text-xs"}`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Columns ({visible.length}/{columns.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2 max-h-72 overflow-y-auto" align="end">
        <div className="space-y-1">
          {columns.map((col) => {
            const checked = visible.includes(col.key);
            const isLast = checked && visible.length <= 1;
            return (
              <label
                key={col.key}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm select-none ${isLast ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/60"}`}
              >
                <Checkbox checked={checked} disabled={isLast} onCheckedChange={() => toggle(col.key)} />
                <span className="truncate">{col.label}</span>
              </label>
            );
          })}
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
            onClick={() => onChange(columns.map((c) => c.key))}
          >
            Show all
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
