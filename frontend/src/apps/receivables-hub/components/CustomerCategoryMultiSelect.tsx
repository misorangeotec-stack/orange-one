import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { ChevronDown } from "lucide-react";

// Customer tier as maintained by Sales/Finance in the mapping sheet.
// AA = internal. UNCATEGORIZED is the explicit bucket for a blank category.
export const UNCATEGORIZED = "Uncategorized";

// ⚠ THE TWO MATCHING HELPERS MOVED TO `lib/customerCategory.ts`, and are re-exported here so the
//   ~dozen call sites that import them from this component keep working. They are pure functions
//   and the scheduled report has to call them on a server, where importing a component would drag
//   React into the bundle. Import them from the lib in new code.
export { customerCategoryTokens, matchesCategory } from "@hub/lib/customerCategory";
import { MARK_LABEL } from "@hub/lib/markType";

export const CATEGORY_OPTIONS = [
  { value: "A",  label: "A" },
  { value: "B",  label: "B" },
  { value: "C",  label: "C" },
  { value: "D",  label: "D" },
  { value: "E",  label: "E" },
  { value: "AA", label: "AA (internal)" },
  { value: UNCATEGORIZED, label: "Uncategorized" },
  // Not tiers: the Red Mark + Legal master (Settings → Masters). A customer is in one of these AS
  // WELL AS its tier, so ticking one narrows to just those customers.
  { value: MARK_LABEL.redmark, label: "Red Mark" },
  { value: MARK_LABEL.legal, label: "Legal" },
];
const FIRST_MARK_OPTION = MARK_LABEL.redmark;

interface Props {
  value: string[];
  onChange: (value: string[]) => void;
  triggerClassName?: string;
}

/**
 * What an EMPTY selection means, drawn as ticks: every option except Legal (user, 22-10-2026).
 * `[]` stays the stored value for it, so pages show no filter chip for the default.
 */
const DEFAULT_TICKS = CATEGORY_OPTIONS.map((o) => o.value).filter((v) => v !== MARK_LABEL.legal);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

export function CustomerCategoryMultiSelect({ value, onChange, triggerClassName }: Props) {
  // The ticks on screen. An empty value is the default (everything but Legal), never "nothing".
  const ticked = value.length ? value : DEFAULT_TICKS;
  /** Store the default as [] again, so a page reads "no filter chip" for it. */
  const emit = (next: string[]) => onChange(next.length === 0 || sameSet(next, DEFAULT_TICKS) ? [] : next);
  const toggle = (cat: string) => {
    emit(ticked.includes(cat) ? ticked.filter((v) => v !== cat) : [...ticked, cat]);
  };

  const label =
    value.length === 0
      ? "All except Legal"
      : value.length === CATEGORY_OPTIONS.length
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
          {CATEGORY_OPTIONS.map((opt) => (<div key={opt.value || "_uncat"}>
            {opt.value === FIRST_MARK_OPTION && <div className="border-t border-border my-1" />}
            <label
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 text-sm select-none"
            >
              <Checkbox
                checked={ticked.includes(opt.value)}
                onCheckedChange={() => toggle(opt.value)}
              />
              {opt.label}
            </label>
          </div>))}
          <div className="border-t border-border my-1" />
          {ticked.length < CATEGORY_OPTIONS.length && (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
              onClick={() => onChange(CATEGORY_OPTIONS.map((o) => o.value))}
            >
              Select all (include Legal)
            </button>
          )}
          {value.length > 0 && (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
              onClick={() => onChange([])}
            >
              Reset (all except Legal)
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
