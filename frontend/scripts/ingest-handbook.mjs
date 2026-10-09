#!/usr/bin/env node
/**
 * ingest-handbook.mjs - load the HR handbook into the Knowledge Base (KB-1).
 *
 * WHY THIS IS A LOCAL CLI AND NOT AN IN-APP UPLOAD:
 *   The handbook is a legal document revised once or twice a year, and every revision is a
 *   policy change. Somebody should READ WHAT CHANGED before the portal starts quoting it.
 *   So a publish is: run this, read the diff, confirm. There is no self-service path.
 *
 * USAGE (from the `frontend/` folder):
 *   npm run handbook                               # diff only, against files/HR_Handbook_Formatted_v4.doc
 *   npm run handbook -- --publish                  # write a new version and make it current
 *   npm run handbook -- --file "../files/X.doc"    # a different source
 *   npm run handbook -- --json out.json            # dump the parsed sections and stop
 *
 * PREREQUISITES:
 *   1. Microsoft Word, for .doc -> .docx. The source is a legacy OLE binary that no Node
 *      library reads. Word 16 is on the build machine; this script drives it through
 *      PowerShell. Give it a .docx directly and Word is not needed.
 *      WARNING: never let Word "Save As" plain text here. That format is ANSI, so the rupee
 *      sign becomes "?". We read the .docx XML, which is UTF-8.
 *   2. The repo-root `.env` with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (gitignored).
 *      Not needed for --json.
 *
 * WHAT IT DOES NOT DO: it does not tidy the handbook. Chapter 4's OBJECTIVE heading is
 * empty and its paid-leave rules sit under TYPES OF LEAVE, because that is how the Word
 * file is styled. The model reads the whole document, so a misplaced boundary costs
 * nothing; "fixing" it here would make our copy disagree with the paper one.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const SLUG = "hr-handbook";
const TITLE = "HR Manual";
const DEFAULT_SOURCE = path.join(REPO, "files", "HR_Handbook_Formatted_v4.doc");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/* ------------------------------- arguments -------------------------------- */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const SOURCE = path.resolve(value("file", DEFAULT_SOURCE));
const PUBLISH = flag("publish");
const JSON_OUT = value("json", null);

/* --------------------------------- .env ----------------------------------- */

function loadEnv() {
  for (const p of [path.join(REPO, ".env"), path.join(REPO, "frontend", ".env.local")]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  }
}

/* --------------------------- .doc  ->  .docx ------------------------------- */

function toDocx(src) {
  if (src.toLowerCase().endsWith(".docx")) return src;
  const out = path.join(os.tmpdir(), `handbook-${crypto.randomBytes(4).toString("hex")}.docx`);
  // wdFormatDocumentDefault = 16. Read-only open, alerts off, so nothing can block.
  const ps = `
$ErrorActionPreference = 'Stop'
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$w.DisplayAlerts = 0
try {
  $d = $w.Documents.Open('${src.replace(/'/g, "''")}', $false, $true)
  $d.SaveAs2('${out.replace(/'/g, "''")}', 16)
  $d.Close(0)
} finally { $w.Quit() }
`;
  console.log(`  converting ${path.basename(src)} through Word...`);
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  return out;
}

/* ------------------------------ docx parsing ------------------------------- */

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** Text of one element, honouring tabs and soft breaks, in document order. */
function textOf(xml) {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) out += decode(m[1]);
    else if (m[0].startsWith("<w:tab")) out += "\t";
    else out += "\n";
  }
  return out;
}

