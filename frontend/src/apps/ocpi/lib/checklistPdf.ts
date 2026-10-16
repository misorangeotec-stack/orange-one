import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Read a machine's service checklist PDF into its check points.
 *
 * The PDF IS the checklist: every line of text becomes one box the service team
 * accepts or rejects on the Service Check. There is no separate list to type.
 *
 * pdfjs hands back text in fragments with a position. We group fragments into
 * lines by their y position (per page, top to bottom), join each line left to
 * right, strip leading numbering / bullets / empty tick-box glyphs, and drop
 * duplicates and lines with no letters (page numbers, rules).
 *
 * ⚠ A SCANNED PDF HAS NO TEXT. It comes back as an empty list; the uploader is
 *   told, and the PDF is still kept for download.
 */

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return pdfjsPromise;
}

/** Leading "1.", "1)", "(a)", "a.", "i)", "•", "-", "☐", "□" … plus spaces. */
const LEAD = /^\s*(?:[☐☑☒□■▪●•◦‣∙·*–—-]+\s*|\(?\d{1,3}[.)\]:]\s*|\(?[a-zA-Z][.)]\s+|\(?[ivxIVX]{1,4}[.)]\s+)+/;
/** Trailing "Yes / No", "OK / Not OK", "☐", "____" columns left over from a printed form. */
const TRAIL = /(?:\s*(?:[☐☑☒□]|_{2,}|\.{3,}|\byes\s*\/\s*no\b|\bok\s*\/\s*not\s*ok\b))+\s*$/i;

export function cleanChecklistLine(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(LEAD, "").replace(TRAIL, "").trim();
}

export async function readChecklistPdf(file: File): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  const seen = new Set<string>();

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();

      // y → fragments on that line. Fragments within 3pt of a line join it.
      const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
      for (const it of content.items as any[]) {
        const s: string = it.str ?? "";
        if (!s.trim()) continue;
        const x = it.transform?.[4] ?? 0;
        const y = it.transform?.[5] ?? 0;
        let line = lines.find((l) => Math.abs(l.y - y) <= 3);
        if (!line) lines.push((line = { y, parts: [] }));
        line.parts.push({ x, s });
      }

      lines.sort((a, b) => b.y - a.y); // PDF y grows upwards
      for (const l of lines) {
        const text = cleanChecklistLine(
          l.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(" "),
        );
        if (!/[A-Za-z]{2,}/.test(text)) continue;
        if (/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(text)) continue; // page footers
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
