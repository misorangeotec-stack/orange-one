/**
 * discover.mjs — find every real ORDER CONFIRMATION in a year folder, by
 * reading it rather than by trusting its filename.
 *
 * 🔴 THE FILENAME LIES AND THE FOLDER NAME LIES. `106- NOOR DYEING ….pdf` carries
 *    no OC/PI marker at all; `107-PANKAJ FASHION 01.09.26.pdf` names neither;
 *    `109- … 25 aug.pdf` reads as an OC from its name and is a Performa Invoice.
 *    One folder holds six PIs and no contract. So every PDF is opened and
 *    classified on its own heading and its own body.
 *
 * ⚠ A CONTRACT IS NOT JUST A HEADING. `MP5000` and `P8D` head their contracts
 *   `OFFER QUOTE`, and a Performa Invoice can carry the word "Order" in a
 *   reference line. The test is the heading PLUS a clause body — a real OC runs
 *   to SALE CONDITIONS / WARRANTY / CANCELLATION and a PI never does.
 *
 * ⚠ SCANNED SIGNED COPIES HAVE NO TEXT LAYER and are skipped with a reason, not
 *   silently. Several folders hold "SCAN & SIGNED OC.pdf" beside the original.
 *
 * ⚠ NEVER PARSE THE `.pptx` / `.docx`. Two folders (102, 127) hold their OC ONLY
 *   as a deck with no PDF beside it. Those are REPORTED as uncovered rather than
 *   read — turning them into PDFs is a separate, deliberate step.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readPdfLines, allLines } from "./pdfText.mjs";

/** A heading that a contract uses. `doc_title` on the master records both. */
const CONTRACT_HEADING = /\b(ORDER\s*CONFIRMATION|OFFER\s*QUOTE)\b/i;
const INVOICE_HEADING = /\b(PERFORMA|PROFORMA)\s*INVOICE\b/i;

/** Clause titles no Performa Invoice carries. Two or more ⇒ a contract body. */
const CLAUSE_TELLS = [
  /SALE\s*CONDITIONS/i,
  /\bWARRANTY\b/i,
  /\bCANCELLATION\b/i,
  /INSTALLATION\s*AND\s*START/i,
  /NOT\s*INCLUDED/i,
  /PRINT\s*HEAD\s*POLICY/i,
  /CUSTOMER.?S?\s*CARE/i,
  /COMPOSED\s*AS\s*FOLLOWS/i,
];

export async function walkPdfs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkPdfs(p)));
    else if (e.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

/** Decks holding a contract that has no PDF beside it — reported, never parsed. */
export async function deckOnlyContracts(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const files = await readdir(p, { withFileTypes: true });
      const names = files.filter((f) => f.isFile()).map((f) => f.name);
      const deckOc = names.find((n) => /\.pptx$/i.test(n) && /\boc\b/i.test(n) && !/^~\$/.test(n));
      const pdfOc = names.some((n) => /\.pdf$/i.test(n) && /\boc\b/i.test(n));
      if (deckOc && !pdfOc) out.push({ folder: e.name, deck: deckOc });
      out.push(...(await deckOnlyContracts(p)).map((r) => ({ ...r, folder: e.name + "/" + r.folder })));
    }
  }
  return out;
}

/**
 * What one PDF is. Never throws — a file that cannot be read comes back as
 * `kind: "unreadable"` with the reason, because a silently skipped paper is the
 * failure this whole audit exists to prevent.
 */
export async function classify(file) {
  let doc;
  try {
    doc = await readPdfLines(file);
  } catch (e) {
    return { file, kind: "unreadable", why: e.message };
  }
  if (!doc.hasTextLayer) {
    return { file, kind: "unreadable", why: "image-only scan, no text layer", doc: null };
  }
  const lines = allLines(doc).map((l) => l.text);
  const text = lines.join("\n");

  const heading = lines.find((l) => CONTRACT_HEADING.test(l)) ?? "";
  const clauseHits = CLAUSE_TELLS.filter((re) => re.test(text)).length;
  const num = /\bOTPL\/[A-Z]+\/[0-9]+\/[0-9-]+/i.exec(text)?.[0] ?? null;

  /*
    ⚠ THE INVOICE HEADING DOES NOT SURVIVE THE BOX ORDER on most of these files —
      a PI's "Performa No." sits in its own text box and pdf.js hands it back
      wherever PowerPoint stored it, so heading-matching alone classified 36 real
      Performa Invoices as "other". A PI is therefore recognised by what it
      structurally IS: it carries the deal's OTPL number and money, and it has no
      clause body. Two clause tells is the floor — a PI legitimately mentions
      "Delivery Terms" and one or two more in its terms block.
  */
  let kind;
  if (CONTRACT_HEADING.test(heading) && clauseHits >= 2) kind = "contract";
  else if (clauseHits >= 4) kind = "contract"; // a contract whose heading did not survive the box order
  else if (INVOICE_HEADING.test(text) || num) kind = "invoice";
  else kind = "other";

  return { file, kind, heading: heading.trim(), clauseHits, docNo: num, doc, lines };
}

