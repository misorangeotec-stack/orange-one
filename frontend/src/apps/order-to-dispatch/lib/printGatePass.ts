/**
 * The gate pass, PRINTED — the slip that leaves with the consignment.
 *
 * ⚠ PRINTED, NOT DOWNLOADED. This used to build an A5 PDF and hand it to the
 *   browser as a file: the security desk then had to find it in Downloads, open
 *   it, and print from a viewer, on a slip that is only ever wanted on paper.
 *   Rendering it as HTML into a hidden iframe and calling `print()` puts the
 *   printer dialog on screen at the click, which is exactly what Production does
 *   for its issue slip (`production-entry/lib/printIssueSlip.ts`).
 *
 * ⚠ `@page { size: A5 portrait }` IS THE POINT, not decoration. With no size
 *   declared the dialog defaults to the printer's own paper — A4 here — and
 *   scales the slip up to fill it, which is how an A5 pad ends up printing as an
 *   A4 sheet.
 *
 * ⚠ THE NUMBER IS NEVER MINTED HERE. `gpNo` is allocated server-side when the
 *   sales bill is recorded — one pass per invoice. This only prints what it is
 *   handed, which is what makes a reprint identical to the original.
 */
import { LOGO_SRC } from "@/shared/components/ui/Logo";
import { dmy, sharedUnit } from "./format";
import type { GatePassData } from "./gatePass";

function esc(v: string | number | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const qty = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

/** Build the printable HTML document for a gate pass. */
export function renderGatePassHtml(d: GatePassData): string {
  const branch = d.companyLocation?.trim();

  const facts = [
    ["DATE:", dmy(d.invoiceDateIso)],
    ["NAME:", d.customerName],
    // Labelled for the buyer explicitly: our own site prints in the masthead, and
    // a bare "LOCATION" would be two different facts under one word.
    ["CUSTOMER LOCATION:", d.customerLocation || "—"],
    ["INV. NO:", d.invoiceNo || "—"],
    ["ORDER NO:", d.orderNo],
  ]
    .map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value || "—")}</td></tr>`)
    .join("");

  const lines = d.lines.length
    ? d.lines
        .map(
          (l) => `<tr>
            <td>${esc(l.name)}</td>
            <td class="r">${esc(qty(l.qty))}${l.unit ? ` ${esc(l.unit)}` : ""}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td>—</td><td class="r">—</td></tr>`;

  const total = d.lines.reduce((a, l) => a + l.qty, 0);
  // Same rule as every other total in this app: no unit when the lines disagree,
  // because "500" of KGS and PCS together is a number, not a quantity.
  const unit = sharedUnit(d.lines.map((l) => ({ unit: l.unit })));

  const signatures = ["SENDER SIGNATURE:", "ADMIN/HR SIGNATURE:", "SECURITY SIGNATURE:"]
    .map((label) => `<tr><th>${esc(label)}</th><td class="rule"></td></tr>`)
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Gate Pass ${esc(d.gpNo ?? d.orderNo)}</title>
<style>
  @page { size: A5 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  /* The signature block is anchored to the FOOT of the slip, not to the end of
     the item list — a ten-line order would otherwise push it off the page, and
     an unsigned gate pass is useless. */
  html, body { height: 100%; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11px;
         display: flex; flex-direction: column; min-height: 100%; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .serial { font-size: 12px; font-weight: bold; }
  .serial span { font-weight: normal; }
  .company { font-size: 11px; font-weight: bold; margin-top: 4px; }
  .branch { font-size: 10px; color: #444; margin-top: 1px; }
  .logo { height: 13mm; width: auto; }
  h1 { font-size: 17px; text-align: center; margin: 10px 0 4px; letter-spacing: 1px; }
  .rule-full { border-top: 1.2px solid #000; margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; }
  table.facts th { text-align: left; font-size: 10.5px; width: 38mm; padding: 2.2px 0; vertical-align: top; }
  table.facts td { font-size: 10.5px; padding: 2.2px 0; }
  .sec { margin-top: 8px; }
  table.items th { text-align: left; font-size: 10.5px; border-bottom: 1px solid #000; padding: 3px 0; }
  table.items td { font-size: 10.5px; padding: 3px 0; vertical-align: top; }
  table.items .r, table.items th.r { text-align: right; }
  table.items tr.total td { border-top: 1px solid #000; font-weight: bold; padding-top: 4px; }
  .sign { margin-top: auto; padding-top: 14px; }
  table.sign th { text-align: left; font-size: 10.5px; white-space: nowrap; padding: 6px 6px 6px 0; width: 40mm; }
  table.sign td.rule { border-bottom: 0.6px solid #000; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="serial">Sr. No.: <span>${esc(d.gpNo ?? "—")}</span></div>
      <!-- WHO SENT THIS. The serial encodes it (ENT- / OTEC-) but only to someone
           who knows the prefixes, and the logo is common to both companies. -->
      <div class="company">${esc(d.companyName)}</div>
      ${branch ? `<div class="branch">${esc(branch)}</div>` : ""}
    </div>
    <img class="logo" src="${esc(LOGO_SRC.light)}" alt="" onerror="this.remove()" />
  </div>

  <h1>GATE PASS</h1>
  <div class="rule-full"></div>

  <table class="facts">${facts}</table>

  <div class="sec">
    <table class="items">
      <thead><tr><th>PARTICULARS</th><th class="r">QTY</th></tr></thead>
      <tbody>
        ${lines}
        <tr class="total">
          <td>TOTAL</td>
          <td class="r">${esc(qty(total))}${unit ? ` ${esc(unit)}` : ""}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="sign"><table class="sign">${signatures}</table></div>
</body>
</html>`;
}

/**
 * Render the gate pass into a hidden iframe and open the browser's print dialog.
 *
 * The iframe's `load` event waits on the logo, so the slip never prints half-drawn;
 * a logo that 404s removes itself and the pass prints anyway — a gate pass without
 * a logo is a working gate pass, one that refuses to print is not.
 */
export function printGatePass(d: GatePassData): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.srcdoc = renderGatePassHtml(d);
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    const cleanup = () => setTimeout(() => iframe.remove(), 500);
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    // Fallback cleanup in case afterprint never fires (some browsers).
    setTimeout(cleanup, 60000);
  };
  document.body.appendChild(iframe);
}
