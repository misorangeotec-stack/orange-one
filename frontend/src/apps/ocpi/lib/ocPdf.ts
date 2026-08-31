import jsPDF from "jspdf";
import {
  BRAND, MARGIN, contentW, loadBrandAssets, pageH, pageW, registerBrandFonts,
  setDraw, setFill, text, widthOf, wrapText,
} from "@/shared/lib/pdfBrand";
import { BODY_TOP, bodyBottom, drawLetterhead, loadLetterhead, type LetterheadAssets } from "./letterhead";
import { resolve, tokensFor } from "./tokens";
import { docHeading } from "./format";
import type { OcpiCompanyProfile, OcpiDeal, OcpiMachine, OcpiMachineSection } from "../types";

/**
 * The Order Confirmation — the document the customer signs.
 *
 * ⚠ ITS STRUCTURE COMES FROM THE MACHINE, NOT FROM THIS FILE. The ten templates
 *   genuinely differ: Pengda puts its warranty first and has no print-head
 *   policy at all, P8D is headed OFFER QUOTE, K24 prints no `Ref:` line, and the
 *   Alpha decks close "Checked By" where Homer and P8 close "Approved By". So
 *   the renderer draws whatever the machine declares, in the order it declares
 *   it, and hard-codes none of it.
 *
 * ⚠ EVERY BLANK IS A TOKEN. The decks carry literal fill-in gaps — "warranty of
 *   _______months" — and those are now {{machine_warranty_months}} and the rest
 *   of the list in tokens.ts. An unanswered token prints as a ruled blank,
 *   exactly as the paper version does, never as the braces themselves.
 *
 *   (The deck’s other gap, "INR ____________ plus GST", was
 *   {{post_warranty_head_price}} until stage J.1 replaced the sentence around it
 *   with one that needs no figure. Both the token and the field are gone.)
 *
 * ⚠ OPTIONAL EQUIPMENT IS APPENDED FROM THE DEAL, not baked into the machine.
 *   K32's own deck lists an air blade and a centring device as though every K32
 *   had them; the old form asks about each separately. The machine carries what
 *   is always true, and this adds what THIS customer bought.
 */

export interface OcDocInput {
  deal: OcpiDeal;
  machine: OcpiMachine;
  sections: OcpiMachineSection[];
  profile?: OcpiCompanyProfile;
  /** From module config, for the {{quotation_validity_days}} token. */
  validityDays?: number;
  /** From module config, for the two warranty tokens. Fixed company policy. */
  warranty?: { machineMonths: number; headMonths: number };
}

const dmy = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const inr = (n: number | null): string =>
  n === null ? "" : `₹ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const usd = (n: number | null): string =>
  n === null ? "" : `$ ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** How a shipment mode / route reads on a contract, not as it is stored. */
const SHIP_MODE_TEXT: Record<string, string> = {
  with_machine: "With the machine",
  separate: "Separate shipment",
};
const SHIP_VIA_TEXT: Record<string, string> = {
  directly: "Directly",
  hss: "High Seas Sale (HSS)",
  local_sales: "Local sales",
};

export interface ShipmentLine {
  item: string;
  mode: string;
  via: string;
  separateInvoice: boolean | null;
  qty: number | null;
  amount: number | null;
  /**
   * DERIVED SERVER-SIDE by `fms_ocpi_write_oc` as round(qty * amount, 2), and
   * printed from the stored column — never recomputed here.
   *
   * ⚠ One price, one answer. The form shows the same product live while the
   *   figures are typed, but that is a preview; if this file multiplied the two
   *   again, a contract could print an arithmetic the database disagrees with.
   *   Same rule that had `withGst` deleted in stage E.
   *
   * 🔴 NOT PART OF ANY TOTAL. It is not in `total_inr` or `grand_total_inr` and
   *   must never be: a separately-invoiced item is billed on its own document,
   *   so adding it to this contract would charge the customer twice.
   */
  subtotal: number | null;
}

