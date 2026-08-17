/**
 * Compiles the app's own work-queue logic into one Deno-ready file.
 *
 * WHY A BUILD STEP AT ALL
 *   Deno cannot import the frontend directly: it needs file extensions
 *   (`from "./steps"` is a hard error) and it knows nothing about the `@/` path
 *   alias. Both are everywhere in `frontend/src`. Bundling resolves them once,
 *   here, and hands the edge function a single self-contained module.
 *
 *   The alternative — re-implementing nine fetchers and their SLA maths in SQL —
 *   is the thing that has already gone wrong twice: two copies of a rule drift,
 *   and the mail starts disagreeing with the screen about the same person.
 *
 * WHAT THE BUILD ALSO CHECKS
 *   If anything in the import graph secretly reaches for React, `window` or
 *   `import.meta.env`, this build fails or the guard below trips. That is the
 *   test — there is no test runner in this repo, so purity is enforced at the
 *   only place it can be.
 *
 * Run:  node supabase/worksnapshot/build.mjs
 * Out:  supabase/functions/_shared/workSnapshot.bundle.js   (committed)
 */
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const ENTRY = resolve(here, "entry.ts");
const SHIM = resolve(here, "serverSupabase.ts");
const CLOCK = resolve(here, "istWorkingDays.ts");
const SLA = resolve(here, "istStepSla.ts");
const TSCONFIG = resolve(repo, "frontend/tsconfig.json");
const OUT = resolve(repo, "supabase/functions/_shared/workSnapshot.bundle.js");

/**
 * Two substitutions, both at the module boundary so no app code is edited:
 *
 *   @/core/platform/supabase  → a service-role Deno client (the browser one reads
 *                               import.meta.env and pokes window)
 *   @/shared/lib/workingDays  → the same helpers on an IST clock (the edge runtime
 *                               is pinned to UTC and refuses to be moved)
 *
 * A plugin rather than esbuild's `alias` option: `alias` and tsconfig `paths` both
 * claim `@/...`, and their precedence is not something to leave to chance.
 *
 * ⚠ The clock shim itself imports the real workingDays. Redirecting that would be
 * an infinite loop, so the substitution skips imports whose importer IS the shim.
 */
const shims = {
  name: "server-shims",
  setup(b) {
    b.onResolve({ filter: /^@\/core\/platform\/supabase$/ }, () => ({ path: SHIM }));
    b.onResolve({ filter: /(^@\/shared\/lib\/workingDays$|^\.\.?\/workingDays$)/ }, (args) =>
      args.importer === CLOCK ? null : { path: CLOCK },
    );
    // Same trick for the SLA module, whose `dueIsoFrom` asks its own Date for the
    // hour and so cannot be corrected by the workingDays shim alone.
    b.onResolve({ filter: /(^@\/shared\/lib\/stepSla$|^\.\.?\/stepSla$)/ }, (args) =>
      args.importer === SLA ? null : { path: SLA },
    );
  },
};

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  tsconfig: TSCONFIG,
  // Deno fetches these itself at runtime, exactly as the other edge functions do.
  external: ["https://*"],
  plugins: [shims],
  outfile: OUT,
  logLevel: "info",
  metafile: true,
});

/**
 * ── THE GLOBAL RULE ───────────────────────────────────────────────────────────
 * A module added to My Work Today must also reach the daily mail.
 *
 * There is no way to make that automatic: every provider carries its own
 * ownership rule, and those rules genuinely differ — Purchase bands approvals by
 * value, Dispatch scopes owners by location, Sampling assigns six steps on the
 * request itself. A generic "just include it" would invent an owner rule, and an
 * invented rule means someone's work quietly appears on the wrong person's list.
 *
 * So the rule is enforced instead of automated: this compares the app's provider
 * registry against COVERED_APP_IDS and FAILS THE BUILD on any provider that is
 * neither wired nor explicitly excluded. Adding a module to the home screen and
 * forgetting the mail is now impossible to do silently — which is the actual
 * thing that goes wrong.
 */
const registrySrc = await readFile(resolve(repo, "frontend/src/core/workspace/mywork/registry.ts"), "utf8");
const entrySrc = await readFile(ENTRY, "utf8");

