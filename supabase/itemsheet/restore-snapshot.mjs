#!/usr/bin/env node
/**
 * Put item_type / category / ink_type back the way `snapshot-before.json` found
 * them.
 *
 *   node supabase/itemsheet/restore-snapshot.mjs          # rehearse (writes nothing)
 *   node supabase/itemsheet/restore-snapshot.mjs --apply  # actually restore
 *
 * WHY THIS EXISTS AND IS NOT A PARAGRAPH IN A README
 *   A rollback that has never been run is a hope, not a rollback. The sheet load
 *   changes thousands of rows in one go; the only honest way to promise it can
 *   be undone is to undo it once, on the real data, before anyone relies on it.
 *
 * It restores ONLY the three columns the loader touches, and only on rows whose
 * current value actually differs — so it cannot resurrect a row, cannot move a
 * name, and re-running it after a successful restore writes nothing.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const HERE = new URL("./", import.meta.url);
const p = (base, rel) => fileURLToPath(new URL(rel, base));

const APPLY = process.argv.includes("--apply");

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function credentials() {
  if (process.env.OO_ADMIN_EMAIL && process.env.OO_ADMIN_PASSWORD) {
    return { email: process.env.OO_ADMIN_EMAIL, password: process.env.OO_ADMIN_PASSWORD };
  }
  const local = `${process.env.USERPROFILE ?? process.env.HOME}/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json`;
  if (existsSync(local)) {
    const c = JSON.parse(readFileSync(local, "utf8")).orangeOne;
    return { email: c.username, password: c.password };
  }
  throw new Error("No credentials. Set OO_ADMIN_EMAIL and OO_ADMIN_PASSWORD.");
}

async function main() {
  const env = readEnvFile(p(ROOT, "frontend/.env.local"));
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;

  const snapPath = p(HERE, "snapshot-before.json");
  if (!existsSync(snapPath)) throw new Error(`No snapshot at ${snapPath} — nothing to restore from.`);
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));

  const { email, password } = credentials();
  const a = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!a.ok) throw new Error(`Sign-in failed (${a.status})`);
  const token = (await a.json()).access_token;
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Current state, to diff against.
  const current = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/mst_items?select=id,item_type,category,ink_type&order=id.asc`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    const page = await r.json();
    current.push(...page);
    if (page.length < 1000) break;
  }

  const want = new Map(snap.map((r) => [r.id, r]));
  const same = (a, b) => (a ?? null) === (b ?? null);
  const todo = current.filter((c) => {
    const w = want.get(c.id);
    return w && !(same(w.item_type, c.item_type) && same(w.category, c.category) && same(w.ink_type, c.ink_type));
  });

  const missing = current.filter((c) => !want.has(c.id)).length;
  console.log(`Snapshot rows : ${snap.length}`);
  console.log(`Live rows     : ${current.length}` + (missing ? ` (${missing} not in the snapshot — created since, left alone)` : ""));
  console.log(`Rows to undo  : ${todo.length}`);

  if (!APPLY) {
    console.log("\nRehearsal only. Re-run with --apply to write.");
    for (const c of todo.slice(0, 10)) {
      const w = want.get(c.id);
      console.log(`  ${c.id}  ${c.item_type} -> ${w.item_type}`);
    }
    return;
  }

  // One PATCH per row would be 13,242 round trips. Rows sharing the same target
  // triple can go in one statement, and there are only a few hundred distinct
  // triples — so this collapses to a couple of hundred requests.
  //
  // Chunked at 200 ids for the same reason setMasterModules is
  // (core/platform/masterWrites.ts): `in` builds a query STRING, and a few
  // thousand uuids exceed what the gateway accepts as one URL.
  const groups = new Map();
  for (const c of todo) {
    const w = want.get(c.id);
    const k = JSON.stringify([w.item_type, w.category, w.ink_type]);
    if (!groups.has(k)) groups.set(k, { patch: { item_type: w.item_type, category: w.category, ink_type: w.ink_type }, ids: [] });
    groups.get(k).ids.push(c.id);
  }
  console.log(`Distinct target values: ${groups.size}`);

  let done = 0;
  for (const { patch, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r = await fetch(`${url}/rest/v1/mst_items?id=in.(${chunk.join(",")})`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`PATCH ${chunk.length} row(s) -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
      done += chunk.length;
      process.stdout.write(`\rRestored : ${done}/${todo.length}`);
    }
  }
  console.log(`\rRestored : ${done}/${todo.length}`);
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
