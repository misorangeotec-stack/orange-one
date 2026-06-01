import { useMemo, useState, useEffect } from "react";
import { Search, Download, Loader2 } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import {
  downloadPerSalesperson, buildMailtoLink,
  type ExportCustomerRow, type ActiveFiltersSummary,
} from "@hub/lib/exportSalesperson";

export interface SalespersonOption {
  name: string;
  customerCount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SalespersonOption[];
  customers: ExportCustomerRow[];
  filters: ActiveFiltersSummary;
  asOfDate: string;
}

export function SalespersonPickerDialog({
  open, onOpenChange, options, customers, filters, asOfDate,
}: Props) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMailto, setOpenMailto] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSearch("");
      setSelected(new Set());
      setOpenMailto(false);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.name.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(o => next.add(o.name));
      return next;
    });
  };

  const clearAll = () => setSelected(new Set());

  const handleDownload = async () => {
    const names = [...selected];
    if (names.length === 0) return;
    setBusy(true);
    try {
      const { count, filename } = await downloadPerSalesperson(names, customers, filters, asOfDate);
      toast({
        title: count === 1 ? "Report downloaded" : `${count} reports downloaded`,
        description: filename,
      });
      if (openMailto) {
        names.forEach((name, i) => {
          setTimeout(() => {
            window.location.href = buildMailtoLink(name, asOfDate);
          }, i * 400);
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Download Individual Salesperson Reports</DialogTitle>
          <DialogDescription>
            Pick one or more salespersons. Each gets a dedicated Excel file with only their customers.
            Multiple selections are bundled into a .zip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search salesperson..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 rounded-input border-border text-sm"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selected · {filtered.length} shown · {options.length} total</span>
            <div className="flex gap-2">
              <button className="text-primary hover:underline" onClick={selectAllVisible} type="button">
                Select visible
              </button>
              <span>·</span>
              <button className="text-muted-foreground hover:underline" onClick={clearAll} type="button">
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-input border border-border divide-y divide-border">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No salespersons match.</div>
            ) : filtered.map(opt => (
              <label
                key={opt.name}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30"
              >
                <Checkbox
                  checked={selected.has(opt.name)}
                  onCheckedChange={() => toggle(opt.name)}
                />
                <span className="flex-1 text-sm truncate">{opt.name}</span>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  {opt.customerCount} cust
                </span>
              </label>
            ))}
          </div>

          <label className="flex items-start gap-2 pt-1 cursor-pointer">
            <Checkbox
              checked={openMailto}
              onCheckedChange={(v) => setOpenMailto(v === true)}
              className="mt-0.5"
            />
            <div className="text-xs">
              <span className="font-medium">Also open email draft for each selected salesperson</span>
              <p className="text-muted-foreground">
                Opens your email client with a pre-filled subject and body. Attach the downloaded file manually.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-button" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            className="rounded-button"
            onClick={handleDownload}
            disabled={selected.size === 0 || busy}
          >
            {busy ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Preparing…</>
            ) : (
              <><Download className="h-4 w-4 mr-2" /> Download {selected.size > 0 ? `(${selected.size})` : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
