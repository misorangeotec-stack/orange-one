/**
 * OCPI-37 verification — the customer's GSTIN, the model number and the HSN.
 *
 * 🔴 RENDERS AND READS BACK WITH pdf.js. String-searching jsPDF output finds
 *    nothing, even for text that is on the page.
 *
 * Checks, on real master data:
 *   1  a deal WITH a GSTIN prints "GST: <n>" under the address, on any machine
 *   2  a deal WITHOUT one prints no GST line at all — not a blank, not a label
 *   3  Homer K32  → "(Model No: HM1800B-TK32-B1)  (HSN Code: 84433910)"
 *   4  Homer K24  → the model inside its own description, and NOT twice, and
 *                   no ruled blank where {{machine_model_no}} used to fail
 *   5  Rocket     → its deck already names both, so nothing is added
 *   6  Alpha 15   → no model on record, so nothing is drawn
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readPdfLines, allLines } from "./pdfText.mjs";
import { loadModuleCode, installAssetFetch } from "./ourRenderer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..", "..");
const OUT = join(FRONTEND, "..", "Misc", "Bushra Reports", "OCPI", "oc-audit", "ours");
const CREDS = "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";
const BUILD = join(process.env.TEMP ?? "C:/Users/Admin/AppData/Local/Temp", "claude", "oc-audit-build");

function loadEnv() {
  for (const line of readFileSync(join(FRONTEND, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const GSTIN = "24AASCA8419N1Z0"; // the real one off contract 123, used as a specimen
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failed += 1;
};

loadEnv();
installAssetFetch();
mkdirSync(OUT, { recursive: true });

const mod = await loadModuleCode(BUILD);
const { orangeOne } = JSON.parse(readFileSync(CREDS, "utf8"));
const { error } = await mod.supabase.auth.signInWithPassword({
  email: orangeOne.username, password: orangeOne.password,
});
if (error) throw new Error("Sign-in failed: " + error.message);

const data = await mod.fetchers.fetchOcpiData();
const profile = data.companyProfiles.find((p) => p.isDefault) ?? data.companyProfiles[0];
const skeleton = data.deals[0];
const warranty = data.config.warranty
  ? { machineMonths: data.config.warranty.machineMonths, headMonths: data.config.warranty.headMonths }
  : undefined;

async function renderOne(machineName, overrides) {
  const machine = data.machines.find((m) => m.name === machineName);
  if (!machine) throw new Error("no machine " + machineName);
  const sections = data.machineSections
    .filter((s) => s.machineId === machine.id && s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const deal = {
    ...skeleton,
    machineId: machine.id,
    machineCategoryId: machine.categoryId,
    ocNo: "OTPL/OC/VERIFY/26-27",
    machineCount: 1,
    headCount: 8,
    machineModelNo: null,
    customerName: "VERIFICATION SPECIMEN PVT LTD",
    customerAddress: "PLOT 1, GIDC SACHIN, SURAT - 395002",
    dryerType: data.dryerTypes.find((t) => !t.meansNoDryer)?.name ?? "Chinese",
    dealValueCurrency: "INR",
    ...overrides,
  };
  const facts = mod.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);
  const input = {
    deal, machine, sections, facts, profile,
    validityDays: data.config.quotationValidityDays,
    warranty, warrantyNote: data.config.warrantyNote,
  };
  const pdf = await mod.buildOcPdf(input);
  const file = join(OUT, `verify-${machineName.replace(/[^A-Za-z0-9]+/g, "-")}-${overrides.gstNo ? "gst" : "nogst"}.pdf`);
  writeFileSync(file, Buffer.from(pdf.output("arraybuffer")));
  const lines = allLines(await readPdfLines(file)).map((l) => l.text);
  return { lines, doc: mod.resolvedOcDocument(input), file };
}

console.log("\n1 · the customer's GSTIN — Homer K32, deal HAS one");
{
  const { lines, doc } = await renderOne("Homer K32", { gstNo: GSTIN, gstAvailable: true });
  const at = lines.findIndex((l) => l.includes("GST:") && l.includes(GSTIN));
  check(at >= 0, `"GST: ${GSTIN}" is on the page`, at >= 0 ? `line ${at}: ${lines[at]}` : "not found");
  const addr = lines.findIndex((l) => l.startsWith("Address:"));
  check(addr >= 0 && at === addr + 1, "it sits directly under the address block",
    `address line ${addr}, gst line ${at}`);
  check(doc.customer_gstin === GSTIN, "frozen onto the payload as customer_gstin", String(doc.customer_gstin));
}

console.log("\n2 · a deal with NO GSTIN — nothing is printed, not even a label");
{
  const { lines, doc } = await renderOne("Homer K32", { gstNo: null, gstAvailable: false });
  check(!lines.some((l) => /\bGST:/.test(l)), "no GST label anywhere on the contract");
  check(!lines.some((l) => l.includes("________")), "no ruled blank anywhere");
  check(doc.customer_gstin === null, "payload records null, not an empty string", String(doc.customer_gstin));
}

console.log("\n3 · Homer K32 — the model number and the HSN, off the master");
{
  const { lines, doc } = await renderOne("Homer K32", { gstNo: GSTIN, gstAvailable: true });
  const at = lines.findIndex((l) => l.includes("HM1800B-TK32-B1"));
  check(at >= 0, "the model number prints", at >= 0 ? lines[at] : "not found");
  check(at >= 0 && lines[at].includes("84433910"), "the HSN code prints on the same line",
    at >= 0 ? lines[at] : "");
  const supply = lines.findIndex((l) => l.includes("TOTAL NET AMOUNT"));
  check(at > supply && at < supply + 6, "it sits in the priced supply block",
    `supply line ${supply}, detail line ${at}`);
  check(
    lines.filter((l) => l.includes("HM1800B-TK32-B1")).length === 1,
    "printed exactly once",
  );
  check(doc.machine_detail_line?.includes("84433910") === true, "frozen onto the payload",
    String(doc.machine_detail_line));
}

/*
  ⚠ THE PRICED BLOCK IS MATCHED AS ONE STRING, NOT LINE BY LINE. jsPDF wraps the
    description at the page width, so K24's "(Model No:" ends one line and
    "HM1800B-TK24)" begins the next. Asserting per line reported a failure for
    text that is on the page and correct — the check was wrong, not the render.
*/
const block = (lines) => {
  const i = lines.findIndex((l) => l.includes("TOTAL NET AMOUNT"));
  return lines.slice(i, i + 6).join(" ");
};

