/**
 * OCPI-41 verification — which NUMBER a paper prints, before and after approval.
 *
 * Ritesh Bhai, 03-09-2026, shown that an unapproved deal downloads a complete
 * order confirmation: *"it should just show as order quotation, and the number
 * should also be of the quotation only … it should mention the quotation number
 * till it is not approved."*
 *
 * 🔴 RENDERS AND READS BACK WITH pdf.js. String-searching jsPDF output finds
 *    nothing, even for text that is on the page.
 *
 * 🔴 THE FAILURE THIS EXISTS TO CATCH IS THE HALF-STATE, not either end of it:
 *    a page headed ORDER QUOTATION with `OTPL/OC/10/26-27` beside it. So every
 *    scenario asserts BOTH that the right number is present AND that the wrong
 *    one is absent from the whole document — a check that only looks for what it
 *    expects passes on a paper carrying both.
 *
 * Scenarios, on real master data:
 *   1  contract, NOT approved  → ORDER QUOTATION · QT-M#### · no OTPL/OC anywhere
 *   2  contract, approved      → ORDER CONFIRMATION · OTPL/OC/… · no QT-M anywhere
 *   3  summary, NOT approved   → "Quotation No. : QT-M####", no "Confirmation No."
 *   4  summary, approved       → "Confirmation No. : OTPL/OC/…"
 *   5  a deal with no quotation number yet prints no half-number and no blank
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const QT = "QT-M0099";
const OC = "OTPL/OC/99/26-27";

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

const MACHINE = "Homer K24";
const machine = data.machines.find((m) => m.name === MACHINE);
if (!machine) throw new Error("no machine " + MACHINE);
const sections = data.machineSections
  .filter((s) => s.machineId === machine.id && s.active)
  .sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * ⚠ THE SERIAL EXISTS IN BOTH STATES, AND THAT IS THE WHOLE POINT. From OCPI-36
 *   the OC number is minted at Generate, so an unapproved deal HAS `ocNo` — it
 *   simply must not print it. Setting `ocNo: null` for the unapproved case would
 *   make every scenario pass against a renderer that never changed.
 */
const dealFor = (approved) => ({
  ...skeleton,
  machineId: machine.id,
  machineCategoryId: machine.categoryId,
  quotationNo: QT,
  ocNo: OC,
  ocAt: approved ? "2026-09-03T06:00:00.000Z" : null,
  machineCount: 1,
  headCount: 8,
  machineModelNo: null,
  customerName: "VERIFICATION SPECIMEN PVT LTD",
  customerAddress: "PLOT 1, GIDC SACHIN, SURAT - 395002",
  dryerType: data.dryerTypes.find((t) => !t.meansNoDryer)?.name ?? "Chinese",
  dealValueCurrency: "INR",
});

async function renderContract(approved, tag) {
  const deal = dealFor(approved);
  const facts = mod.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);
  const input = {
    deal, machine, sections, facts, profile,
    validityDays: data.config.quotationValidityDays,
    warranty, warrantyNote: data.config.warrantyNote,
  };
  const pdf = await mod.buildOcPdf(input);
  const file = join(OUT, `verify-paperno-contract-${tag}.pdf`);
  writeFileSync(file, Buffer.from(pdf.output("arraybuffer")));
  const lines = allLines(await readPdfLines(file)).map((l) => l.text);
  return { lines, doc: mod.resolvedOcDocument(input), file };
}

async function renderSummary(approved, tag) {
  const deal = dealFor(approved);
  const facts = mod.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);
  const pdf = await mod.quote.buildQuotationPdf({
    deal, machine, profile, versionNo: 1, facts,
    generatedAt: "2026-09-03T06:00:00.000Z",
  });
  const file = join(OUT, `verify-paperno-summary-${tag}.pdf`);
  writeFileSync(file, Buffer.from(pdf.output("arraybuffer")));
  return allLines(await readPdfLines(file)).map((l) => l.text);
}

