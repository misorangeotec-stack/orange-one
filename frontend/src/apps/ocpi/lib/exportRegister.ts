import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { STATUS_LABEL, dmy } from "./format";
import { signedPages } from "./signatures";
import type { OcpiDeal, OcpiMachine } from "../types";

/**
 * The Deal Register — the spreadsheet that replaces "ask Bushra which stage it
 * is at".
 *
 * ⚠ ONE ROW PER DEAL, and unlike Order to Dispatch's register that is genuinely
 *   correct rather than a simplification: a deal is one model, one customer and
 *   one order confirmation from first draft to Finance receipt. Quotation
 *   REVISIONS are the one thing that repeats, and they are summarised as a count
 *   plus the date of the latest — the full before/after trail is the revision
 *   history on the deal, which is a reading task, not a spreadsheet column.
 *
 * ⚠ THE MONEY COLUMNS ARE NUMBERS, NOT FORMATTED STRINGS, so the reader can sum
 *   and sort them. That means the CURRENCY has to be its own column: a sheet
 *   with a dollar deal and a rupee deal in one numeric column, and no way to
 *   tell which is which, would be worse than no total at all.
 *
 * ⚠ NOTHING HERE IS DERIVED A SECOND TIME. Status wording comes from
 *   STATUS_LABEL — the same map every screen reads — and the signed-page counts
 *   from `signedPages`, so the register cannot say a contract has one page while
 *   the deal page shows five.
 */

export interface RegisterDeps {
  machineById: (id: string | null) => OcpiMachine | undefined;
  companyName: (id: string | null) => string;
  personName: (id: string | null) => string;
}

export function exportDealRegister(
  deals: OcpiDeal[],
  deps: RegisterDeps,
  filters: string[] = [],
): void {
  const machine = (d: OcpiDeal) => deps.machineById(d.machineId)?.name ?? "";

  const columns: ExportColumn<OcpiDeal>[] = [
    { header: "Quotation No.", width: 14, value: (d) => d.quotationNo ?? "" },
    { header: "OC No.", width: 20, value: (d) => d.ocNo ?? "" },
    { header: "Status", width: 30, value: (d) => STATUS_LABEL[d.status] },
    { header: "Raised", width: 13, value: (d) => dmy(d.createdAt) },
    { header: "Customer", width: 30, value: (d) => d.customerName ?? "" },
    { header: "Contact", width: 20, value: (d) => d.customerAttn ?? "" },
    { header: "Mobile", width: 14, value: (d) => d.customerMobile ?? "" },
    { header: "Email", width: 24, value: (d) => d.customerEmail ?? "" },
    { header: "GSTIN", width: 18, value: (d) => d.gstNo ?? "" },
    { header: "Selling entity", width: 26, value: (d) => deps.companyName(d.companyId) },
    { header: "Salesperson", width: 20, value: (d) => d.salespersonName ?? "" },
    { header: "Raised by", width: 20, value: (d) => deps.personName(d.raisedBy) },
    { header: "Machine", width: 30, value: (d) => machine(d) },
    { header: "Machines", width: 9, value: (d) => d.machineCount ?? "" },
    { header: "Print heads", width: 11, value: (d) => d.headCount ?? "" },
    // See the header: the figure and the unit it is in are two columns on
    // purpose, so the numeric column can be summed without lying.
    { header: "Currency", width: 9, value: (d) => d.dealValueCurrency ?? "" },
    { header: "Deal value", width: 15, value: (d) => d.dealValueAmount ?? "" },
    // A dollar deal is contracted in rupees, at a rate frozen onto the revision
    // it was issued under. Without both columns the sheet cannot reproduce its
    // own arithmetic, and somebody re-converting at today's rate gets a
    // different total from the one on the customer's contract.
    { header: "USD rate", width: 11, value: (d) => d.fxRate ?? "" },
    { header: "Deal value (INR)", width: 16, value: (d) => d.dealValueInr ?? "" },
    { header: "Machine value (INR)", width: 17, value: (d) => d.machineValueInr ?? "" },
    { header: "GST (INR)", width: 14, value: (d) => d.gstAmountInr ?? "" },
    { header: "Total (INR)", width: 15, value: (d) => d.totalInr ?? "" },
    { header: "Payment terms", width: 24, value: (d) => d.paymentTerms ?? "" },
    { header: "Delivery term", width: 16, value: (d) => d.tradeTerm ?? "" },
    { header: "Delivery days", width: 13, value: (d) => d.deliveryDays ?? "" },
    { header: "Delivery date", width: 13, value: (d) => dmy(d.deliveryDate) },
    { header: "Revisions", width: 10, value: (d) => d.quotationVersionNo },
    { header: "Sent back", width: 10, value: (d) => d.reworkCount },
    { header: "Sent for approval", width: 15, value: (d) => dmy(d.qsAt) },
    { header: "Quotation approved", width: 16, value: (d) => dmy(d.qaAt) },
    // ⚠ "OC issued" IS THE APPROVAL now, not a later step. The column kept its
    //   underlying field and changed its name, because the field changed meaning
    //   at the stage-E cutover and a header saying "OC submitted" would date a
    //   step that no longer runs.
    { header: "OC issued", width: 14, value: (d) => dmy(d.ocAt) },
    { header: "OC confirmed (retired step)", width: 22, value: (d) => dmy(d.ocaAt) },
    { header: "Customer signed", width: 14, value: (d) => dmy(d.csAt) },
    { header: "Countersigned", width: 14, value: (d) => dmy(d.msAt) },
    // Where the signed paper actually went — the question the old register could
    // not answer at all, because countersigning closed the deal.
    { header: "Handed to Finance", width: 16, value: (d) => dmy(d.fhAt) },
    { header: "Handed over by", width: 20, value: (d) => deps.personName(d.fhBy) },
    { header: "Finance received", width: 16, value: (d) => dmy(d.frAt) },
    { header: "Received by", width: 20, value: (d) => deps.personName(d.frBy) },
    {
      header: "Signed pages",
      width: 12,
      value: (d) =>
        signedPages(d, "customer-signed").length + signedPages(d, "management-signed").length,
    },
    {
      header: "Why it stopped",
      width: 40,
      // One column for three different endings, because a reader scanning for
      // "what happened to this one" does not care which field it was stored in.
      value: (d) => d.cancelReason ?? d.rejectReason ?? d.holdReason ?? "",
    },
  ];

  exportRowsToXlsx<OcpiDeal>({
    fileName: "OCPI_Deal_Register",
    sheetName: "Deals",
    title: "OCPI — Deal Register",
    columns,
    rows: deals,
    filters,
    notes: [
      "One row per deal, from the first draft to Finance confirming they have the signed contract.",
      "Deal value is the figure quoted to the customer and may be in USD — read the Currency column beside it. On a dollar deal, USD rate and Deal value (INR) are the conversion the contract was actually issued at, frozen at that revision. Machine value, GST and Total are always rupees, and are what the order confirmation printed.",
      "Handed to Finance and Finance received are the two halves of the handover; they are always different people, because one person cannot record both.",
      "OC confirmed dates a step that was retired when the order confirmation was merged into the quotation. It is populated only on deals raised before that change.",
      "Revisions counts generated quotation versions; the number itself never changes across them. Sent back counts times a step was returned for changes.",
      "Signed pages is the total scanned pages held for both signatures — a contract with fewer pages than the printed document is worth opening.",
      "Drafts are included only when the person running the export raised them; a draft is private to its author.",
    ],
  });
}
