import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@hub/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { cn } from "@hub/lib/utils";
import { isUnset, offMasterReason, optionsForRow, type NameMasterRow } from "@hub/lib/nameMasters";

/**
 * The pick-one cell for a value that comes from a managed master — salesperson, collection team.
 *
 * Replaces the `<Input list="…">` datalists these cells used to be. A datalist SUGGESTS; it does not
 * constrain, so anything typed was written. That is how "MAYANK" and "Others" ended up tagged on
 * real users while matching zero customers, since matching is exact and case-sensitive everywhere
 * (lib/scopeParties.ts). There is no free-text path out of this control.
 *
 * ⚠ IT STILL OFFERS THE VALUE THE ROW ALREADY HOLDS, even when that value is switched off or is not
 *   in the master at all. This is load-bearing rather than tidy. A customer whose salesperson is
 *   switched off is left exactly as they are — no warning, no reassignment (decided 09-09-2026) — so
 *   if the picker dropped a value it could not offer, editing any OTHER field on one of those rows
 *   would silently blank the mapping on save. The odd value is shown and labelled instead.
 *
 * ⚠ AND "NOT SET" IS A REAL CHOICE, writing NULL. 37 ledgers have no salesperson and they are NOT
 *   'OTHERS'; the box this replaces carried a placeholder of "OTHERS", which implied otherwise.
 */
export default function MasterValueCell({
  value, master, onChange, placeholder = "Not set", className, disabled,
}: {
  /** The stored value. `''` and null both mean unset — the seed left 1,631 empty strings. */
  value: string | null;
  /** The whole master, active and inactive. Empty while it loads. */
  master: NameMasterRow[];
  onChange: (next: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const options = optionsForRow(master, value);
  const unset = isUnset(value);
  const reason = offMasterReason(master, value);

  const pick = (next: string | null) => { onChange(next); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-8 w-full justify-between px-2 font-normal", className)}
          onKeyDown={(e) => {
            // An arrow key inside a scroll container would otherwise ALSO scroll it: ScrollableTable
            // claims the arrows and only bails for INPUT/TEXTAREA/SELECT, never for a button.
            // Without this, ↓ on a cell scrolls the table instead of opening the menu. Same guard
            // the shared Combobox and MultiSelect carry.
            if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
            }
          }}
        >
          <span className={cn("truncate", unset && "text-muted-foreground")}>
            {unset ? placeholder : value}
            {reason === "inactive" && (
              <span className="ml-1 text-xs text-muted-foreground">(switched off)</span>
            )}
            {reason === "unknown" && (
              <span className="ml-1 text-xs text-amber-600">(not in the list)</span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>
              Nothing matches. New names are added under Settings → Masters.
            </CommandEmpty>
            <CommandGroup>
              <CommandItem value="__unset__" onSelect={() => pick(null)}>
                <Check className={cn("mr-2 h-4 w-4", unset ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">{placeholder}</span>
              </CommandItem>
              {options.map((name) => {
                const why = offMasterReason(master, name);
                return (
                  <CommandItem key={name} value={name} onSelect={() => pick(name)}>
                    <Check className={cn("mr-2 h-4 w-4", value === name ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{name}</span>
                    {why === "inactive" && (
                      <span className="ml-2 text-xs text-muted-foreground">switched off</span>
                    )}
                    {why === "unknown" && (
                      <span className="ml-2 text-xs text-amber-600">not in the list</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