/**
 * What ships on its own terms, and what is billed on its own.
 *
 * ⚠ THIS ANSWERS A GAP, NOT A REQUEST FOR MORE DETAIL. Before stage I these
 *   answers were asked on the form, branch-gated in BOTH engines, written by
 *   fms_ocpi_write_oc and frozen into every revision payload — and printed in
 *   NEITHER paper, in no template token, and in no register column. Four
 *   questions a salesperson answered on every head-inclusive deal, and no
 *   document ever stated what was agreed.
 *
 * ⚠ A LINE APPEARS ONLY IF THE DEAL CARRIES ONE. The branch rules already
 *   guarantee a null for anything that does not apply — the head's columns are
 *   nulled when no head is included, the dryer's when the machine takes none —
 *   so an empty line here means the question was not answered, not that it was
 *   inapplicable, and it is left off rather than printed as a ruled blank.
 */
export function shipmentLines(d: OcpiDeal): ShipmentLine[] {
  // Ordered head · ink · dryer · spare parts · centering device, matching the
  // form's table and the client's stated order (OCPI-11).
  const rows: [string, string | null, string | null, boolean | null, number | null, number | null, number | null][] = [
    ["Print head", d.headShipMode, d.headShipVia, d.headSeparateInvoice, d.headInvoiceQty, d.headInvoiceAmount, d.headInvoiceSubtotal],
    ["Ink", d.inkShipMode, d.inkShipVia, d.inkSeparateInvoice, d.inkInvoiceQty, d.inkInvoiceAmount, d.inkInvoiceSubtotal],
    ["Dryer", d.dryerShipMode, d.dryerShipVia, d.dryerSeparateInvoice, d.dryerInvoiceQty, d.dryerInvoiceAmount, d.dryerInvoiceSubtotal],
    ["Spare parts", d.sparesShipMode, d.sparesShipVia, d.sparesSeparateInvoice, d.sparesInvoiceQty, d.sparesInvoiceAmount, d.sparesInvoiceSubtotal],
    ["Centering device", d.centeringShipMode, d.centeringShipVia, d.centeringSeparateInvoice, d.centeringInvoiceQty, d.centeringInvoiceAmount, d.centeringInvoiceSubtotal],
  ];
  return rows
    .filter(([, mode, , inv]) => !!mode || inv !== null)
    .map(([item, mode, via, inv, qty, amount, subtotal]) => ({
      item,
      mode: mode ? (SHIP_MODE_TEXT[mode] ?? mode) : "",
      via: via ? (SHIP_VIA_TEXT[via] ?? via) : "",
      separateInvoice: inv,
      qty,
      amount,
      subtotal,
    }));
}

/**
 * What this deal ADDS to the machine's standard composition.
 *
 * ⚠ A No CONTRIBUTES NOTHING, and that is deliberate even now that a No is a
 *   deliberate answer on every deal rather than a hidden question (OCPI-10,
 *   confirmed with the client 31-Aug-2026). These lines become bullets under
 *   "THE MACHINE IS COMPOSED AS FOLLOWS", which is a list of what the machine
 *   HAS. "Air Blade: No" is not a thing the machine has. The quotation is
 *   where the Yes/No answers are stated in full — this paper states the
 *   outcome.
 *
 * ⚠ `otherInclusions` IS FREE TEXT AND GOES IN AS TYPED, so it reads as one
 *   more line of the composition. It is the only entry here the salesperson
 *   words themselves.
 */
export function optionalExtras(d: OcpiDeal): string[] {
  const out: string[] = [];
  if (d.airBlade) out.push("Air Blade");
  if (d.externalCentering) out.push("External Centring Device");
  if (d.inkDustExhauster) out.push("Ink Dust Exhauster");
  if (d.chillingSystem) out.push("Chilling System");
  if (d.otherInclusions?.trim()) out.push(d.otherInclusions.trim());
  return out;
}

/**
 * The document as plain data — what gets frozen onto the deal.
 *
 * Built here rather than in the caller so the snapshot and the PDF are produced
 * from one source and cannot describe different documents.
 */
