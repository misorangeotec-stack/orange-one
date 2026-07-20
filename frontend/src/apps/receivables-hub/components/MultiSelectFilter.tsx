import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { ChevronDown, Search } from "lucide-react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface Props {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Shown when nothing (or everything) is selected, e.g. "All Companies". */
  allLabel: string;
  /** Plural noun for the ">2 selected" summary, e.g. "Companies". */
  unit?: string;
  triggerClassName?: string;
  contentClassName?: string;
  /** Force the in-dropdown search box. Defaults to on when there are > 8 options. */
  searchable?: boolean;
}

/**
 * Generic checkbox multi-select filter — same visual pattern as
 * RiskMultiSelect / SalesPersonMultiSelect (visible checkboxes +
 * Select all / Clear selection). Empty selection means "no filter".
 *
 * A search box appears for long option lists (> 8) so a filter like Tally groups stays usable; it
 * filters the visible rows only — Select all / Clear selection still act on the whole set.
 */
export function MultiSelectFilter({
  options, value, onChange, allLabel, unit, triggerClassName, contentClassName, searchable,
}: Props) {
  const [query, setQuery] = useState("");
  const showSearch = searchable ?? options.length > 8;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const label =
    value.length === 0 || value.length === options.length
      ? allLabel
      : value.length <= 2
      ? value.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ")
      : `${value.length} ${unit ?? "selected"}`;

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`justify-between font-normal ${triggerClassName ?? "w-44 h-9 text-sm rounded-input"}`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`w-52 p-2 ${contentClassName ?? ""}`} align="start">
        {showSearch && (
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="pl-7 h-8 text-sm rounded-input"
            />
          </div>
        )}
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {shown.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</div>
          ) : (
            shown.map((opt) => (
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
            ))
          )}
        </div>
        <div className="border-t border-border my-1" />
        {value.length < options.length ? (
          <button
            className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
            onClick={() => onChange(options.map((o) => o.value))}
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
      </PopoverContent>
    </Popover>
  );
}
