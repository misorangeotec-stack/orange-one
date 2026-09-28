/**
 * Compiles the evening Daily Report's build into one Node-ready file.
 *
 * A near-twin of `supabase/collectionsreport/build.mjs`, and the differences are the interesting
 * part — read them before changing either:
 *
 *   · It bundles a DIFFERENT entry, but it REUSES that job's three server shims rather than
 *     copying them (see below). One implementation of "how a server run reaches Supabase" is worth
 *     more than tidy folders.
 *   · There is no `@hub/lib/collectionsReportBuild`, and no mirrored report spec. The Daily Report's
 *     definition is `lib/reportInput.ts`, which the SCREEN also calls, so the bundle contains the
 *     page's own rules rather than a second copy of them.
 *
 * THE FIVE SUBSTITUTIONS, all at the module boundary so NO app code is edited:
 *
 *   @hub/lib/connectwaveSupabase  → a Node client on the same anon key (the browser one reads
 *                                   import.meta.env)
 *   @/core/platform/supabase      → a service-role Node client, for the gate, storage and the outbox
 *   @/shared/lib/pdfBrand         → the same module with `loadBrandAssets` reading the fonts and the
 *                                   logo off the checkout instead of fetching `/assets/…`
 *   jspdf                         → its ESM build. The package's Node entry is CJS whose default
 *                                   export is NOT the constructor, and `exportDailyPdf.ts` imports
 *                                   it as a default (`import jsPDF from "jspdf"`). Unsubstituted
 *                                   that fails with "is not a constructor" at FIRST USE — i.e. at
 *                                   20:30, in front of nobody. It is pinned rather than remembered.
 *   @hub/lib/scope                → a server stub whose hooks THROW. One unused React hook in
 *                                   `scopeParties.ts` otherwise drags the whole portal session,
 *                                   React, `window` and `import.meta.env` into a Node job.
 *
 * ⚠ THE THREE SHIMS ARE IMPORTED FROM `../collectionsreport/`, NOT COPIED, AND THAT IS DELIBERATE.
 *   Copying them would be the mistake this repo has already paid for twice: a fix applied to one
 *   copy (the URL shape check that turned "Invalid supabaseUrl from line 61906" into a sentence)
 *   would leave the other silently broken. So two jobs share three files, and those files carry a
 *   note saying so. `brandAssetsServer.ts` reads COLLECTIONS_REPORT_PUBLIC_DIR; this workflow sets
 *   the same variable on purpose rather than renaming a working production path.
 *
 *   A plugin rather than esbuild's `alias` option: `alias` and tsconfig `paths` both claim `@/…`,
 *   and their precedence is not something to leave to chance.
 *
 * WHAT THE BUILD ALSO CHECKS
 *   There is no test runner in this repo, so purity is enforced at the only place it can be:
 *
 *   1. Nothing in the graph may import `receivablesSupabase` — the LEGACY receivables project,
 *      whose hostname no longer resolves (RC-4). It would build, deploy, and fail at run time.
 *   2. Our own code, with npm packages excluded, may not reach for `window`, `document`,
 *      `localStorage`, `import.meta.env` or React. Packages ARE excluded on purpose: jsPDF
 *      legitimately feature-detects a browser, and failing the build over its internals would only
 *      teach the next person to delete the check.
 *
 *      ⚠ `react` IS in that list, and this job imports `data/dailyReport.ts`, which imports
 *        `@tanstack/react-query` for its hooks. That passes because the scan looks for
 *        `from "react"` in OUR files and react-query is a package. The hooks are bundled and never
 *        called; if that ever becomes a runtime problem the fix is to split the plain `fetch*`
 *        loaders out of those files, not to weaken the guard.
 *   3. `tsc --noEmit` over these files. They sit outside `frontend/src`, so `npm run build` — the
 *      repo's only gate — never sees them. Without this a wrong argument would compile, bundle,
 *      deploy and fail at 20:30 in front of nobody.
 *
 * Run:  node supabase/dailyreport/build.mjs
 * Out:  supabase/dailyreport/dist/daily-report.cjs   (generated, not committed)
 */
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const FE = resolve(repo, "frontend");
/** The Collection report's folder, which owns the three shared server shims. */
const SHARED = resolve(repo, "supabase/collectionsreport");

