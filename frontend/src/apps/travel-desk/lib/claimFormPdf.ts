import jsPDF from "jspdf";
import {
  BRAND, MARGIN,
  contentW, pageH,
  divider, drawTable, footer, headerBand, loadBrandAssets, metaStrip, noteBlock,
  pageWash, registerBrandFonts, sectionHeading, text,
  type Ctx,
} from "@/shared/lib/pdfBrand";
import { TIER_LABEL } from "./format";
import type {
  Trip, ClaimLine, DaDay, TravelCity, TravelExpenseCategory, TravelRateCard,
} from "../types";

/**
 * TRVL-FRM-01 — the Travel Expense Claim Form the policy itself specifies.
 *
 * ⚠ IT PRINTS WHAT THE ENGINE DECIDED, NOT WHAT WAS CLAIMED. Every line carries
 *   three figures — claimed, allowed, and the gap — and the gap carries its
 *   sentence. A claim form showing only the claimed column is the document that
 *   makes a traveller discover a disallowance from a smaller bank credit six
 *   weeks later.
 *
 * ⚠ THE FOUR SIGNATURE BLOCKS ARE THE POLICY'S, NOT A DESIGN CHOICE. §11.1 runs
 *   Employee → HOD → Finance → CFO, and Annexure B prints all four. Three of
 *   them are already recorded in the system by the time this renders, so they
 *   are printed as facts with names and dates; the CFO block stays an empty
 *   ruled line, because nothing in this module captures that approval and a
 *   pre-filled signature block for a decision nobody made is a forged document.
 *
 * ⚠ AMOUNTS ARE FULL FIGURES, never lakhs or crores — the policy says so on its
 *   own cover page. `₹` renders only because pdfBrand embeds Poppins; jsPDF's
 *   built-in Helvetica has no rupee glyph and would silently print nothing.
 */

export interface ClaimFormInput {
  trip: Trip;
  lines: ClaimLine[];
  daDays: DaDay[];
  categories: TravelExpenseCategory[];
  cities: TravelCity[];
  card: TravelRateCard | undefined;
  /** Resolved names — this file never touches a store. */
  names: {
    traveller: string;
    department: string | null;
    designation: string | null;
    manager: string | null;
    finance: string | null;
  };
  company: { legalName: string; gstin: string; address: string };
}

const dmy = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const inr = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const claimFormFileName = (trip: Trip): string =>
  `TRVL-FRM-01_${(trip.tripNo ?? "draft").replace(/[^\w-]/g, "_")}.pdf`;

/** A ruled line somebody signs, with its caption underneath. */
function signatureLine(pdf: jsPDF, x: number, y: number, w: number, caption: string, filled?: string): void {
  if (filled) {
    text(pdf, filled, x, y - 4, { size: 8.5, color: BRAND.navy });
  }
  pdf.setDrawColor(BRAND.line);
  pdf.setLineWidth(0.8);
  pdf.line(x, y, x + w, y);
  text(pdf, caption, x, y + 10, { size: 7.5, color: BRAND.grey });
}