// Provider files are imported one per line; each declares `appId: "…"`.
const providerFiles = [...registrySrc.matchAll(/^import\s+\{\s*\w+\s*\}\s+from\s+"\.\/providers\/([\w-]+)"/gm)]
  .map((m) => m[1]);

const registeredAppIds = [];
for (const file of providerFiles) {
  const src = await readFile(
    resolve(repo, `frontend/src/core/workspace/mywork/providers/${file}.ts`),
    "utf8",
  );
  const m = src.match(/appId:\s*"([\w-]+)"/);
  // Only providers actually listed in myWorkProviders count — the registry keeps
  // deliberately disabled ones commented out, and those are not omissions.
  if (m && new RegExp(`^\\s*${file.replace(/-(\w)/g, (_, c) => c.toUpperCase())}Provider,`, "m").test(registrySrc)) {
    registeredAppIds.push(m[1]);
  }
}

const coveredMatch = entrySrc.match(/export const COVERED_APP_IDS = \[([^\]]*)\]/s);
const covered = new Set([...(coveredMatch?.[1] ?? "").matchAll(/"([\w-]+)"/g)].map((m) => m[1]));
const excusedMatch = entrySrc.match(/export const DELIBERATELY_UNCOVERED[^=]*=\s*\{([^}]*)\}/s);
const excused = new Set([...(excusedMatch?.[1] ?? "").matchAll(/"([\w-]+)"\s*:/g)].map((m) => m[1]));

const missing = registeredAppIds.filter((id) => !covered.has(id) && !excused.has(id));
if (missing.length) {
  throw new Error(
    `These modules are on My Work Today but not in the daily snapshot mail: ${missing.join(", ")}.\n` +
      `Mirror each provider's ownership rule in supabase/worksnapshot/entry.ts and add it to\n` +
      `COVERED_APP_IDS — or, if it should never be mailed, add it to DELIBERATELY_UNCOVERED\n` +
      `with the reason. Do not skip this: a module missing here under-reports someone's work\n` +
      `without anything on screen looking wrong.`,
  );
}
if (!registeredAppIds.length) {
  throw new Error(
    "Could not read any providers out of mywork/registry.ts — the coverage check is not running.\n" +
      "Its import or list format has changed; fix the parsing above rather than deleting the check.",
  );
}
console.log(`  coverage: ${registeredAppIds.length} providers on screen, all wired into the mail.`);

const code = await readFile(OUT, "utf8");

/**
 * The guard runs against a MINIFIED copy, not the readable one.
 *
 * The first version scanned the plain bundle and failed on the word "window"
 * inside a comment about a date range. Prose is not code; minifying strips every
 * comment, so what is left is only what actually executes.
 */
const { outputFiles } = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  tsconfig: TSCONFIG,
  external: ["https://*"],
  plugins: [shims],
  minify: true,
  legalComments: "none",
  write: false,
  logLevel: "silent",
});
const executable = outputFiles[0].text;

// `import.meta.env` would mean a browser module slipped in; a React import would
// mean a provider or a store did. Either makes the bundle unusable in Deno, and
// both stay silent until the function is invoked in production.
const contraband = [
  ["import.meta.env", /import\.meta\.env/],
  ["react", /from\s*["']react["']/],
  ["window", /(^|[^\w.$])window\s*[.[]/],
  ["localStorage", /(^|[^\w.$])localStorage\b/],
  ["document", /(^|[^\w.$])document\s*[.[]/],
];
const found = contraband.filter(([, re]) => re.test(executable)).map(([name]) => name);
if (found.length) {
  throw new Error(
    `work-snapshot bundle contains browser-only code: ${found.join(", ")}.\n` +
      `Something in the import graph reaches the browser. Check the newest import in entry.ts.`,
  );
}

const inputs = Object.keys(result.metafile.outputs[
  Object.keys(result.metafile.outputs).find((k) => !k.endsWith(".map"))
].inputs ?? {});

await writeFile(
  OUT,
  `// GENERATED by supabase/worksnapshot/build.mjs — do not edit by hand.\n` +
    `// Rebuild after ANY change to the app's queue rules, SLA config or fetchers.\n` +
    `// Sources bundled: ${inputs.length}\n` +
    code,
  "utf8",
);

console.log(`\n✓ ${OUT}`);
console.log(`  ${inputs.length} source files, ${(code.length / 1024).toFixed(0)} kB, no browser code.`);
