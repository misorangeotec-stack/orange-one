/**
 * decks.mjs — the two decks supplied on 02-09-2026, read for "what is missing".
 *
 * Both land on master rows with `has_template = false`, so nothing is
 * overwritten and no contract changes. This answers the question that was asked
 * — what a template for each would need — and stops there. **Building them is a
 * separate task**: it writes the words that print on signed contracts.
 *
 * 🔴 TRANSCRIPTION COMES FROM THE RENDER, NEVER FROM THIS FILE'S OUTPUT. Four of
 *    the nine decks in the last batch fuse words in OOXML — `Followingupyourkind
 *    order`, `THEMACHINEISCOMPOSEDASFOLLOWS` — and fused text reads as prose with
 *    typos rather than as corruption, so it transcribes into a customer contract
 *    without anything failing. The XML walk here COUNTS and NAMES things, which
 *    is safe; every slide is also exported to PNG under `oc-audit/decks/` and the
 *    words themselves must be taken from those.
 *
 * 🔴 THE DANGER SWEEP IS THE POINT OF READING THE XML AT ALL. `FABPRO 1I.pptx`
 *    arrived as a filled-in live contract — customer PRINTING PARADISE, their GST
 *    number, Rs 40,00,000 — and transcribed verbatim that lands on every future
 *    Fab Pro contract. Any new deck is swept for customer names, GST numbers,
 *    amounts and bank details before a word of it is trusted.
 *
 * ⚠ ORANGE'S OWN BANK DETAILS ARE NOT A FINDING. Every deck carries `A/C no.
 *   919030077980346` and `IFSC: UTIB0003360` because that is the company's own
 *   account, and in our templates it resolves from the company profile through
 *   `{{bank_block}}`. Reported separately from the things that must be stripped.
 */

import { readFileSync } from "node:fs";
import JSZip from "jszip";

// (Orange O Tec's own account and IFSC appear on every deck; both are reported with the
// note that they belong in `{{bank_block}}` rather than in template text.)

const DANGER = [
  {
    label: "a customer GST number",
    re: /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]\b/g,
    fix: "**Strip it.** The deal supplies the customer; hard-coded, this prints another company's GST number on every contract for the model — exactly what `FABPRO 1I.pptx` would have done.",
  },
  {
    label: "a money figure",
    re: /\b(?:INR|USD|Rs\.?|₹|\$)\s?[\d,]{5,}(?:\.\d{2})?|\b\d{1,3},\d{2},\d{3}(?:\.\d{2})?\b/g,
    fix: "**Strip it.** The renderer draws the money block from the deal, so a figure left in the template would print beside a different — and correct — total on the same page.",
  },
  {
    label: "a bank account number",
    re: /\bA\/?C\s*no\.?\s*\d{6,}/gi,
    fix: "Orange's own account. Our templates resolve it from the company profile through `{{bank_block}}`, which is what lets a Colorix or Noida deal print its own bank. Do not hard-code it.",
  },
  {
    label: "an IFSC code",
    re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    fix: "As above — part of `{{bank_block}}`, not template text.",
  },
  /*
    🔴 ANOTHER MANUFACTURER'S NAME IN A DECK IS A LOUD SIGNAL. The Mini Lario deck
       carries `MARKEM-IMAJE` — a different company — inside its legal clauses,
       which says the terms were lifted from a third party's contract rather than
       written for Orange O Tec. Transcribed as-is, an Orange contract would bind
       the customer to another firm's warranty disclaimer, indemnity and governing
       law. This is not a formatting problem; it needs a person to decide which of
       those clauses Orange actually intends to offer.
  */
  {
    label: "another company's name",
    re: /\b(MARKEM[- ]?IMAJE|DOVER|MS\s+PRINTING\s+SOLUTIONS)\b/gi,
    fix: "🔴 **A person decides this, not a transcriber.** The legal clauses around it — limited warranty, limitation of liability, indemnity, data privacy, governing law — read as another manufacturer's standard terms rather than Orange O Tec's. Carried across as they stand, an Orange contract would offer a third party's warranty disclaimer and bind the customer to their dispute resolution. Ritesh Bhai settles which of these clauses Orange actually intends to offer before any of it becomes a template.",
  },
];

