import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { ChevronDown } from "lucide-react";

// Customer tier as maintained by Sales/Finance in the mapping sheet.
// AA = internal. UNCATEGORIZED is the explicit bucket for a blank category.
export const UNCATEGORIZED = "Uncategorized";

export const CATEGORY_OPTIONS = [
  { value: "A",  label: "A" },
  { value: "B",  label: "B" },
  { value: "C",  label: "C" },
  { value: "D",  label: "D" },
  { value: "E",  label: "E" },
  { value: "AA", label: "AA (internal)" },
  { value: UNCATEGORIZED, label: "Uncategorized" },
];

/** The category tokens a customer matches against (handles groups + blanks). */
export function customerCategoryTokens(
  c: { category?: string; categories?: string[] },
): string[] {
  if (c.categories && c.categories.length) return c.categories;
  if (c.category && c.category !== "Multiple") return [c.category];
  return [UNCATEGORIZED];
}

/** True when the customer matches the selected categories ([] = no filter). */
export function matchesCategory(
  c: { category?: string; categories?: string[] },
  selected: string[],
): boolean {
  if (!selected.length) return true;
  const set = new Set(selected);
  return customerCategoryTokens(c).some((t) => set.has(t));
}

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  triggerClassName?: string;
}

export function CustomerCategoryMultiSelect({ value, onChange, triggerClassName }: Props) {
  const toggle = (cat: string) => {
    onChange(value.includes(cat) ? value.filter((v) => v !== cat) : [...value, cat]);
  };

  const label =
    value.length === 0 || value.length === CATEGORY_OPTIONS.length
      ? "All Categories"
      : value.length <= 3
      ? value.map((v) => CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v).join(", ")
      : `${value.length} Categories`;

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
      <PopoverContent className="w-48 p-2" align="start">
        <div className="space-y-1">
          {CATEGORY_OPTIONS.map((opt) => (
            <label
              key={opt.value || "_uncat"}
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
          {value.length < CATEGORY_OPTIONS.length ? (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
              onClick={() => onChange(CATEGORY_OPTIONS.map((o) => o.value))}
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
