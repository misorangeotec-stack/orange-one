import { useMemo, useState } from "react";
import { Download, Share2, FileSpreadsheet, Users, Mail, MessageCircle, ChevronDown } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@hub/components/ui/dropdown-menu";
import { useToast } from "@hub/hooks/use-toast";
import {
  downloadConsolidated,
  type ExportCustomerRow, type ActiveFiltersSummary,
} from "@hub/lib/exportSalesperson";
import { SalespersonPickerDialog, type SalespersonOption } from "./SalespersonPickerDialog";
import { SharePromptDialog, type ShareChannel } from "./SharePromptDialog";

interface Props {
  customers: ExportCustomerRow[];
  filters: ActiveFiltersSummary;
  asOfDate: string;
}

export function ShareReportMenu({ customers, filters, asOfDate }: Props) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen,  setShareOpen]  = useState(false);
  const [shareChannel, setShareChannel] = useState<ShareChannel>("email");

  const salespersonOptions: SalespersonOption[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of customers) {
      const names = c.salesPersons && c.salesPersons.length ? c.salesPersons : [c.salesPerson || "Others"];
      for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, customerCount]) => ({ name, customerCount }))
      .sort((a, b) => b.customerCount - a.customerCount);
  }, [customers]);

  const salespersonNames = useMemo(
    () => salespersonOptions.map(o => o.name),
    [salespersonOptions],
  );

  const handleConsolidated = () => {
    if (customers.length === 0) {
      toast({ title: "Nothing to export", description: "No customers match the current filters.", variant: "destructive" });
      return;
    }
    try {
      const filename = downloadConsolidated(customers, filters, asOfDate);
      toast({ title: "Report downloaded", description: filename });
    } catch (err) {
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openShare = (channel: ShareChannel) => {
    if (salespersonOptions.length === 0) {
      toast({ title: "No salespersons available", description: "Apply filters that include at least one salesperson.", variant: "destructive" });
      return;
    }
    setShareChannel(channel);
    setShareOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-button border-border">
            <Share2 className="h-4 w-4 mr-2" />
            Share / Download
            <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Download (reflects current filters)
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={handleConsolidated} className="cursor-pointer">
            <FileSpreadsheet className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm">Consolidated Report</span>
              <span className="text-[11px] text-muted-foreground">All salespersons · Excel</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPickerOpen(true)} className="cursor-pointer">
            <Users className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm">Individual Salesperson Report(s)…</span>
              <span className="text-[11px] text-muted-foreground">Pick one or more · Excel or Zip</span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Share (after downloading)
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => openShare("email")} className="cursor-pointer">
            <Mail className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm">Email draft (Mailto)…</span>
              <span className="text-[11px] text-muted-foreground">Opens your email client</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openShare("whatsapp")} className="cursor-pointer">
            <MessageCircle className="h-4 w-4 mr-2 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm">WhatsApp message…</span>
              <span className="text-[11px] text-muted-foreground">Opens WhatsApp Web / app</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SalespersonPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        options={salespersonOptions}
        customers={customers}
        filters={filters}
        asOfDate={asOfDate}
      />

      <SharePromptDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        channel={shareChannel}
        salespersons={salespersonNames}
        asOfDate={asOfDate}
      />
    </>
  );
}
