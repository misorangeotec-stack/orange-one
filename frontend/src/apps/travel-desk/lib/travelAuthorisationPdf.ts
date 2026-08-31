import jsPDF from "jspdf";
import {
  BRAND, MARGIN,
  contentW, pageH,
  divider, drawTable, footer, headerBand, loadBrandAssets, metaStrip, noteBlock,
  pageWash, registerBrandFonts, sectionHeading, text,
  type Ctx,
} from "@/shared/lib/pdfBrand";
import type { Entitlement } from "./entitlement";
import { CATEGORY_LABEL, TIER_LABEL } from "./format";
import type { Trip, TripPassenger, TravelCity, TravelPurpose, TravelRateCard } from "../types";

/**
 * The Travel Authorisation — the one-page proof that this trip was approved,
 * and the entitlement it was approved against.
 *
 * ⚠ THE ENTITLEMENT IS ON THE PAGE, NOT JUST THE APPROVAL. A slip saying "yes,
 *   go" is what the old paper process produced, and it is exactly why every cap
 *   in the Domestic Travel Policy was discovered at claim time. A traveller
 *   standing at a hotel counter needs the number they may spend, in their hand,
 *   before they hand over a card. That is the whole reason this document exists
 *   rather than an email saying "approved".
 *
 * ⚠ EVERY FIGURE IS READ FROM THE TRIP'S **FROZEN** CARD. The caller resolves
 *   the entitlement from `snapRateCardId` and `snapBandNo`; nothing here reaches
 *   for today's rates. A card superseded the week after departure must not
 *   change what the traveller was told they could spend.
 *
 * ⚠ AMOUNTS ARE FULL FIGURES, never lakhs or crores. The policy says so on its
 *   own cover page, and `₹` renders only because pdfBrand embeds Poppins —
 *   jsPDF's built-in Helvetica has no rupee glyph and would print nothing.
 */

