import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

export interface ExportMeta {
  customerName: string;
  company: string;
  location: string;
  asOfDate?: string;
}

export interface CustomerExportData {
  meta: ExportMeta;
  kpis: Array<{ label: string; value: string }>;
  aging: Array<{ bucket: string; amount: number }>;
  monthly: {
    columns: string[]; // first label is "Month"
    rows: Array<Array<string | number>>;
    summary?: Array<string | number>;
  };
}

const safeFileName = (s: string) =>
  s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "customer";

/**
 * Capture one or more DOM regions into a single A4 PDF.
 * Page 1 carries a title header. Each region after the first starts on a fresh page.
 * Elements tagged with `data-export-hide` are omitted from the capture.
 */
export async function exportCustomerPdf(elements: Array<HTMLElement | null>, meta: ExportMeta): Promise<void> {
  const pdf = new jsPDF({ orientation: "p", unit: "px", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;

  // Page 1 title block
  const headerH = 54;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text(meta.customerName, margin, margin + 16);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(110);
  const asOfDMY = meta.asOfDate ? meta.asOfDate.replace(/^(\d{4})-(\d{2})-(\d{2}).*/, "$3-$2-$1") : "";
  const sub = `${meta.company} · ${meta.location}${asOfDMY ? `  ·  As of ${asOfDMY}` : ""}`;
  pdf.text(sub, margin, margin + 32);
  pdf.setTextColor(0);

  let cursorY = margin + headerH; // top of the next slice on the current page
  const regions = elements.filter((el): el is HTMLElement => !!el);

  for (let i = 0; i < regions.length; i++) {
    const canvas = await html2canvas(regions[i], {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      ignoreElements: (node) =>
        node instanceof HTMLElement && node.hasAttribute("data-export-hide"),
    });
    const ratio = contentW / canvas.width; // pdf px per source px

    // Every region after the first begins on a new page.
    if (i > 0) {
      pdf.addPage();
      cursorY = margin;
    }

    let srcY = 0;
    while (srcY < canvas.height) {
      let availPdfH = pageH - cursorY - margin;
      if (availPdfH < 48) {
        pdf.addPage();
        cursorY = margin;
        availPdfH = pageH - cursorY - margin;
      }
      const sliceSrcH = Math.min(Math.floor(availPdfH / ratio), canvas.height - srcY);

      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceSrcH;
      const ctx = slice.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceSrcH, 0, 0, canvas.width, sliceSrcH);
      }
      pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, cursorY, contentW, sliceSrcH * ratio);

      srcY += sliceSrcH;
      cursorY += sliceSrcH * ratio;
      if (srcY < canvas.height) {
        pdf.addPage();
        cursorY = margin;
      }
    }
  }

  pdf.save(`${safeFileName(meta.customerName)}.pdf`);
}

/** Build a multi-sheet workbook: Overview (KPIs), Aging, Monthly Analysis. */
export function exportCustomerXlsx(data: CustomerExportData): void {
  const wb = XLSX.utils.book_new();

  const overview: Array<Array<string | number>> = [
    ["Customer", data.meta.customerName],
    ["Company", data.meta.company],
    ["Location", data.meta.location],
  ];
  if (data.meta.asOfDate) overview.push(["As of", data.meta.asOfDate]);
  overview.push([], ["KPI", "Value"]);
  for (const k of data.kpis) overview.push([k.label, k.value]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overview), "Overview");

  if (data.aging.length > 0) {
    const aging: Array<Array<string | number>> = [["Aging Bucket", "Amount (INR)"]];
    for (const a of data.aging) aging.push([a.bucket, a.amount]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aging), "Aging");
  }

  const monthly: Array<Array<string | number>> = [data.monthly.columns, ...data.monthly.rows];
  if (data.monthly.summary) monthly.push(data.monthly.summary);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthly), "Monthly Analysis");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([out], { type: "application/octet-stream" }), `${safeFileName(data.meta.customerName)}.xlsx`);
}

/** Export the (filtered, visible-column) transactions ledger as a single-sheet
 *  workbook. The customer name + context sit at the top of the sheet. */
export function exportTransactionsXlsx(opts: {
  meta: ExportMeta;
  columns: string[];
  rows: Array<Array<string | number>>;
}): void {
  const wb = XLSX.utils.book_new();
  const aoa: Array<Array<string | number>> = [
    ["Customer", opts.meta.customerName],
    ["Company", opts.meta.company],
    ["Location", opts.meta.location],
  ];
  if (opts.meta.asOfDate) aoa.push(["As of", opts.meta.asOfDate]);
  aoa.push([], opts.columns, ...opts.rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([out], { type: "application/octet-stream" }),
    `${safeFileName(opts.meta.customerName)}-transactions.xlsx`,
  );
}
