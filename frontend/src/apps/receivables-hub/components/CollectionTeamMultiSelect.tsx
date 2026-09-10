import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { useReceivablesScope } from "@hub/lib/scope";
import { ChevronDown } from "lucide-react";

/**
 * The Collection Team filter (RC-11) — the twin of `SalesPersonMultiSelect`, deliberately identical
 * in behaviour so the two read as one control repeated, not two controls that drifted.
 *
 * ⚠ A FILTER, NOT A SCOPE. Widening the selection can never reveal another team's customers:
 *   `options` is derived from rows the viewer can already see, and `useAppData` applies the scope
 *   regardless of what is ticked here. The picker only goes inert when the viewer has no access at
 *   all — that is the "No access" state below.
 *
 * ⚠ AN UNASSIGNED CUSTOMER APPEARS UNDER NO TEAM, so it cannot be reached from this control at all.
 *   That is correct — there is no catch-all team and inventing an "Others" bucket here would hide
 *   the coverage gap the Masters screen exists to report — but it does mean "select every team" is
 *   not the same as "no filter". Leaving the control empty is what shows everything.
 */
interface Props {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  triggerClassName?: string;
}

export function CollectionTeamMultiSelect({ options, value, onChange, triggerClassName }: Props) {
  const { restrictToSalespersons, restrictToCollectionTeams } = useReceivablesScope();
  const scoped = restrictToSalespersons !== null || restrictToCollectionTeams !== null;

  const toggle = (t: string) => {
    onChange(value.includes(t) ? value.filter((v) => v !== t) : [...value, t]);
  };

  const label =
    value.length === 0 || value.length === options.length
      ? "All Collection Teams"
      : value.length <= 2
      ? value.join(", ")
      : `${value.length} Teams`;

  // Scoped viewer whose rows carry no team at all — nothing to filter by.
  if (scoped && options.length === 0) {
    return (
      <Button
        variant="outline"
        disabled
        className={`justify-start font-normal opacity-100 cursor-default ${triggerClassName ?? "w-48 h-9 text-sm rounded-input"}`}
        title="No collection team access"
      >
        <span className="truncate">No access</span>
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={`justify-between font-normal ${triggerClassName ?? "w-48 h-9 text-sm rounded-input"}`}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2 max-h-72 overflow-y-auto" align="start">
        <div className="space-y-1">
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No collection teams on these customers yet.
            </p>
          )}
          {options.map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/60 text-sm select-none"
            >
              <Checkbox checked={value.includes(t)} onCheckedChange={() => toggle(t)} />
              {t}
            </label>
          ))}
          {options.length > 0 && <div className="border-t border-border my-1" />}
          {options.length > 0 && (value.length < options.length ? (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md"
              onClick={() => onChange([...options])}
            >
              Select all
            </button>
          ) : (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md"
              onClick={() => onChange([])}
            >
              Clear selection
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
