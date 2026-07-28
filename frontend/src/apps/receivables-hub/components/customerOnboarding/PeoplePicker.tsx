/**
 * People pickers for the module — one multi-select, one single-select.
 *
 * The list comes from `list_org_people` (fetchOrgPeople), NOT the portal
 * directory. The directory is RLS-scoped: a non-admin only sees self + downline
 * + same-department peers, so a sales head in another department is simply
 * absent from it. Step owners and coordinators are org-wide appointments, so an
 * org-wide list is the only correct source.
 *
 * ⚠ Two MultiSelects already exist in this codebase with different APIs
 *   (shared/components/ui/MultiSelect and the hub's own). This is a third only
 *   because both hard-code Orange One's portal tokens, which `.hub-root` does
 *   not remap — they render as a different product inside a hub card. The
 *   behaviour is deliberately identical: search, Select all, Clear all.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Badge } from "@hub/components/ui/badge";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@hub/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { cn } from "@hub/lib/utils";
import { fetchOrgPeople, type OrgPerson } from "@/core/platform/orgPeople";

/** Shared cache entry with the mention picker and every FMS store — no extra call. */
export function useOrgPeople(): OrgPerson[] {
  const { data } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(
    () => [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
}

function subtitle(p: OrgPerson): string {
  return p.designation?.trim() || p.role.replace(/_/g, " ");
}

export function PeopleMultiSelect({
  value, onChange, people, placeholder = "Nobody selected", disabled, emptyText,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Pre-filtered candidate list — pass the department-narrowed set. */
  people: OrgPerson[];
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn("truncate", !value.length && "text-muted-foreground")}>
              {value.length ? `${value.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search people…" />
            <CommandList>
              <CommandEmpty>{emptyText ?? "No one matches that."}</CommandEmpty>
              <CommandGroup>
                {people.map((p) => {
                  const on = value.includes(p.id);
                  return (
                    <CommandItem key={p.id} value={`${p.name} ${subtitle(p)}`} onSelect={() => toggle(p.id)}>
                      <Check className={cn("mr-2 h-4 w-4", on ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0">
                        <span className="block truncate">{p.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">{subtitle(p)}</span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
          {/* House pattern: every multi-select carries Select all + Clear all. */}
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => onChange(people.map((p) => p.id))}
            >
              Select all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              Clear all
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 font-normal">
              {/* An id with no matching person is a stale appointment — someone who
                  has left. Show the raw id rather than dropping it silently, or an
                  admin can never work out why a step notifies nobody. */}
              {byId.get(id)?.name ?? `Unknown (${id.slice(0, 8)})`}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  className="hover:text-destructive"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function PersonSelect({
  value, onChange, people, placeholder = "Choose a person", disabled, allowClear = true,
}: {
  value: string | null;
  onChange: (id: string | null, person: OrgPerson | null) => void;
  people: OrgPerson[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chosen = people.find((p) => p.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !chosen && "text-muted-foreground")}>
            {chosen?.name ?? placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search people…" />
          <CommandList>
            <CommandEmpty>No one matches that.</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem value="__none__" onSelect={() => { onChange(null, null); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value ? "opacity-0" : "opacity-100")} />
                  <span className="text-muted-foreground">Nobody</span>
                </CommandItem>
              )}
              {people.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${subtitle(p)}`}
                  onSelect={() => { onChange(p.id, p); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0">
                    <span className="block truncate">{p.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{subtitle(p)}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
