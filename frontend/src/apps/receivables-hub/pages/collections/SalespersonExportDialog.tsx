/**
 * SalespersonExportDialog — pick the salespeople to cut the report by.
 *
 * One PDF + one workbook per person, containing only their customers. A single selection
 * downloads the two files loose; more than one bundles everything into a .zip, matching how
 * `exportSalesperson.ts` already behaves on the Risk Report.
 *
 * The dialog states the overlap rule on screen, because it is the moment the reader is about to
 * create files whose totals deliberately do not add up to the consolidated report — see
 * OVERLAP_NOTE in lib/collectionsExport.ts.
 */

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { Input } from "@hub/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import { buildBoth, type CollectionsExportContext, type SalespersonOption } from "@hub/lib/collectionsExport";
import { matchesSearch } from "@/shared/lib/search";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SalespersonOption[];
  getContext: () => CollectionsExportContext;
}

export function SalespersonExportDialog({ open, onOpenChange, options, getContext }: Props) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (open) { setSearch(""); setSelected(new Set()); setProgress(""); }
  }, [open]);

  const filtered = useMemo(
    () => (search.trim() ? options.filter((o) => matchesSearch(search, o.name)) : options),
    [options, search],
  );

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const selectVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((o) => next.add(o.name));
      return next;
    });

  const handleDownload = async () => {
    const names = [...selected];
    if (!names.length) return;
    setBusy(true);
    try {
      const ctx = getContext();

      if (names.length === 1) {
        setProgress(names[0]);
        const files = await buildBoth(ctx, { kind: "salesperson", name: names[0] });
        for (const f of files) saveAs(f.blob, f.filename);
        toast({ title: "Report downloaded", description: files.map((f) => f.filename).join(" · ") });
      } else {
        const zip = new JSZip();
        // Sequential on purpose: each PDF is a synchronous draw over the whole book, and firing
        // twenty at once locks the tab with no way to show where it has got to.
        for (let i = 0; i < names.length; i++) {
          setProgress(`${names[i]} (${i + 1}/${names.length})`);
          const files = await buildBoth(ctx, { kind: "salesperson", name: names[i] });
          for (const f of files) zip.file(f.filename, await f.blob.arrayBuffer());
        }
        setProgress("Zipping…");
        const stamp = ctx.meta.asOfDate.slice(0, 10);
        const zipName = `Salesperson_Reports_${stamp}.zip`;
        saveAs(await zip.generateAsync({ type: "blob" }), zipName);
        toast({ title: `${names.length} salesperson reports downloaded`, description: zipName });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Export salesperson-wise</DialogTitle>
          <DialogDescription>
            Each selected salesperson gets a branded PDF and a detailed Excel workbook covering only
            their customers. More than one selection is bundled into a .zip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search salesperson..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 rounded-input border-border text-sm"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{selected.size} selected · {filtered.length} shown · {options.length} total</span>
            <div className="flex gap-2">
              <button className="text-primary hover:underline" onClick={selectVisible} type="button">Select visible</button>
              <span>·</span>
              <button className="text-muted-foreground hover:underline" onClick={() => setSelected(new Set())} type="button">Clear</button>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-input border border-border divide-y divide-border">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No salespersons match.</div>
            ) : filtered.map((opt) => (
              <label key={opt.name} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30">
                <Checkbox checked={selected.has(opt.name)} onCheckedChange={() => toggle(opt.name)} />
                <span className="flex-1 text-sm truncate">{opt.name}</span>
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">{opt.customers} cust</span>
              </label>
            ))}
          </div>

          {/* Said here, not only in the file: this is the moment the reader creates the overlap. */}
          <p className="text-[11px] leading-snug text-muted-foreground">
            A customer worked by more than one salesperson appears in each of their files, so these
            reports deliberately do not add up to the consolidated one.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-button" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button className="rounded-button" onClick={handleDownload} disabled={selected.size === 0 || busy}>
            {busy ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {progress || "Preparing…"}</>
            ) : (
              <><Download className="h-4 w-4 mr-2" /> Download {selected.size > 0 ? `(${selected.size})` : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