/** Split a container's XML into its immediate <w:p> and <w:tbl> children, in order. */
function topLevelChildren(xml) {
  const parts = [];
  let i = 0;
  while (i < xml.length) {
    const p = xml.indexOf("<w:p", i);
    const t = xml.indexOf("<w:tbl", i);
    // Guard against <w:pPr>, <w:tblPr> etc. matching the prefix.
    const isEl = (at, tag) => at >= 0 && /[\s>/]/.test(xml[at + tag.length]);
    const pOk = isEl(p, "<w:p");
    const tOk = isEl(t, "<w:tbl");
    let at, kind;
    if (pOk && (!tOk || p < t)) { at = p; kind = "p"; }
    else if (tOk) { at = t; kind = "tbl"; }
    else break;

    if (kind === "p") {
      const head = xml.slice(at, xml.indexOf(">", at) + 1);
      if (head.endsWith("/>")) { parts.push({ kind, xml: head }); i = at + head.length; continue; }
      const end = xml.indexOf("</w:p>", at);
      if (end < 0) break;
      parts.push({ kind, xml: xml.slice(at, end + 6) });
      i = end + 6;
    } else {
      // Tables nest, so walk to the matching close.
      let depth = 0, j = at;
      for (;;) {
        const open = xml.indexOf("<w:tbl", j + 1);
        const close = xml.indexOf("</w:tbl>", j + 1);
        if (close < 0) { j = -1; break; }
        if (open >= 0 && open < close && /[\s>]/.test(xml[open + 6])) { depth++; j = open; continue; }
        if (depth === 0) { j = close; break; }
        depth--; j = close;
      }
      if (j < 0) break;
      parts.push({ kind, xml: xml.slice(at, j + 8) });
      i = j + 8;
    }
  }
  return parts;
}

/**
 * ⚠ A cell is read PARAGRAPH BY PARAGRAPH, never as one run of text.
 * Several of the handbook's callout boxes are a 1x1 table holding four or five
 * paragraphs, and concatenating their <w:t> runs fuses the last word of one to the first
 * of the next: "Rates Pending ConfirmationAll rate caps below...". The model then reads a
 * word that is not in the handbook. Same trap as the OCPI decks.
 */
function cellText(cellXml) {
  const paras = topLevelChildren(cellXml)
    .filter((c) => c.kind === "p")
    .map((c) => textOf(c.xml).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paras.join("\n");
}

function parseTable(xml) {
  const rows = [];
  const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
  let tr;
  while ((tr = trRe.exec(xml))) {
    const cells = topLevelCells(tr[1]).map(cellText);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function topLevelCells(trXml) {
  const out = [];
  let i = 0;
  for (;;) {
    const at = trXml.indexOf("<w:tc", i);
    if (at < 0 || !/[\s>]/.test(trXml[at + 5])) break;
    const end = trXml.indexOf("</w:tc>", at);
    if (end < 0) break;
    out.push(trXml.slice(at, end + 7));
    i = end + 7;
  }
  return out;
}

async function parseDocx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));

  const stylesXml = await zip.file("word/styles.xml").async("string");
  const styles = new Map();
  const sRe = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let s;
  while ((s = sRe.exec(stylesXml))) {
    const n = /<w:name\s+w:val="([^"]+)"/.exec(s[2]);
    if (n) styles.set(s[1], n[1]);
  }

  const relsXml = await zip.file("word/_rels/document.xml.rels").async("string");
  const rels = new Map();
  const rRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let r;
  while ((r = rRe.exec(relsXml))) rels.set(r[1], r[2].replace(/^\.\//, ""));

  const docXml = await zip.file("word/document.xml").async("string");
  const bodyStart = docXml.indexOf("<w:body>");
  const body = docXml.slice(bodyStart + 8, docXml.lastIndexOf("</w:body>"));

  // ⚠ FILES ONLY. v5 was saved with an explicit "word/media/" directory entry in the zip,
  // which Word's own .doc -> .docx conversion never wrote. Counting it made the summary say
  // "8 pictures" for 7, and at publish time the upload loop sorts it FIRST (no digits in the
  // name, so it reads as 0), which would number every real picture one too high and then
  // throw on zip.file("word/media/"), which is null for a directory.
  const media = [];
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith("word/media/") && !zip.files[name].dir) media.push(name);
  }
  media.sort((a, b) =>
    (Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0)));

  const blocks = [];
  let imageOrdinal = 0;
  for (const child of topLevelChildren(body)) {
    if (child.kind === "tbl") {
      const rows = parseTable(child.xml);
      if (rows.length) blocks.push({ kind: "table", rows });
      continue;
    }
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(child.xml)?.[1] ?? "";
    const styleId = /<w:pStyle\s+w:val="([^"]+)"/.exec(pPr)?.[1] ?? null;
    const styleName = styles.get(styleId) ?? styleId ?? "Normal";
    const numbered = /<w:numPr>/.test(pPr);
    const text = textOf(child.xml).trim();

    // EVERY picture in this paragraph, in document order, one per drawing.
    //
    // ⚠ NOT just the first. v5's cover page and the Director's Desk page sit in ONE <w:p>,
    //   and taking only the first embed dropped the Director's Desk outright and shifted
    //   every later picture's ordinal down by one. handbook-image-text.json is keyed BY
    //   ORDINAL, so the Designation Hierarchy transcript landed on the Org Chart, the
    //   Preface landed on the back cover, and the address transcript was never used at all.
    //   Nothing errors; the manual just quietly says the wrong things about itself.
    //
    // One reference per <w:drawing>/<w:pict> rather than one per r:embed, because a picture
    // carrying a VML fallback names the same media twice and would otherwise count twice.
    const pics = child.xml.match(/<w:(?:drawing|pict)[\s>][\s\S]*?<\/w:(?:drawing|pict)>/g);
    const refs = pics ?? (/r:embed=|r:id=/.test(child.xml) ? [child.xml] : []);
    for (const pic of refs) {
      const embed = /r:embed="([^"]+)"|r:id="([^"]+)"/.exec(pic);
      const target = embed ? rels.get(embed[1] ?? embed[2]) : null;
      if (target && target.startsWith("media/")) {
        blocks.push({ kind: "image", ordinal: ++imageOrdinal, zipPath: `word/${target}` });
      }
    }
    if (text) blocks.push({ kind: "para", styleName, numbered, text });
  }

  return { blocks, zip, media };
}

