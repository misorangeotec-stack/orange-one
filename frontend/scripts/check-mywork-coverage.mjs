/**
 * Every app is either on My Control Center or deliberately off it — never forgotten.
 *
 * Runs before `tsc` in `npm run build`. Reads the app list (src/apps/registry.tsx →
 * each manifest's `id`), the My Work providers that are switched on
 * (src/core/workspace/mywork/registry.ts → each provider's `appId`) and the
 * opt-out list (src/core/workspace/mywork/notOnMyWork.ts), and fails when:
 *   - an app is in neither list (a new module nobody wired up — the failure this
 *     exists for: Physical Verification went live without it on 14-10-2026), or
 *   - an app is in both, or the opt-out names an app that does not exist.
 *
 * Same idea as supabase/worksnapshot/build.mjs, which holds the screen and the
 * morning mail together. Plain text parsing on purpose: no TS loader needed.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (p) => readFile(resolve(src, p), "utf8");

// 1. Every app in the launcher registry.
const appsSrc = await read("apps/registry.tsx");
const appIds = [];
for (const [, dir] of appsSrc.matchAll(/^import\s+\{\s*\w+\s*\}\s+from\s+"\.\/([\w-]+)\/meta"/gm)) {
  const meta = await read(`apps/${dir}/meta.tsx`).catch(() => read(`apps/${dir}/meta.ts`));
  const m = meta.match(/\bid:\s*"([\w-]+)"/);
  if (!m) throw new Error(`check-mywork-coverage: no \`id: "…"\` in apps/${dir}/meta — has the manifest format changed?`);
  appIds.push(m[1]);
}

// 2. Providers actually listed in myWorkProviders (commented-out ones do not count).
const regSrc = await read("core/workspace/mywork/registry.ts");
const covered = new Set();
for (const m of regSrc.matchAll(/^import\s+\{\s*(\w+)\s*\}\s+from\s+"\.\/providers\/([\w-]+)"/gm)) {
  const [, name, file] = m;
  if (!new RegExp(`^\\s*${name},`, "m").test(regSrc)) continue;
  const p = await read(`core/workspace/mywork/providers/${file}.ts`);
  const id = p.match(/appId:\s*"([\w-]+)"/);
  if (id) covered.add(id[1]);
}

// 3. The deliberate opt-outs.
const offSrc = await read("core/workspace/mywork/notOnMyWork.ts");
const off = new Set([...offSrc.matchAll(/^\s*"([\w-]+)"\s*:/gm)].map((m) => m[1]));

if (appIds.length < 10 || covered.size < 5) {
  throw new Error(
    "check-mywork-coverage: read too few apps or providers — a file's import format has changed.\n" +
      "Fix the parsing here rather than deleting the check.",
  );
}

const problems = [];
const missing = appIds.filter((id) => !covered.has(id) && !off.has(id));
if (missing.length) {
  problems.push(
    `Not on My Control Center and not opted out: ${missing.join(", ")}.\n` +
      `  If the module gives a named person work (a step owner, approver or verifier from its Setup),\n` +
      `  add a provider: src/core/workspace/mywork/items/<name>.ts + providers/<name>.ts + registry.ts\n` +
      `  (and the morning mail — supabase/worksnapshot/entry.ts). Otherwise add it to\n` +
      `  src/core/workspace/mywork/notOnMyWork.ts with the reason.`,
  );
}
const both = appIds.filter((id) => covered.has(id) && off.has(id));
if (both.length) problems.push(`On My Control Center AND in notOnMyWork.ts: ${both.join(", ")} — remove it from notOnMyWork.ts.`);
const stale = [...off].filter((id) => !appIds.includes(id));
if (stale.length) problems.push(`notOnMyWork.ts names apps that do not exist: ${stale.join(", ")}.`);

if (problems.length) {
  console.error("\n✗ My Control Center coverage\n\n" + problems.join("\n\n") + "\n");
  process.exit(1);
}
console.log(`✓ My Control Center coverage: ${covered.size} apps on it, ${off.size} deliberately off, ${appIds.length} in all.`);
