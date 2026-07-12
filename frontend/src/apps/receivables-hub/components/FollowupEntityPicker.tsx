import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { Input } from "@hub/components/ui/input";
import { useAppData } from "@hub/lib/useAppData";
import { fmtINRMoney } from "@hub/lib/utils";
import { matchesSearch } from "@/shared/lib/search";
import type { FollowupEntityType } from "@hub/lib/followupTypes";

/**
 * Pick the customer (or group) to log a follow-up against.
 *
 * Exists so the Follow-ups page can start a chase on ANY customer without first hunting for the
 * row in the Risk Register. Follows the dialog+search pattern of SalespersonPickerDialog.
 *
 * The options come from `useAppData`, which is ALREADY salesperson-scoped — so this picker
 * physically cannot surface a customer the signed-in user isn't allowed to see. Scoping is
 * inherited, not re-implemented.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (entity: { type: FollowupEntityType; name: string }) => void;
}

interface Option {
  type: FollowupEntityType;
  name: string;
  outstanding: number;
  salesPerson: string;
}

/** There are ~700 customers; rendering them all un-virtualised stutters. Show the top slice
 *  and tell the user to narrow — the search box is the real navigation here. */
const MAX_RENDERED = 100;

export function FollowupEntityPicker({ open, onOpenChange, onSelect }: Props) {
  const { consolidatedCustomers, groupedCustomers } = useAppData({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const options = useMemo<Option[]>(() => {
    // Real (multi-member) groups first — a single-member "group" IS the customer, so listing both
    // would show every customer twice.
    const groups: Option[] = groupedCustomers
      .filter((g) => g.isGroup)
      .map((g) => ({ type: "group" as const, name: g.name, outstanding: g.outstanding, salesPerson: g.salesPerson }));
    const customers: Option[] = consolidatedCustomers
      .map((c) => ({ type: "customer" as const, name: c.name, outstanding: c.outstanding, salesPerson: c.salesPerson }));
    return [
      ...groups.sort((a, b) => b.outstanding - a.outstanding),
      ...customers.sort((a, b) => b.outstanding - a.outstanding),
    ];
  }, [consolidatedCustomers, groupedCustomers]);

  const matches = useMemo(
    () => options.filter((o) => matchesSearch(search, o.name, o.salesPerson)),
    [options, search],
  );
  const shown = matches.slice(0, MAX_RENDERED);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Log a follow-up</DialogTitle>
          <DialogDescription className="text-xs">
            Pick the customer or group you spoke to. Highest outstanding first.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search customer, group or salesperson…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
          {shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No customer matches “{search}”.</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((o) => (
                <li key={`${o.type}:${o.name}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect({ type: o.type, name: o.name });
                      onOpenChange(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{o.name}</span>
                        {o.type === "group" && (
                          <span className="shrink-0 rounded border border-border bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                            Group
                          </span>
                        )}
                      </span>
                      {o.salesPerson && (
                        <span className="block truncate text-[11px] text-muted-foreground">{o.salesPerson}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {fmtINRMoney(o.outstanding)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {matches.length > MAX_RENDERED && (
          <p className="text-[11px] text-muted-foreground">
            Showing the top {MAX_RENDERED} of {matches.length} matches — keep typing to narrow it down.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
