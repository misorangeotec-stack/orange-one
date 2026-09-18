/**
 * Compiles the monthly ranking (CC-1) — the modules' own queue logic plus the
 * ranking's scorers — into one Deno-ready file for the `fms-ranking` edge function.
 *
 * WHY A BUILD STEP, AND WHY THIS ONE
 *   The same reasons as supabase/worksnapshot/build.mjs, whose tooling this shares:
 *   Deno cannot import the frontend (extensionless imports, the `@/` alias), and the
 *   rules must be the app's own rather than a second copy. The three module-boundary
 *   substitutions are the morning mail's own files, used as they are:
 *
 *     @/core/platform/supabase → worksnapshot/serverSupabase.ts  (service-role client)
 *     @/shared/lib/workingDays → worksnapshot/istWorkingDays.ts  (the IST clock)
 *     @/shared/lib/stepSla     → worksnapshot/istStepSla.ts      (IST cut-off hours)
 *
 *   Only the tooling is shared. The morning mail's function, bundle and schedule are
 *   not touched by anything here.
 *
 * WHAT THE BUILD CHECKS
 *   1. No browser-only code in the graph — React, `window`, `document`, `localStorage`,
 *      `import.meta.env`. There is no test runner here; this is the test.
 *   2. THE RANKING'S GLOBAL RULE: every FMS on the Control Center is either scored or
 *      deliberately excused. See below.
 *
 * ⚠ BUILD FROM MASTER, never from a feature branch. The bundle carries every module's
 *   queue logic; a stale branch ships other modules' old rules. (It happened to the
 *   morning mail: see the memory note work-snapshot-runs-the-app-code.)
 *
 * Run:  node supabase/ranking/build.mjs
 * Out:  supabase/functions/_shared/fmsRanking.bundle.js   (committed)
 */
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const ENTRY = resolve(here, "entry.ts");
const SHIM = resolve(repo, "supabase/worksnapshot/serverSupabase.ts");
const CLOCK = resolve(repo, "supabase/worksnapshot/istWorkingDays.ts");
const SLA = resolve(repo, "supabase/worksnapshot/istStepSla.ts");
const TSCONFIG = resolve(repo, "frontend/tsconfig.json");
const OUT = resolve(repo, "supabase/functions/_shared/fmsRanking.bundle.js");

/**
 * The substitutions, as a plugin rather than esbuild's `alias` (which competes with
 * tsconfig `paths` over `@/…`). The two clock shims import the real modules they
 * replace, so a shim's own import is left alone — otherwise it would resolve to itself.
 */
const shims = {
  name: "server-shims",
  setup(b) {
    b.onResolve({ filter: /^@\/core\/platform\/supabase$/ }, () => ({ path: SHIM }));
    b.onResolve({ filter: /(^@\/shared\/lib\/workingDays$|^\.\.?\/workingDays$)/ }, (args) =>
      resolve(args.importer) === CLOCK ? null : { path: CLOCK },
    );
    b.onResolve({ filter: /(^@\/shared\/lib\/stepSla$|^\.\.?\/stepSla$)/ }, (args) =>
      resolve(args.importer) === SLA ? null : { path: SLA },
    );
  },
};

const options = {
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  tsconfig: TSCONFIG,
  // Deno fetches these itself at runtime, exactly as the other edge functions do.
  external: ["https://*"],
  plugins: [shims],
};

/**
 * ── THE RANKING'S GLOBAL RULE ─────────────────────────────────────────────────
 * An FMS added to the Control Center must also be ranked — or be excused in writing.
 *
 * It cannot be automatic: each module's steps close in their own way, and a generic
 * "score it" would invent a closer or a due date. So the rule is enforced instead:
 * this reads the Control Center's adapter registry and the ranking's registry and
 * FAILS THE BUILD on any adapter that is in neither RANKED_MODULES nor NOT_SCORED.
 * A new module can therefore never drop silently out of the ranking — which is what
 * would actually go wrong.
 */
