/**
 * ourRenderer.mjs — run the app's OWN order-confirmation renderer under Node.
 *
 * 🔴 IT IS THE APP'S CODE, NOT A COPY OF IT. `lib/ocPdf.ts` is bundled and
 *    imported, so `resolvedOcDocument` and `buildOcPdf` here are byte-for-byte
 *    what the browser runs. A re-implementation would be an audit of the audit's
 *    own guess at the renderer, which is worth nothing: the whole question is
 *    whether the DOCUMENT THE MODULE PRODUCES matches the real one.
 *
 * ⚠ WHY NOT SEED DEALS AND CLICK GENERATE. Producing a real OC means approving a
 *   quotation, and the module refuses self-approval in both the panel and the
 *   SQL, so it needs a second account. It also burns a quotation number and an OC
 *   number per specimen, permanently, on live sequence state. Rendering against
 *   live master data raises nothing and burns nothing — the same route OCPI-4
 *   used to sweep nineteen templates.
 *
 * ⚠ THE FETCH SHIM IS NOT A MOCK. `loadBrandAssets` and `loadLetterhead` ask for
 *   `/assets/fonts/Poppins-*.ttf` and `/assets/ocpi/*.png` — real files that the
 *   dev server would serve out of `frontend/public`. The shim resolves those same
 *   paths off disk, so the Poppins faces and the letterhead artwork in the
 *   rendered PDF are the ones a customer receives. Without it jsPDF falls back to
 *   Helvetica, which has no rupee sign, and every money line would come out
 *   carrying a missing-glyph box that the audit would then report as a difference.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..", "..");
const SRC = join(FRONTEND, "src");
const PUBLIC = join(FRONTEND, "public");

/**
 * Bundle the module's renderer and data layer into one file we can import.
 *
 * ⚠ THE ENTRY IS GENERATED, not a checked-in file. A real file under `src/`
 *   would be compiled by `npm run build` and shipped to users, and an export
 *   surface that exists only for a script is exactly the sort of thing that
 *   later gets "cleaned up" by somebody who cannot see who calls it.
 */
export async function loadModuleCode(outDir) {
  mkdirSync(outDir, { recursive: true });
  const entry = join(outDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(join(SRC, "apps/ocpi/lib/ocPdf.ts").replace(/\\/g, "/"))};`,
      `export * from ${JSON.stringify(join(SRC, "apps/ocpi/lib/templateDiff.ts").replace(/\\/g, "/"))};`,
      `export * from ${JSON.stringify(join(SRC, "apps/ocpi/lib/fieldSpec.ts").replace(/\\/g, "/"))};`,
      `export * from ${JSON.stringify(join(SRC, "apps/ocpi/lib/format.ts").replace(/\\/g, "/"))};`,
      `export * as fetchers from ${JSON.stringify(join(SRC, "apps/ocpi/data/ocpiFetch.ts").replace(/\\/g, "/"))};`,
      `export * as tokens from ${JSON.stringify(join(SRC, "apps/ocpi/lib/tokens.ts").replace(/\\/g, "/"))};`,
      `export * as conditions from ${JSON.stringify(join(SRC, "apps/ocpi/lib/conditions.ts").replace(/\\/g, "/"))};`,
      /*
        ⚠ NAMESPACED, NOT `export *`. `quotationPdf.ts` and `ocPdf.ts` share
          several helper names, and a bare star-export would make each of them
          ambiguous and silently absent from the bundle. Added for
          `verifyPaperNo.mjs`, which has to read the SUMMARY sheet as well as the
          contract — both print the paper number, and only both together prove
          the pre-approval state.
      */
      `export * as quote from ${JSON.stringify(join(SRC, "apps/ocpi/lib/quotationPdf.ts").replace(/\\/g, "/"))};`,
      /*
        ⚠ THE MODULE'S OWN CLIENT, NOT A SECOND ONE. `fetchOcpiData` reads through
          the singleton in `core/platform/supabase.ts`; signing a *different*
          client in would leave that one anonymous and every masters read would
          come back empty under RLS — which looks exactly like "the machine has no
          template" and would have produced a spectacular false report.
      */
      `export { supabase } from ${JSON.stringify(join(SRC, "core/platform/supabase.ts").replace(/\\/g, "/"))};`,
    ].join("\n"),
    "utf8",
  );

  const out = join(outDir, "ocpi-bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    /*
      `@/…` is the portal's own alias, configured in vite.config.ts / tsconfig.

      ⚠ jsPDF IS PINNED TO ITS **ES** BUILD, DELIBERATELY. Its `exports` map sends
        the `node` condition to `dist/jspdf.node.min.js`, whose interop gives
        esbuild no usable default export — `import_jspdf.default is not a
        constructor` on the first render. The browser build is also the RIGHT one
        for fidelity: it is what Vite bundles, so the bytes this audit measures
        are the bytes a customer receives.
    */
    alias: {
      "@": SRC,
      jspdf: join(FRONTEND, "node_modules/jspdf/dist/jspdf.es.min.js"),
    },
    // Vite injects these; esbuild does not, and `ocpiFetch` reads them at import.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.VITE_SUPABASE_URL ?? ""),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? ""),
      "import.meta.env.MODE": JSON.stringify("production"),
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
    },
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

/**
 * Serve `/assets/…` off `frontend/public`, and let anything else through.
 *
 * Installed globally because `pdfBrand.ts` and `letterhead.ts` call bare
 * `fetch(path)` — they are browser code and have no notion of a base URL.
 */
export function installAssetFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.startsWith("/assets/")) {
      const file = join(PUBLIC, url.replace(/^\//, ""));
      const bytes = readFileSync(file);
      return new Response(bytes, { status: 200 });
    }
    return real(input, init);
  };
}