/* ---------------------------- sections from blocks ------------------------- */

const headingDepth = (styleName) => {
  const m = /^heading\s*(\d)$/i.exec(String(styleName).trim());
  return m ? Number(m[1]) : null;
};

/**
 * A paragraph carrying a heading style that is really prose. The handbook has nine:
 * whole sentences styled as "heading 2". Long, or ending in a full stop, gives them away.
 */
const looksLikeProse = (text) =>
  text.length > 90 || (/[.]$/.test(text.trim()) && text.trim().split(/\s+/).length > 6);

const slug = (s) =>
  s.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "section";

const numberOf = (heading) =>
  /^chapter\s+(\d+)\s*:/i.exec(heading)?.[1] ??
  /^(\d+(?:\.\d+)*)[.\s)]/.exec(heading)?.[1] ??
  null;

/**
 * What the pictures SAY. Six of the seven carry text no extraction can see (the Preface,
 * the Director's Desk, both halves of the Organization Chart, the Designation Hierarchy
 * and the address). Each becomes its OWN section, so it is citable and findable, instead
 * of being swallowed by a "Front matter" blob. Kept in a file beside this one so a
 * re-publish does not wipe the transcripts. See handbook-image-text.json.
 */
function loadImageText() {
  const p = path.join(HERE, "handbook-image-text.json");
  if (!fs.existsSync(p)) return new Map();
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const out = new Map();
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    // An explicit null is a DECISION ("decorative, nothing to read"), and is kept so the
    // publish can tell it apart from a picture nobody has looked at yet.
    out.set(Number(k), v ?? null);
  }
  return out;
}

function buildSections(blocks, imageText = new Map()) {
  const sections = [];
  const stack = [];
  const used = new Map();
  let current = null;

  const open = (depth, heading) => {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const base = slug(heading);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const anchor = n === 1 ? base : `${base}-${n}`;
    const node = { depth, heading };
    stack.push(node);
    current = {
      ordinal: sections.length,
      depth,
      number: numberOf(heading),
      heading,
      anchor,
      path_text: stack.map((x) => x.heading).join(" › "),
      body: [],
    };
    sections.push(current);
  };

  for (const b of blocks) {
    if (b.kind === "para") {
      const d = headingDepth(b.styleName);
      if (d && !looksLikeProse(b.text)) { open(d, b.text); continue; }
    }
    // A picture we have transcribed opens its own section, with the words the picture
    // carries as ordinary text and the picture itself beside them.
    if (b.kind === "image" && imageText.get(b.ordinal)) {
      const t = imageText.get(b.ordinal);
      open(t.depth ?? 1, t.heading);
      current.body.push({ kind: "image", ordinal: b.ordinal });
      current.body.push({ kind: "paragraph", text: t.transcript });
      continue;
    }
    if (!current) open(1, "Front matter");

    if (b.kind === "para") {
      const last = current.body[current.body.length - 1];
      if (b.numbered) {
        if (last?.kind === "bullets") last.items.push(b.text);
        else current.body.push({ kind: "bullets", items: [b.text] });
      } else {
        current.body.push({ kind: "paragraph", text: b.text });
      }
    } else if (b.kind === "table") {
      current.body.push({ kind: "table", rows: b.rows });
    } else if (b.kind === "image") {
      current.body.push({ kind: "image", ordinal: b.ordinal });
    }
  }

  for (const sec of sections) sec.plain_text = flatten(sec);
  return sections;
}