const adaptersDir = resolve(repo, "frontend/src/apps/fms-control-center/adapters");
const adapterRegistry = await readFile(resolve(adaptersDir, "registry.ts"), "utf8");
const rankingRegistry = await readFile(
  resolve(repo, "frontend/src/apps/fms-control-center/ranking/registry.ts"),
  "utf8",
);

// `import { hrAdapter } from "./hr";` … `export const fmsAdapters: FmsAdapter[] = [purchaseAdapter, …];`
const importOf = new Map(
  [...adapterRegistry.matchAll(/^import\s+\{\s*(\w+)\s*\}\s+from\s+"\.\/([\w-]+)"/gm)].map((m) => [m[1], m[2]]),
);
const listed = (adapterRegistry.match(/export const fmsAdapters[^=]*=\s*\[([^\]]*)\]/s)?.[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const adapterKeys = [];
for (const name of listed) {
  const file = importOf.get(name);
  if (!file) throw new Error(`ranking guard: cannot find the import for adapter "${name}" in adapters/registry.ts`);
  const src = await readFile(resolve(adaptersDir, `${file}.ts`), "utf8");
  const key = src.match(/\bkey:\s*"([\w-]+)"/)?.[1];
  if (!key) throw new Error(`ranking guard: adapter file ${file}.ts declares no key`);
  adapterKeys.push(key);
}
if (!adapterKeys.length) {
  throw new Error(
    "ranking guard: read no adapters out of adapters/registry.ts — its format changed.\n" +
      "Fix the parsing here rather than deleting the check.",
  );
}

const objectKeys = (name) => {
  const body = rankingRegistry.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`))?.[1];
  if (body === undefined) throw new Error(`ranking guard: cannot read ${name} in ranking/registry.ts`);
  return new Set([...body.matchAll(/^\s*"?([\w-]+)"?\s*:/gm)].map((m) => m[1]));
};
const ranked = objectKeys("RANKED_MODULES");
const excused = objectKeys("NOT_SCORED");

const missing = adapterKeys.filter((k) => !ranked.has(k) && !excused.has(k));
if (missing.length) {
  throw new Error(
    `These FMS are on the Control Center but not in the monthly ranking: ${missing.join(", ")}.\n` +
      `Write a scorer in frontend/src/apps/fms-control-center/ranking/modules/ and add it to\n` +
      `RANKED_MODULES — or, if it must not be ranked, add it to NOT_SCORED with the reason.\n` +
      `Do not skip this: a module missing here quietly leaves its people's work out of the score.`,
  );
}
const stale = [...ranked, ...excused].filter((k) => !adapterKeys.includes(k));
if (stale.length) {
  throw new Error(`ranking/registry.ts names modules the Control Center does not have: ${stale.join(", ")}.`);
}
console.log(`  ranking guard: ${adapterKeys.length} Control Center modules — ${ranked.size} scored, ${excused.size} excused.`);

const result = await build({ ...options, outfile: OUT, logLevel: "info", metafile: true });
const code = await readFile(OUT, "utf8");

// The browser-code guard runs on a MINIFIED copy, so words in comments cannot trip it.
const { outputFiles } = await build({ ...options, minify: true, legalComments: "none", write: false, logLevel: "silent" });
const executable = outputFiles[0].text;
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
    `fms-ranking bundle contains browser-only code: ${found.join(", ")}.\n` +
      `Something in the import graph reaches the browser. Check the newest import under ranking/.`,
  );
}

const inputs = Object.keys(
  result.metafile.outputs[Object.keys(result.metafile.outputs).find((k) => !k.endsWith(".map"))].inputs ?? {},
);
await writeFile(
  OUT,
  `// GENERATED by supabase/ranking/build.mjs — do not edit by hand.\n` +
    `// Rebuild FROM MASTER after ANY change to a module's queue rules, SLA config or fetchers.\n` +
    `// Sources bundled: ${inputs.length}\n` +
    code,
  "utf8",
);
console.log(`\n✓ ${OUT}`);
console.log(`  ${inputs.length} source files, ${(code.length / 1024).toFixed(0)} kB, no browser code.`);
