/**
 * ExportMenu — the Collection Performance reports' download menu.
 *
 * Two scopes, two artefacts each:
 *   Export all              → one branded PDF + one detailed workbook, covering the whole book
 *   Export salesperson-wise → the same pair per selected salesperson (a .zip past one)
 *
 * Modelled on `pages/salesperson/ShareReportMenu.tsx` so it reads like the rest of the hub. The
 * heavy lifting lives in `lib/collectionsExport.ts`; this file is the UI and nothing else.
 *
 * WHAT IT EXPORTS IS WHAT YOU SEE: the context handed in is built from the FOCUSED rows, so the
 * active period, threshold, filters, KPI lenses and column choice all travel into both files.
 *
 * ── EMAILING IS DELIBERATELY NOT WIRED UP HERE YET ──────────────────────────────────
 * Mailing these files needs a Storage bucket, an enqueue RPC (`queue_report_email`) and an
 * attachment-capable `send-email`, none of which exist on the live project yet. The UI for it is
 * written and sitting beside this file (`EmailReportDialog.tsx`, `lib/reportEmail.ts`,
 * `pages/settings/NotificationsSection.tsx`); it is left unreferenced on purpose, because a menu
 * item that throws is worse than one that is absent. Re-add the two items and the dialog once the
 * migration is applied and the function deployed.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, Loader2, Users } from "lucide-react";
import { saveAs } from "file-saver";
import { Button } from "@hub/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@hub/components/ui/dropdown-menu";
import { useToast } from "@hub/hooks/use-toast";
import {
  buildBoth, salespersonOptions,
  type CollectionsExportContext, type SalespersonOption,
} from "@hub/lib/collectionsExport";
import { SalespersonExportDialog } from "./SalespersonExportDialog";

interface Props {
  /** Built lazily by the page — see `exportContext` in CollectionPerformanceReport. */
  getContext: () => CollectionsExportContext;
  /** Number of rows in scope; the menu is inert with nothing to export. */
  rowCount: number;
  /** Salesperson-wise export is gated — a rep must not be able to pull another rep's book. */
  canExportPerSalesperson: boolean;
}

export function ExportMenu({ getContext, rowCount, canExportPerSalesperson }: Props) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Only computed when a dialog opens — building it on every render would walk every row on a
  // report that already re-derives a lot per keystroke.
  const [options, setOptions] = useState<SalespersonOption[]>([]);

  const disabled = rowCount === 0;

  const handleAll = async () => {
    if (disabled || busy) return;
    setBusy(true);
    try {
      const files = await buildBoth(getContext(), { kind: "all" });
      for (const f of files) saveAs(f.blob, f.filename);
      toast({ title: "Report downloaded", description: files.map((f) => f.filename).join(" · ") });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const openPicker = () => {
    setOptions(salespersonOptions(getContext().rows));
    setPickerOpen(true);
  };

  const trigger = useMemo(
    () => (
      <Button variant="outline" size="sm" className="rounded-button border-border" disabled={disabled || busy}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
        {busy ? "Preparing…" : "Export"}
        <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-60" />
      </Button>
    ),
    [disabled, busy],
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Reflects the current period, filters and columns
          </DropdownMenuLabel>

          <DropdownMenuItem onClick={handleAll} className="cursor-pointer">
            <FileSpreadsheet className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm">Export all</span>
              <span className="text-[11px] text-muted-foreground">PDF summary + detailed Excel</span>
            </div>
          </DropdownMenuItem>

          {canExportPerSalesperson && (
            <DropdownMenuItem onClick={openPicker} className="cursor-pointer">
              <Users className="h-4 w-4 mr-2 text-primary" />
              <div className="flex flex-col">
                <span className="text-sm">Export salesperson-wise…</span>
                <span className="text-[11px] text-muted-foreground">Pick one or more · .zip past one</span>
              </div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SalespersonExportDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        options={options}
        getContext={getContext}
      />
    </>
  );
}