function flatten(sec) {
  const out = [sec.path_text];
  for (const b of sec.body) {
    if (b.kind === "paragraph") out.push(b.text);
    else if (b.kind === "bullets") out.push(...b.items.map((i) => `- ${i}`));
    else if (b.kind === "table") out.push(...b.rows.map((r) => r.join(" | ")));
    else if (b.kind === "image") out.push(`[picture ${b.ordinal}]`);
  }
  return out.join("\n").trim();
}

/* ---------------------------------- diff ----------------------------------- */

function diff(oldRows, next) {
  const before = new Map(oldRows.map((r) => [r.anchor, r]));
  const after = new Map(next.map((r) => [r.anchor, r]));
  const added = next.filter((r) => !before.has(r.anchor));
  const removed = oldRows.filter((r) => !after.has(r.anchor));
  const changed = next.filter(
    (r) => before.has(r.anchor) && before.get(r.anchor).plain_text !== r.plain_text
  );
  return { added, removed, changed };
}

/* ---------------------------------- main ----------------------------------- */

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Source not found: ${SOURCE}`);
    process.exit(1);
  }
  console.log(`\nHandbook: ${SOURCE}`);

  const docx = toDocx(SOURCE);
  const { blocks, zip, media } = await parseDocx(docx);
  const imageText = loadImageText();
  const sections = buildSections(blocks, imageText);

  const demoted = blocks.filter(
    (b) => b.kind === "para" && headingDepth(b.styleName) && looksLikeProse(b.text)
  );

  const chars = sections.reduce((n, s) => n + s.plain_text.length, 0);
  console.log(`  ${sections.length} sections   ${media.length} pictures   ${chars.toLocaleString()} characters`);
  console.log(`  depth 1/2/3: ${[1, 2, 3].map((d) => sections.filter((s) => s.depth === d).length).join(" / ")}`);
  console.log(`  ~${Math.round(chars / 3.8).toLocaleString()} tokens (estimate)`);

  if (demoted.length) {
    console.log(`\n  ${demoted.length} paragraph(s) styled as a heading but kept as prose:`);
    for (const d of demoted) console.log(`    - ${d.text.slice(0, 96)}${d.text.length > 96 ? "..." : ""}`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(sections, null, 1), "utf8");
    console.log(`\nWrote ${JSON_OUT}. Nothing published.`);
    return;
  }

  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("\nSUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from the repo-root .env");
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: current } = await db
    .from("kb_documents").select("id, version").eq("slug", SLUG).eq("is_current", true).maybeSingle();

  let oldRows = [];
  if (current) {
    const { data } = await db
      .from("kb_sections")
      .select("anchor, plain_text, in_force_note")
      .eq("document_id", current.id);
    oldRows = data ?? [];
  }
  // Notes are hand-written by HR about places where the handbook fails to flag its own
  // problem (today: the two travel policies, and the band tables that disagree). They belong
  // to the SECTION, not to the version, so carry them across a re-publish by anchor. Losing
  // them silently would put an unflagged contradiction back in front of staff.
  const notes = new Map(oldRows.filter((r) => r.in_force_note).map((r) => [r.anchor, r.in_force_note]));

  const d = diff(oldRows, sections);
  console.log(
    current
      ? `\nAgainst live version ${current.version} (${oldRows.length} sections):`
      : `\nNothing published yet. This would be version 1:`
  );
  console.log(`  added ${d.added.length}   changed ${d.changed.length}   removed ${d.removed.length}`);
  for (const r of d.added.slice(0, 12))   console.log(`   + ${r.path_text}`);
  for (const r of d.changed.slice(0, 12)) console.log(`   ~ ${r.path_text}`);
  for (const r of d.removed.slice(0, 12)) console.log(`   - ${r.anchor}`);
  const more = d.added.length + d.changed.length + d.removed.length - 36;
  if (more > 0) console.log(`   ...and ${more} more`);

  if (!PUBLISH) {
    console.log(`\nDiff only. Re-run with --publish to write it.`);
    return;
  }

  const version = (current?.version ?? 0) + 1;
  const { data: doc, error: docErr } = await db
    .from("kb_documents")
    .insert({ slug: SLUG, title: TITLE, version, source_filename: path.basename(SOURCE), is_current: false })
    .select("id").single();
  if (docErr) throw docErr;

  const rows = sections.map((s) => ({
    document_id: doc.id,
    ordinal: s.ordinal,
    depth: s.depth,
    number: s.number,
    heading: s.heading,
    path_text: s.path_text,
    anchor: s.anchor,
    body: s.body,
    plain_text: s.plain_text,
    in_force_note: notes.get(s.anchor) ?? null,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db.from("kb_sections").insert(rows.slice(i, i + 100));
    if (error) throw error;
  }

  // Pictures: upload, then record. Section links are set by ordinal below.
  const bucket = "kb-handbook-docs";
  const byOrdinal = new Map();
  for (const s of sections)
    for (const b of s.body) if (b.kind === "image") byOrdinal.set(b.ordinal, s.anchor);

  const { data: written } = await db
    .from("kb_sections").select("id, anchor").eq("document_id", doc.id);
  const idByAnchor = new Map((written ?? []).map((r) => [r.anchor, r.id]));

  let n = 0;
  for (const zipPath of media) {
    n += 1;
    const buf = await zip.file(zipPath).async("nodebuffer");
    const ext = path.extname(zipPath) || ".jpg";
    const storagePath = `${SLUG}/v${version}/image${n}${ext}`;
    const { error: upErr } = await db.storage
      .from(bucket)
      .upload(storagePath, buf, { contentType: ext === ".png" ? "image/png" : "image/jpeg", upsert: true });
    if (upErr && !/already exists/i.test(upErr.message)) throw upErr;
    const { error: imgErr } = await db.from("kb_images").insert({
      document_id: doc.id,
      section_id: idByAnchor.get(byOrdinal.get(n)) ?? null,
      ordinal: n,
      storage_path: storagePath,
      alt_text: imageText.get(n)?.heading ?? null,
      transcript: imageText.get(n)?.transcript ?? null,
    });
    if (imgErr) throw imgErr;
  }

  // One statement, so there is never a moment with two current versions or none.
  const { error: flipErr } = await db
    .from("kb_documents").update({ is_current: false }).eq("slug", SLUG).eq("is_current", true);
  if (flipErr) throw flipErr;
  const { error: onErr } = await db
    .from("kb_documents").update({ is_current: true }).eq("id", doc.id);
  if (onErr) {
    console.error(`\n!! Sections are in but version ${version} is not current. Fix with:`);
    console.error(`   update public.kb_documents set is_current = (id = '${doc.id}') where slug = '${SLUG}';`);
    throw onErr;
  }

  const keptNotes = rows.filter((r) => r.in_force_note).length;
  const lostNotes = [...notes.keys()].filter((a) => !sections.some((s) => s.anchor === a));
  const missing = media.map((_, i) => i + 1).filter((n) => !imageText.has(n));
  console.log(`\nPublished version ${version}: ${rows.length} sections, ${media.length} pictures.`);
  if (missing.length) {
    console.log(
      `⚠ Picture(s) ${missing.join(", ")} have no entry in handbook-image-text.json, so whatever`
    );
    console.log(
      `  they say cannot be answered from. Add a transcript there, or set the key to null if the`
    );
    console.log(`  picture is decorative, then publish again.`);
  }
  if (keptNotes) console.log(`  carried ${keptNotes} hand-written section note(s) forward.`);
  if (lostNotes.length) {
    console.log(`⚠ ${lostNotes.length} note(s) had no section to land on and were NOT carried:`);
    for (const a of lostNotes) console.log(`    ${a}`);
  }
}

main().catch((e) => {
  console.error(`\n${e?.message ?? e}`);
  process.exit(1);
});
