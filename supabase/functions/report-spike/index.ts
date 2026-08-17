/**
 * report-spike — THROWAWAY, and it has served its purpose. DELETE THE DEPLOYED FUNCTION.
 * (There is no delete in the Supabase MCP tools; remove it from the dashboard, or with
 *  `supabase functions delete report-spike --project-ref icutjkrqkbzwvmnfbzpr`.)
 *
 * THE QUESTION IT ANSWERED
 *   The Collection reports are drawn in the browser with jsPDF and written with xlsx-js-style. To
 *   mail them on a schedule, something has to draw them with nobody logged in. Everything else in
 *   that plan is ordinary work; this was the one part that could have turned out to be impossible,
 *   so it was answered in an afternoon rather than discovered in week two.
 *
 * ── THE ANSWER: YES, ON ALL THREE COUNTS ────────────────────────────────────────────
 *   Run against the live project on 17-Aug-2026:
 *
 *     jsPdfShape     "named jsPDF"       xlsxShape   "default"
 *     fontBytes      160,316             fontRegistered  true
 *     pdfBytes       15,211              pdfPages    2      pdfMagic  true
 *     xlsxBytes      16,719              xlsxMagic   true
 *     ms             75
 *
 *   The PDF was pulled back and read with pdfjs: page 1 extracts as "₹ 1.25 L and ₹ 42.19 Cr" —
 *   both rupee signs present and extractable, one link, one bookmark. So font embedding, vector
 *   drawing, internal links and outlines all work on the edge runtime, in 75 ms.
 *
 * ── THE TWO TRAPS IT FOUND, WHICH ARE THE REAL DELIVERABLE ──────────────────────────
 *   Both libraries ship CJS, and Deno's interop hands back a namespace rather than the thing you
 *   asked for. NEITHER fails at import time — they fail on first use, which in a scheduled job
 *   means at 08:00 in front of nobody:
 *
 *     import jsPDF from "npm:jspdf"        -> "jsPDF is not a constructor"
 *     import * as XLSX from "npm:xlsx-js-style"  -> XLSX.utils is undefined
 *
 *   What works:
 *
 *     import { jsPDF } from "npm:jspdf@4.2.1";              // NAMED export
 *     import XLSX from "npm:xlsx-js-style@1.2.0";           // DEFAULT export
 *
 *   The real builder must use those two forms, and should assert both are callable at module load
 *   rather than discovering it mid-render.
 *
 * ── WHAT THIS DELIBERATELY DID NOT TEST ─────────────────────────────────────────────
 *   The report itself, the receivables data, memory on a full book, or emailing. It sends nothing,
 *   reads no business table and writes nothing anywhere. The remaining open question is SIZE: a
 *   two-page toy proves the runtime, not that ~60 pages over a few thousand invoices fits inside
 *   the function's memory and wall clock. That gets measured against real data in the next step.
 *
 * ── A NOTE ON THE FONT ──────────────────────────────────────────────────────────────
 *   This pulls Poppins off the Google Fonts repo because the spike needed *a* TTF from *somewhere*:
 *   the app's own copy is not reliably reachable over https (portal.orangeotec.com does not resolve
 *   from every runtime, and the Vercel build does not serve /assets/fonts as a fetchable file —
 *   both checked). In production the fonts should be INLINED into the server bundle. That removes a
 *   network call, a base URL and a whole class of failure from the send path, and the browser is
 *   unaffected because it keeps fetching and caching its own copy.
 */

import * as JsPdfNs from "npm:jspdf@4.2.1";
import * as XlsxNs from "npm:xlsx-js-style@1.2.0";

// deno-lint-ignore no-explicit-any
const pick = (cands: [string, any][]) => {
  const hit = cands.find(([, v]) => v !== undefined && v !== null);
  return { shape: hit?.[0] ?? "NONE", value: hit?.[1] };
};

// deno-lint-ignore no-explicit-any
const jns = JsPdfNs as any;
const jsPdfPick = pick([
  ["named jsPDF", typeof jns.jsPDF === "function" ? jns.jsPDF : undefined],
  ["default.jsPDF", typeof jns.default?.jsPDF === "function" ? jns.default.jsPDF : undefined],
  ["default", typeof jns.default === "function" ? jns.default : undefined],
]);

// deno-lint-ignore no-explicit-any
const xns = XlsxNs as any;
const xlsxPick = pick([
  ["namespace", xns.utils ? xns : undefined],
  ["default", xns.default?.utils ? xns.default : undefined],
]);

const FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf";

/** Bytes -> base64 without blowing the stack on a 160 kB font (btoa takes a string). */
function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

Deno.serve(async () => {
  const started = Date.now();
  const steps: Record<string, unknown> = {
    jsPdfShape: jsPdfPick.shape,
    xlsxShape: xlsxPick.shape,
  };

  try {
    const JsPDF = jsPdfPick.value;
    const XLSX = xlsxPick.value;
    if (!JsPDF) throw new Error("no callable jsPDF export found");
    if (!XLSX?.utils) throw new Error("no xlsx namespace with .utils found");

    const pdf = new JsPDF({ orientation: "p", unit: "pt", format: "a4", compress: true });
    steps.constructed = true;

    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`font fetch ${res.status}`);
    const ttf = new Uint8Array(await res.arrayBuffer());
    steps.fontBytes = ttf.length;

    pdf.addFileToVFS("Poppins-Regular.ttf", toBase64(ttf));
    // Identity-H is the whole point: it is what lets a glyph outside WinAnsi through.
    pdf.addFont("Poppins-Regular.ttf", "Poppins", "normal", "Identity-H");
    pdf.setFont("Poppins", "normal");
    steps.fontRegistered = pdf.getFontList().Poppins !== undefined;

    pdf.setFontSize(18);
    pdf.text("₹ 1.25 L and ₹ 42.19 Cr", 40, 80);

    pdf.setFillColor("#FF6A1F");
    pdf.roundedRect(40, 110, 200, 40, 6, 6, "F");
    pdf.triangle(40, 180, 60, 180, 50, 165, "F");
    pdf.link(40, 110, 200, 40, { pageNumber: 2 });
    pdf.addPage();
    pdf.text("page two", 40, 80);
    pdf.outline.add(null, "Home", { pageNumber: 1 });

    const blob = pdf.output("blob") as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    steps.pdfBytes = bytes.length;
    steps.pdfPages = pdf.getNumberOfPages();
    steps.pdfMagic = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

    const ws = XLSX.utils.aoa_to_sheet([
      ["Salesperson", "Customer", "Overdue"],
      ["Rajesh Kumar", "ACME Industries", 1300000],
    ]);
    ws["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 14 }];
    ws.A1.s = { font: { bold: true }, fill: { fgColor: { rgb: "0B1B40" } } };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Collections");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const xb = new Uint8Array(out);
    steps.xlsxBytes = xb.length;
    // Every .xlsx is a zip: "PK".
    steps.xlsxMagic = xb[0] === 0x50 && xb[1] === 0x4b;

    steps.ms = Date.now() - started;
    steps.memoryMb = Math.round((Deno.memoryUsage?.().rss ?? 0) / 1048576);

    // Returned so the rupee glyph can be CHECKED by reading the file, not inferred from a size.
    return Response.json({ ok: true, ...steps, pdfBase64: toBase64(bytes) });
  } catch (e) {
    return Response.json(
      { ok: false, failedAfter: steps, error: (e as Error).message, stack: (e as Error).stack?.slice(0, 800) },
      { status: 500 },
    );
  }
});