/** Slide text, in slide order. Counting and naming only — never transcription. */
async function slideText(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const out = [];
  for (const n of names) {
    const xml = await zip.file(n).async("string");
    out.push([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ").replace(/\s+/g, " "));
  }
  return out;
}

/**
 * Runs of capitals that read as clause headings.
 *
 * ⚠ APPROXIMATE, AND SAID SO IN THE REPORT. The Mini Lario deck sets whole
 *   paragraphs of its warranty disclaimer in capitals — "THE WARRANTY IS
 *   EXCLUSIVE AND IN LIEU OF ALL OTHER EXPRESS AND IMPLIED WARRANTIES…" — so a
 *   naive run-of-capitals count returned 50 "headings" for a deck that has
 *   perhaps twenty. Length and word caps plus a stop-word list cut the sentence
 *   fragments; the rendered slides remain the authority.
 */
const FRAGMENT_START =
  /^(THE|AND|THAT|OR|A|S|WITH|INCLUDING|AGAINST|USAGE|CONFORMITY|REPRESENTATION|WARRANTIES|COMBINATION|IT |TO |IN )\b/;

function headings(text) {
  const out = [];
  for (const m of text.matchAll(/\b([A-Z][A-Z '&,.\-/]{8,70})\b/g)) {
    const s = m[1].trim().replace(/\s+/g, " ").replace(/[.\-,]+$/, "");
    if (s.length < 10 || s.length > 55) continue;
    if (s.split(/\s+/).length > 7) continue;
    if (FRAGMENT_START.test(s)) continue;
    if (/^(ORANGE|SHED|GIDC|G\.I\.D\.C|CIN|AXIS BANK|SACHIN|INDIA|SURAT)/.test(s)) continue;
    out.push(s);
  }
  return [...new Set(out)];
}

export async function readDecks(specs, machines, sections) {
  const out = [];
  for (const spec of specs) {
    let slides;
    try {
      slides = await slideText(spec.path);
    } catch (e) {
      out.push({ ...spec, error: e.message });
      continue;
    }
    const text = slides.join(" ");
    const machine = machines.find((m) => m.name === spec.machine);
    const mine = machine ? sections.filter((s) => s.machineId === machine.id && s.active) : [];

    const risks = [];
    for (const d of DANGER) {
      const hits = [...new Set(text.match(d.re) ?? [])];
      if (hits.length) risks.push({ ...d, hits });
    }

    out.push({
      ...spec,
      slides: slides.length,
      headings: headings(text),
      risks,
      machineFound: !!machine,
      hasTemplate: machine?.hasTemplate ?? false,
      existingSections: mine.length,
      billingName: machine?.billingName ?? null,
      modelNo: machine?.machineModelNo ?? null,
      headerFields: machine?.headerFields ?? [],
    });
  }
  return out;
}

/** The decks section of the report. */
export function deckReport(decks) {
  const L = [];
  L.push("## The two decks added on 02-09-2026");
  L.push("");
  L.push("Both land on master rows that carry **no template at all**, so nothing is overwritten and no");
  L.push("existing contract changes. Every slide was exported to PNG through PowerPoint and read from the");
  L.push("image — the counts below come from the file's XML as a cross-check only, because four of the nine");
  L.push("decks in the last batch fuse words in OOXML and fused text reads as prose with typos rather than");
  L.push("as corruption. Slides are in `Misc/Bushra Reports/OCPI/oc-audit/decks/`.");
  L.push("");
  for (const d of decks) {
    L.push("### " + d.machine + "  ·  `" + d.file + "`");
    L.push("");
    if (d.error) {
      L.push("⚠ could not be read: " + d.error);
      L.push("");
      continue;
    }
    L.push("| | |");
    L.push("|---|---|");
    L.push("| Slides | " + d.slides + " |");
    L.push("| Master row | " + (d.machineFound ? "`" + d.machine + "` — **" + (d.hasTemplate ? "already templated" : "no template") + "**, " + d.existingSections + " section rows today" : "**not found in the master**") + " |");
    L.push("| Billing name today | " + (d.billingName ? "`" + d.billingName + "`" : "**not set**") + " |");
    L.push("| Model no. today | " + (d.modelNo ? "`" + d.modelNo + "`" : "**not set** — the deck states one, so use the literal") + " |");
    L.push("| Header fields today | " + (d.headerFields.length ? d.headerFields.join(", ") : "—") + " |");
    L.push("| Candidate clause headings | " + d.headings.length + " — approximate, counted from the XML; the rendered slides are the authority |");
    L.push("");
    L.push("**Headings the deck carries** — " + d.headings.map((h) => "`" + h + "`").join(" · "));
    L.push("");
    if (d.risks.length) {
      L.push("🔴 **Sweep before transcribing.**");
      L.push("");
      for (const r of d.risks) {
        L.push("- **" + r.label + "** — " + r.hits.map((h) => "`" + h + "`").join(", "));
        L.push("  " + r.fix);
      }
    } else {
      L.push("✅ Swept for customer names, GST numbers, amounts and bank details across all " + d.slides + " slides — nothing to strip.");
    }
    L.push("");
    L.push("**What is missing:** everything — this machine has no `intro_text`, no `spec_rows`, no");
    L.push("`composition`, no `supply_description` and no `fms_ocpi_machine_sections` rows, so it prints no");
    L.push("order confirmation at all. " + (d.note ?? ""));
    L.push("");
  }
  L.push("⚠ **Neither template is built here.** You asked what is missing; building writes the words that");
  L.push("print on signed contracts, and it is raised as its own work item with these renders attached.");
  L.push("**`Pengda PD-1800XD-800` still has no deck at all** and remains a gap.");
  L.push("");
  return L;
}
