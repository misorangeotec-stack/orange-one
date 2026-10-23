import BackLink from "@/shared/components/ui/BackLink";
import { Link, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import ServiceCheckPanel from "../../components/ServiceCheckPanel";
import { useOcpiStore } from "../../store";
import { dealRef } from "../../lib/queues";
import { dmy } from "../../lib/format";

/**
 * What the service team sees when they open a deal from the Service Check queue.
 *
 * ⚠ CUSTOMER AND MACHINE ONLY, ON PURPOSE. No deal value, no payment or
 *   commercial terms, no rates, no signed scans or PDFs — the client asked that
 *   the service team is not shown the money or the attachments. The full deal
 *   page stays for everyone else; the queue's Open lands here instead.
 */
export default function ServiceCheckView() {
  const { id } = useParams();
  const s = useOcpiStore();
  const deal = s.deals.find((d) => d.id === id);

  if (!deal) {
    return (
      <Card className="p-5">
        <p className="text-[13.5px] text-grey">This deal could not be found.</p>
        <Link to="/ocpi/queues/service-check" className="mt-2 inline-block text-[13px] font-semibold text-orange">
          Back to Service Check
        </Link>
      </Card>
    );
  }

  const machine = deal.machineId ? s.machineById(deal.machineId) : undefined;
  const category = s.machineCategories.find((c) => c.id === deal.machineCategoryId)?.name;

  const customer: [string, string | null][] = [
    ["Customer", deal.customerName],
    ["Address", deal.customerAddress],
    ["GST", deal.gstNo],
    ["Contact person", deal.customerAttn],
    ["Mobile", deal.customerMobile],
    ["Email", deal.customerEmail],
    ["Salesperson", deal.salespersonName],
  ];

  const yes = (v: boolean | null, detail?: string | null) =>
    v === true ? (detail?.trim() ? `Yes — ${detail.trim()}` : "Yes") : v === false ? "No" : null;

  const machineRows: [string, string | null][] = [
    ["Machine", machine?.salesName || machine?.name || null],
    ["Category", category ?? null],
    ["No. of machines", deal.machineCount != null ? String(deal.machineCount) : null],
    ["Print head", [deal.headType, deal.headCount != null ? `${deal.headCount} heads` : null].filter(Boolean).join(" · ") || null],
    ["Ink type", deal.inkType],
    ["Dryer", deal.dryerName || deal.dryerType],
    ["Centering device", yes(deal.inclCentering, deal.centeringDetails)],
    ["Air blade", yes(deal.airBlade)],
    ["Ink dust exhauster", yes(deal.inkDustExhauster)],
    ["Chilling system", yes(deal.chillingSystem)],
    ["Ink included", yes(deal.inclInk, deal.inkQtyIncluded)],
    ["Spare parts included", yes(deal.inclSpares, deal.spareDetails)],
    ["Extra heads included", yes(deal.inclHead, deal.headsIncluded != null ? `${deal.headsIncluded} nos.` : null)],
    ["Tentative delivery", deal.deliveryDate ? dmy(deal.deliveryDate) : null],
  ];

  return (
    <div className="space-y-5">
      <div>
        <BackLink to="/ocpi/queues/service-check" label="Service Check" className="text-[13px] font-semibold text-grey-2 hover:text-orange" />
        <h1 className="mt-1 text-[22px] font-bold text-navy">{dealRef(deal)}</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">{deal.customerName}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Facts title="Customer details" rows={customer} />
        <Facts title="Machine details" rows={machineRows} />
      </div>

      <ServiceCheckPanel deal={deal} />
    </div>
  );
}

function Facts({ title, rows }: { title: string; rows: [string, string | null][] }) {
  const shown = rows.filter(([, v]) => v && v.trim());
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[15px] font-bold text-navy">{title}</h2>
      <dl className="space-y-2">
        {shown.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[150px_1fr] gap-3 text-[13.5px]">
            <dt className="font-semibold text-grey-2">{label}</dt>
            <dd className="whitespace-pre-line text-navy">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
