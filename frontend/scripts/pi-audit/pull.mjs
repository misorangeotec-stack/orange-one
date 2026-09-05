/**
 * pull.mjs — download the PI that the module actually produced for each of the
 * eleven re-entered contracts, and extract its text with pdf.js.
 *
 * 🔴 THE STORED FILE IS THE GROUND TRUTH. These PDFs are what the UI wrote at
 *    Generate time; nothing here re-renders them, so the vintage question ("was
 *    this made before or after the fixes?") is answered by reading the paper,
 *    not by trusting a timestamp.
 *
 * ⚠ NEVER string-search a jsPDF file — text plainly on the page does not appear
 *   in the raw bytes. Everything goes through readPdfLines.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Extracted text and rendered PDFs go to TEMP, never into the repo. */
const TMP = join(process.env.TEMP ?? "/tmp", "claude", "pi-audit");
const REPO = resolve(HERE, "..", "..", "..");
const FRONTEND = resolve(HERE, "..", "..");
const AUDIT = resolve(HERE, "..", "oc-audit");
const OUT = join(TMP, "ours");
const BUILD = join(TMP, "build");
const CREDS = "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";
const BUCKET = "fms-ocpi-docs";

const { readPdfLines, allLines } = await import(pathToFileURL(join(AUDIT, "pdfText.mjs")).href);
const { loadModuleCode, installAssetFetch } = await import(pathToFileURL(join(AUDIT, "ourRenderer.mjs")).href);

function loadEnv() {
  for (const line of readFileSync(join(FRONTEND, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();
installAssetFetch();
mkdirSync(OUT, { recursive: true });

const mod = await loadModuleCode(BUILD);
const { orangeOne } = JSON.parse(readFileSync(CREDS, "utf8"));
const { error: authErr } = await mod.supabase.auth.signInWithPassword({
  email: orangeOne.username,
  password: orangeOne.password,
});
if (authErr) throw new Error("Sign-in failed: " + authErr.message);

const OCS = [
  "OTPL/OC/10/26-27", "OTPL/OC/11/26-27", "OTPL/OC/12/26-27", "OTPL/OC/15/26-27",
  "OTPL/OC/16/26-27", "OTPL/OC/17/26-27", "OTPL/OC/18/26-27", "OTPL/OC/19/26-27",
  "OTPL/OC/20/26-27", "OTPL/OC/21/26-27", "OTPL/OC/22/26-27",
];

const { data: deals, error: dErr } = await mod.supabase
  .from("fms_ocpi_deals")
  .select("id, oc_no, quotation_no, customer_name")
  .in("oc_no", OCS);
if (dErr) throw new Error(dErr.message);

const manifest = [];
for (const oc of OCS) {
  const deal = deals.find((d) => d.oc_no === oc);
  if (!deal) { console.log(`${oc}: NO DEAL`); continue; }

  // Latest version only — that is the paper standing today.
  const { data: vs, error: vErr } = await mod.supabase
    .from("fms_ocpi_quotation_versions")
    .select("version_no, pi_pdf_path, generated_at")
    .eq("deal_id", deal.id)
    .not("pi_pdf_path", "is", null)
    .order("version_no", { ascending: false })
    .limit(1);
  if (vErr) throw new Error(vErr.message);
  const v = vs?.[0];
  if (!v) { console.log(`${oc}: no PI stored`); continue; }

  const { data: blob, error: sErr } = await mod.supabase.storage.from(BUCKET).download(v.pi_pdf_path);
  if (sErr) throw new Error(`${oc}: ${sErr.message}`);

  const slug = oc.replace(/[^0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const pdf = join(OUT, `oc${slug}.pdf`);
  writeFileSync(pdf, Buffer.from(await blob.arrayBuffer()));

  const pages = await readPdfLines(pdf);
  const lines = allLines(pages).map((l) => l.text);
  writeFileSync(join(OUT, `oc${slug}.txt`), lines.join("\n"), "utf8");

  manifest.push({
    oc, quotation: deal.quotation_no, customer: deal.customer_name,
    version: v.version_no, generatedAt: v.generated_at,
    pages: pages.numPages, lines: lines.length, txt: `oc${slug}.txt`,
  });
  console.log(`${oc}  v${v.version_no}  ${pages.numPages}pp  ${lines.length} lines  ${deal.customer_name}`);
}

writeFileSync(join(TMP, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`\n${manifest.length} PIs pulled into ${OUT}`);