const ENTRY = resolve(here, "entry.ts");
const CONNECTWAVE = resolve(SHARED, "connectwaveServer.ts");
const IDENTITY = resolve(SHARED, "identityServer.ts");
const BRAND = resolve(SHARED, "brandAssetsServer.ts");
/**
 * This job's own fifth substitution, which the Collection report does not need: `@hub/lib/scope`.
 * `salesRegister.ts` -> `scopeParties.ts` -> `scope.tsx` -> `session.tsx` -> `useCatalogueVersion.ts`
 * pulls React, `window` and `import.meta.env` into the bundle for the sake of one hook this job
 * never calls. See scopeServer.ts for why it throws rather than returning "all".
 */
const SCOPE = resolve(here, "scopeServer.ts");
const OUT = resolve(here, "dist/daily-report.cjs");

/**
 * @param {{ externalJspdf?: boolean }} opts
 *
 * `externalJspdf` matters only to the purity guard below, and it is the difference between a guard
 * that works and one that cries wolf. The jsPDF substitution resolves to an ABSOLUTE file path, so
 * esbuild's `packages: "external"` stops recognising it as a package and bundles it, dragging in the
 * copy of FileSaver that jsPDF ships. That code calls `document.createElement("a")`, the guard sees
 * it, and the build fails over a browser reference in a dependency we do not own and do not call.
 * Left external for the scan, substituted for real.
 */
const makeShims = (opts = {}) => ({
  name: "server-shims",
  setup(b) {
    b.onResolve({ filter: /connectwaveSupabase$/ }, () => ({ path: CONNECTWAVE }));

    /**
     * ⚠ BOTH SPELLINGS, AND THE SECOND ONE IS NOT HYPOTHETICAL.
     *   The Collection report's build matches only `@/core/platform/supabase`, because its import
     *   graph only ever uses the alias. This job's does not: `data/bankAccounts.ts` imports
     *   `@/core/platform/liveMasters`, and that file — sitting in the same directory as the client —
     *   imports it as `./supabase`. With only the alias matched, `supabase.ts` stayed in the bundle
     *   and the purity guard failed on its `import.meta.env`, naming a file nothing had knowingly
     *   imported.
     *
     *   Anchored, so it cannot catch `./receivablesSupabase` (which has its own refusal below) or
     *   `./connectwaveSupabase` (matched by the rule above).
     *
     *   The `args.importer === IDENTITY` guard is there so a future edit to the shim that imports
     *   the real module cannot loop, the same way the brand shim is guarded.
     */
    b.onResolve({ filter: /(^@\/core\/platform\/supabase$|^\.\.?\/supabase$)/ }, (args) =>
      args.importer === IDENTITY ? null : { path: IDENTITY });

    b.onResolve({ filter: /(^@\/shared\/lib\/pdfBrand$|^\.\.?\/pdfBrand$)/ }, (args) =>
      args.importer === BRAND ? null : { path: BRAND });

    // Matches both the alias and a relative import from inside the hub, the way the brand shim
    // matches both spellings of pdfBrand.
    b.onResolve({ filter: /(^@hub\/lib\/scope$|^\.\.?\/scope$)/ }, (args) =>
      args.importer === SCOPE ? null : { path: SCOPE });

    b.onResolve({ filter: /^jspdf$/ }, () =>
      opts.externalJspdf
        ? { path: "jspdf", external: true }
        : { path: resolve(FE, "node_modules/jspdf/dist/jspdf.es.min.js") });

    // Guard 1. Not a shim — a refusal. See the header.
    b.onResolve({ filter: /receivablesSupabase$/ }, (args) => ({
      errors: [{
        text:
          "the Daily Report reached the LEGACY receivables project, which no longer exists " +
          `(imported from ${args.importer}). Read ConnectWave instead — see RC-4 in WORKLIST.md.`,
      }],
    }));
  },
});

const common = {
  entryPoints: [ENTRY],
  bundle: true,
  platform: "node",
  target: "node20",
  absWorkingDir: FE,
  // The shims sit OUTSIDE frontend/, so Node resolution from their own directory cannot see the
  // app's node_modules. This points bare specifiers (@supabase/supabase-js) back at the one install
  // the app itself uses, rather than asking for a second copy beside this script.
  nodePaths: [resolve(FE, "node_modules")],
  tsconfig: resolve(FE, "tsconfig.json"),
  plugins: [makeShims()],
  loader: { ".ts": "ts", ".tsx": "tsx" },
  jsx: "automatic",
};