/*
  ⚠ MATCHED ON THE WHOLE DOCUMENT AS ONE STRING for the ABSENCE checks, and per
    line for the presence ones. jsPDF wraps at the page width, so a number can
    straddle two lines; an absence check that scanned line by line would miss
    exactly the broken case it is looking for.
*/
const whole = (lines) => lines.join(" ").replace(/\s+/g, " ");

console.log("\n1 · the contract, NOT approved — quotation number, quotation heading");
{
  const { lines, doc } = await renderContract(false, "draft");
  const at = lines.findIndex((l) => l.includes(QT));
  check(at >= 0, `"${QT}" is on the page`, at >= 0 ? `line ${at}: ${lines[at]}` : "not found");
  check(lines.some((l) => l.includes("ORDER QUOTATION")), "headed ORDER QUOTATION");
  check(!whole(lines).includes("OTPL/OC/"), "🔴 the OC number appears NOWHERE on the document");
  check(!lines.some((l) => l.includes("________")), "no ruled blank anywhere");
  check(doc.paper_no === QT, "frozen onto the payload as paper_no", String(doc.paper_no));
  check(doc.oc_no === OC, "and oc_no is still recorded, unprinted", String(doc.oc_no));
  check(doc.doc_title === "ORDER QUOTATION", "doc_title agrees", String(doc.doc_title));
}

console.log("\n2 · the contract, APPROVED — nothing about it changes");
{
  const { lines, doc } = await renderContract(true, "approved");
  const at = lines.findIndex((l) => l.includes(OC));
  check(at >= 0, `"${OC}" is on the page`, at >= 0 ? `line ${at}: ${lines[at]}` : "not found");
  check(lines.some((l) => l.includes("ORDER CONFIRMATION")), "headed ORDER CONFIRMATION");
  check(!whole(lines).includes(QT), "the quotation number appears nowhere on a contract");
  check(doc.paper_no === OC, "paper_no is the OC number", String(doc.paper_no));
}

console.log("\n3 · the summary sheet, NOT approved");
{
  const lines = await renderSummary(false, "draft");
  const w = whole(lines);
  check(w.includes(`Quotation No. : ${QT}`) || (w.includes("Quotation No.") && w.includes(QT)),
    `labelled "Quotation No." and carrying ${QT}`);
  check(!w.includes("Confirmation No."), "🔴 it does NOT say Confirmation No. before approval");
  check(!w.includes("OTPL/OC/"), "🔴 the OC number appears nowhere");
  check(w.includes("ORDER QUOTATION"), "headed ORDER QUOTATION");
}

console.log("\n4 · the summary sheet, APPROVED");
{
  const lines = await renderSummary(true, "approved");
  const w = whole(lines);
  check(w.includes("Confirmation No."), `labelled "Confirmation No."`);
  check(w.includes(OC), `carrying ${OC}`);
  check(w.includes("ORDER CONFIRMATION"), "headed ORDER CONFIRMATION");
}

console.log("\n5 · a deal with no quotation number yet — no half-number, no blank");
{
  const deal = { ...dealFor(false), quotationNo: null };
  const facts = mod.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);
  const input = {
    deal, machine, sections, facts, profile,
    validityDays: data.config.quotationValidityDays,
    warranty, warrantyNote: data.config.warrantyNote,
  };
  const pdf = await mod.buildOcPdf(input);
  const file = join(OUT, "verify-paperno-contract-nonumber.pdf");
  writeFileSync(file, Buffer.from(pdf.output("arraybuffer")));
  const lines = allLines(await readPdfLines(file)).map((l) => l.text);
  check(!whole(lines).includes("OTPL/OC/"), "no OC number leaks in as a fallback");
  check(!lines.some((l) => l.includes("________")), "no ruled blank in the title bar");
  check(mod.resolvedOcDocument(input).paper_no === null, "payload records null, not an empty string");
}

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} CHECK(S) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
