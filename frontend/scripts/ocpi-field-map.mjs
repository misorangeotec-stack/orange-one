#!/usr/bin/env node
/**
 * ocpi-field-map.mjs — the OCPI field → document map (OCPI-23, produced by OCPI-12).
 *
 * WHY THIS IS GENERATED AND NOT HAND-WRITTEN:
 *   The module added ~15 fields in three days (OCPI-7, 10, 11, 14, 18). A map
 *   somebody typed once goes stale the first time a field is added, and a STALE
 *   MAP IS WORSE THAN NO MAP because it will be trusted. This reads the same
 *   sources the renderers read, so it cannot drift from them.
 *
 * 🔴 THE LONG FORM IS PER MACHINE, so "does this field print?" has a COUNT as its
 *    answer, never a yes/no. A field reaches the detailed paper two different
 *    ways and only the first is answerable once:
 *      1. rendered directly by ocPdf.ts — the same on every deal;
 *      2. through a {{token}} inside a MACHINE'S OWN template section — and each
 *         machine has its own sections.
 *    The two routes are separate columns here and must never be merged.
 *
 * ⚠ THE DENOMINATOR IS THE TEMPLATED MACHINES, NOT ALL OF THEM. A machine with
 *   has_template = false prints no long form at all; it is neither "prints" nor
 *   "missing", and counting it as a gap would invent one.
 *
 * ⚠ THIS IS A STATIC CLAIM, NOT PROOF. A field can be referenced in ocPdf.ts and
 *   still never appear — inside a branch that never fires, in a section the
 *   machine has no rows for, or in a column that overflows. OCPI-12's rendered
 *   PDFs are what settle it.
 *
 * USAGE (from the `frontend/` folder):
 *   npm run field-map
 *
 * Output: OCPI-FIELD-MAP.md at the repo root.
 *
 * CREDENTIALS: reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from
 * frontend/.env.local, and signs in with the local browser-testing account file
 * so the masters are readable under RLS. The password is never printed.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(FRONTEND, "..");
const OCPI = join(FRONTEND, "src", "apps", "ocpi");
const CREDS =
  "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";

const read = (p) => readFileSync(p, "utf8");

/* ── env ──────────────────────────────────────────────────────────────────── */
function loadEnv() {
  const out = {};
  const f = join(FRONTEND, ".env.local");
  if (existsSync(f)) {
    for (const line of read(f).split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...out, ...process.env };
}

/* ── 1 · the module's own list of every question ──────────────────────────── */
function fieldLabels(src) {
  const start = src.indexOf("export const FIELD_LABEL");
  if (start < 0) throw new Error("FIELD_LABEL not found in fieldSpec.ts");
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
  const out = [];
  // Only two-space-indented `key: "label"` entries are fields; anything deeper
  // sits inside a comment example.
  const re = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*"((?:[^"\\]|\\.)*)"/gm;
  let m;
  while ((m = re.exec(block))) out.push({ key: m[1], label: m[2] });
  if (out.length === 0) throw new Error("FIELD_LABEL parsed to zero fields — the shape has changed");
  return out;
}

/* ── 2 · which token, if any, a field is exposed as ───────────────────────── */
function tokenSources(src) {
  const start = src.indexOf("export function tokensFor");
  const end = src.indexOf("\nconst TOKEN_RE", start);
  if (start < 0 || end < 0) throw new Error("tokensFor not found in tokens.ts");
  const body = src.slice(start, end);
  // Split on four-space-indented `token_name:` entries — the shape of the
  // returned object literal.
  const marks = [];
  const re = /^ {4}([a-z0-9_]+):/gm;
  let m;
  while ((m = re.exec(body))) marks.push({ token: m[1], at: m.index });
  if (marks.length === 0) throw new Error("tokensFor parsed to zero tokens — the shape has changed");
  const byField = new Map();
  marks.forEach((mk, i) => {
    const seg = body.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : body.length);
    const fre = /\bdeal\.([a-zA-Z][a-zA-Z0-9]*)/g;
    let f;
    while ((f = fre.exec(seg))) {
      if (!byField.has(f[1])) byField.set(f[1], new Set());
      byField.get(f[1]).add(mk.token);
    }
  });
  return byField;
}

/*
   ⚠ THE SHORT FORM'S SECTION IS READ OFF THE RENDERER, NOT DECLARED HERE.
     quotationPdf.ts builds four arrays and returns them as sections A–D. Mapping
     the array name to the letter is the only hand-written link, and it is
     checked against the returned literal below, so a renamed array fails loudly
     instead of silently reporting "no section".
*/
const SHORT_SECTIONS = [
  ["machineRows", "A · Machine Details"],
  ["inclusions", "B · Deal Inclusions"],
  ["commercial", "C · Commercial Terms"],
  ["remarks", "D · Special Remarks"],
];