/**
 * Identify the machine from what the paper says, never from the folder name.
 *
 * 🔴 THE SPECIFICATION FINGERPRINT DECIDES, AND NAME-MATCHING GETS IT WRONG.
 *    Proved on real contract 124 (Clothera): its folder says "1.9 16 PH", a
 *    composition bullet says "KoloRado alpha II", and matching on names put it on
 *    `KoloRado Alpha II — 1.9 m` — whose printing width is `1900 mm | 2200 mm`.
 *    The paper says `1800 mm | 2200 mm`, and every one of its four literal spec
 *    values matches `KoloRado Alpha 3 — 12 heads` exactly. Names on these papers
 *    are marketing; the spec table is the machine.
 *
 * ⚠ ONLY LITERAL SPEC VALUES COUNT. A master row storing `{{head_count}} Heads`
 *   would match every paper, so token-bearing values are skipped — which is also
 *   why a head count NEVER identifies a machine: it is a per-deal answer, and 124
 *   is a 16-head deal on a row whose name says 12.
 *
 * ⚠ THE `Model:` LINE IS ONE VOTE, NOT THE ANSWER. 124 prints `Model: KoloRado
 *   alpha III` while its folder, its PI and OCPI-36's note all call it something
 *   else. The manufacturer's CODE is trustworthy — it is unique per machine — the
 *   sales model line is not.
 *
 * ⚠ A WEAK BEST MATCH IS REPORTED AS WEAK. `confidence` is "strong" on a model
 *   code or three-plus spec matches, "weak" otherwise, and the report prints the
 *   runner-up so a wrong match is visible rather than silent.
 */
export function identifyMachine(lines, machines, specRows = []) {
  const fold = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hay = fold(lines.join(" "));
  const paperSpec = new Map(specRows.map((r) => [fold(r.label), fold(r.value)]));
  const scored = [];

  for (const m of machines) {
    let score = 0;
    let specMatches = 0;
    const why = [];

    const code = m.machineModelNo?.trim();
    if (code && hay.includes(fold(code))) { score += 100; why.push("model code " + code); }

    for (const row of m.specRows ?? []) {
      if (/\{\{|\[\[/.test(row.value ?? "")) continue;   // a token matches everything
      const mine = fold(row.value);
      if (mine.length < 3) continue;
      const theirs = paperSpec.get(fold(row.label));
      if (theirs && theirs === mine) { score += 30; specMatches += 1; }
      else if (theirs && theirs !== mine) score -= 20;    // a stated contradiction
    }
    if (specMatches) why.push(specMatches + " spec row(s) matched exactly");

    if (m.billingName?.trim() && hay.includes(fold(m.billingName))) { score += 20; why.push("billing name"); }

    const base = fold(m.name.split("—")[0]);
    if (base.length >= 4 && hay.includes(base)) {
      score += 10;
      why.push("name");
      const qual = m.name.split("—")[1] ?? "";
      const metres = /([0-9]\.[0-9])\s*m/i.exec(qual)?.[1];
      if (metres && (hay.includes(fold(metres + "METER")) || hay.includes(fold(metres + "MTR")))) {
        score += 25;
        why.push(metres + " m");
      }
    }
    if (score > 0) scored.push({ machine: m, score, specMatches, why });
  }

  scored.sort((a, b) => b.score - a.score || b.machine.name.length - a.machine.name.length);
  if (!scored.length) return { machine: null, score: 0, why: [], runnerUp: null, confidence: "none" };
  const top = scored[0];
  const strong = top.specMatches >= 3 || /model code/.test(top.why.join(" "));
  return { ...top, runnerUp: scored[1] ?? null, confidence: strong ? "strong" : "weak" };
}
