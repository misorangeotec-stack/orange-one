import { useMemo } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import KpiRow, { type KpiTile } from "@/shared/components/dashboard/KpiRow";
import { formatDateDMY } from "@/shared/lib/date";
import { useTravelStore } from "../../store";
import { money } from "../../lib/format";
import type { ClaimLine, Trip } from "../../types";

/**
 * The GST input credit sitting inside travel claims.
 *
 * ⚠ THIS IS MONEY CURRENTLY LEFT ON THE TABLE, and it is not in the source PRD.
 *   §11.3 wants vendor invoices in the company's name so the input credit can be
 *   claimed; nothing in the business has ever been able to list what that credit
 *   came to, so nobody claims it. Every rupee in the "Credit claimable" tile is
 *   real money the company is entitled to and has not been asking for.
 *
 * ⚠ A LINE WITH NO VENDOR GSTIN IS NOT CREDIT — it is a lost credit, and it is
 *   listed separately rather than dropped. The whole value of this report to
 *   Finance is the second list: those are the vendors to go back to, and the
 *   travellers to remind.
 *
 * ⚠ IT COUNTS ONLY WHAT WAS ACTUALLY SETTLED. Tax on a disallowed portion is not
 *   claimable either, so the credit is apportioned to the settled share of the
 *   line — a ₹2,750 hotel bill capped at ₹1,750 carries its GST in the same
 *   proportion. Claiming the whole tax on a partly-disallowed bill would be
 *   overstating the credit.
 *
 * ⚠ H8 — THE COMPANY GSTIN IS STILL UNKNOWN, and the screen says so rather than
 *   printing a placeholder. §7.1 and §11.3 both carry it as "[⚠ CONFIRM with
 *   Finance]". Without it, hotels are billing employees personally and the
 *   credit is lost at source, which is a bigger number than anything below.
 */

interface Row {
  id: string;
  trip: Trip;
  line: ClaimLine;
  categoryName: string;
  /** The share of the line that was actually settled, 0..1. */
  share: number;
  /** GST apportioned to the settled share. */
  claimable: number;
}

