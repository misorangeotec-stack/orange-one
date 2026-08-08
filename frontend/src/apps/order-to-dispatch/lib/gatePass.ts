/**
 * The gate pass, as an A5 PDF — the printed pad, generated.
 *
 * The paper version is a pre-printed leaf where someone writes the date, the
 * customer and the invoice number by hand and ticks MACHINE / SPARE PARTS /
 * HEAD / INK / OTHER. Everything on it is already in the order, so this draws it
 * instead, with the exact items and quantities that were billed in place of the
 * tick-list.
 *
 * ⚠ DRAWN NATIVELY, NOT SCREENSHOTTED. `exportCustomer.ts` renders a whole
 *   dashboard through html2canvas, which is right for charts. This is a dozen
 *   fields on a slip: drawing them gives text that stays crisp at any printer
 *   DPI, a file measured in kilobytes, no dependence on a mounted visible DOM
 *   node, and no exposure to html2canvas failing on a modern CSS colour.
 *
 * ⚠ THE NUMBER IS NEVER MINTED HERE. `gpNo` is allocated server-side when the
 *   sales bill is recorded — one pass per invoice. This function only prints
 *   what it is handed, which is what makes a reprint identical to the original.
 */
import jsPDF from "jspdf";
import { LOGO_SRC } from "@/shared/components/ui/Logo";
import { dmy, sharedUnit } from "./format";
import type { RoundView } from "./rounds";

export interface GatePassData {
  /** e.g. `OTEC-2608-001`. Null means no invoice yet — callers must not get here. */
  gpNo: string | null;
  companyName: string;
  /**
   * OUR site the consignment left from — the order's Dispatch location.
   *
   * ⚠ THE COUNTERPART TO `customerLocation`, NOT A SYNONYM. This one is a master
   *   naming one of our own places (SURAT / NOIDA); that one is free text saying
   *   where the buyer takes delivery. Both print on the slip, which is exactly
   *   why the customer's row is labelled CUSTOMER LOCATION rather than LOCATION.
   *   Null when the order has no location, and then no line is drawn at all.
   */
  companyLocation: string | null;
  customerName: string;
  /** Where the CUSTOMER takes delivery — free text on the order. */
  customerLocation: string | null;
  invoiceNo: string | null;
  /** The invoice date, ISO. Printed dd-mm-yyyy. */
  invoiceDateIso: string | null;
  orderNo: string;
  lines: { name: string; qty: number; unit: string | null }[];
}

/**
 * Turn a round into the slip's contents.
 *
 * ⚠ `itemName` IS REQUIRED, AND IS NOT OPTIONAL POLISH. `lib/rounds.ts`
 *   `liveItems()` returns `itemName: ""` — only the ARCHIVE freezes names, and a
 *   gate pass is printed at Gate Outward Entry, which is always the live round.
 *   Without this resolver every pass prints a blank Particulars column, which is
 *   precisely the part the printed pad exists to carry.
 */
export function gatePassFromRound(
  view: RoundView,
  meta: {
    orderNo: string;
    companyName: string;
    companyLocation: string | null;
    customerName: string;
    customerLocation: string | null;
    itemName: (id: string | null) => string;
  },
): GatePassData {
  return {
    gpNo: view.gpNo,
    companyName: meta.companyName,
    companyLocation: meta.companyLocation,
    customerName: meta.customerName,
    customerLocation: meta.customerLocation,
    invoiceNo: view.sbInvoiceNo,
    invoiceDateIso: view.sbActualDate,
    orderNo: meta.orderNo,
    lines: view.items
      .filter((i) => (Number(i.shipQty) || 0) > 0)
      .map((i) => ({
        // The frozen name on a reprint of an archived round, the master's
        // current name on a live one. Both are right for their case: history
        // should not be rewritten by a rename, and a live round has no snapshot.
        name: i.itemName || meta.itemName(i.itemId) || "Item",
        qty: Number(i.shipQty) || 0,
        unit: i.unitName,
      })),
  };
}

/** A5 portrait, millimetres. */
const PAGE_W = 148;
const PAGE_H = 210;
const M = 12; // margin
const LOGO_H = 11;

/**
 * The logo as a data URL, or null if it could not be had.
 *
 * ⚠ NEVER THROWS, AND NEVER REJECTS. A gate pass that prints without a logo is a
 *   working gate pass; one that refuses to print because an image 404'd is not.
 *   The caller draws the company name in its place.
 *
 * ⚠ FETCH, NOT `new Image()`. The obvious version constructs an Image and reads
 *   naturalWidth for the aspect ratio, but that is a hard DOM dependency that
 *   THROWS rather than degrading anywhere `Image` is undefined, and it cannot be
 *   rendered in a test. jsPDF parses the dimensions out of the data URL itself
 *   (`getImageProperties`), so nothing is lost.
 */
async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_SRC.light);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Chunked: String.fromCharCode(...bytes) blows the argument limit on any
    // real image.
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:image/jpeg;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

const qty = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));