mkdirSync(dirname(OUT), { recursive: true });
const result = await build({
  ...common,
  format: "cjs",
  outfile: OUT,
  logLevel: "info",
  metafile: true,
});

// ── Guard 2 ────────────────────────────────────────────────────────────────
// Minified, so a comment mentioning "window" cannot fail the build — prose is not code. And with
// `packages: "external"`, so what is scanned is OUR code and nothing else.
const { outputFiles } = await build({
  ...common,
  plugins: [makeShims({ externalJspdf: true })],
  format: "esm",
  packages: "external",
  minify: true,
  legalComments: "none",
  write: false,
  logLevel: "silent",
});
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
    `daily-report bundle contains browser-only code: ${found.join(", ")}.\n` +
      "Something in the import graph reaches the browser. Check the newest import in entry.ts,\n" +
      "and shim it at the module boundary rather than editing the app.",
  );
}

const outKey = Object.keys(result.metafile.outputs).find((k) => !k.endsWith(".map"));
const inputs = Object.keys(result.metafile.outputs[outKey].inputs ?? {});
const ours = inputs.filter((p) => !p.includes("node_modules"));

const code = readFileSync(OUT, "utf8");
writeFileSync(
  OUT,
  "// GENERATED by supabase/dailyreport/build.mjs — do not edit, do not commit.\n" +
    "// Rebuild after ANY change to the report's rules, its export code or the brand PDF helpers.\n" +
    `// Sources bundled: ${inputs.length} (${ours.length} from this repo)\n` +
    code,
  "utf8",
);

console.log(`\n✓ ${OUT}`);
console.log(`  ${ours.length} of our files, ${(code.length / 1024 / 1024).toFixed(1)} MB, no browser code.`);

/**
 * ── Guard 3: typecheck ─────────────────────────────────────────────────────
 * esbuild STRIPS types, it does not check them. These files live outside `frontend/src`, so
 * `npm run build` — the repo's only gate — never sees them either. Without this, a wrong argument
 * to `buildDailyReportInput` would compile cleanly, bundle cleanly, deploy cleanly, and fail at
 * 20:30 on a Tuesday in front of nobody.
 *
 * A generated tsconfig rather than a checked-in one: it must inherit the app's `paths` (`@/` and
 * `@hub/`) verbatim, and a second copy of those would be one more thing to keep in step.
 */
// Generated INSIDE frontend/, not beside this script, and that is the whole trick: TypeScript
// resolves `node_modules`, `@types` and the app's own `paths` from the directory holding the config.
// From `supabase/dailyreport/` it finds none of them and reports a missing `@supabase/supabase-js`
// and a missing `node` typings package — which read like broken dependencies and are nothing of the
// kind.
const tsconfigPath = resolve(FE, "tsconfig.dailyreport.json");
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: {
      noEmit: true,
      types: ["node"],
      // ⚠ `paths` REPLACES the inherited map rather than merging with it, so the app's own aliases
      // are read back out of the base config instead of being restated here.
      paths: {
        ...JSON.parse(readFileSync(resolve(FE, "tsconfig.json"), "utf8")).compilerOptions.paths,
        "@supabase/supabase-js": ["./node_modules/@supabase/supabase-js"],
      },
    },
    include: [
      "../supabase/dailyreport/*.ts",
      // The three shared shims, checked here too: this job depends on them, and a change made for
      // the Collection report that breaks this one should fail THIS build as well.
      "../supabase/collectionsreport/identityServer.ts",
      "../supabase/collectionsreport/connectwaveServer.ts",
      "../supabase/collectionsreport/brandAssetsServer.ts",
      // Vite's own ambient types, which is what makes `import.meta.env` legal. The app modules
      // these files import still read it — tsc follows the REAL modules, being unaware of the
      // substitutions esbuild makes above — so without this the check fails on
      // `Property 'env' does not exist on type 'ImportMeta'` in code that is never bundled.
      "src/vite-env.d.ts",
    ],
  }, null, 2),
  "utf8",
);

const { execFileSync } = await import("node:child_process");
try {
  execFileSync(
    process.execPath,
    [resolve(FE, "node_modules/typescript/bin/tsc"), "-p", tsconfigPath],
    { stdio: "inherit", cwd: FE },
  );
  console.log("  types check out.");
} catch {
  throw new Error(
    "daily-report does not typecheck. Fix it here — these files are NOT covered by\n" +
      "`npm run build`, so nothing else will tell you.",
  );
}
