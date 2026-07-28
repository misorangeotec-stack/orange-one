/**
 * The completed-customer export.
 *
 * ⚠ THIS IS THE MODULE'S ONLY HAND-OFF, BY DESIGN.
 *   The completed request IS the customer record — nothing is pushed to
 *   Order-to-Dispatch or anywhere else (decided 28-Jul-2026, see the migration
 *   headers). So whoever needs this data — Tally, Dispatch, MIS — pulls it here.
 *   That makes the column set part of the contract: removing one silently breaks
 *   someone's spreadsheet downstream. Add freely; think before you take away.
 *
 * One row per customer, every step's fields on it, in the order the process
 * runs: who they are → KYC → contact → ink → potential → references → credit →
 * what each approver decided → the Tally record.
 *
 * Uses the shared exporter (not RequestTable's own) because that one exports the
 * columns on screen — eleven of them — which is the right behaviour for a table
 * view and the wrong one for a hand-off.
 */
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import {
  consumptionLabel, customerTypeLabel, dmy, liveStatusLabel, paymentTermsLabel,
  printingListLabel, securityLabel, statusLabel,
} from "./format";
import type { CustomerRequest } from "./types";

/** Blank, not "—": a dash is a reading aid on screen and dirt in a spreadsheet. */
const t = (v: string | null | undefined): string => v ?? "";
/** Numbers stay NUMBERS so the sheet can sum them. "" for absent, never 0. */
const n = (v: number | null | undefined): string | number => (v === null || v === undefined ? "" : v);
const b = (v: boolean | null | undefined): string => (v === null || v === undefined ? "" : v ? "Yes" : "No");
const d = (v: string | null | undefined): string => (v ? dmy(v) : "");

