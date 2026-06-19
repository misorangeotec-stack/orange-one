import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { ChevronDown, Search } from "lucide-react";

interface Props {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Shown when nothing (or everything) is selected, e.g. "All Companies". */
  allLabel: string;
  /** Plural noun used in the "N <noun>" summary, e.g. "companies". */
  noun: string;
  triggerClassName?: string;
}

/** Generic checkbox multi-select used for plain string filters (Company, Location, …).
 *  Empty selection = "all" (no filter). Adds a search box when the list is long. */
export function MultiSelect({ options, value, onChange, allLabel, noun, triggerClassName }: Props) {
  const [query, setQuery] = useState("");

  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  };

  const label =
    value.length === 0 || value.length === options.length
      ? allLabel
      : value.length <= 2
      ? value.join(", ")
      : `${value.length} ${noun}`;

  const searchable = options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <Popover onOpenChange={(o) => { if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`justify-between font-normal ${triggerClassName ?? "w-44 h-9 text-sm rounded-input"}`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        {searchable && (
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={`Search ${noun}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-8 rounded-input border-border text-xs"
            />
          </div>
        )}
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {shown.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches.</div>
          ) : (
            shown.map((opt) => (
              <label
                key={opt}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 text-sm select-none"
              >
                <Checkbox checked={value.includes(opt)} onCheckedChange={() => toggle(opt)} className="mt-0.5" />
                <span className="flex-1 break-words leading-tight">{opt}</span>
              </label>
            ))
          )}
        </div>
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
      </PopoverContent>
    </Popover>
  );
}
