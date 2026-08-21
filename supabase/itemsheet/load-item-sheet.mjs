#!/usr/bin/env node
/**
 * Load the Inventory Mapping sheet onto the central item master.
 *
 *   cd "d:/AI Development/Orange One"
 *   node supabase/itemsheet/load-item-sheet.mjs ["path/to/workbook.xlsx"]
 *
 * WHAT IT DOES
 *   Reads Sheet1 (TYPE | Item Name | CATEGORY | INK-TYPE), normalises the type
 *   words, refills `mst_item_sheet_import`, then calls `mst_apply_item_sheet()`
 *   and prints its report. Everything it writes goes through PostgREST as a
 *   signed-in admin, so RLS decides what is allowed — there is no service key
 *   anywhere in here.
 *
 * WHY A SCRIPT AND NOT SQL IN A MIGRATION
 *   The sheet will be revised. A migration is applied once; this is meant to be
 *   run again, against a newer workbook, without a manual pass. The staging
 *   table is what makes that safe: it is refilled from scratch every run, and
 *   the apply is a no-op for every row that has not actually changed.
 *
 * ⚠ IT TAKES A SNAPSHOT FIRST, and it is not decoration. 2,484 rows changed
 *   type on the first load; if the sheet turns out to be wrong, that file is
 *   the only way back. `restore-snapshot.mjs` reads it.
 *
 * ⚠ AN UNKNOWN TYPE WORD IS A HARD ERROR, never a quiet fallback to `other`.
 *   A revised sheet that grows a fourteenth type must be a conversation, not a
 *   silent demotion of a few hundred items.
 *
 * ⚠ NEITHER `psql` NOR THE `pg` MODULE EXISTS on the machine this was written
 *   on, which is why this goes over PostgREST rather than a direct connection.
 *   `xlsx` lives in frontend/node_modules, hence the explicit require below.
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const HERE = new URL("./", import.meta.url);
const p = (base, rel) => fileURLToPath(new URL(rel, base));

// xlsx is a dependency of the frontend app, not of the repo root.
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const XLSX = require("xlsx");

const DEFAULT_WORKBOOK = "Misc/Bushra Reports/Inventory Mapping Sales Register.xlsx";

/**
 * The sheet's 16 TYPE words -> the 13 stored keys.
 *
 * ⚠ THE FIRST FIVE KEYS ARE SPELLED TO MATCH receivables-hub's SaleType. Do not
 *   "tidy" spare_parts into spare_part; the whole point of those five strings is
 *   that item and revenue can be joined without a translation table.
 *
 * The merges, and why each one:
 *   PACKING MATERIAL STOCK / PACKING MATERIAL  two Tally group names, one thing.
 *   SUBLIMATION PAPER (1 row)                  a paper.
 *   (Ungrouped)                                not a type word at all — it is
 *     Tally saying "this item is in no group". All 154 of those rows carry
 *     CATEGORY = OTHERS, so the sheet's author did classify them; `other` reads
 *     that, where NULL would throw it away.
 *
 * PROVISION INK and Other Ink stay OUT of `ink` on purpose: a provision is an
 * accounting entry, not stock, and lumping it in would overstate ink.
 */
const TYPE_MAP = new Map(Object.entries({
  "SPARE PART": "spare_parts",
  "INK": "ink",
  "PAPER": "paper",
  "SUBLIMATION PAPER": "paper",
  "MACHINE": "machine",
  "HEAD": "head",
  "RAW MATERIAL": "raw_material",
  "OTHER": "other",
  "(UNGROUPED)": "other",
  "PACKING MATERIAL": "packing_material",
  "PACKING MATERIAL STOCK": "packing_material",
  "CARTAGE": "cartage",
  "SOFTWARE": "software",
  "PROVISION INK": "provision_ink",
  "OTHER INK": "other_ink",
  "SERVICE EXPENSE": "service_expense",
}));

// --------------------------------------------------------------- plumbing --

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * Credentials, in order of preference:
 *   1. OO_ADMIN_EMAIL / OO_ADMIN_PASSWORD in the environment — what CI or
 *      anyone other than this machine should use.
 *   2. The local test-credentials file, which is outside the repo.
 * The password is never printed and never passed on a command line.
 */
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

async function signIn(url, anonKey) {
  const { email, password } = credentials();
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`Sign-in failed (${r.status}). Is the account an admin?`);
  return (await r.json()).access_token;
}

