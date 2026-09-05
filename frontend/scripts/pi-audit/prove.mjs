/**
 * prove.mjs — render one PI from the CURRENT code and read it back.
 *
 * 🔴 IT RENDERS, IT DOES NOT SAVE. Nothing is written to storage, no version row
 *    is created and no serial moves. The deal is read live and handed straight
 *    to the module's own `piPdfBlob`, so the bytes measured here are the bytes a
 *    customer would receive.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Extracted text and rendered PDFs go to TEMP, never into the repo. */
const TMP = join(process.env.TEMP ?? "/tmp", "claude", "pi-audit");
const FRONTEND = resolve(HERE, "..", "..");
const SRC = join(FRONTEND, "src");
const PUBLIC = join(FRONTEND, "public");
const AUDIT = resolve(HERE, "..", "oc-audit");
const OUT = join(TMP, "proof");
const CREDS = "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";

const { readPdfLines, allLines } = await import(pathToFileURL(join(AUDIT, "pdfText.mjs")).href);

for (const line of readFileSync(join(FRONTEND, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

/* The same asset shim the OC audit uses — without it jsPDF falls back to
   Helvetica, which has no rupee sign, and every money line grows a tofu box. */
const real = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith("/assets/")) return new Response(readFileSync(join(PUBLIC, url.replace(/^\//, ""))), { status: 200 });
  return real(input, init);
};

mkdirSync(OUT, { recursive: true });
const entry = join(OUT, "entry.mjs");
const q = (p) => JSON.stringify(join(SRC, p).replace(/\\/g, "/"));
writeFileSync(entry, [
  `export * as pi from ${q("apps/ocpi/lib/piPdf.ts")};`,
  `export * as spec from ${q("apps/ocpi/lib/fieldSpec.ts")};`,
  `export * as fmt from ${q("apps/ocpi/lib/format.ts")};`,
  `export * as fetchers from ${q("apps/ocpi/data/ocpiFetch.ts")};`,
  `export { supabase } from ${q("core/platform/supabase.ts")};`,
].join("\n"), "utf8");

const bundle = join(OUT, "bundle.mjs");
await build({
  entryPoints: [entry], outfile: bundle, bundle: true, format: "esm",
  platform: "node", target: "node20", logLevel: "silent",
  alias: { "@": SRC, jspdf: join(FRONTEND, "node_modules/jspdf/dist/jspdf.es.min.js") },
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.VITE_SUPABASE_URL ?? ""),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? ""),
    "import.meta.env.MODE": JSON.stringify("production"),
    "import.meta.env.DEV": "false", "import.meta.env.PROD": "true",
  },
});
const mod = await import(pathToFileURL(bundle).href);

const { orangeOne } = JSON.parse(readFileSync(CREDS, "utf8"));
const { error } = await mod.supabase.auth.signInWithPassword({ email: orangeOne.username, password: orangeOne.password });
if (error) throw new Error(error.message);

/* Mirrors the trailing-stop strip that `sellerNameFor` does at the call site:
   the stored name ends "PVT LTD." and that stop is right in the cover letter,
   which ends a sentence, and wrong mid-clause inside brackets. */
const noStop = (s) => (s.endsWith(".") ? s.slice(0, -1) : s);
/* ── 1 · the trade-term leak, through the form's own composer ─────────────── */
const STORED = "M/s ORANGE O TEC PVT LTD.";
console.log("\n=== 1 · trade term, company bears the local transport ===");
console.log(`  stored legal_name      : ${STORED}`);
console.log(`  proseCompanyName(...)  : ${mod.fmt.proseCompanyName(STORED)}`);
const term = mod.spec.composeTradeTerm(
  { deliveryVia: "EX Factory", deliveryPort: "", deliveryFactoryCity: "Surat",
    deliveryLeg: "", transportTerms: "local", highSeasCostBy: "", localCostBy: "company" },
  noStop(mod.fmt.proseCompanyName(STORED)),
);
console.log(`  composed term          : ${term}`);
console.log(`  folder 101 reads       : Ex-Work Surat ( Transportation Bear by Orange O Tec Pvt Ltd)`);

/* ── 2 · the GST label, on a real rendered page ───────────────────────────── */
const data = await mod.fetchers.fetchOcpiData();
const deal = data.deals.find((d) => d.ocNo === "OTPL/OC/19/26-27");
if (!deal) throw new Error("deal not found");
const machine = data.machines.find((m) => m.id === deal.machineId);
const profile = data.companyProfiles?.find((p) => p.isDefault && p.active);
const salesPage = await mod.fetchers.fetchSalesPage?.(deal.machineId).catch(() => undefined);
const facts = mod.spec.factsForDeal(data.dryerTypes, data.machineCategories, deal, machine);

const blob = await mod.pi.piPdfBlob({ deal, machine, profile, salesPage, facts });
const file = join(OUT, "oc19-current.pdf");
writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
const lines = allLines(await readPdfLines(file)).map((l) => l.text);

console.log("\n=== 2 · OTPL/OC/19/26-27 rendered from current code ===");
for (const l of lines) {
  if (/GST Value|Machine Value|Total Value|We are|^For |Performa No\.|Trade Terms/.test(l)) console.log("  " + l);
}
console.log(`\n  folder 101 reads       : +18% GST Value INR 6,75,180.00`);
console.log(`\nPDF: ${file}`);