export default function GstItcRegister() {
  const s = useTravelStore();
  const companyGstin = s.config.companyIdentity.gstin;

  const rows = useMemo<Row[]>(() => {
    const catName = new Map(s.expenseCategories.map((c) => [c.id, c.name]));
    const tripById = new Map(s.trips.map((t) => [t.id, t]));
    const out: Row[] = [];

    for (const l of s.claimLines) {
      if (l.gstAmount <= 0) continue;
      const trip = tripById.get(l.tripId);
      if (!trip) continue;

      const settled = l.financeAmount ?? l.allowedAmount ?? 0;
      const share = l.amount > 0 ? Math.min(settled / l.amount, 1) : 0;

      out.push({
        id: l.id,
        trip,
        line: l,
        categoryName: l.categoryId ? (catName.get(l.categoryId) ?? "—") : "—",
        share,
        claimable: l.gstin ? Math.round(l.gstAmount * share * 100) / 100 : 0,
      });
    }
    return out;
  }, [s.claimLines, s.trips, s.expenseCategories]);

  const withGstin = rows.filter((r) => !!r.line.gstin);
  const without = rows.filter((r) => !r.line.gstin);
  const claimable = withGstin.reduce((sum, r) => sum + r.claimable, 0);
  const lost = without.reduce((sum, r) => sum + r.line.gstAmount, 0);
  const vendors = new Set(withGstin.map((r) => r.line.gstin)).size;

  const tiles: KpiTile[] = [
    {
      key: "claimable",
      label: "Credit claimable",
      value: money(claimable),
      hint: `${withGstin.length} invoice${withGstin.length === 1 ? "" : "s"} carrying a vendor GSTIN`,
    },
    {
      key: "lost",
      label: "Credit lost",
      value: money(lost),
      hint: `${without.length} line${without.length === 1 ? "" : "s"} with tax but no GSTIN`,
      tone: lost > 0 ? "red" : undefined,
    },
    { key: "vendors", label: "Vendors", value: String(vendors), hint: "Distinct GSTINs on file" },
    {
      key: "gstin",
      label: "Company GSTIN",
      value: companyGstin || "Not recorded",
      hint: companyGstin
        ? "Give this to every hotel and vendor"
        : "H8 — until Finance confirms it, invoices are being raised personally and the credit is lost at source",
      tone: companyGstin ? undefined : "red",
    },
  ];

  const columns = useMemo<QueueColumn<Row>[]>(
    () => [
      {
        key: "date",
        header: "Invoice date",
        alwaysVisible: true,
        cell: (r) => (r.line.spentOn ? formatDateDMY(r.line.spentOn) : "—"),
        sortValue: (r) => r.line.spentOn ?? "",
        filter: { kind: "date", get: (r) => r.line.spentOn ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "vendor",
        header: "Vendor",
        cell: (r) => r.line.vendor ?? "—",
        sortValue: (r) => r.line.vendor ?? "",
        filter: { kind: "select", get: (r) => r.line.vendor ?? "—" },
      },
      {
        key: "gstin",
        header: "Vendor GSTIN",
        cell: (r) =>
          r.line.gstin ? (
            <span className="font-mono text-[12px]">{r.line.gstin}</span>
          ) : (
            <span className="font-semibold text-ryg-amber">Not on the invoice</span>
          ),
        sortValue: (r) => r.line.gstin ?? "",
        filter: { kind: "select", get: (r) => (r.line.gstin ? "On file" : "Missing") },
        exportValue: (r) => r.line.gstin ?? "",
      },
      {
        key: "invoice",
        header: "Invoice no",
        cell: (r) => r.line.invoiceNo ?? "—",
        sortValue: (r) => r.line.invoiceNo ?? "",
        filter: { kind: "text", get: (r) => r.line.invoiceNo ?? "" },
      },
      {
        key: "category",
        header: "Category",
        cell: (r) => r.categoryName,
        sortValue: (r) => r.categoryName,
        filter: { kind: "select", get: (r) => r.categoryName },
      },
      {
        key: "trip",
        header: "Trip",
        cell: (r) => (
          <Link
            to={`/travel-desk/trips/${r.trip.id}`}
            className="font-semibold text-navy hover:text-orange hover:underline"
          >
            {r.trip.tripNo ?? "—"}
          </Link>
        ),
        sortValue: (r) => r.trip.tripNo ?? "",
        filter: { kind: "text", get: (r) => r.trip.tripNo ?? "" },
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "traveller",
        header: "Traveller",
        cell: (r) => r.trip.travellerName,
        sortValue: (r) => r.trip.travellerName,
        filter: { kind: "select", get: (r) => r.trip.travellerName },
      },
      {
        key: "gross",
        header: "Invoice total",
        cell: (r) => money(r.line.amount),
        sortValue: (r) => r.line.amount,
        exportValue: (r) => r.line.amount,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "tax",
        header: "Tax on invoice",
        cell: (r) => money(r.line.gstAmount),
        sortValue: (r) => r.line.gstAmount,
        exportValue: (r) => r.line.gstAmount,
        tdClassName: "whitespace-nowrap text-right",
      },
      {
        key: "share",
        header: "Settled share",
        cell: (r) =>
          r.share >= 1 ? (
            <span className="text-grey-2">All of it</span>
          ) : (
            <span className="text-ryg-amber">{Math.round(r.share * 100)}%</span>
          ),
        sortValue: (r) => r.share,
        filter: { kind: "select", get: (r) => (r.share >= 1 ? "All of it" : "Part disallowed") },
        exportValue: (r) => Math.round(r.share * 100),
        tdClassName: "whitespace-nowrap",
      },
      {
        key: "claimable",
        header: "Credit claimable",
        cell: (r) =>
          r.claimable > 0 ? (
            <span className="font-semibold text-navy">{money(r.claimable)}</span>
          ) : (
            <span className="text-grey-2">—</span>
          ),
        sortValue: (r) => r.claimable,
        exportValue: (r) => r.claimable,
        tdClassName: "whitespace-nowrap text-right",
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-bold text-navy">GST input credit register</h1>
        <p className="text-[13px] text-grey">
          Every travel invoice carrying tax, and what of it the company can actually claim back
          (§11.3). The tax is apportioned to the share of the line that was settled — claiming the
          whole of it on a partly disallowed bill would overstate the credit.
        </p>
      </div>

      <KpiRow tiles={tiles} />

      {!companyGstin && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold text-navy">
            The company GSTIN is not recorded (H8)
          </div>
          <p className="mt-1 text-[12.5px] text-grey-2">
            §7.1 and §11.3 both carry it as <em>&ldquo;[⚠ CONFIRM with Finance]&rdquo;</em>. Until
            it is set in Settings, the Travel Authorisation cannot tell travellers what number to
            give a hotel — so invoices are being raised in the employee&rsquo;s name and the credit
            is lost before it reaches this register. That is a larger figure than anything in the
            table below, and it is not measurable from here.
          </p>
        </Card>
      )}

      {lost > 0 && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold text-navy">
            {money(lost)} of tax has no vendor GSTIN against it
          </div>
          <p className="mt-1 text-[12.5px] text-grey-2">
            These invoices charged tax but do not record who charged it, so none of it can be
            claimed. Filter the GSTIN column to <strong>Missing</strong> for the list to go back to.
          </p>
        </Card>
      )}

      <QueueTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        rowsLabel="invoices"
        emptyTitle="No tax recorded on any claim yet"
        emptyMessage="A line appears here as soon as somebody records a GST amount on a receipt. Nothing to claim is not the same as nothing to see — if travel invoices are arriving with tax on them and this list is empty, the tax is not being captured."
        loading={s.isLoading}
        initialSort={{ key: "date", dir: "desc" }}
        exportName="Travel_GST_ITC_Register"
        columnPicker={{ storageKey: "travel-report-itc" }}
      />
    </div>
  );
}
