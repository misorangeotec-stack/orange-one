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
 *   _______months", "INR ____________ plus GST" — and those are now
 *   {{machine_warranty_months}} and {{post_warranty_head_price}}. An unanswered
 *   token prints as a ruled blank, exactly as the paper version does, never as
 *   the braces themselves.
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

/** What this deal adds to the machine's standard composition. */
export function optionalExtras(d: OcpiDeal): string[] {
  const out: string[] = [];
  if (d.airBlade) out.push("Air Blade");
  if (d.externalCentering) out.push("External Centring Device");
  if (d.inkDustExhauster) out.push("Ink Dust Exhauster");
  if (d.chillingSystem) out.push("Chilling System");
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
    ...tokensFor({ deal, profile }),
    quotation_validity_days: input.validityDays ? String(input.validityDays) : null,
  };
  return {
    doc_title: docHeading(deal),
    oc_no: deal.ocNo,
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
    ...tokensFor({ deal, profile }),
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
  moneyRows.push(["Total Value INR", inr(deal.totalInr), true]);
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