export interface AuthorisationInput {
  trip: Trip;
  entitlement: Entitlement;
  card: TravelRateCard | undefined;
  city: TravelCity | undefined;
  purpose: TravelPurpose | undefined;
  passengers: TripPassenger[];
  /** Resolved names — this file never touches a store. */
  names: {
    traveller: string;
    raisedBy: string | null;
    manager: string | null;
    director: string | null;
    department: string | null;
    designation: string | null;
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

/** A cap row, or the honest reason there is no figure. */
const capText = (r: { amount: number | null } | null, pending?: string): string => {
  if (pending) return pending;
  if (!r) return "Not set on the rate card";
  return r.amount === null ? "No cap — actuals with a receipt" : inr(r.amount);
};

export const authorisationFileName = (trip: Trip): string =>
  `Travel_Authorisation_${(trip.tripNo ?? "draft").replace(/[^\w-]/g, "_")}.pdf`;

async function build(input: AuthorisationInput): Promise<jsPDF> {
  const { trip, entitlement: e, card, city, purpose, passengers, names, company } = input;

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

  pageWash(pdf);
  let y = headerBand(ctx, { tag: "Travel Authorisation" });
  y += 16;

  const W = contentW(pdf);

  y = sectionHeading(
    pdf, MARGIN, y,
    trip.tripNo ?? "Unnumbered",
    `${names.traveller} — ${city?.name ?? "destination not set"}`,
  );
  y += 8;

  y = metaStrip(pdf, MARGIN, y, W, [
    { label: "Departs", value: dmy(trip.plannedDepartureDate) },
    { label: "Returns", value: dmy(trip.plannedReturnDate) },
    {
      label: "Category",
      value: trip.snapTravelCategory ?? "—",
      note: trip.snapBandNo ? `Band ${trip.snapBandNo}` : undefined,
    },
    { label: "Estimate", value: inr(trip.estimatedCost) },
  ]);
  y += 14;

  // ---- who and why --------------------------------------------------------
  y = sectionHeading(pdf, MARGIN, y, "The trip");
  y += 4;

  const facts: { k: string; v: string }[] = [
    { k: "Traveller", v: names.traveller },
    { k: "Employee code", v: trip.travellerEmployeeCode ?? "—" },
    { k: "Department", v: names.department ?? "—" },
    { k: "Designation", v: names.designation ?? "—" },
    { k: "Purpose", v: purpose?.name ?? "—" },
    { k: "Destination", v: city ? `${city.name} (${TIER_LABEL[city.tier]})` : "—" },
    { k: "Raised by", v: names.raisedBy ?? "—" },
    { k: "Accommodation", v: trip.accommodationRequired ? "Required" : "Not required" },
  ];
  if (trip.purposeOtherRemarks) facts.push({ k: "Reason", v: trip.purposeOtherRemarks });
  if (trip.isEmergency) {
    facts.push({ k: "Emergency (§3.5)", v: trip.emergencyReason ?? "no reason recorded" });
  }

  y = drawTable(pdf, {
    x: MARGIN, y, width: W,
    columns: [
      { header: "", width: 1, value: (r: { k: string }) => r.k },
      { header: "", width: 2.2, value: (r: { v: string }) => r.v },
    ],
    rows: facts,
    showHeader: false,
    rowH: 14,
  });
  y += 14;

  // ---- what the policy allows --------------------------------------------
  y = sectionHeading(pdf, MARGIN, y, "Your entitlement", "What may be spent, and on what");
  y += 4;

  const tierPending = city ? undefined : "Destination not set";
  const caps: { k: string; v: string }[] = [
    { k: "Hotel, per night (incl. GST)", v: capText(e.hotelCap, tierPending) },
    { k: "Daily allowance, per day", v: capText(e.da) },
    { k: "Local conveyance, per day", v: capText(e.conveyanceCap, e.conveyanceCap?.amount === null ? undefined : tierPending) },
    { k: "Full-day vehicle hire", v: capText(e.rentalCap) },
    { k: "Air", v: e.air.travelClass?.textValue ?? "Not set on the rate card" },
    { k: "Train", v: e.train.travelClass?.textValue ?? "Not set on the rate card" },
    { k: "Road", v: e.road.mode?.textValue ?? "Not set on the rate card" },
  ];
  if (e.conveyanceSelfDec?.amount) {
    caps.push({ k: "Conveyance without a receipt, per trip", v: inr(e.conveyanceSelfDec.amount) });
  }

  y = drawTable(pdf, {
    x: MARGIN, y, width: W,
    columns: [
      { header: "Item", width: 1.6, value: (r: { k: string }) => r.k },
      { header: "Entitlement", width: 1.4, align: "right", value: (r: { v: string }) => r.v },
    ],
    rows: caps,
    rowH: 15,
  });
  y += 12;

  // ---- the advance --------------------------------------------------------
  if (trip.advanceRequested) {
    y = drawTable(pdf, {
      x: MARGIN, y, width: W,
      columns: [
        { header: "Travel advance", width: 1.6, value: (r: { k: string }) => r.k },
        { header: "", width: 1.4, align: "right", value: (r: { v: string }) => r.v },
      ],
      rows: [
        { k: "Requested", v: inr(trip.advanceRequestedAmount) },
        { k: "Approved", v: inr(trip.advanceApprovedAmount) },
        { k: "Paid", v: inr(trip.advancePaidAmount) },
      ],
      rowH: 14,
    });
    y += 12;
  }

  // ---- who is on the booking ---------------------------------------------
  if (passengers.length) {
    y = drawTable(pdf, {
      x: MARGIN, y, width: W,
      columns: [
        { header: "Passenger", width: 2, value: (p: TripPassenger) => p.fullName },
        { header: "Gender", width: 1, value: (p: TripPassenger) => p.gender ?? "—" },
        { header: "Date of birth", width: 1.2, align: "right", value: (p: TripPassenger) => dmy(p.dateOfBirth) },
      ],
      rows: passengers,
      rowH: 14,
    });
    y += 12;
  }

  // ---- the approvals ------------------------------------------------------
  y = divider(pdf, MARGIN, y, W) + 8;
  y = sectionHeading(pdf, MARGIN, y, "Approved by");
  y += 4;

  const approvals = [
    {
      k: "Reporting manager",
      v: trip.managerApprovalSkipped
        ? "Not required"
        : trip.maAt
          ? `${names.manager ?? "—"} · ${dmy(trip.maAt)}`
          : "Pending",
    },
    {
      k: "Director",
      v: trip.directorApprovalSkipped
        ? `Not required — band ${trip.snapBandNo ?? "—"} (§3.2)`
        : trip.daAt
          ? `${names.director ?? "—"} · ${dmy(trip.daAt)}`
          : "Pending",
    },
  ];

  y = drawTable(pdf, {
    x: MARGIN, y, width: W,
    columns: [
      { header: "", width: 1, value: (r: { k: string }) => r.k },
      { header: "", width: 2.2, value: (r: { v: string }) => r.v },
    ],
    rows: approvals,
    showHeader: false,
    rowH: 15,
  });
  y += 14;

  // ---- the fine print the traveller actually needs -------------------------
  const notes: string[] = [
    "Keep every original receipt. The expense claim is due within 5 working days of your return, and nothing over 30 days old is reimbursed without Director approval (§11).",
    "A hotel night above the cap needs written evidence that the cap was unavailable, plus HOD approval — and can never exceed 1.5× the cap regardless (§7.3).",
    "Alcohol, fines, personal entertainment and anything in §15 is not reimbursable at any band.",
  ];
  if (company.gstin) {
    notes.push(`Ask every hotel and vendor to bill Orange O Tec with GSTIN ${company.gstin} — the input credit is lost without it (§11.3).`);
  } else {
    // ⚠ NOT A PLACEHOLDER NUMBER. §7.1 and §11.3 both carry the company GSTIN as
    //   "[⚠ CONFIRM with Finance]" (H8). A made-up number printed on guidance an
    //   employee hands to a hotel is worse than a visible gap.
    notes.push("Ask every hotel and vendor to bill the company, not you personally — the GST input credit is lost on a personal invoice (§11.3). The company GSTIN is not yet recorded in the system; ask Finance for it.");
  }
  if (trip.tcDowngradedFrom) {
    notes.unshift(`This trip was regularised after departure, so §3.5 reimburses it at TC-D rather than ${trip.tcDowngradedFrom}. The figures above are the reduced ones.`);
  }
  if (card && card.status !== "confirmed") {
    notes.unshift(`These figures come from a rate card that has not been signed off (“${card.label}”). They are what the policy proposes; caps are not enforced against them yet.`);
  }

  const needed = 120;
  if (y + needed > pageH(pdf) - 60) {
    footer(ctx, 1, new Date().toISOString());
    pdf.addPage();
    pageWash(pdf);
    y = headerBand(ctx, { tag: "Travel Authorisation", compact: true }) + 16;
  }

  y = noteBlock(pdf, { x: MARGIN, y, width: W, title: "Before you travel", lines: notes });
  y += 16;

  // ---- signature line -----------------------------------------------------
  divider(pdf, MARGIN, y, W);
  y += 22;
  text(pdf, "Traveller's signature", MARGIN, y + 26, { size: 7.5, color: BRAND.grey });
  pdf.setDrawColor(BRAND.line);
  pdf.setLineWidth(0.8);
  pdf.line(MARGIN, y + 18, MARGIN + 180, y + 18);
  text(pdf, "Date", MARGIN + 220, y + 26, { size: 7.5, color: BRAND.grey });
  pdf.line(MARGIN + 220, y + 18, MARGIN + 340, y + 18);

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
export async function travelAuthorisationBlob(input: AuthorisationInput): Promise<Blob> {
  return (await build(input)).output("blob");
}

/**
 * Hand it to the reader.
 *
 * `pdf.save` rather than an object URL: it is what every other export in this
 * repo does (the Master Report, the receivables customer statement), so the file
 * lands in the same place with the same naming and nothing has to remember to
 * revoke a URL.
 */
export async function downloadTravelAuthorisation(input: AuthorisationInput): Promise<void> {
  (await build(input)).save(authorisationFileName(input.trip));
}