function shortFormSections(src, keys) {
  const start = src.indexOf("function sectionRows");
  const end = src.indexOf("\nexport async function buildQuotationPdf", start);
  if (start < 0 || end < 0) throw new Error("sectionRows not found in quotationPdf.ts");
  const body = src.slice(start, end);

  for (const [arr] of SHORT_SECTIONS) {
    if (!new RegExp(`rows:\\s*${arr}\\b`).test(body)) {
      throw new Error(
        `quotationPdf.ts no longer returns an array called "${arr}" — the section map in this script is stale`,
      );
    }
  }

  const found = new Map();
  const add = (k, s) => {
    if (!found.has(k)) found.set(k, new Set());
    found.get(k).add(s);
  };

  // Walk line by line, remembering which array is currently being built or
  // pushed into, and attribute every `d.<field>` seen to that section.
  let current = null;
  for (const line of body.split("\n")) {
    for (const [arr, label] of SHORT_SECTIONS) {
      if (new RegExp(`\\b${arr}\\b\\s*(?::\\s*Row\\[\\]\\s*)?(?:=|\\.push\\()`).test(line)) {
        current = label;
      }
    }
    if (!current) continue;
    const fre = /\bd\.([a-zA-Z][a-zA-Z0-9]*)/g;
    let f;
    while ((f = fre.exec(line))) if (keys.has(f[1])) add(f[1], current);
  }
  return found;
}

/* ── direct references, the fallback signal ───────────────────────────────── */
const refCount = (src, key) => (src.match(new RegExp(`\\.${key}\\b`, "g")) || []).length;

/* ── how many machines' templates actually use each token ─────────────────── */
async function tokenUsage(env) {
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from frontend/.env.local");
  }
  const sb = createClient(url, anon, { auth: { persistSession: false } });

  if (!existsSync(CREDS)) throw new Error(`Credentials file not found: ${CREDS}`);
  const { orangeOne } = JSON.parse(read(CREDS));
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: orangeOne.username,
    password: orangeOne.password,
  });
  if (authErr) throw new Error(`Sign-in failed: ${authErr.message}`);

  const { data: machines, error: mErr } = await sb
    .from("fms_ocpi_machines")
    .select("id,name,has_template,active");
  if (mErr) throw new Error(`machines: ${mErr.message}`);
  const { data: sections, error: sErr } = await sb
    .from("fms_ocpi_machine_sections")
    .select("machine_id,title,body,active");
  if (sErr) throw new Error(`sections: ${sErr.message}`);

  const live = machines.filter((m) => m.active);
  const templated = live.filter((m) => m.has_template);
  const templatedIds = new Set(templated.map((m) => m.id));

  const usage = new Map();
  for (const s of sections) {
    if (!s.active || !templatedIds.has(s.machine_id)) continue;
    const text = `${s.title ?? ""} ${s.body ?? ""}`;
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text))) {
      const t = m[1].toLowerCase();
      if (!usage.has(t)) usage.set(t, new Set());
      usage.get(t).add(s.machine_id);
    }
  }
  return {
    denom: templated.length,
    usage,
    noTemplate: live.filter((m) => !m.has_template).map((m) => m.name).sort(),
  };
}

/* ── main ─────────────────────────────────────────────────────────────────── */
const env = loadEnv();
const fieldSpec = read(join(OCPI, "lib", "fieldSpec.ts"));
const quotationPdf = read(join(OCPI, "lib", "quotationPdf.ts"));
const ocPdf = read(join(OCPI, "lib", "ocPdf.ts"));
const tokensTs = read(join(OCPI, "lib", "tokens.ts"));

const fields = fieldLabels(fieldSpec);
const keys = new Set(fields.map((f) => f.key));
const tokenBy = tokenSources(tokensTs);
const shortSec = shortFormSections(quotationPdf, keys);
const { denom, usage, noTemplate } = await tokenUsage(env);

