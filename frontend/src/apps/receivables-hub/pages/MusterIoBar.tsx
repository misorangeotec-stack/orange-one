import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import { runImport, type ImportPlan, type MasterIo } from "@hub/lib/musterIo";

/**
 * Export + Import cluster for one master tab.
 *
 * Export downloads `exportRows` (what the user currently sees) as an .xlsx. Import parses a file,
 * matches its rows against `existingRows` (the FULL master, so an edit lands even if the export was
 * filtered), shows a preview of exactly what will change, and on confirm writes only the changed
 * rows through the same guarded muster-write edge function the per-row Save buttons use.
 */
interface MasterIoBarProps<Row> {
  io: MasterIo<Row>;
  /** Rows to export — the tab's current filtered view. */
  exportRows: Row[];
  /** Rows to match imports against — the tab's full row set. */
  existingRows: Row[];
  /** Plain-English description of the active filters, for the "About" sheet. */
  activeFilters: string[];
  onReload: () => void;
}

export function MasterIoBar<Row>({ io, exportRows, existingRows, activeFilters, onReload }: MasterIoBarProps<Row>) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [writing, setWriting] = useState<{ done: number; total: number } | null>(null);

  const doExport = () => {
    exportRowsToXlsx({
      fileName: io.fileName,
      sheetName: io.sheetName,
      title: io.title,
      columns: io.exportColumns,
      rows: exportRows,
      filters: activeFilters,
      notes: io.notes,
    });
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked
    if (!file) return;
    try {
      const records = await parseXlsxRows(file);
      if (records.length === 0) {
        toast({ variant: "destructive", title: "Empty file", description: "No data rows found in the sheet." });
        return;
      }
      setPlan(io.buildPlan(records, existingRows));
    } catch (err) {
      toast({ variant: "destructive", title: "Couldn't read file", description: (err as Error).message });
    }
  };

  const confirm = async () => {
    if (!plan) return;
    setWriting({ done: 0, total: plan.changes.length });
    const result = await runImport(plan.changes, (done, total) => setWriting({ done, total }));
    setWriting(null);
    setPlan(null);
    if (result.failed.length) {
      toast({
        variant: "destructive",
        title: `${result.ok} updated, ${result.failed.length} failed`,
        description: result.failed.slice(0, 3).map((f) => `${f.label}: ${f.error}`).join(" · "),
      });
    } else {
      toast({ title: "Import complete", description: `${result.ok} row${result.ok === 1 ? "" : "s"} updated.` });
    }
    onReload();
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={doExport} className="gap-1.5">
          <Download className="h-4 w-4" /> Export
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
          <Upload className="h-4 w-4" /> Import
        </Button>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onPick} />
      </div>

      <ImportPreviewDialog
        plan={plan}
        title={io.title}
        writing={writing}
        onCancel={() => setPlan(null)}
        onConfirm={confirm}
      />
    </>
  );
}

const PREVIEW_LIMIT = 20;

function ImportPreviewDialog({
  plan, title, writing, onCancel, onConfirm,
}: {
  plan: ImportPlan | null;
  title: string;
  writing: { done: number; total: number } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const open = plan !== null;
  const changes = plan?.changes ?? [];
  const invalid = plan?.invalid ?? [];
  const unmatched = plan?.unmatched ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !writing) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import — {title}</DialogTitle>
          <DialogDescription>
            Review the changes before writing. Only rows whose values differ are written; everything else is left untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span><span className="font-semibold text-foreground">{changes.length}</span> to update</span>
          <span className="text-muted-foreground">{plan?.unchanged ?? 0} unchanged</span>
          <span className="text-muted-foreground">{unmatched.length} unmatched</span>
          <span className={invalid.length ? "text-destructive" : "text-muted-foreground"}>{invalid.length} invalid</span>
        </div>

        {invalid.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 max-h-28 overflow-y-auto text-xs">
            <p className="font-medium text-destructive mb-1">Skipped — invalid ({invalid.length})</p>
            {invalid.slice(0, PREVIEW_LIMIT).map((r, i) => (
              <div key={i}><span className="font-medium">{r.label}</span> — {r.reason}</div>
            ))}
            {invalid.length > PREVIEW_LIMIT && <div className="text-muted-foreground">…and {invalid.length - PREVIEW_LIMIT} more</div>}
          </div>
        )}

        {changes.length > 0 && (
          <div className="rounded-md border border-border max-h-64 overflow-y-auto text-xs">
            {changes.slice(0, PREVIEW_LIMIT).map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3 border-b border-border/60 px-2 py-1 last:border-0">
                <span className="truncate font-medium">{c.label}</span>
                <span className="shrink-0 text-muted-foreground">{c.fields}</span>
              </div>
            ))}
            {changes.length > PREVIEW_LIMIT && (
              <div className="px-2 py-1 text-muted-foreground">…and {changes.length - PREVIEW_LIMIT} more</div>
            )}
          </div>
        )}

        {changes.length === 0 && invalid.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing to update — every row already matches the live data.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={!!writing}>Cancel</Button>
          <Button onClick={onConfirm} disabled={!!writing || changes.length === 0}>
            {writing ? `Writing ${writing.done}/${writing.total}…` : `Write ${changes.length} change${changes.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
