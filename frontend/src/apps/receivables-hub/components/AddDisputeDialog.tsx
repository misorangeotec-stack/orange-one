import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import { Textarea } from "@hub/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@hub/components/ui/command";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import { insertDisputes, type DisputeRow } from "@hub/lib/musterApi";
import { saleTypeLabel } from "@hub/lib/salesReport";
import { formatDateDMY } from "@hub/lib/utils";

/**
 * Put a customer's bills in dispute (RC-13): pick a customer → tick one or more of their OPEN bills
 * → type a remark → save.
 *
 * ── Nothing about money or dates is typed ──
 * The bill is picked from the ones Tally says are open, so its number is the snapshot's own spelling
 * and the report can always find it again. The server refuses anything else.
 *
 * ── The same dialog on two screens, fed from two places ──
 * The Disputed Bills report hands it the dashboard's own customers and bills (already scoped to the
 * viewer, with Other Payments netted); Settings → Masters hands it the raw snapshot, like every other
 * muster tab. So this component takes the lists as props and never fetches.
 */

export interface DisputeCustomer {
  ledgerId: string;
  name: string;
  company: string;
  location: string;
}

export interface DisputeBill {
  billRef: string;
  /** ISO yyyy-mm-dd, or "" when unknown. */
  date: string;
  dueDate: string;
  amount: number;
  pending: number;
  overdueDays: number;
  saleType: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Overdue first (most overdue at the top), then the oldest due date — the order a collector chases in. */
function byOverdueFirst(a: DisputeBill, b: DisputeBill): number {
  if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
  return (a.dueDate || a.date).localeCompare(b.dueDate || b.date);
}

export function AddDisputeDialog({ open, onOpenChange, customers, billsOf, existing, onAdded }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: DisputeCustomer[];
  /**
   * The customer's open bills. Only bills still owed (pending > 0) are offered: a credit sitting on
   * the ledger — an advance, an unapplied receipt — is not a bill anyone can dispute.
   */
  billsOf: (ledgerId: string) => DisputeBill[];
  /** The master as it stands, so a bill already on it is greyed out instead of failing on save. */
  existing: DisputeRow[];
  onAdded: (rows: DisputeRow[]) => void;
}) {
  const { toast } = useToast();
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [remarks, setRemarks] = useState("");
  const [item, setItem] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const billsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setLedgerId(null); setPicked([]); setRemarks(""); setItem(""); setQ(""); }
  }, [open]);

  /** Only customers with something to dispute — anyone else would open onto an empty list. */
  const pickable = useMemo(() => {
    if (!open) return [];
    return customers
      .map((c) => ({ ...c, open: billsOf(c.ledgerId).filter((b) => b.pending > 0.5).length }))
      .filter((c) => c.open > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [open, customers, billsOf]);

  const matches = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return (needle ? pickable.filter((c) => c.name.toUpperCase().includes(needle)) : pickable).slice(0, 50);
  }, [pickable, q]);

  const customer = ledgerId ? pickable.find((c) => c.ledgerId === ledgerId) ?? null : null;

  const bills = useMemo(
    () => (ledgerId ? billsOf(ledgerId).filter((b) => b.pending > 0.5).sort(byOverdueFirst) : []),
    [ledgerId, billsOf],
  );

  /** bill_ref → the dispute already on it, for this customer only (the number alone is not unique). */
  const onList = useMemo(() => {
    const m = new Map<string, DisputeRow>();
    for (const d of existing) if (d.ledger_id === ledgerId) m.set(d.bill_ref, d);
    return m;
  }, [existing, ledgerId]);

  const selectable = bills.filter((b) => !onList.has(b.billRef));
  const allTicked = selectable.length > 0 && selectable.every((b) => picked.includes(b.billRef));

  const pickCustomer = (id: string) => {
    setLedgerId(id);
    setPicked([]);
    setPickerOpen(false);
    setQ("");
    // The cursor follows the work: once the customer is chosen, the next thing to do is tick a bill.
    // Next frame, because the bill list has not rendered yet.
    requestAnimationFrame(() => {
      billsRef.current?.querySelector<HTMLButtonElement>("button[role='checkbox']:not([disabled])")?.focus();
    });
  };

  const toggle = (ref: string) =>
    setPicked((p) => (p.includes(ref) ? p.filter((x) => x !== ref) : [...p, ref]));

  const submit = async () => {
    if (!customer || picked.length === 0) return;
    setSaving(true);
    try {
      const { rows } = await insertDisputes({
        ledger_id: customer.ledgerId,
        tally_name: customer.name,
        bill_refs: picked,
        remarks: remarks.trim() || null,
        item_description: item.trim() || null,
      });
      onAdded(rows);
      onOpenChange(false);
      toast({
        title: rows.length === 1 ? "Bill put in dispute" : `${rows.length} bills put in dispute`,
        description: customer.name,
      });
    } catch (e) {
      // The dialog stays open with everything typed, so a refused save costs nothing to retry.
      toast({ variant: "destructive", title: "Could not add", description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add disputed bills</DialogTitle>
          <DialogDescription>
            Pick a customer, tick the bills in dispute and say why. The amounts stay live from Tally —
            nothing about money or dates is typed here.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Customer</span>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className={customer ? "truncate" : "text-muted-foreground"}>
                    {customer
                      ? `${customer.name} · ${[customer.company, customer.location].filter(Boolean).join(" / ")}`
                      : "Search a customer with open bills…"}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[360px]" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="Type a customer name…" value={q} onValueChange={setQ} />
                  <CommandList>
                    <CommandEmpty>No customer with open bills matches.</CommandEmpty>
                    <CommandGroup>
                      {matches.map((c) => (
                        <CommandItem key={c.ledgerId} value={c.ledgerId} onSelect={() => pickCustomer(c.ledgerId)}>
                          <Check className={`mr-2 h-4 w-4 ${ledgerId === c.ledgerId ? "opacity-100" : "opacity-0"}`} />
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto pl-2 text-xs text-muted-foreground shrink-0">
                            {[c.company, c.location].filter(Boolean).join(" / ")} · {c.open} open
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {customer && (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Open bills — overdue first ({bills.length})
                </span>
                {selectable.length > 1 && (
                  <button
                    type="button"
                    className="text-[11px] underline text-muted-foreground hover:text-foreground"
                    onClick={() => setPicked(allTicked ? [] : selectable.map((b) => b.billRef))}
                  >
                    {allTicked ? "Untick all" : "Tick all"}
                  </button>
                )}
              </div>
              <div ref={billsRef} className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-left text-muted-foreground">
                      <th className="w-8 px-2 py-1.5" />
                      <th className="px-2 py-1.5 font-medium">Bill</th>
                      <th className="px-2 py-1.5 font-medium">Date</th>
                      <th className="px-2 py-1.5 font-medium text-right">Overdue</th>
                      <th className="px-2 py-1.5 font-medium">Type</th>
                      <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                      <th className="px-2 py-1.5 font-medium text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b) => {
                      const already = onList.get(b.billRef);
                      const ticked = picked.includes(b.billRef);
                      return (
                        <tr
                          key={b.billRef}
                          className={`border-t ${already ? "opacity-50" : "cursor-pointer hover:bg-muted/40"}`}
                          onClick={() => { if (!already) toggle(b.billRef); }}
                          title={already
                            ? (already.cleared
                              ? "Already on the list, CLEARED — reopen it there instead of adding it again"
                              : "Already on the disputed bills list")
                            : undefined}
                        >
                          <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={!!already || ticked}
                              disabled={!!already}
                              onCheckedChange={() => toggle(b.billRef)}
                              aria-label={`Dispute ${b.billRef}`}
                            />
                          </td>
                          <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                            {b.billRef}
                            {already && (
                              <span className="ml-2 font-sans text-[10px] text-muted-foreground">
                                {already.cleared ? "on the list · cleared" : "on the list"}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{b.date ? formatDateDMY(b.date) : "—"}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${b.overdueDays > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {b.overdueDays > 0 ? `${b.overdueDays} d` : "not due"}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">{saleTypeLabel(b.saleType)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{inr(b.amount)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">{inr(b.pending)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Remark</span>
            <Textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="What is disputed, who is resolving it, and by when — e.g. rate difference, Nakul ji to clear this week"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Item (optional)</span>
            <Input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="The item in dispute, e.g. TX027-BYHX HEAD DRIVE BOARD"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={!customer || picked.length === 0 || saving} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {saving ? "Adding…" : picked.length > 1 ? `Add ${picked.length} bills` : "Add bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