const rows = fields.map((f) => {
  const secs = [...(shortSec.get(f.key) ?? [])];
  const shortRefs = refCount(quotationPdf, f.key);
  const longRefs = refCount(ocPdf, f.key);
  const toks = [...(tokenBy.get(f.key) ?? [])].sort();

  const short = secs.length ? secs.join("<br>") : shortRefs > 0 ? "✓ (section undetermined)" : "—";
  const long = longRefs > 0 ? "✓" : "—";
  const tokenCell = toks.length
    ? toks.map((t) => `\`{{${t}}}\` · **${usage.get(t)?.size ?? 0}/${denom}**`).join("<br>")
    : "—";

  const printsAnywhere =
    shortRefs > 0 || longRefs > 0 || toks.some((t) => (usage.get(t)?.size ?? 0) > 0);
  const tokenDeclaredUnused = toks.length > 0 && !toks.some((t) => (usage.get(t)?.size ?? 0) > 0);

  const verdict = printsAnywhere
    ? "prints"
    : tokenDeclaredUnused
      ? "**token offered, no template uses it**"
      : "🔴 **screen only — deliberate?**";

  return { ...f, short, long, tokenCell, verdict, printsAnywhere };
});

/*
   ⚠ TWO DIFFERENT FAULTS, AND THEY ARE NOT THE SAME QUESTION.

     · SCREEN ONLY — the answer is captured and stored and no document has any
       route to it. That is a question for the client: should it print?
     · TOKEN OFFERED, UNUSED — a placeholder EXISTS for the field, so a template
       author could print it, and not one of the machines does. That is a
       question for the template authors, not the client.

     Listing them together would put both under one heading and get one of them
     asked of the wrong person.
*/
const screenOnly = rows.filter((r) => !r.printsAnywhere && r.verdict.startsWith("🔴"));
const tokenUnused = rows.filter((r) => !r.printsAnywhere && !r.verdict.startsWith("🔴"));

const md = [
  "# OCPI · field → document map",
  "",
  "> **Generated — do not edit by hand.** Regenerate with `cd frontend && npm run field-map`.",
  `> Produced ${new Date().toISOString().slice(0, 10)} from \`fieldSpec.ts\`, \`quotationPdf.ts\`,`,
  "> `ocPdf.ts`, `tokens.ts` and the live `fms_ocpi_machine_sections` table.",
  "",
  "**The short form** is the summary one-pager (`quotationPdf.ts`) — the same four sections on every",
  "deal. **The long form** is the detailed order confirmation (`ocPdf.ts`) plus the machine's own",
  "template sections, and it is **per machine**: a field reaching it through a `{{token}}` appears only",
  "on the machines whose template uses that token. That is why the last column carries a **count**, not",
  "a tick.",
  "",
  `**The denominator is ${denom}** — the active machines that have a template. The ${noTemplate.length} without one print`,
  "no long form at all and are neither \"prints\" nor \"missing\": " +
    noTemplate.map((n) => `*${n}*`).join(", ") +
    ".",
  "",
  "⚠ **This is a static claim, not proof.** A field can be referenced in a renderer and still never",
  "appear — inside a branch that never fires, in a section the machine has no rows for, or in a column",
  "that overflows. OCPI-12's rendered PDFs are what settle it.",
  "",
  `## The ${screenOnly.length} fields that reach no document at all`,
  "",
  "Captured, stored, and printed nowhere on any machine — with no token a template could even use.",
  "Each is a question for the client rather than automatically a bug, but nobody has decided that it",
  "should be invisible.",
  "",
  "| Field | Label |",
  "|---|---|",
  ...screenOnly.map((r) => `| \`${r.key}\` | ${r.label} |`),
  "",
  `## The ${tokenUnused.length} offered as a token that no template uses`,
  "",
  "Different from the list above, and a question for the template authors rather than the client: the",
  "placeholder exists, so any machine's deck *could* print this, and not one of them does.",
  "",
  "| Field | Label | Token |",
  "|---|---|---|",
  ...tokenUnused.map(
    (r) => `| \`${r.key}\` | ${r.label} | ${r.tokenCell} |`,
  ),
  "",
  "## Every field",
  "",
  "| Field | Label | Short form | Long form (direct) | Long form (via token) | Verdict |",
  "|---|---|---|---|---|---|",
  ...rows.map(
    (r) => `| \`${r.key}\` | ${r.label} | ${r.short} | ${r.long} | ${r.tokenCell} | ${r.verdict} |`,
  ),
  "",
  "## Token usage across the templated machines",
  "",
  "| Token | Machines |",
  "|---|---|",
  ...[...usage.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([t, s]) => `| \`{{${t}}}\` | **${s.size}/${denom}** |`),
  "",
].join("\n");

const out = join(REPO_ROOT, "OCPI-FIELD-MAP.md");
writeFileSync(out, md, "utf8");
console.log(
  `${fields.length} fields · ${screenOnly.length} reach no document · ${usage.size} tokens live · denominator ${denom}`,
);
console.log(`wrote ${out}`);