async function build(input: ClaimFormInput): Promise<jsPDF> {
  const { trip, lines, daDays, categories, cities, card, names, company } = input;

  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  registerBrandFonts(pdf, assets);
  /*
    ⚠ "{tp}" IS A PLACEHOLDER jsPDF SWAPS FOR THE REAL PAGE COUNT at the end —
      see `putTotalPages` below, and the same pattern in the Master Report and
      the receivables collections export. Both travel documents previously passed
      the literal "1", so a claim form that ran to two pages footed both of them
      "Page 1 of 1" and "Page 2 of 1". Nobody notices until the document is
      printed and somebody has to tell whether a page is missing — which is the
      one question a page count exists to answer.
  */
  const ctx: Ctx = { pdf, assets, totalPagesToken: "{tp}" };

  const catName = (id: string | null): string =>
    categories.find((c) => c.id === id)?.name ?? "—";
  const cityName = (id: string | null): string => cities.find((c) => c.id === id)?.name ?? "—";
  const city = cities.find((c) => c.id === trip.destinationCityId);

  pageWash(pdf);
  let y = headerBand(ctx, { tag: "TRVL-FRM-01 · Travel Expense Claim" });
  y += 16;

  const W = contentW(pdf);

  y = sectionHeading(
    pdf, MARGIN, y,
    trip.tripNo ?? "Unnumbered",
    `${names.traveller} — ${city?.name ?? "destination not set"}`,
  );
  y += 8;

  y = metaStrip(pdf, MARGIN, y, W, [
    { label: "Travelled", value: dmy(trip.actualDepartureDate ?? trip.plannedDepartureDate) },
    { label: "Returned", value: dmy(trip.actualReturnDate ?? trip.plannedReturnDate) },
    {
      label: "Category",
      value: trip.snapTravelCategory ?? "—",
      note: trip.snapBandNo ? `Band ${trip.snapBandNo}` : undefined,
    },
    { label: "Claim filed", value: dmy(trip.clAt) },
  ]);
  y += 14;

  // ---- who ---------------------------------------------------------------
  y = drawTable(pdf, {
    x: MARGIN, y, width: W,
    columns: [
      { header: "", width: 1, value: (r: { k: string }) => r.k },
      { header: "", width: 2.2, value: (r: { v: string }) => r.v },
    ],
    rows: [
      { k: "Employee", v: names.traveller },
      { k: "Employee code", v: trip.travellerEmployeeCode ?? "—" },
      { k: "Department", v: names.department ?? "—" },
      { k: "Designation", v: names.designation ?? "—" },
      { k: "Destination", v: city ? `${city.name} (${TIER_LABEL[city.tier]})` : "—" },
    ],
    showHeader: false,
    rowH: 14,
  });
  y += 14;

  // ---- the expense lines --------------------------------------------------
  y = sectionHeading(pdf, MARGIN, y, "Expenses claimed", "Priced against the policy at the moment this claim was filed");
  y += 4;

  if (lines.length === 0) {
    text(pdf, "No expenses were claimed on this trip.", MARGIN, y + 10, { size: 9, color: BRAND.grey });
    y += 22;
  } else {
    y = drawTable(pdf, {
      x: MARGIN, y, width: W,
      columns: [
        { header: "Date", width: 0.9, value: (l: ClaimLine) => dmy(l.spentOn) },
        { header: "Category", width: 1.5, value: (l: ClaimLine) => catName(l.categoryId) },
        { header: "City", width: 1.0, value: (l: ClaimLine) => cityName(l.cityId) },
        { header: "Vendor", width: 1.3, value: (l: ClaimLine) => l.vendor ?? "—" },
        { header: "Claimed", width: 0.9, align: "right", value: (l: ClaimLine) => inr(l.amount) },
        { header: "Allowed", width: 0.9, align: "right", value: (l: ClaimLine) => inr(l.allowedAmount) },
      ],
      rows: lines,
      rowH: 15,
    });
    y += 6;

    /*
      The reasons, below the grid rather than squeezed into a column.

      ⚠ EVERY DISALLOWANCE IS PRINTED IN FULL. A row that reads "2,750 claimed,
        1,750 allowed" with no sentence beside it is the exact document that
        generates the phone call this whole engine exists to prevent.
    */
    const reasons = lines.filter((l) => l.disallowReason);
    if (reasons.length) {
      const notes = reasons.map(
        (l) => `${dmy(l.spentOn)} · ${catName(l.categoryId)} — ${l.disallowReason}`,
      );
      y = noteBlock(pdf, {
        x: MARGIN, y, width: W,
        title: "Why some amounts were not allowed",
        lines: notes,
      });
      y += 12;
    }
  }

  // ---- the daily allowance ------------------------------------------------
  if (y + 140 > pageH(pdf) - 60) {
    footer(ctx, pdf.getCurrentPageInfo().pageNumber, new Date().toISOString(), company.legalName || undefined);
    pdf.addPage();
    pageWash(pdf);
    y = headerBand(ctx, { tag: "TRVL-FRM-01 · Travel Expense Claim", compact: true }) + 16;
  }

  y = sectionHeading(pdf, MARGIN, y, "Daily allowance (§8)", "One row per calendar day, with the reason for each figure");
  y += 4;

  if (daDays.length === 0) {
    text(pdf, "No daily allowance was due on this trip.", MARGIN, y + 10, { size: 9, color: BRAND.grey });
    y += 22;
  } else {
    y = drawTable(pdf, {
      x: MARGIN, y, width: W,
      columns: [
        { header: "Day", width: 1.0, value: (d: DaDay) => dmy(d.day) },
        { header: "Tier", width: 0.6, value: (d: DaDay) => (d.cityTier ? `Tier ${d.cityTier}` : "—") },
        { header: "Rate", width: 0.8, align: "right", value: (d: DaDay) => inr(d.daRate) },
        {
          header: "Factor", width: 0.7, align: "right",
          value: (d: DaDay) => (Number(d.factor) === 1 ? "Full" : `×${Number(d.factor)}`),
        },
        {
          header: "Amount", width: 0.9, align: "right",
          value: (d: DaDay) => inr(d.overrideAmount ?? d.amount),
        },
      ],
      rows: daDays,
      rowH: 14,
    });
    y += 6;

    const why = daDays.filter((d) => d.factorReason || d.overrideReason);
    if (why.length) {
      y = noteBlock(pdf, {
        x: MARGIN, y, width: W,
        title: "How each day was worked out",
        lines: why.map((d) =>
          d.overrideReason
            ? `${dmy(d.day)} — Finance overrode this day: ${d.overrideReason}`
            : `${dmy(d.day)} — ${d.factorReason}`,
        ),
      });
      y += 12;
    }
  }

  // ---- the totals ---------------------------------------------------------
  if (y + 170 > pageH(pdf) - 60) {
    footer(ctx, pdf.getCurrentPageInfo().pageNumber, new Date().toISOString(), company.legalName || undefined);
    pdf.addPage();
    pageWash(pdf);
    y = headerBand(ctx, { tag: "TRVL-FRM-01 · Travel Expense Claim", compact: true }) + 16;
  }

  const owed = trip.netPayable ?? 0;
  y = drawTable(pdf, {
    x: MARGIN, y, width: W,
    columns: [
      { header: "Settlement", width: 2, value: (r: { k: string }) => r.k },
      { header: "", width: 1, align: "right", value: (r: { v: string }) => r.v },
    ],
    rows: [
      { k: "Expenses claimed", v: inr(trip.claimTotal) },
      { k: "Less: not allowed under policy", v: inr(trip.disallowedTotal) },
      { k: "Daily allowance", v: inr(trip.daTotal) },
      { k: "Less: advance already paid", v: inr(trip.advancePaidAmount) },
      {
        // ⚠ The wording flips with the sign. "Net payable: −5,000" is a number
        //   somebody has to stop and interpret; "Recoverable from the employee"
        //   is the same fact, already read.
        k: owed < 0 ? "Recoverable from the employee" : "Payable to the employee",
        v: inr(Math.abs(owed)),
      },
    ],
    rowH: 15,
    rowKind: (r: { k: string }) =>
      r.k.startsWith("Recoverable") || r.k.startsWith("Payable") ? "grand" : "normal",
  });
  y += 16;

  // ---- the four signature blocks -----------------------------------------
  if (y + 120 > pageH(pdf) - 60) {
    footer(ctx, pdf.getCurrentPageInfo().pageNumber, new Date().toISOString(), company.legalName || undefined);
    pdf.addPage();
    pageWash(pdf);
    y = headerBand(ctx, { tag: "TRVL-FRM-01 · Travel Expense Claim", compact: true }) + 16;
  }

  y = divider(pdf, MARGIN, y, W) + 10;
  y = sectionHeading(pdf, MARGIN, y, "Certification", "§11.1 — Employee, HOD, Finance, CFO");
  y += 30;

  const colW = (W - 24) / 2;
  signatureLine(
    pdf, MARGIN, y, colW,
    trip.clAt ? `Declared and filed on ${dmy(trip.clAt)}` : "Employee — signature and date",
    trip.clAt ? names.traveller : undefined,
  );
  signatureLine(
    pdf, MARGIN + colW + 24, y, colW,
    trip.crAt ? `Approved on ${dmy(trip.crAt)}` : "Reporting manager / HOD — signature and date",
    trip.crAt ? (names.manager ?? undefined) : undefined,
  );
  y += 46;

  signatureLine(
    pdf, MARGIN, y, colW,
    trip.frAt ? `Verified on ${dmy(trip.frAt)}` : "Finance — signature and date",
    trip.frAt ? (names.finance ?? undefined) : undefined,
  );
  // ⚠ DELIBERATELY BLANK. Nothing in this module captures a CFO approval, and a
  //   pre-filled block for a decision nobody made is a forged document.
  signatureLine(pdf, MARGIN + colW + 24, y, colW, "CFO — signature and date");
  y += 30;

  const notes: string[] = [
    "I certify that the expenses claimed above were incurred by me wholly for the purposes of the company's business, and that the receipts attached are originals.",
  ];
  if (card && card.status !== "confirmed") {
    notes.unshift(
      `These figures were priced on a rate card that has not been signed off (“${card.label}”). They are what the policy proposes; caps are not enforced against them yet.`,
    );
  }
  if (trip.tcDowngradedFrom) {
    notes.unshift(
      `This trip was regularised after departure, so §3.5 priced it at TC-D rather than ${trip.tcDowngradedFrom}.`,
    );
  }
  if (company.gstin) {
    notes.push(`Company GSTIN for vendor invoices: ${company.gstin}.`);
  }

  if (y + 90 > pageH(pdf) - 60) {
    footer(ctx, pdf.getCurrentPageInfo().pageNumber, new Date().toISOString(), company.legalName || undefined);
    pdf.addPage();
    pageWash(pdf);
    y = headerBand(ctx, { tag: "TRVL-FRM-01 · Travel Expense Claim", compact: true }) + 16;
  }
  noteBlock(pdf, { x: MARGIN, y, width: W, title: "Declaration", lines: notes });

  footer(
    ctx,
    pdf.getCurrentPageInfo().pageNumber,
    new Date().toISOString(),
    company.legalName || undefined,
  );

  // Every footer is drawn by now, so the placeholder can be resolved.
  if (typeof pdf.putTotalPages === "function") pdf.putTotalPages(ctx.totalPagesToken);

  return pdf;
}

/** The document as a blob, for a preview pane. */
export async function claimFormBlob(input: ClaimFormInput): Promise<Blob> {
  return (await build(input)).output("blob");
}

/** Hand it to the reader — `pdf.save`, like every other export in this repo. */
export async function downloadClaimForm(input: ClaimFormInput): Promise<void> {
  (await build(input)).save(claimFormFileName(input.trip));
}