console.log("\n4 · Homer K24 — the token that was ruling a blank");
{
  const { lines } = await renderOne("Homer K24", { gstNo: GSTIN, gstAvailable: true });
  const priced = block(lines);
  check(!lines.some((l) => l.includes("________")), "no ruled blank anywhere on the contract");
  check(priced.split("HM1800B-TK24").length - 1 === 1, "the model number prints exactly once", priced);
  check(/\(Model No:\s*HM1800B-TK24\)/.test(priced),
    "inside its own description, as the real 123 prints it");
}

console.log("\n5 · Rocket — its deck already names both, so nothing is added");
{
  const { lines, doc } = await renderOne("Rocket", { gstNo: GSTIN, gstAvailable: true });
  const priced = block(lines);
  check(/\(MODEL:\s*HMSINGLEPASS 1800-ROCKET-K\)/.test(priced), "the model is stated by the deck", priced);
  check(priced.split("HMSINGLEPASS").length - 1 === 1, "and stated only once");
  check(lines.filter((l) => l.includes("84433910")).length === 1, "the HSN is stated once");
  check(doc.machine_detail_line === null, "the renderer adds nothing", String(doc.machine_detail_line));
}

console.log("\n6 · Kolorado Alpha 15 — no code on record, so nothing is drawn");
{
  const { lines, doc } = await renderOne("Kolorado Alpha 15", { gstNo: GSTIN, gstAvailable: true });
  check(doc.machine_detail_line === null, "no detail line", String(doc.machine_detail_line));
  check(!lines.some((l) => l.includes("Model No:")), "no empty 'Model No:' label — unlike the real 125");
  check(!lines.some((l) => l.includes("________")), "no ruled blank anywhere");
}

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : failed + " CHECK(S) FAILED"}\n`);
process.exit(failed === 0 ? 0 : 1);
