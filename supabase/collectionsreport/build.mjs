/**
 * Compiles the Collection report's own build into one Node-ready file.
 *
 * WHY A BUILD STEP AT ALL
 *   The report is defined in the frontend, in TypeScript, behind two path aliases (`@/` and
 *   `@hub/`) and hundreds of extensionless imports. Bundling resolves all of that once, here, and
 *   hands the runner a single self-contained script.
 *
 *   The alternative — re-implementing the eligibility rules, the KPI maths and the PDF layout for
 *   the server — is the thing this whole exercise exists to prevent. Two copies of a rule drift,
 *   and the mail starts disagreeing with the screen about the same customer.
 *
 * THE FOUR SUBSTITUTIONS, all at the module boundary so NO app code is edited:
 *
 *   @hub/lib/connectwaveSupabase  → a Node client on the same anon key (the browser one reads
 *                                   import.meta.env)
 *   @/core/platform/supabase      → a service-role Node client, for the schedule, storage and
 *                                   the outbox
 *   @/shared/lib/pdfBrand         → the same module with `loadBrandAssets` reading the fonts and
 *                                   the logo off the checkout instead of fetching `/assets/…`
 *   jspdf                         → its ESM build. The package's Node entry is CJS whose default
 *                                   export is NOT the constructor; importing it the ordinary way
 *                                   fails with "import_jspdf.default is not a constructor" at
 *                                   FIRST USE — i.e. at 08:00, in front of nobody. `report-spike`
 *                                   hit this and wrote it down; it is pinned here so it cannot
 *                                   happen again.
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
 *      `localStorage`, `import.meta.env` or React. Packages ARE excluded from that scan on
 *      purpose: jsPDF legitimately feature-detects a browser, and failing the build over its
 *      internals would only teach the next person to delete the check.
 *
 * Run:  node supabase/collectionsreport/build.mjs
 * Out:  supabase/collectionsreport/dist/collections-report.cjs   (generated, not committed)
 */
import { build } from "../../frontend/node_modules/esbuild/lib/main.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const FE = resolve(repo, "frontend");

const ENTRY = resolve(here, "entry.ts");
const CONNECTWAVE = resolve(here, "connectwaveServer.ts");
const IDENTITY = resolve(here, "identityServer.ts");
const BRAND = resolve(here, "brandAssetsServer.ts");
const OUT = resolve(here, "dist/collections-report.cjs");

/**
 * @param {{ externalJspdf?: boolean }} opts
 *
 * `externalJspdf` matters only to the purity guard below, and it is not a detail — it is the
 * difference between a guard that works and one that cries wolf. The jsPDF substitution resolves
 * to an ABSOLUTE file path, so esbuild's `packages: "external"` stops recognising it as a package
 * and bundles it, dragging in the copy of FileSaver that jsPDF ships. That code calls
 * `document.createElement("a")`, the guard sees it, and the build fails over a browser reference
 * in a dependency we do not own and do not call. Left external for the scan, substituted for real.
 */
const makeShims = (opts = {}) => ({
  name: "server-shims",
  setup(b) {
    b.onResolve({ filter: /connectwaveSupabase$/ }, () => ({ path: CONNECTWAVE }));
    b.onResolve({ filter: /^@\/core\/platform\/supabase$/ }, () => ({ path: IDENTITY }));

    // ⚠ The brand shim itself imports the real pdfBrand — redirecting that would be an infinite
    // loop, so the substitution skips imports whose importer IS the shim.
    b.onResolve({ filter: /(^@\/shared\/lib\/pdfBrand$|^\.\.?\/pdfBrand$)/ }, (args) =>
      args.importer === BRAND ? null : { path: BRAND });

    b.onResolve({ filter: /^jspdf$/ }, () =>
      opts.externalJspdf
        ? { path: "jspdf", external: true }
        : { path: resolve(FE, "node_modules/jspdf/dist/jspdf.es.min.js") });

    // Guard 1. Not a shim — a refusal. See the header.
    b.onResolve({ filter: /receivablesSupabase$/ }, (args) => ({
      errors: [{
        text:
          "the Collection report reached the LEGACY receivables project, which no longer exists " +
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
  // app's node_modules. This points bare specifiers (@supabase/supabase-js) back at the one
  // install the app itself uses, rather than asking for a second copy beside this script.
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
    `collections-report bundle contains browser-only code: ${found.join(", ")}.\n` +
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
  "// GENERATED by supabase/collectionsreport/build.mjs — do not edit, do not commit.\n" +
    "// Rebuild after ANY change to the report's rules, its export code or the brand PDF helpers.\n" +
    `// Sources bundled: ${inputs.length} (${ours.length} from this repo)\n` +
    code,
  "utf8",
);

console.log(`\n✓ ${OUT}`);
console.log(`  ${ours.length} of our files, ${(code.length / 1024 / 1024).toFixed(1)} MB, no browser code.`);

/**
 * ── Guard 3: typecheck ─────────────────────────────────────────────────────
 * esbuild STRIPS types, it does not check them. These four files live outside `frontend/src`, so
 * `npm run build` — the repo's only gate — never sees them either. Without this, a wrong argument
 * to `buildCollectionsReportContext` would compile cleanly, bundle cleanly, deploy cleanly, and
 * fail at 08:00 on a Saturday in front of nobody. That is the exact failure mode this whole design
 * is arranged to avoid, so the check is part of the build rather than a thing to remember.
 *
 * A generated tsconfig rather than a checked-in one: it must inherit the app's `paths` (`@/` and
 * `@hub/`) verbatim, and a second copy of those would be one more thing to keep in step.
 */
// Generated INSIDE frontend/, not beside this script, and that is the whole trick: TypeScript
// resolves `node_modules`, `@types` and the app's own `paths` from the directory holding the
// config. From `supabase/collectionsreport/` it finds none of them and reports a missing
// `@supabase/supabase-js` and a missing `node` typings package — which read like broken
// dependencies and are nothing of the kind.
const tsconfigPath = resolve(FE, "tsconfig.collectionsreport.json");
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    extends: "./tsconfig.json",
    compilerOptions: {
      noEmit: true,
      types: ["node"],
      // ⚠ `paths` REPLACES the inherited map rather than merging with it, so the app's own two
      // aliases are read back out of the base config instead of being restated here — a second
      // copy of `@/*` and `@hub/*` would be one more thing to keep in step, and it would go stale
      // silently.
      //
      // The extra entry exists because TypeScript resolves packages from the IMPORTING file's
      // directory, and these four files sit outside `frontend/`, where there is no node_modules to
      // find. esbuild is told the same thing by `nodePaths` above.
      paths: {
        ...JSON.parse(readFileSync(resolve(FE, "tsconfig.json"), "utf8")).compilerOptions.paths,
        "@supabase/supabase-js": ["./node_modules/@supabase/supabase-js"],
      },
    },
    include: [
      "../supabase/collectionsreport/*.ts",
      // Vite's own ambient types, which is what makes `import.meta.env` legal. The app modules
      // these four files import still read it — tsc follows the REAL modules, being unaware of
      // the substitutions esbuild makes above — so without this the check fails on five
      // `Property 'env' does not exist on type 'ImportMeta'` errors in code that is never bundled.
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
    "collections-report does not typecheck. Fix it here — these files are NOT covered by\n" +
      "`npm run build`, so nothing else will tell you.",
  );
}
