/**
 * OCPI-42 · Read back the papers the UI actually produced, from storage.
 *
 * 🔴 THE PDF IS THE GROUND TRUTH, not the frozen payload and not the deal row.
 *    The payload is a diffing aid; what the customer receives is the file. Read
 *    it with pdf.js — string-searching jsPDF output finds nothing.
 *
 * Usage: node scripts/oc-audit/readIssuedPapers.mjs QT-M0062 QT-M0064
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readPdfLines, allLines } from "./pdfText.mjs";
import { loadModuleCode, installAssetFetch } from "./ourRenderer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..", "..");
const OUT = join(process.env.TEMP ?? "C:/Users/Admin/AppData/Local/Temp", "claude", "oc-audit-issued");
const CREDS = "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";
const BUILD = join(process.env.TEMP ?? "C:/Users/Admin/AppData/Local/Temp", "claude", "oc-audit-build");
const BUCKET = "fms-ocpi-docs";

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
const { error } = await mod.supabase.auth.signInWithPassword({
  email: orangeOne.username, password: orangeOne.password,
});
if (error) throw new Error("Sign-in failed: " + error.message);

const wanted = process.argv.slice(2);
if (!wanted.length) throw new Error("Pass one or more quotation numbers");

const { data: deals, error: dErr } = await mod.supabase
  .from("fms_ocpi_deals")
  .select("id, quotation_no, oc_no, customer_name")
  .in("quotation_no", wanted);
if (dErr) throw new Error(dErr.message);

for (const deal of deals.sort((a, b) => a.quotation_no.localeCompare(b.quotation_no))) {
  const { data: vs, error: vErr } = await mod.supabase
    .from("fms_ocpi_quotation_versions")
    .select("version_no, oc_pdf_path, pdf_path")
    .eq("deal_id", deal.id)
    .order("version_no", { ascending: false })
    .limit(1);
  if (vErr) throw new Error(vErr.message);
  const v = vs?.[0];
  if (!v?.oc_pdf_path) { console.log(`\n${deal.quotation_no}: no OC pdf stored`); continue; }

  const { data: blob, error: sErr } = await mod.supabase.storage.from(BUCKET).download(v.oc_pdf_path);
  if (sErr) throw new Error(`${deal.quotation_no}: ${sErr.message}`);
  const file = join(OUT, `${deal.quotation_no}-OC.pdf`);
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));

  const lines = allLines(await readPdfLines(file)).map((l) => l.text);
  const whole = lines.join(" ").replace(/\s+/g, " ");

  console.log(`\n=== ${deal.quotation_no} · ${deal.customer_name} ===`);
  console.log(`   stored as : ${v.oc_pdf_path.split("/").pop()}`);
  console.log(`   heading   : ${lines.find((l) => /ORDER (QUOTATION|CONFIRMATION)/.test(l)) ?? "(none)"}`);
  console.log(`   quotation# on page : ${whole.includes(deal.quotation_no) ? "YES" : "NO"}`);
  console.log(`   contract#  on page : ${deal.oc_no && whole.includes(deal.oc_no) ? "YES  <-- " + deal.oc_no : "no"}`);
  const supply = lines.filter((l) => /printhead|PRINTHEADS|STANDARD ACCESSORIES/i.test(l));
  console.log(`   supply line: ${supply.join(" | ") || "(not found)"}`);
  const trade = lines.filter((l) => /Ex.?Work|Ex Factory|Trade Term|Transport/i.test(l));
  console.log(`   trade term : ${trade.join(" | ") || "(none)"}`);
  const blanks = lines.filter((l) => l.includes("________"));
  console.log(`   ruled blanks: ${blanks.length}${blanks.length ? " -> " + blanks.slice(0, 3).join(" | ") : ""}`);
}
console.log(`\nPDFs saved under ${OUT}\n`);