export function resolvedOcDocument(input: OcDocInput): Record<string, unknown> {
  const { deal, machine, sections, profile } = input;
  const tokens = {
    ...tokensFor({ deal, profile, warranty: input.warranty }),
    quotation_validity_days: input.validityDays ? String(input.validityDays) : null,
  };
  return {
    doc_title: docHeading(deal),
    oc_no: deal.ocNo,
    /*
      ⚠ BOTH NAMES ARE FROZEN, not just the code (OCPI-3, stage I). The billing
        name is read off the MACHINE at render time, so a machine renamed or
        re-described next year would otherwise change what an already-issued
        contract appears to have said. Revisions frozen BEFORE this carry
        neither key — they are simply absent, which is honest; there is nothing
        to invent them from.
    */
    machine_name: machine.name,
    machine_billing_name: machine.billingName,
    intro_text: machine.introText ? resolve(machine.introText, tokens).text : null,
    header_fields: machine.headerFields,
    signoff_style: machine.signoffStyle,
    spec_rows: machine.specRows.map((r) => ({
      label: r.label,
      value: resolve(r.value ?? "", tokens).text,
    })),
    composition: [...machine.composition, ...optionalExtras(deal)],
    supply_description: machine.supplyDescription ? resolve(machine.supplyDescription, tokens).text : null,
    sections: sections.map((s) => ({
      key: s.key,
      title: s.title,
      body: resolve(s.body ?? "", tokens).text,
    })),
    /*
      ⚠ THE CURRENCY AND THE RATE ARE PART OF THE MONEY, not context around it.
        A frozen snapshot recording only rupees cannot afterwards say whether the
        contract was struck in dollars or what it was converted at, and those are
        the two facts a disputed total turns on.
    */
    money: {
      deal_value_amount: deal.dealValueAmount,
      deal_value_currency: deal.dealValueCurrency,
      fx_rate: deal.fxRate,
      machine_value_inr: deal.machineValueInr,
      gst_rate: deal.gstRate,
      gst_amount_inr: deal.gstAmountInr,
      total_inr: deal.totalInr,
      /*
        ⚠ THE DRYER MONEY IS PART OF THE MONEY. A snapshot recording only
          `total_inr` could not afterwards say what the customer was actually
          asked to pay, which is the one thing a disputed total turns on.
          `total_inr` is the MACHINE total; `grand_total_inr` is the sum.
          `dryer_price` is in the DEAL’S CURRENCY and `dryer_value_inr` is the
          rupee figure it converted to — both are frozen, because the second
          cannot be re-derived once a rate moves.
      */
      dryer_price: deal.dryerPrice,
      dryer_included: deal.dryerIncluded,
      dryer_value_inr: deal.dryerValueInr,
      dryer_gst_inr: deal.dryerGstInr,
      grand_total_inr: deal.grandTotalInr,
    },
    /*
      ⚠ FROZEN BECAUSE IT NOW PRINTS. Before stage I these answers were frozen
        into `field_payload` but appeared on no document; they are part of the
        resolved contract now, so the snapshot has to carry what was printed.
    */
    shipment: shipmentLines(deal),
    dryer: {
      category: deal.dryerType,
      name: deal.dryerName,
      chambers: deal.dryerChambers,
      heating_medium: deal.heatingMode,
      included: deal.dryerIncluded,
      price: deal.dryerPrice,
    },
    company_profile: profile
      ? {
          legal_name: profile.legalName,
          cin: profile.cin,
          registered_address: profile.registeredAddress,
          ex_works_city: profile.exWorksCity,
          letterhead_path: profile.letterheadPath,
        }
      : null,
  };
}

