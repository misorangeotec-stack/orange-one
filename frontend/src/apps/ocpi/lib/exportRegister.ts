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
  const billingName = (d: OcpiDeal) => deps.machineById(d.machineId)?.billingName ?? "";
  const yesNo = (v: boolean | null) => (v === null ? "" : v ? "Yes" : "No");

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
    // ⚠ BOTH NAMES (OCPI-3, stage I). "Machine" is the CODE the register has
    //   always carried; this is the product description the INVOICE will show,
    //   which is what somebody reconciling this register against Tally needs.
    //   Read from the machine, so it follows a re-description — unlike the
    //   contract, which keeps the name it was issued under.
    { header: "Billing name", width: 44, value: (d) => billingName(d) },
    { header: "Machines", width: 9, value: (d) => d.machineCount ?? "" },
    { header: "Print heads", width: 11, value: (d) => d.headCount ?? "" },
    { header: "Type of head", width: 26, value: (d) => d.headType ?? "" },
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
    /*
      ⚠ THE DRYER IS ITS OWN MONEY AND ITS OWN COLUMNS. It is NOT inside
        "Total (INR)", which is and always was the MACHINE total — so a register
        showing only that would understate what the customer was asked to pay on
        every deal where a dryer is sold outside the deal. "Grand total (INR)"
        below is the figure the customer pays.

      ⚠ THE PRICE IS IN THE DEAL’S CURRENCY and the rupee figure is beside it,
        for the same reason the machine has both: a numeric column mixing dollars
        and rupees with no way to tell which is which is worse than no column.
        All four are DERIVED server-side; the client settled the dryer’s GST on
        29-Aug-2026 — it applies, at the deal’s own rate.
    */
    { header: "Dryer category", width: 14, value: (d) => d.dryerType ?? "" },
    { header: "Dryer", width: 22, value: (d) => d.dryerName ?? "" },
    { header: "Dryer in deal", width: 12, value: (d) => yesNo(d.dryerIncluded) },
    /*
      ⚠ "Dryer price (deal currency)" IS GONE (OCPI-14). The form stopped asking
        it — all pricing is collected once, in Shipment & invoice — so the column
        would be blank on every deal raised from here on. The two DERIVED rupee
        figures below stay: they are null on a new deal and still carry the
        figures of any older one that recorded a price, and dropping them would
        lose that history from the only export that shows it.
    */
    { header: "Dryer value (INR)", width: 17, value: (d) => d.dryerValueInr ?? "" },
    { header: "Dryer GST (INR)", width: 15, value: (d) => d.dryerGstInr ?? "" },
    // What the customer actually pays: machine + its GST + dryer + its GST.
    // "Total (INR)" above is the MACHINE total and always was.
    { header: "Grand total (INR)", width: 17, value: (d) => d.grandTotalInr ?? "" },
    /*
      ⚠ SEPARATELY-INVOICED ITEMS, three columns each — billed separately, the
        quantity, and the amount. These were captured, stored and frozen from the
        revision onward and appeared in NO register column — the same gap the
        detailed sheet had. A finance reader reconciling invoices against this
        register could not see which deals would produce a second bill, or for
        how much.

      ⚠ ALL FOUR CARRY A QUANTITY, not just the head. The form asks it of every
        row and the contract's SHIPMENT & INVOICE table prints all four, so a
        register that exported the head's quantity alone would disagree with the
        paper it is meant to reconcile — on the three rows where a reader is most
        likely to be checking a second bill line by line.
    */
    /*
      ⚠ EACH ITEM EXPORTS FOUR COLUMNS, NOT THREE (OCPI-11). The sub-total is
        derived by fms_ocpi_write_oc, so exporting it costs nothing and saves the
        reader multiplying five pairs by hand to reconcile a second bill.

      🔴 NONE OF THE SUB-TOTALS BELONGS IN A DEAL TOTAL. They sit beside
        "Total (INR)" in this sheet, which is exactly where somebody eventually
        writes =SUM() across a row. A separately-invoiced item is billed on its
        own document; adding it to the contract value would count it twice.
    */
    { header: "Head invoiced separately", width: 19, value: (d) => yesNo(d.headSeparateInvoice) },
    { header: "Head invoice qty", width: 14, value: (d) => d.headInvoiceQty ?? "" },
    { header: "Head invoice amount", width: 18, value: (d) => d.headInvoiceAmount ?? "" },
    { header: "Head invoice sub-total", width: 20, value: (d) => d.headInvoiceSubtotal ?? "" },
    /* Ink that IS included and billed on its own document — NOT the subsidized
       columns further down, which are ink the deal does not include at all.
       Mode and route are left out to match the other four items: this register
       has never exported them for any row, and adding them for ink alone would
       make the sheet inconsistent rather than more complete. */
    { header: "Ink invoiced separately", width: 20, value: (d) => yesNo(d.inkSeparateInvoice) },
    { header: "Ink invoice qty", width: 14, value: (d) => d.inkInvoiceQty ?? "" },
    { header: "Ink invoice amount", width: 18, value: (d) => d.inkInvoiceAmount ?? "" },
    { header: "Ink invoice sub-total", width: 20, value: (d) => d.inkInvoiceSubtotal ?? "" },
    { header: "Dryer invoiced separately", width: 19, value: (d) => yesNo(d.dryerSeparateInvoice) },
    { header: "Dryer invoice qty", width: 14, value: (d) => d.dryerInvoiceQty ?? "" },
    { header: "Dryer invoice amount", width: 18, value: (d) => d.dryerInvoiceAmount ?? "" },
    { header: "Dryer invoice sub-total", width: 20, value: (d) => d.dryerInvoiceSubtotal ?? "" },
    { header: "Spares invoiced separately", width: 20, value: (d) => yesNo(d.sparesSeparateInvoice) },
    { header: "Spares invoice qty", width: 14, value: (d) => d.sparesInvoiceQty ?? "" },
    { header: "Spares invoice amount", width: 18, value: (d) => d.sparesInvoiceAmount ?? "" },
    { header: "Spares invoice sub-total", width: 20, value: (d) => d.sparesInvoiceSubtotal ?? "" },
    { header: "Centering invoiced separately", width: 22, value: (d) => yesNo(d.centeringSeparateInvoice) },
    { header: "Centering invoice qty", width: 16, value: (d) => d.centeringInvoiceQty ?? "" },
    { header: "Centering invoice amount", width: 20, value: (d) => d.centeringInvoiceAmount ?? "" },
    { header: "Centering invoice sub-total", width: 22, value: (d) => d.centeringInvoiceSubtotal ?? "" },
    /*
      ── The three warranties (OCPI-14) ──────────────────────────────────────

      Worth a column now and not before: until this change they were one
      company-wide SETTING applied to every deal, so a column would have printed
      the same two figures 20 times. They are per machine now — 15 of the 28
      models carry no head warranty at all — so they vary by row, which is the
      test for whether a register column earns its place.

      Frozen on the DEAL, prefilled from the machine master, so this is what was
      quoted rather than what the master says today.

      ⚠ THERE IS NO SPARE-PARTS WARRANTY COLUMN. The client's sheet reads "NA"
        for it on all 28 models, so there is nothing to export.

      ⚠ AND NO "Centering included" COLUMN, deliberately. This export has never
        carried ANY of the section-B inclusions — not ink, not spare parts, not
        the head, and not the tick the centering inclusion replaced. Adding one
        of them alone would be the inconsistency rather than the fix; if finance
        wants the inclusions they should arrive as a set.
    */
    { header: "Machine warranty", width: 16, value: (d) => d.printerWarranty ?? "" },
    { header: "Head warranty", width: 16, value: (d) => d.headWarranty ?? "" },
    { header: "Dryer warranty", width: 16, value: (d) => d.dryerWarranty ?? "" },
    /*
      ── The NO branch (OCPI-7) ──────────────────────────────────────────────

      What an item that is NOT in the deal was offered at instead. Same reason
      the separate-invoice pairs above exist: the deal records a commercial
      commitment and a reader reconciling it could not otherwise see it.

      ⚠ THE OPPOSITE OF THE COLUMNS DIRECTLY ABOVE, despite the similar words.
        "Head invoice qty" is a head that IS in the deal, billed on its own
        document. "Head subsidized qty" is a head the deal does NOT include, on
        an agreed rate. They are mutually exclusive on a row by construction.

      ⚠ THESE ARE NOT PART OF ANY TOTAL AND MUST NEVER BE SUMMED INTO ONE.
        They are placed here, at the far end of the sheet and nowhere near the
        deal-value block, precisely so no reader drags a contiguous numeric
        range into a sum. The question is only ever asked when the item is not
        in the deal, so this money is not the deal's money — adding it to a
        contract price would be a commercial error, not a display bug.

      ⚠ ALWAYS RUPEES, AND THE "Currency" COLUMN DOES NOT APPLY TO THEM. Every
        other money column on this sheet is in the deal's currency and is read
        together with that column; these four are rupees whatever the deal is
        quoted in, so their headers say INR outright. Reading them against
        "Currency" on a dollar deal would overstate them by the exchange rate.
    */
    { header: "Ink offered at subsidized rate", width: 22, value: (d) => yesNo(d.inkOfferAgreed) },
    { header: "Ink subsidized qty (litres)", width: 20, value: (d) => d.inkOfferQty ?? "" },
    { header: "Ink subsidized rate (INR/litre)", width: 22, value: (d) => d.inkOfferRate ?? "" },
    { header: "Ink subsidized price (INR)", width: 20, value: (d) => d.inkOfferSubtotal ?? "" },
    { header: "Head offered at subsidized rate", width: 22, value: (d) => yesNo(d.headOfferAgreed) },
    { header: "Head subsidized qty", width: 16, value: (d) => d.headOfferQty ?? "" },
    { header: "Head subsidized rate (INR/head)", width: 22, value: (d) => d.headOfferRate ?? "" },
    { header: "Head subsidized price (INR)", width: 20, value: (d) => d.headOfferSubtotal ?? "" },
    { header: "Payment terms", width: 24, value: (d) => d.paymentTerms ?? "" },
    /*
      ⚠ "Delivery term" STAYS — settled with the client on 29-Aug-2026, after an
        earlier instruction to remove it. It is the only delivery route an
        "Others" deal records anywhere: commercial terms asks a route on High
        Seas deals alone, and 11 of the 12 ordinary deals on record had filled
        this in. It also feeds "Delivery Terms:" on all ten contract templates.
    */
    { header: "Delivery term", width: 16, value: (d) => d.tradeTerm ?? "" },
    /*
      ⚠ THE "Delivery days" COLUMN IS GONE (OCPI-18). The form no longer asks the
        question and no paper prints the answer, so from here on the column could
        only ever have exported a blank — or, worse, a value from before the
        change sitting beside newer rows that have none, read as though the newer
        deals had simply forgotten to fill it in.

        The `delivery_days` COLUMN itself stays and the 20 deals that answered it
        keep their answer; it is the export that would have misled.
    */
    { header: "Tentative delivery date", width: 20, value: (d) => dmy(d.deliveryDate) },
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
