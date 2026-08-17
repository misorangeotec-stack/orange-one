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
 * ── THE EMAIL ITEMS ARE VISIBLE BUT INERT UNTIL AN ADMIN SWITCHES THEM ON ───────────
 * `queue_report_email` RAISES while `email_module_settings('outstanding-dashboard')` is off, and
 * that row is seeded off (migration 20260829120000). So the two Email items are shown to anyone
 * who could use them, and pressing one reports "email is switched off for the Outstanding
 * Dashboard" rather than appearing to send. Hiding them instead would be worse: a feature nobody
 * can find is a feature nobody can turn on.
 *
 * That switch is also the deliberate hard stop while this is being built out — nothing reaches a
 * salesperson until the owner flips it in Settings > Notifications. Do not flip it in code, in a
 * migration, or "just to test".
 */

import { useMemo, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, Loader2, Mail, Users } from "lucide-react";
import { saveAs } from "file-saver";
import { Button } from "@hub/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@hub/components/ui/dropdown-menu";
import { useToast } from "@hub/hooks/use-toast";
import {
  buildBoth, salespersonOptions,
  type CollectionsExportContext, type SalespersonOption,
} from "@hub/lib/collectionsExport";
import { SalespersonExportDialog } from "./SalespersonExportDialog";
import { EmailReportDialog, type EmailScope } from "./EmailReportDialog";

interface Props {
  /** Built lazily by the page — see `exportContext` in CollectionPerformanceReport. */
  getContext: () => CollectionsExportContext;
  /** Number of rows in scope; the menu is inert with nothing to export. */
  rowCount: number;
  /**
   * May this user hand the book to somebody else?
   *
   * Covers per-salesperson export AND all emailing, because they are the same risk wearing two
   * hats: both put one salesperson's customers in front of a different person. A rep exporting
   * their own screen is fine; a rep pulling another rep's book, or mailing it anywhere, is not.
   * `queue_report_email` re-checks this server-side, so the menu is a courtesy, not the control.
   */
  canDistribute: boolean;
  /**
   * The catalogue id of the report on screen (lib/reportCatalog.ts).
   *
   * Emailing is switched on per REPORT, so the mail has to say which one it is. Downloading does
   * not need it — a download goes to the person who asked for it.
   */
  reportKey: string;
}

export function ExportMenu({ getContext, rowCount, canDistribute, reportKey }: Props) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailScope, setEmailScope] = useState<EmailScope>("all");
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

  // The salesperson list is needed for the per-rep mail too, and building it costs one walk of the
  // rows either way — so both doors load it the same way rather than one of them going without.
  const openEmail = (scope: EmailScope) => {
    if (scope === "salesperson") setOptions(salespersonOptions(getContext().rows));
    setEmailScope(scope);
    setEmailOpen(true);
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

          {canDistribute && (
            <DropdownMenuItem onClick={openPicker} className="cursor-pointer">
              <Users className="h-4 w-4 mr-2 text-primary" />
              <div className="flex flex-col">
                <span className="text-sm">Export salesperson-wise…</span>
                <span className="text-[11px] text-muted-foreground">Pick one or more · .zip past one</span>
              </div>
            </DropdownMenuItem>
          )}

          {canDistribute && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Sends the same two files by email
              </DropdownMenuLabel>

              <DropdownMenuItem onClick={() => openEmail("all")} className="cursor-pointer">
                <Mail className="h-4 w-4 mr-2 text-primary" />
                <div className="flex flex-col">
                  <span className="text-sm">Email all…</span>
                  <span className="text-[11px] text-muted-foreground">One mail, both files attached</span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => openEmail("salesperson")} className="cursor-pointer">
                <Mail className="h-4 w-4 mr-2 text-primary" />
                <div className="flex flex-col">
                  <span className="text-sm">Email salesperson-wise…</span>
                  <span className="text-[11px] text-muted-foreground">Each rep gets only their own book</span>
                </div>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SalespersonExportDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        options={options}
        getContext={getContext}
      />

      <EmailReportDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        scope={emailScope}
        reportKey={reportKey}
        options={options}
        getContext={getContext}
      />
    </>
  );
}