export async function buildGatePassPdf(d: GatePassData): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a5" });
  const right = PAGE_W - M;

  /*
   * The page has always BEEN A5 (148×210mm). What was missing is telling the
   * viewer to keep it that way at print time: with no instruction, Acrobat and
   * every browser print dialog default to the printer's own paper -- A4 here --
   * and "fit to page" the slip up to fill it. The result reads as an A4 gate
   * pass, which is what it was.
   *
   *   PrintScaling: "None"      -> print at true size, do not fit-to-page
   *   PickTrayByPDFSize: true   -> ask for A5 paper rather than the default tray
   *
   * Both are hints a viewer MAY honour, not guarantees, so the person at the
   * printer can still override them. They flip the default from "wrong" to
   * "right", which is the part we control.
   */
  pdf.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true });
  pdf.setProperties({ title: `Gate Pass ${d.gpNo ?? d.orderNo}` });

  /* ---- header: serial + who sent it on the left, logo right ---- */
  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      // Width derived from the image's own dimensions, never hard-coded — a
      // fixed w×h would squash the logo the day the asset is replaced at a
      // different ratio.
      const props = pdf.getImageProperties(logo);
      const w = (props.width / props.height) * LOGO_H;
      pdf.addImage(logo, "JPEG", right - w, M - 4, w, LOGO_H);
    } catch {
      // A corrupt or unexpected image must not cost us the pass. Nothing is
      // drawn in its place: the masthead below already names the company, and
      // it did NOT before — this block used to be the fallback for exactly that.
    }
  }

  pdf.setFont("helvetica", "bold").setFontSize(10);
  pdf.text("Sr. No.:", M, M);
  pdf.setFontSize(12);
  pdf.text(d.gpNo ?? "—", M + 16, M);

  /*
   * The masthead — WHO SENT THIS, which the slip did not say. The serial encodes
   * it (ENT- / OTEC-) but only to someone who knows the prefixes, and the logo is
   * common to both companies. Left-aligned under the serial: the logo owns the
   * right of this band, while the longest company name reaches x = 60mm, so the
   * two cannot meet.
   */
  pdf.setFont("helvetica", "bold").setFontSize(9);
  pdf.text(d.companyName, M, M + 6);
  const branch = d.companyLocation?.trim();
  if (branch) {
    pdf.setFont("helvetica", "normal").setFontSize(8.5);
    pdf.text(branch, M, M + 10.5);
  }

  // Everything below the masthead shifts by whether that second line exists —
  // reserving its space unconditionally would leave a visible gap on an order
  // with no location.
  const headTop = M + (branch ? 7 : 3);

  pdf.setFont("helvetica", "bold").setFontSize(15);
  pdf.text("GATE PASS", PAGE_W / 2, headTop + 14, { align: "center" });
  pdf.setLineWidth(0.4);
  pdf.line(M, headTop + 17, right, headTop + 17);

  /* ---- the facts ---- */
  let y = headTop + 25;
  // Wide enough for CUSTOMER LOCATION:, the longest label — it ends at x = 48.3mm
  // at 9pt bold, so the old 28mm column would have run the label into its value.
  const VALUE_X = M + 40;
  const row = (label: string, value: string) => {
    pdf.setFont("helvetica", "bold").setFontSize(9);
    pdf.text(label, M, y);
    pdf.setFont("helvetica", "normal").setFontSize(9);
    // Wrapped, because a customer name can be longer than the slip is wide.
    const lines = pdf.splitTextToSize(value || "—", right - VALUE_X) as string[];
    pdf.text(lines, VALUE_X, y);
    y += 6 + (lines.length - 1) * 4.2;
  };

  row("DATE:", dmy(d.invoiceDateIso));
  row("NAME:", d.customerName);
  // Labelled for the buyer explicitly: our own location now prints in the
  // masthead, and a bare "LOCATION" would be two facts under one word.
  row("CUSTOMER LOCATION:", d.customerLocation || "—");
  row("INV. NO:", d.invoiceNo || "—");
  row("ORDER NO:", d.orderNo);

  /* ---- particulars: the actual billed items ---- */
  y += 2;
  pdf.setFont("helvetica", "bold").setFontSize(9);
  pdf.text("PARTICULARS", M, y);
  pdf.text("QTY", right, y, { align: "right" });
  y += 2;
  pdf.setLineWidth(0.2);
  pdf.line(M, y, right, y);
  y += 5;

  pdf.setFont("helvetica", "normal").setFontSize(9);
  if (d.lines.length === 0) {
    pdf.text("—", M, y);
    y += 5;
  }
  for (const l of d.lines) {
    const name = pdf.splitTextToSize(l.name, right - M - 26) as string[];
    pdf.text(name, M, y);
    pdf.text(`${qty(l.qty)}${l.unit ? ` ${l.unit}` : ""}`, right, y, { align: "right" });
    y += Math.max(5, name.length * 4.2);
  }

  const total = d.lines.reduce((a, l) => a + l.qty, 0);
  // Same rule as every other total in this app: no unit when the lines disagree,
  // because "500" of KGS and PCS together is a number, not a quantity.
  const unit = sharedUnit(d.lines.map((l) => ({ unit: l.unit })));
  pdf.setLineWidth(0.2);
  pdf.line(right - 34, y - 3, right, y - 3);
  pdf.setFont("helvetica", "bold").setFontSize(9);
  pdf.text("TOTAL", right - 36, y + 1, { align: "right" });
  pdf.text(`${qty(total)}${unit ? ` ${unit}` : ""}`, right, y + 1, { align: "right" });

  /* ---- signatures, anchored to the PAGE BOTTOM ---- */
  // Deliberately not placed after the table: a ten-line order would otherwise
  // push the signature block off the slip, and an unsigned gate pass is useless.
  let sy = PAGE_H - M - 26;
  pdf.setFont("helvetica", "bold").setFontSize(9);
  for (const label of ["SENDER SIGNATURE:", "ADMIN/HR SIGNATURE:", "SECURITY SIGNATURE:"]) {
    pdf.text(label, M, sy);
    pdf.setLineWidth(0.15);
    pdf.line(M + 38, sy + 1, right, sy + 1);
    sy += 10;
  }

  return pdf;
}

/** Build and hand it to the browser. Filename is the pass number. */
export async function downloadGatePass(d: GatePassData): Promise<void> {
  const pdf = await buildGatePassPdf(d);
  pdf.save(`Gate_Pass_${(d.gpNo ?? d.orderNo).replace(/[^\w.-]+/g, "_")}.pdf`);
}