export async function buildOcPdf(input: OcDocInput): Promise<jsPDF> {
  const { deal, machine, sections, profile } = input;

  const [assets, letterhead] = await Promise.all([loadBrandAssets(), loadLetterhead(profile)]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  registerBrandFonts(pdf, assets);

  const cw = contentW(pdf);
  const left = MARGIN;

  const tokens = {
    ...tokensFor({ deal, profile, warranty: input.warranty }),
    quotation_validity_days: input.validityDays ? String(input.validityDays) : null,
  };

  const newPage = (a: LetterheadAssets): number => {
    pdf.addPage();
    drawLetterhead(pdf, a);
    return BODY_TOP;
  };
  const room = (y: number, need: number): number =>
    y + need > bodyBottom(pdf) ? newPage(letterhead) : y;

  drawLetterhead(pdf, letterhead);
  let y = 96;

  // ── Title ────────────────────────────────────────────────────────────────
  setFill(pdf, BRAND.navy);
  pdf.rect(left, y, cw, 24, "F");
  // ⚠ THE HEADING COMES FROM THE STAGE, NOT THE MACHINE. See docHeading.
  text(pdf, docHeading(deal), left + 10, y + 16.5, { size: 12, bold: true, color: BRAND.white });
  if (deal.ocNo) {
    text(pdf, deal.ocNo, left + cw - 10, y + 16.5, {
      size: 10, bold: true, color: BRAND.white, align: "right",
    });
  }
  y += 34;

  // ── Header lines, only the ones this machine declares ────────────────────
  const header: [string, string][] = [];
  const wants = (k: string) => machine.headerFields.includes(k);
  if (wants("attn")) header.push(["Attn:", deal.customerAttn ?? ""]);
  if (wants("date")) header.push(["Date:", dmy(deal.ocAt ?? new Date().toISOString())]);
  if (wants("ref")) header.push(["Ref:", deal.refNo ?? ""]);
  if (wants("address")) header.push(["Address:", [deal.customerName, deal.customerAddress].filter(Boolean).join(", ")]);

  /*
    ⚠ THE BILLING NAME IS NOT IN `headerFields`, AND THAT IS THE POINT (OCPI-3,
      stage I). Those four — attn, date, ref, address — are a per-machine choice
      about what a given deck happens to want at the top. This is not optional in
      the same way: it is the product description the INVOICE will carry, and a
      contract that does not state it cannot be matched against the bill it
      produces.

      The machine CODE is already on this paper — every one of the ten intros
      reads "we are glad to confirm the supply of <code> Digital Printing
      Machine…", and each deck carries two naming spec rows — so only the billing
      name was missing. Nothing prints when the machine has no billing name; 21
      of the 28 are mapped.
  */
  if (machine.billingName) header.push(["Product:", machine.billingName]);

  for (const [label, value] of header) {
    const lines = wrapText(pdf, value, cw - 62, 9);
    y = room(y, Math.max(13, lines.length * 11 + 2));
    text(pdf, label, left, y, { size: 9, bold: true });
    lines.forEach((l, i) => text(pdf, l, left + 58, y + i * 11, { size: 9 }));
    y += Math.max(13, lines.length * 11 + 2);
  }
  y += 6;

  // ── Intro ────────────────────────────────────────────────────────────────
  if (machine.introText) {
    const intro = resolve(machine.introText, tokens).text;
    const lines = wrapText(pdf, intro, cw, 9);
    y = room(y, lines.length * 11 + 8);
    for (const l of lines) {
      text(pdf, l, left, y, { size: 9 });
      y += 11;
    }
    y += 10;
  }

  // ── Specification table ──────────────────────────────────────────────────
  const LABEL_W = cw * 0.42;
  for (const spec of machine.specRows) {
    const value = resolve(spec.value ?? "", tokens).text;
    const labelLines = wrapText(pdf, spec.label, LABEL_W - 12, 8.5, true);
    // Values carry newlines on the electrical rows; honour them.
    const valueLines = value
      .split("\n")
      .flatMap((seg) => wrapText(pdf, seg, cw - LABEL_W - 12, 8.5));
    const h = Math.max(17, 7 + Math.max(labelLines.length, valueLines.length) * 10);
    y = room(y, h);

    setDraw(pdf, BRAND.line);
    pdf.setLineWidth(0.6);
    pdf.rect(left, y, cw, h);
    pdf.line(left + LABEL_W, y, left + LABEL_W, y + h);
    labelLines.forEach((l, i) => text(pdf, l, left + 6, y + 11 + i * 10, { size: 8.5, bold: true }));
    valueLines.forEach((l, i) => text(pdf, l, left + LABEL_W + 6, y + 11 + i * 10, { size: 8.5 }));
    y += h;
  }
  y += 14;

  // ── Composition ──────────────────────────────────────────────────────────
  const composition = [...machine.composition, ...optionalExtras(deal)];
  if (composition.length > 0) {
    y = room(y, 30);
    text(pdf, "THE MACHINE IS COMPOSED AS FOLLOWS:", left, y, { size: 9.5, bold: true });
    y += 14;
    for (const item of composition) {
      const lines = wrapText(pdf, resolve(item, tokens).text, cw - 14, 8.5);
      y = room(y, lines.length * 11 + 2);
      setFill(pdf, BRAND.orange);
      pdf.circle(left + 3, y - 2.6, 1.4, "F");
      lines.forEach((l, i) => text(pdf, l, left + 14, y + i * 11, { size: 8.5 }));
      y += lines.length * 11 + 2;
    }
    y += 12;
  }

  // ── Total net amount ─────────────────────────────────────────────────────
  y = room(y, 76);
  text(pdf, "TOTAL NET AMOUNT OF THE SUPPLY", left, y, { size: 9.5, bold: true });
  y += 14;
  if (machine.supplyDescription) {
    const lines = wrapText(pdf, resolve(machine.supplyDescription, tokens).text, cw, 8.5);
    y = room(y, lines.length * 11 + 4);
    for (const l of lines) {
      text(pdf, l, left, y, { size: 8.5 });
      y += 11;
    }
    y += 4;
  }
  /*
    ⚠ THE TAX ROW IS OMITTED ON A HIGH SEAS SALE, NOT SET TO ZERO. This block
      used to read `deal.gstRate === null ? 18 : deal.gstRate`, which printed
      "+ 18% GST Value INR" with a blank figure beside it on exactly the deals
      that carry no tax — the renderer "remembering" a default the data had
      deliberately cleared. A null rate now means there is no row.

    ⚠ A DOLLAR DEAL PRINTS BOTH CURRENCIES, and the rate it was converted at, so
      the arithmetic on the paper can be checked from the paper. The rate is the
      one frozen onto this revision, never today's.
  */
  const moneyRows: [string, string, boolean][] = [];
  if (deal.dealValueCurrency === "USD") {
    moneyRows.push(["Machine Value USD", usd(deal.dealValueAmount), false]);
    moneyRows.push([
      deal.fxRate === null
        ? "Machine Value INR"
        : `Machine Value INR (at ${deal.fxRate.toFixed(4)} per USD)`,
      inr(deal.machineValueInr),
      false,
    ]);
  } else {
    moneyRows.push(["Machine Value INR", inr(deal.machineValueInr), false]);
  }
  if (deal.gstRate !== null) {
    moneyRows.push([`+ ${deal.gstRate}% GST Value INR`, inr(deal.gstAmountInr), false]);
  }
  /*
    ⚠ MACHINE TOTAL → DRYER TOTAL → FINAL TOTAL when a dryer is charged outside
      the deal, exactly as the client specified, and matching the summary sheet
      row for row.

    ⚠ EVERY FIGURE IS READ, NOT COMPUTED. The dryer's rupee value, its GST and
      the grand total are derived in `fms_ocpi_write_oc` and stored, like the
      machine's. Stage I added them in the browser as a holding position while
      the dryer's tax treatment was unanswered; the client settled it on
      29-Aug-2026 — GST applies, at the same rate — and the arithmetic moved to
      the server. Only the server knows that High Seas carries no GST at all and
      that a dollar deal's dryer converts at the rate frozen onto the revision.
  */
  const dryerCharged = deal.dryerValueInr !== null && deal.dryerValueInr > 0;
  if (dryerCharged) {
    moneyRows.push(["Machine Total INR", inr(deal.totalInr), false]);
    moneyRows.push(["Dryer Value INR", inr(deal.dryerValueInr), false]);
    // Omitted, not zeroed, on a High Seas deal — see the note above the machine's
    // own tax row for why a zero-tax line is a different claim from no line.
    if (deal.dryerGstInr !== null) {
      moneyRows.push([`+ ${deal.gstRate}% GST on Dryer INR`, inr(deal.dryerGstInr), false]);
    }
    moneyRows.push(["Final Total INR", inr(deal.grandTotalInr), true]);
  } else {
    moneyRows.push(["Total Value INR", inr(deal.totalInr), true]);
  }
  for (const [label, value, strong] of moneyRows) {
    y = room(y, 18);
    if (strong) {
      setFill(pdf, BRAND.orangeSoft);
      pdf.rect(left, y - 11, cw, 17, "F");
    }
    text(pdf, label, left + 6, y, { size: strong ? 9.5 : 9, bold: strong });
    text(pdf, value, left + cw - 6, y, { size: strong ? 9.5 : 9, bold: strong, align: "right" });
    y += 18;
  }
  y += 12;

  /*
    ── Shipment & invoice ───────────────────────────────────────────────────

    ⚠ THE CLIENT ASKED FOR THESE ANSWERS TO PRINT ON THE DETAILED PAPER, and
      until now they printed on neither. See `shipmentLines` for what was
      missing. Five columns, because "invoiced separately: yes" without the
      quantity and the amount states an intention and not a term.

    ⚠ AMOUNTS ARE EXCLUSIVE OF TAX, by instruction, and the heading says so —
      an amount on a contract with no tax status is not a figure anybody can act
      on. They are NOT added into the totals above: a separately-invoiced item is
      billed on its own document, and rolling it into this one would double it.
  */
  const shipment = shipmentLines(deal);
  if (shipment.length > 0) {
    const COLS: [string, number][] = [
      ["Item", 0.2], ["How it ships", 0.17], ["Sent via", 0.16],
      ["Separate invoice", 0.11], ["Qty", 0.07], ["Amount (excl. tax)", 0.14],
      ["Sub-total", 0.15],
    ];
    // ⚠ FRACTIONS MUST SUM TO 1, so the seven columns fill the content width
    //   exactly. They were six until OCPI-11 added the sub-total; every other
    //   fraction was reduced to make room rather than the new one being
    //   squeezed in, because a column narrower than its figures wraps every
    //   row and doubles the height of the table.
    const w = COLS.map(([, f]) => cw * f);
    const x: number[] = [];
    for (let i = 0, at = left; i < w.length; at += w[i], i++) x.push(at);

    y = room(y, 46);
    text(pdf, "SHIPMENT & INVOICE", left, y, { size: 9.5, bold: true });
    y += 6;
    // ⚠ THE CAPTION HAS TO SAY THE SUB-TOTALS ARE NOT IN THE TOTAL. This table
    //   sits below the deal's own money on the same page, and a rupee column a
    //   customer cannot account for reads as an unexplained extra charge.
    text(
      pdf,
      "Amounts exclude tax and are billed on their own invoice. Sub-totals are not included in the totals above.",
      left, y + 5, { size: 8, color: BRAND.grey },
    );
    y += 14;

    setFill(pdf, BRAND.navy);
    pdf.rect(left, y, cw, 16, "F");
    COLS.forEach(([label], i) =>
      text(pdf, label, x[i] + 5, y + 11, { size: 7.5, bold: true, color: BRAND.white }),
    );
    y += 16;

    for (const line of shipment) {
      const cells = [
        line.item,
        line.mode,
        line.via,
        line.separateInvoice === null ? "" : line.separateInvoice ? "Yes" : "No",
        line.qty === null ? "" : String(line.qty),
        line.amount === null ? "" : inr(line.amount),
        // The STORED figure, not a fresh multiplication — see ShipmentLine.
        line.subtotal === null ? "" : inr(line.subtotal),
      ];
      const wrapped = cells.map((c, i) => wrapText(pdf, c, w[i] - 10, 8.5));
      const h = Math.max(17, 7 + Math.max(...wrapped.map((l) => l.length)) * 10);
      y = room(y, h);

      setDraw(pdf, BRAND.line);
      pdf.setLineWidth(0.6);
      pdf.rect(left, y, cw, h);
      wrapped.forEach((lines, i) => {
        if (i > 0) pdf.line(x[i], y, x[i], y + h);
        // The three numeric columns right-align, so figures line up to be read
        // down the column rather than compared character by character.
        // (Two until OCPI-11 added the sub-total; the index is unchanged
        // because the sub-total was appended after Amount.)
        const numeric = i >= 4;
        lines.forEach((l, k) =>
          text(pdf, l, numeric ? x[i] + w[i] - 5 : x[i] + 5, y + 11 + k * 10, {
            size: 8.5,
            align: numeric ? "right" : undefined,
          }),
        );
      });
      y += h;
    }
    y += 14;
  }

  // ── The machine's own sections, in its own order ─────────────────────────
  for (const sec of sections) {
    const body = resolve(sec.body ?? "", tokens).text;
    y = room(y, 30);
    text(pdf, sec.title.toUpperCase(), left, y, { size: 9.5, bold: true, color: BRAND.navy });
    y += 13;

    for (const para of body.split("\n")) {
      if (para.trim() === "") {
        y += 5;
        continue;
      }
      const lines = wrapText(pdf, para, cw, 8.5);
      y = room(y, lines.length * 10.5 + 2);
      for (const l of lines) {
        text(pdf, l, left, y, { size: 8.5, color: BRAND.grey });
        y += 10.5;
      }
      y += 3;
    }
    y += 10;
  }

  // ── Signatures ───────────────────────────────────────────────────────────
  y = room(y, 96);
  const sellerName = profile?.legalName ?? "M/s Orange O Tec Pvt. Ltd.";
  const half = cw / 2;
  text(pdf, sellerName, left, y, { size: 9, bold: true });
  text(pdf, `M/s ${deal.customerName ?? ""}`, left + half, y, { size: 9, bold: true });
  y += 40;
  setDraw(pdf, BRAND.grey2);
  pdf.setLineWidth(0.5);
  pdf.line(left, y, left + half - 24, y);
  pdf.line(left + half, y, left + cw - 24, y);
  y += 11;
  text(pdf, "Authorised Signatory Name", left, y, { size: 8, bold: true });
  text(pdf, "Authorised Signatory Name", left + half, y, { size: 8, bold: true });
  y += 26;

  const secondLabel = machine.signoffStyle === "checked_by" ? "Checked By:" : "Approved By:";
  text(pdf, "Prepared By:", left, y, { size: 8.5, bold: true });
  text(pdf, deal.preparedBy ?? "", left + widthOf(pdf, "Prepared By:", 8.5, true) + 6, y, { size: 8.5 });
  y += 14;
  text(pdf, secondLabel, left, y, { size: 8.5, bold: true });
  text(pdf, deal.approvedBy ?? "", left + widthOf(pdf, secondLabel, 8.5, true) + 6, y, { size: 8.5 });

  // Page x of y, so a six-page contract cannot be signed a page short.
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    text(pdf, `Page ${p} of ${total}`, pageW(pdf) - MARGIN, pageH(pdf) - 16, {
      size: 7, color: BRAND.grey2, align: "right",
    });
  }

  return pdf;
}

export async function ocPdfBlob(input: OcDocInput): Promise<Blob> {
  const pdf = await buildOcPdf(input);
  return pdf.output("blob");
}

const ocBase = (deal: OcpiDeal): string =>
  (deal.ocNo ?? `OC-DRAFT-${deal.customerName ?? "order"}`).replace(/[\\/:*?"<>|]/g, "-");

export function ocFileName(deal: OcpiDeal): string {
  return `${ocBase(deal)}.pdf`;
}

/**
 * The approved SUMMARY sheet's file name.
 *
 * ⚠ IT MUST DIFFER FROM `ocFileName`. Both approved papers are uploaded to the
 *   deal's `oc/` folder with `upsert: true`, so one shared name would mean the
 *   detailed sheet silently replaced the summary and the deal would appear to
 *   have half a contract.
 */
export function ocSummaryFileName(deal: OcpiDeal): string {
  return `${ocBase(deal)} Summary.pdf`;
}
