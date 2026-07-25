import Card from "@/shared/components/ui/Card";
import Kpi from "@/shared/components/ui/Kpi";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { inr } from "../../lib/format";
import type { MoneySummary as MoneySummaryData } from "../../lib/dashboardMetrics";

/**
 * Value over the LIVE POs, INR roll-up. Multi-currency by nature, so we show one
 * INR headline per metric and deliberately omit an FX total (summing $ + € would
 * mislead). Zero-state falls out for free — every tile reads `₹0`.
 */
export default function MoneySummary({ data }: { data: MoneySummaryData }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="border-b border-line pb-2">
        <h3 className={SECTION_HEADING_CLASS}>Value</h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
        <Kpi label="Value in flight" value={inr(data.inFlight)} hint="live POs" size="md" />
        <Kpi label="Advance pending" value={inr(data.advancePending)} hint="unpaid on live POs" size="md" />
        <Kpi label="Paid to vendors" value={inr(data.paid)} hint="on live POs" size="md" />
        <Kpi label="Booked in Tally (30d)" value={inr(data.bookedTally)} hint="PO value booked" size="md" />
      </div>
    </Card>
  );
}
