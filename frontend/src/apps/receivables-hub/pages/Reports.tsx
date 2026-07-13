import { useNavigate } from "react-router-dom";
import { CalendarClock, FileText, ArrowRight, HandCoins, UserX, Percent as PercentIcon, AlarmClock, PackageX } from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Card, CardContent } from "@hub/components/ui/card";

/* ── Report catalogue ──────────────────────────────────────────
 * One card per report. The Aging Report is live; more cards land here
 * over time (set `to` + `ready: true` when each is built). */

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  to?: string;
  ready: boolean;
}

const REPORTS: ReportCard[] = [
  {
    id: "aging",
    title: "Aging Report",
    description:
      "Outstanding split by invoice age (< 180 / > 180) and overdue split by days-past-due brackets — grouped by sale type, customer or salesperson, with stacked grouping.",
    icon: CalendarClock,
    to: "/outstanding-dashboard/reports/aging",
    ready: true,
  },
  {
    id: "other-payments",
    title: "Other Payments Report",
    description:
      "Manual (non-Tally) payments applied against invoices or booked on account — grouped by salesperson or customer, with against-invoice vs on-account split and styled Excel export.",
    icon: HandCoins,
    to: "/outstanding-dashboard/reports/other-payments",
    ready: true,
  },
  // Two cards, one page. Zero collection is the 0% case of the threshold report, so both
  // open pages/CollectionPerformanceReport at a different ?below= — see lib/collections.ts.
  {
    id: "zero-collections",
    title: "Customers with Zero Collections",
    description:
      "Customers who owe money and paid nothing in the period — ranked by outstanding, flagged when we're still billing them. Never-paid and still-buying counts, drill-down to open bills, Excel export.",
    icon: UserX,
    to: "/outstanding-dashboard/reports/collections?below=0",
    ready: true,
  },
  {
    id: "low-collections",
    title: "Customers Below 30% Collection",
    description:
      "Customers who collected less than 30% of what we could have collected (opening outstanding + sales billed). Shortfall in rupees, severity bands, prior-period comparison, and bounced-cheque and still-buying flags.",
    icon: PercentIcon,
    to: "/outstanding-dashboard/reports/collections?below=30",
    ready: true,
  },
  // The cutoff is switchable on the page (90 / 120 / 180 / custom, via ?over=) — this card is
  // just the one management asked for. See lib/overdueAging.ts.
  {
    id: "overdue-aging",
    title: "Customers Overdue Over 120 Days",
    description:
      "Customers with money stuck on bills more than 120 days past due — ranked on the aged amount alone, split into opening debt brought forward vs debt billed since, with the 180+ slice, still-buying flags, bill-level drill-down and an aged-bill Excel sheet to chase.",
    icon: AlarmClock,
    to: "/outstanding-dashboard/reports/overdue?over=120",
    ready: true,
  },
  // The third report on the collections engine — but it asks the SALES question: not "who
  // isn't paying" but "who has stopped buying and still owes us". See lib/collections.ts.
  {
    id: "dormant-debtors",
    title: "Customers with Dues but No Sales",
    description:
      "Dormant accounts — they owe money but have billed nothing in the period. Opens on the last 6 months, excluding one-time machine sales (switchable), ranked by the cash stuck in them, with months-since-last-sale, a \"paid nothing either\" lens for the dead-and-stuck, a \"recently gone quiet\" lens for the ones still worth a call, drill-down to open bills and Excel export.",
    icon: PackageX,
    to: "/outstanding-dashboard/reports/dormant",
    ready: true,
  },
];

export default function Reports() {
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6 max-w-[1180px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Reports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Detailed, drillable receivables reports. Pick a report to open it.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <Card
            key={r.id}
            onClick={r.ready && r.to ? () => navigate(r.to as string) : undefined}
            className={`rounded-card border transition-all ${
              r.ready
                ? "border-border bg-surface cursor-pointer hover:border-primary/40 hover:shadow-md"
                : "border-dashed border-border bg-muted/30 opacity-70"
            }`}
          >
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div className={`w-10 h-10 rounded-button flex items-center justify-center ${r.ready ? "bg-primary/15" : "bg-muted"}`}>
                  <r.icon className={`h-5 w-5 ${r.ready ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                {r.ready ? (
                  <ArrowRight className="h-5 w-5 text-primary" />
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button uppercase bg-muted text-muted-foreground border-border">
                    Coming soon
                  </Badge>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{r.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