export function customerExportColumns(
  personName: (id: string | null | undefined) => string,
): ExportColumn<CustomerRequest>[] {
  return [
    { header: "Request No", width: 16, value: (r) => t(r.reqNo) },
    { header: "Customer Code", width: 14, value: (r) => t(r.customerCode) },
    { header: "Status", width: 14, value: (r) => statusLabel(r.status) },

    { header: "Legal Name", width: 34, value: (r) => t(r.legalName) },
    { header: "Trade Name", width: 26, value: (r) => t(r.tradeName) },
    { header: "Customer Type", width: 15, value: (r) => (r.customerType ? customerTypeLabel(r.customerType) : "") },
    { header: "Website", width: 24, value: (r) => t(r.website) },

    { header: "GST Number", width: 18, value: (r) => t(r.gstNumber) },
    { header: "PAN Number", width: 13, value: (r) => t(r.panNumber) },
    { header: "MSME / Udyam", width: 18, value: (r) => t(r.msmeUdyamNo) },
    { header: "Registered Address", width: 40, value: (r) => t(r.registeredAddress) },
    { header: "City", width: 16, value: (r) => t(r.city) },
    { header: "State", width: 18, value: (r) => t(r.stateName) },
    { header: "GST State Code", width: 12, value: (r) => t(r.stateCode) },
    { header: "Factory Address", width: 40, value: (r) => t(r.factoryAddress) },
    {
      header: "Billing Address", width: 40,
      value: (r) => (r.billingSameAsRegistered ? t(r.registeredAddress) : t(r.billingAddress)),
    },

    { header: "Contact Person", width: 24, value: (r) => t(r.contactName) },
    { header: "Designation", width: 20, value: (r) => t(r.contactDesignation) },
    // Text, not a number: Excel eats the leading zero of anything it can parse,
    // and a 10-digit mobile is exactly the shape it tries hardest to parse.
    { header: "Mobile", width: 14, value: (r) => t(r.contactMobile) },
    { header: "Email", width: 28, value: (r) => t(r.contactEmail) },

    { header: "Printing Applications", width: 30, value: (r) => (r.printingApplications.length ? printingListLabel(r.printingApplications) : "") },
    { header: "Other Application", width: 22, value: (r) => t(r.printingApplicationOther) },
    { header: "Current Ink Brand", width: 20, value: (r) => t(r.currentInkBrand) },
    { header: "Current Supplier", width: 22, value: (r) => t(r.currentSupplier) },
    { header: "Monthly Ink Consumption", width: 20, value: (r) => (r.monthlyInkConsumption ? consumptionLabel(r.monthlyInkConsumption) : "") },

    { header: "Est. Monthly Purchase", width: 18, value: (r) => n(r.estMonthlyPurchase) },
    { header: "Expected First Order", width: 18, value: (r) => n(r.expectedFirstOrder) },

    { header: "Reference 1 Company", width: 28, value: (r) => t(r.ref1Company) },
    { header: "Reference 1 Contact", width: 22, value: (r) => t(r.ref1Contact) },
    { header: "Reference 1 Mobile", width: 14, value: (r) => t(r.ref1Mobile) },
    { header: "Reference 2 Company", width: 28, value: (r) => t(r.ref2Company) },
    { header: "Reference 2 Contact", width: 22, value: (r) => t(r.ref2Contact) },
    { header: "Reference 2 Mobile", width: 14, value: (r) => t(r.ref2Mobile) },

    { header: "Payment Terms", width: 14, value: (r) => (r.paymentTerms ? paymentTermsLabel(r.paymentTerms) : "") },
    { header: "Requested Credit Limit", width: 18, value: (r) => n(r.requestedCreditLimit) },
    { header: "Requested Credit Days", width: 16, value: (r) => n(r.requestedCreditDays) },
    { header: "Security Offered", width: 16, value: (r) => (r.securityOffered ? securityLabel(r.securityOffered) : "") },
    { header: "Reason for Credit", width: 34, value: (r) => t(r.creditReason) },

    { header: "GST Verified", width: 12, value: (r) => b(r.accGstVerified) },
    { header: "References Verified", width: 15, value: (r) => b(r.accRefsVerified) },
    { header: "Recommended Limit", width: 18, value: (r) => n(r.accRecommendedLimit) },
    { header: "Recommended Days", width: 16, value: (r) => n(r.accRecommendedDays) },
    { header: "Accounts Remarks", width: 34, value: (r) => t(r.accRemarks) },
    { header: "Verified By", width: 22, value: (r) => (r.accVerifiedBy ? personName(r.accVerifiedBy) : "") },
    { header: "Verified On", width: 13, value: (r) => d(r.accVerifiedDate ?? r.accVerifiedAt) },

    { header: "Category", width: 9, value: (r) => t(r.shCustomerCategory) },
    { header: "Business Potential", width: 34, value: (r) => t(r.shBusinessPotential) },
    { header: "Sales Head Decision", width: 15, value: (r) => t(r.shDecision) },
    { header: "Sales Head Remarks", width: 34, value: (r) => t(r.shRemarks) },
    { header: "Approved By", width: 22, value: (r) => (r.shDecidedBy ? personName(r.shDecidedBy) : "") },
    { header: "Approved On", width: 13, value: (r) => d(r.shDecidedDate ?? r.shDecidedAt) },

    { header: "Director Required", width: 14, value: (r) => (r.dirRequired ? "Yes" : "No") },
    {
      header: "Why Director", width: 16,
      value: (r) => (!r.dirRequired ? "" : r.dirRequiredReason === "forced" ? "Escalated" : "Above threshold"),
    },
    { header: "Threshold Applied", width: 16, value: (r) => n(r.dirThresholdAtDecision) },
    { header: "Director Decision", width: 14, value: (r) => t(r.dirDecision) },
    { header: "Director Remarks", width: 34, value: (r) => t(r.dirRemarks) },
    { header: "Director", width: 22, value: (r) => (r.dirDecidedBy ? personName(r.dirDecidedBy) : "") },
    { header: "Director Decided On", width: 13, value: (r) => d(r.dirDecidedDate ?? r.dirDecidedAt) },

    { header: "Tally Ledger Created", width: 14, value: (r) => b(r.tallyLedgerCreated) },
    { header: "Tally Ledger Name", width: 30, value: (r) => t(r.tallyLedgerName) },
    { header: "Customer Status", width: 13, value: (r) => (r.customerStatus ? liveStatusLabel(r.customerStatus) : "") },
    { header: "Sales Executive", width: 22, value: (r) => t(r.assignedSalesExecName) },
    { header: "Created in Tally On", width: 14, value: (r) => d(r.tallyDate ?? r.tallyAt) },
    { header: "Recorded By", width: 22, value: (r) => (r.tallyBy ? personName(r.tallyBy) : "") },

    { header: "Raised By", width: 22, value: (r) => t(r.raisedByName) },
    { header: "Submitted On", width: 13, value: (r) => d(r.submittedAt) },
    { header: "Times Sent Back", width: 13, value: (r) => r.reworkCount },
  ];
}

export function exportCompletedCustomers(
  rows: CustomerRequest[],
  personName: (id: string | null | undefined) => string,
  filterLabel: string,
): void {
  exportRowsToXlsx<CustomerRequest>({
    fileName: "Customer_Onboarding",
    sheetName: "Customers",
    title: "Customer Onboarding — full record",
    columns: customerExportColumns(personName),
    rows,
    filters: [filterLabel, `${rows.length} customer${rows.length === 1 ? "" : "s"}`],
    notes: [
      "One row per onboarding request, carrying every step: the details Sales captured, what Accounts verified and recommended, how the sales head graded it, the Director's decision where one was needed, and the Tally record.",
      "Amounts are numbers, so they can be summed. Blank means the field was never filled in — it does not mean zero.",
      "Mobile numbers are stored as ten bare digits with no country code, and are exported as text so Excel cannot drop a leading digit.",
      "\"Threshold Applied\" is the Director threshold that was in force when the sales head approved, frozen onto the row. Changing the threshold today does not change it here.",
      "This export is the module's hand-off: nothing is written automatically to Order-to-Dispatch or any other system.",
    ],
  });
}
