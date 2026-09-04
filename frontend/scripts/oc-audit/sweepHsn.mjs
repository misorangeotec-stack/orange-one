/**
 * One-off sweep: every real paper in both years, pulled for HSN codes and
 * `Model (...)` tokens. Rendered with pdf.js — never parsed from the deck.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readPdfLines, allLines } from "./pdfText.mjs";

const ROOT = path.resolve("../Misc/Bushra Reports/OCPI");

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

const files = (await walk(ROOT)).filter((f) => !f.includes("oc-audit"));
console.log(`# ${files.length} PDFs`);

for (const f of files) {
  let lines;
  try {
    lines = allLines(await readPdfLines(f));
  } catch (e) {
    console.log(`!! ${path.relative(ROOT, f)} — ${e.message}`);
    continue;
  }
  const hits = lines
    .map((l) => l.text)
    .filter((t) => /hsn/i.test(t) || /model\s*[:(]/i.test(t));
  if (!hits.length) continue;
  console.log(`\n## ${path.relative(ROOT, f)}`);
  for (const h of hits) console.log(`   ${h.replace(/\s+/g, " ").trim()}`);
}