function makeRest(url, anonKey, token) {
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  return async (path, init = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
}

/** PostgREST caps a response; walk it a page at a time. */
async function fetchAll(rest, path, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const page = await rest(`${path}&order=id.asc`, {
      headers: { Range: `${from}-${from + pageSize - 1}` },
    });
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

// ------------------------------------------------------------------- main --

async function main() {
  const workbookPath = process.argv[2]
    ? process.argv[2]
    : p(ROOT, DEFAULT_WORKBOOK);

  const env = readEnvFile(p(ROOT, "frontend/.env.local"));
  const url = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("frontend/.env.local is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");

  console.log(`Workbook : ${workbookPath}`);
  console.log(`Project  : ${url}`);

  // ---------------------------------------------------------- read sheet --
  const wb = XLSX.readFile(workbookPath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" }).slice(1);

  const unknownTypes = new Map();
  const staging = [];
  const seen = new Set();
  let blankNames = 0;
  let duplicates = 0;

  for (const r of rows) {
    const name = String(r[1] ?? "").trim();
    if (!name) { blankNames++; continue; }
    // The staging table keys on the name, so a repeated name would be an
    // upsert conflict rather than a second row. Say so instead of losing it.
    if (seen.has(name)) { duplicates++; continue; }
    seen.add(name);

    const rawType = String(r[0] ?? "").trim();
    const key = TYPE_MAP.get(rawType.toUpperCase());
    if (rawType && !key) {
      unknownTypes.set(rawType, (unknownTypes.get(rawType) ?? 0) + 1);
      continue;
    }

    staging.push({
      item_name: name,
      item_type: key ?? null,
      category: String(r[2] ?? "").trim() || null,
      ink_type: String(r[3] ?? "").trim() || null,
    });
  }

  if (unknownTypes.size) {
    console.error("\nThe sheet uses type words this loader does not know:");
    for (const [word, n] of unknownTypes) console.error(`  ${word}  (${n} rows)`);
    console.error("\nAdd them to TYPE_MAP here AND to the CHECK in");
    console.error("supabase/migrations/20260921120000_item_sheet_type_category_ink.sql,");
    console.error("AND to ITEM_TYPES in frontend/src/core/platform/liveMasters.ts.");
    console.error("Nothing has been written.");
    process.exit(1);
  }

  console.log(`Sheet    : ${sheetName} — ${staging.length} usable rows` +
    (blankNames ? `, ${blankNames} blank name(s) skipped` : "") +
    (duplicates ? `, ${duplicates} duplicate name(s) skipped` : ""));

  // ------------------------------------------------------------- connect --
  const token = await signIn(url, anonKey);
  const rest = makeRest(url, anonKey, token);

  // ------------------------------------------------------------ snapshot --
  // Taken BEFORE anything is written, and of the three columns this touches.
  const before = await fetchAll(rest, "mst_items?select=id,name,item_type,category,ink_type");
  const snapshotPath = p(HERE, "snapshot-before.json");
  writeFileSync(snapshotPath, JSON.stringify(before));
  console.log(`Snapshot : ${before.length} rows -> ${snapshotPath}`);

  // -------------------------------------------------------- fill staging --
  // Emptied first, so a name dropped from a revised sheet stops being applied
  // rather than lingering from the previous run.
  await rest("mst_item_sheet_import?item_name=not.is.null", { method: "DELETE" });

  const CHUNK = 500;
  for (let i = 0; i < staging.length; i += CHUNK) {
    await rest("mst_item_sheet_import", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(staging.slice(i, i + CHUNK)),
    });
    process.stdout.write(`\rStaging  : ${Math.min(i + CHUNK, staging.length)}/${staging.length}`);
  }
  console.log("");

  // ---------------------------------------------------------------- apply --
  const [report] = await rest("rpc/mst_apply_item_sheet", { method: "POST", body: "{}" });

  console.log("\n--- mst_apply_item_sheet -------------------------------------");
  for (const [k, v] of Object.entries(report)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log("--------------------------------------------------------------");

  // ------------------------------------------------- the unmatched items --
  const after = await fetchAll(rest, "mst_items?select=id,name,item_type,category,ink_type");
  // The same key mst_apply_item_sheet() joins on — runs of whitespace collapsed,
  // and nothing else. See that function for why.
  const key = (s) => String(s).replace(/\s+/g, " ").trim();
  const sheetNames = new Set(staging.map((s) => key(s.item_name)));
  const unmatched = [...new Set(after.filter((i) => !sheetNames.has(key(i.name))).map((i) => i.name))].sort();
  const itemNames = new Set(after.map((i) => key(i.name)));
  const orphanSheetRows = staging.filter((s) => !itemNames.has(key(s.item_name))).map((s) => s.item_name);

  writeFileSync(p(HERE, "unmatched.txt"),
    `# Items in the master that the sheet does not name (${unmatched.length}).\n` +
    `# They keep whatever type they already carried — exact match only, nothing guessed.\n` +
    `# Workbook: ${workbookPath}\n\n` +
    unmatched.join("\n") + "\n");

  if (orphanSheetRows.length) {
    console.log(`\nSheet names with no item in the master (${orphanSheetRows.length}):`);
    for (const n of orphanSheetRows) console.log(`  ${n}`);
  }
  console.log(`\nItems the sheet does not name: ${unmatched.length} -> supabase/itemsheet/unmatched.txt`);

  // What actually moved, so the run is readable without a separate query.
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const moves = new Map();
  for (const row of after) {
    const b = beforeById.get(row.id);
    if (!b || b.item_type === row.item_type) continue;
    const k = `${b.item_type ?? "(not set)"} -> ${row.item_type ?? "(not set)"}`;
    moves.set(k, (moves.get(k) ?? 0) + 1);
  }
  if (moves.size) {
    console.log("\nType changes:");
    for (const [k, n] of [...moves.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(34)} ${n}`);
    }
  } else {
    console.log("\nNo type changed — the master already agreed with the sheet.");
  }
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
