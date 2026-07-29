import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { addDaysIso } from "@/shared/lib/dueBuckets";
import { useAssetStore } from "../../store";
import { dmy, duePhrase, frequencyLabel } from "../../lib/format";
import { liveTracks } from "../../lib/schedules";

/**
 * The four questions people actually ask of an asset register, each as one
 * download. Deliberately exports rather than on-screen tables: every one of these
 * ends up in a meeting, a renewal file or an audit pack.
 */
export default function Reports() {
  const s = useAssetStore();
  const today = s.todayIso;

  const tracks = useMemo(
    () => s.assets.filter((a) => a.active).flatMap((a) => liveTracks(a.schedules).map((t) => ({ a, t }))),
    [s.assets],
  );

  const exportRegister = () => {
    exportRowsToXlsx({
      fileName: "Asset_Register",
      sheetName: "Assets",
      title: "Asset register",
      rows: s.assets,
      columns: [
        { header: "Asset no.", value: (a) => a.assetNo },
        { header: "Name", value: (a) => a.name },
        { header: "Category", value: (a) => s.masterName("category", a.categoryId) },
        { header: "Make", value: (a) => s.masterName("make", a.makeId) },
        { header: "Model", value: (a) => a.model ?? "" },
        { header: "Serial / reg. no.", value: (a) => a.serialNo ?? "" },
        { header: "Company", value: (a) => s.masterName("company", a.companyId) },
        { header: "Location", value: (a) => s.masterName("location", a.locationId) },
        { header: "Department", value: (a) => s.departments.find((d) => d.id === a.departmentId)?.name ?? "" },
        { header: "Custodian", value: (a) => s.personName(a.custodianUserId) },
        { header: "Condition", value: (a) => s.masterName("condition", a.conditionId) },
        { header: "Purchase date", value: (a) => (a.purchaseDate ? dmy(a.purchaseDate) : "") },
        { header: "Purchase cost", value: (a) => a.purchaseCost ?? "" },
        { header: "Bought from", value: (a) => s.masterName("vendor", a.vendorId) },
        { header: "Invoice no.", value: (a) => a.invoiceNo ?? "" },
        { header: "Warranty months", value: (a) => a.warrantyMonths ?? "" },
        { header: "Tracks", value: (a) => liveTracks(a.schedules).length },
        { header: "Status", value: (a) => (a.active ? "In use" : `Retired ${dmy(a.retiredOn)}`) },
      ],
      notes: [
        "One row per asset. 'Tracks' counts the ACTIVE, dated schedules driving its reminders — an asset with 0 is invisible to the reminder engine.",
      ],
    });
  };

  const exportUpcoming = () => {
    const rows = [...tracks].sort((x, z) =>
      (x.t.nextDueDate as string).localeCompare(z.t.nextDueDate as string));
    exportRowsToXlsx({
      fileName: "Asset_Upcoming_Due",
      sheetName: "Upcoming",
      title: "Upcoming services and renewals",
      rows,
      columns: [
        { header: "Due on", value: (r) => dmy(r.t.nextDueDate) },
        { header: "Status", value: (r) => duePhrase(r.t.nextDueDate, today) },
        { header: "What", value: (r) => s.scheduleTypeName(r.t.scheduleTypeId) },
        { header: "Asset no.", value: (r) => r.a.assetNo },
        { header: "Asset", value: (r) => r.a.name },
        { header: "Serial / reg. no.", value: (r) => r.a.serialNo ?? "" },
        { header: "Category", value: (r) => s.masterName("category", r.a.categoryId) },
        { header: "Location", value: (r) => s.masterName("location", r.a.locationId) },
        { header: "Custodian", value: (r) => s.personName(r.a.custodianUserId) },
        { header: "Repeats", value: (r) => frequencyLabel(r.t.frequencyValue, r.t.frequencyUnit) },
        { header: "Reminds days ahead", value: (r) => r.t.leadDays },
        { header: "Last done", value: (r) => (r.t.lastDoneDate ? dmy(r.t.lastDoneDate) : "") },
        { header: "Reference", value: (r) => r.t.refNo ?? "" },
        { header: "Provider", value: (r) => r.t.provider ?? "" },
        { header: "Amount", value: (r) => r.t.amount ?? "" },
      ],
      notes: [
        "Every ACTIVE, dated track on an in-use asset, soonest first — including ones whose service job has not opened yet.",
        `Generated ${dmy(today)}.`,
      ],
    });
  };

  const exportHistory = () => {
    const rows = s.jobs.filter((j) => j.sdActualDate);
    exportRowsToXlsx({
      fileName: "Asset_Service_History",
      sheetName: "Services",
      title: "Service history",
      rows,
      columns: [
        { header: "Job no.", value: (j) => j.jobNo },
        { header: "Asset no.", value: (j) => s.assetById(j.assetId)?.assetNo ?? "" },
        { header: "Asset", value: (j) => s.assetById(j.assetId)?.name ?? "" },
        { header: "What", value: (j) => s.scheduleTypeName(j.scheduleTypeId) },
        { header: "Due on", value: (j) => (j.dueDate ? dmy(j.dueDate) : "") },
        { header: "Carried out on", value: (j) => (j.sdActualDate ? dmy(j.sdActualDate) : "") },
        {
          header: "Days late",
          value: (j) =>
            j.dueDate && j.sdActualDate
              ? Math.max(0, Math.round(
                  (new Date(`${j.sdActualDate}T00:00:00`).getTime()
                    - new Date(`${j.dueDate}T00:00:00`).getTime()) / 86400000))
              : "",
        },
        { header: "Vendor", value: (j) => s.vendorName(j.sdVendorId ?? j.scVendorId) },
        { header: "Cost", value: (j) => j.sdCost ?? "" },
        { header: "Cost head", value: (j) => s.masterName("cost_head", j.sdCostHeadId) },
        { header: "Bill no.", value: (j) => j.sdBillNo ?? "" },
        { header: "Outcome", value: (j) => j.vcOutcome ?? "" },
        { header: "Status", value: (j) => j.status },
        { header: "Recorded by", value: (j) => s.personName(j.sdBy) },
      ],
      notes: [
        "Only jobs where a service was actually recorded. 'Days late' is against the job's own due date, floored at 0.",
      ],
    });
  };

  const exportCost = () => {
    const done = s.jobs.filter((j) => j.sdActualDate && j.sdCost !== null);
    const byAsset = new Map<string, { count: number; total: number }>();
    for (const j of done) {
      const cur = byAsset.get(j.assetId) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += j.sdCost ?? 0;
      byAsset.set(j.assetId, cur);
    }
    const rows = [...byAsset.entries()].map(([assetId, v]) => ({ assetId, ...v }))
      .sort((a, b) => b.total - a.total);

    exportRowsToXlsx({
      fileName: "Asset_Service_Cost",
      sheetName: "Cost by asset",
      title: "Service cost by asset",
      rows,
      columns: [
        { header: "Asset no.", value: (r) => s.assetById(r.assetId)?.assetNo ?? "" },
        { header: "Asset", value: (r) => s.assetById(r.assetId)?.name ?? "" },
        { header: "Category", value: (r) => s.masterName("category", s.assetById(r.assetId)?.categoryId ?? null) },
        { header: "Location", value: (r) => s.masterName("location", s.assetById(r.assetId)?.locationId ?? null) },
        { header: "Services recorded", value: (r) => r.count },
        { header: "Total spend", value: (r) => r.total },
        { header: "Average", value: (r) => (r.count ? Math.round(r.total / r.count) : 0) },
        { header: "Purchase cost", value: (r) => s.assetById(r.assetId)?.purchaseCost ?? "" },
      ],
      notes: [
        "Only jobs with a cost recorded. An asset whose running cost approaches its purchase cost is usually the one to replace.",
      ],
    });
  };

  const in30 = addDaysIso(today, 30);
  const dueSoon = tracks.filter((r) => (r.t.nextDueDate as string) <= in30).length;
  const serviced = s.jobs.filter((j) => j.sdActualDate).length;
  const costed = s.jobs.filter((j) => j.sdCost !== null).length;

  const cards = [
    {
      title: "Asset register",
      body: "Everything owned, with its custodian, location, purchase details and how many tracks drive its reminders.",
      count: `${s.assets.length} assets`,
      action: exportRegister,
    },
    {
      title: "Upcoming services and renewals",
      body: "Every dated track, soonest first — including the ones whose job has not opened yet. This is the one to take into a renewals meeting.",
      count: `${dueSoon} due within 30 days`,
      action: exportUpcoming,
    },
    {
      title: "Service history",
      body: "Everything actually carried out, with how many days late it ran against its own due date.",
      count: `${serviced} services recorded`,
      action: exportHistory,
    },
    {
      title: "Service cost by asset",
      body: "What each asset has cost to keep running, against what it cost to buy.",
      count: `${costed} jobs with a cost`,
      action: exportCost,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Reports</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Each one downloads as an Excel workbook with an “About this export” sheet.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.title} className="flex flex-col justify-between gap-4 p-5">
            <div>
              <SectionHeading>{c.title}</SectionHeading>
              <p className="mt-2 text-[13px] text-grey">{c.body}</p>
              <p className="mt-2 text-[12.5px] font-semibold text-navy">{c.count}</p>
            </div>
            <div><Button size="sm" onClick={c.action}>Export</Button></div>
          </Card>
        ))}
      </div>
    </div>
  );
}
