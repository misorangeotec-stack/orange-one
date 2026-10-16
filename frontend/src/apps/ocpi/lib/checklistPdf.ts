import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Read a machine's service checklist PDF into its check points.
 *
 * The PDF IS the checklist: every point becomes one row the service team marks
 * Ready / Not Ready on the Service Check. There is no separate list to type.
 *
 * Two layouts are understood:
 *
 *  · TABLE (the Orange O Tec "CHECK LIST FOR MACHINE INSTALLATION" format):
 *    Sr. No | Particulars | Ready | Not Ready. A long particular wraps onto
 *    several lines and its Sr. No sits vertically centred beside them, so each
 *    text line is given to the NEAREST serial number. One row = one point.
 *    The title, machine name, column headings and the footer are not rows and
 *    are left out.
 *
 *  · PLAIN LIST: no serial-number column — every text line is a point, with
 *    leading numbering / bullets / tick-box glyphs stripped.
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

interface Frag { x: number; y: number; s: string }
interface Line { y: number; x: number; text: string }

/** Fragments within 3pt of each other vertically form one line, read left to right. */
function toLines(frags: Frag[]): Line[] {
  const rows: { y: number; parts: Frag[] }[] = [];
  for (const f of frags) {
    let r = rows.find((q) => Math.abs(q.y - f.y) <= 3);
    if (!r) rows.push((r = { y: f.y, parts: [] }));
    r.parts.push(f);
  }
  return rows
    .map((r) => {
      const parts = r.parts.sort((a, b) => a.x - b.x);
      return { y: r.y, x: parts[0].x, text: parts.map((p) => p.s).join(" ").replace(/\s+/g, " ").trim() };
    })
    .sort((a, b) => b.y - a.y); // PDF y grows upwards → top of page first
}

/**
 * TABLE layout: the serial numbers in the left-most column, or null when the
 * page has no such column (fewer than 3 numbers).
 */
function serialColumn(frags: Frag[]): Frag[] | null {
  const nums = frags.filter((f) => /^\d{1,3}\.?$/.test(f.s.trim()));
  if (nums.length < 3) return null;
  const minX = Math.min(...nums.map((n) => n.x));
  const col = nums.filter((n) => n.x <= minX + 30);
  if (col.length < 3) return null;
  // Everything else on the page must lie to the RIGHT of the column, or it is
  // not a serial-number column (e.g. numbered sentences in a plain list).
  return col.sort((a, b) => b.y - a.y);
}

function tablePoints(frags: Frag[], serials: Frag[]): string[] {
  const serialSet = new Set(serials);
  const colRight = Math.max(...serials.map((n) => n.x)) + 15;
  const lines = toLines(frags.filter((f) => !serialSet.has(f) && f.x > colRight));

  /*
    ⚠ NOT "NEAREST NUMBER". A tall wrapped row beside a short one puts its top
      line closer to the neighbour's number than to its own. Instead: each
      serial owns ONE CONTIGUOUS BLOCK of lines whose vertical centre sits on
      the number, and the blocks are chosen together (DP, least squared
      off-centre). Lines before the first block (title, machine name, column
      headings) and after the last (the footer) belong to no row.
  */
  const n = lines.length;
  const m = serials.length;
  if (n < m) return [];
  const cost = (i: number, j: number, k: number) => {
    const mid = (lines[i].y + lines[j].y) / 2; // block = lines i..j inclusive
    return (mid - serials[k].y) ** 2;
  };
  // best[k][j]: least cost with rows 0..k placed, row k ending at line j.
  const best: number[][] = Array.from({ length: m }, () => Array(n).fill(Infinity));
  const from: number[][] = Array.from({ length: m }, () => Array(n).fill(-1));
  for (let k = 0; k < m; k++) {
    for (let j = k; j < n; j++) {
      for (let i = k; i <= j; i++) {
        // Rows touch: row k starts right after row k-1 ends (no line between
        // two rows is dropped). Only row 0 may start after skipped lines.
        const prev = k === 0 ? 0 : i > 0 ? best[k - 1][i - 1] : Infinity;
        if (prev === Infinity) continue;
        const c = prev + cost(i, j, k);
        if (c < best[k][j]) { best[k][j] = c; from[k][j] = i; }
      }
    }
  }
  let end = best[m - 1].indexOf(Math.min(...best[m - 1]));
  const rows: Line[][] = Array(m);
  for (let k = m - 1; k >= 0; k--) {
    const start = from[k][end];
    rows[k] = lines.slice(start, end + 1);
    end = start - 1;
  }

  return rows
    .map((r) => r.map((l) => l.text).join(" "))
    .map(cleanChecklistLine)
    .filter((t) => /[A-Za-z]{2,}/.test(t));
}

function plainPoints(frags: Frag[]): string[] {
  return toLines(frags)
    .map((l) => cleanChecklistLine(l.text))
    .filter((t) => /[A-Za-z]{2,}/.test(t))
    .filter((t) => !/^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(t)); // page footers
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
      const frags: Frag[] = [];
      for (const it of content.items as any[]) {
        const s: string = it.str ?? "";
        if (!s.trim()) continue;
        frags.push({ x: it.transform?.[4] ?? 0, y: it.transform?.[5] ?? 0, s });
      }
      const serials = serialColumn(frags);
      for (const text of serials ? tablePoints(frags, serials) : plainPoints(frags)) {
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
