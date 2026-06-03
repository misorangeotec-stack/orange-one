#!/usr/bin/env node
/**
 * backup-db.mjs — local, restorable .sql backups of the two Supabase projects.
 *
 * WHY THIS IS A LOCAL CLI (not an in-app button / not on Vercel):
 *   A real restorable dump needs `pg_dump` + a direct Postgres connection string
 *   (with the DB password). That password is never shipped to the browser, and
 *   the app is a static SPA on Vercel with no server runtime. So the dump runs
 *   here, on your machine, against the live databases — read-only.
 *
 * USAGE (from the `frontend/` folder):
 *   npm run backup                          # both projects, full dump
 *   npm run backup -- --only=identity       # just the identity/auth project
 *   npm run backup -- --only=receivables    # just the receivables data project
 *   npm run backup -- --schema-only         # structure only (no data rows)
 *   npm run backup -- --data-only           # data rows only (no structure)
 *
 * PREREQUISITES (one-time):
 *   1. `pg_dump` on PATH, version >= the Supabase server major (PG 15/17).
 *      Windows: `winget install PostgreSQL.PostgreSQL` or the EnterpriseDB
 *      installer (both ship pg_dump.exe).
 *   2. Two connection strings in the repo-root `.env` (or `frontend/.env.local`
 *      — both gitignored):
 *        BACKUP_IDENTITY_DB_URL=postgresql://postgres.<ref>:<DB_PASSWORD>@<host>:5432/postgres
 *        BACKUP_RECEIVABLES_DB_URL=postgresql://postgres.<ref>:<DB_PASSWORD>@<host>:5432/postgres
 *      Get each from Supabase → Connect → Session pooler (URI). The password is
 *      the project DB password, NOT the anon/service key.
 *
 * Output: timestamped .sql files in the repo-root `backups/` folder (gitignored —
 * these contain real user data / PII; never commit them).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)); // frontend/scripts
const FRONTEND_DIR = resolve(SCRIPT_DIR, "..");             // frontend
const REPO_ROOT = resolve(FRONTEND_DIR, "..");              // repo root
const BACKUPS_DIR = join(REPO_ROOT, "backups");

// Connection strings are read from either of these (both gitignored). Later
// entries win, and the shell environment (process.env) overrides both.
const ENV_FILES = [
  join(REPO_ROOT, ".env"),          // repo-root .env  (credentials live here)
  join(FRONTEND_DIR, ".env.local"), // Vite's local env
];

// The two projects, in the order they're dumped.
const PROJECTS = [
  { key: "identity", label: "Identity / auth", envVar: "BACKUP_IDENTITY_DB_URL" },
  { key: "receivables", label: "Receivables data", envVar: "BACKUP_RECEIVABLES_DB_URL" },
];

// ── tiny console helpers (no deps) ──────────────────────────────────────────
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const die = (msg) => {
  console.error(`\n${c.red("✖ Backup aborted.")} ${msg}\n`);
  process.exit(1);
};

// ── minimal .env parser (KEY=VALUE; ignores comments/blank lines) ────────────
// Shell env (process.env) wins over the file, so you can override ad hoc.
function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip matching surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// ── CLI flags ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = { only: null, schemaOnly: false, dataOnly: false };
  for (const a of argv) {
    if (a.startsWith("--only=")) flags.only = a.slice("--only=".length).trim();
    else if (a === "--schema-only") flags.schemaOnly = true;
    else if (a === "--data-only") flags.dataOnly = true;
    else die(`Unknown argument: ${a}\nRun with no args for both projects, or use --only=identity|receivables, --schema-only, --data-only.`);
  }
  if (flags.schemaOnly && flags.dataOnly) {
    die("--schema-only and --data-only are mutually exclusive.");
  }
  if (flags.only && !PROJECTS.some((p) => p.key === flags.only)) {
    die(`--only must be one of: ${PROJECTS.map((p) => p.key).join(", ")} (got "${flags.only}").`);
  }
  return flags;
}

// ── pg_dump presence + version check ─────────────────────────────────────────
// Supabase runs Postgres 15/17; pg_dump must be >= the server major or it errors.
function checkPgDump() {
  const r = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    die(
      "`pg_dump` was not found on your PATH.\n" +
        "  Install the PostgreSQL client tools (v16 or v17 recommended):\n" +
        "    Windows:  winget install PostgreSQL.PostgreSQL\n" +
        "              (or the EnterpriseDB installer — both ship pg_dump.exe)\n" +
        "  Then re-open your terminal so PATH refreshes, and try again."
    );
  }
  const out = (r.stdout || "").trim(); // e.g. "pg_dump (PostgreSQL) 17.2"
  const major = Number((out.match(/\)\s+(\d+)/) || [])[1] || 0);
  console.log(c.dim(`  using ${out}`));
  if (major && major < 15) {
    console.log(
      c.yellow(
        `  ⚠ pg_dump major ${major} is older than the Supabase server (PG 15/17).\n` +
          "    The dump may fail with a server-version mismatch — install PG 16/17 client tools."
      )
    );
  }
  return major;
}

// ── one timestamp for the whole run: YYYY-MM-DD_HHMM (local time) ────────────
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dumpOne(project, dbUrl, flags, ts) {
  const suffix = flags.schemaOnly ? "_schema" : flags.dataOnly ? "_data" : "";
  const outFile = join(BACKUPS_DIR, `${project.key}${suffix}_${ts}.sql`);

  // Full restorable dump by default: structure + data + functions + RLS, with
  // CLEAN/IF EXISTS so the file can be replayed onto an existing database.
  const args = ["--no-owner", "--no-privileges", "--format=plain", "--file", outFile];
  if (flags.schemaOnly) args.push("--schema-only");
  else if (flags.dataOnly) args.push("--data-only");
  else args.push("--clean", "--if-exists");
  args.push(dbUrl); // connection string last

  console.log(`\n${c.cyan("▶")} ${c.bold(project.label)} ${c.dim(`(${project.key})`)}`);
  const r = spawnSync("pg_dump", args, { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });

  if (r.error || r.status !== 0) {
    // Don't leave a half-written / empty file behind.
    if (existsSync(outFile)) {
      try { unlinkSync(outFile); } catch { /* best effort */ }
    }
    const stderr = (r.stderr || "").trim();
    console.error(c.red(`  ✖ pg_dump failed for ${project.key}.`));
    if (stderr) console.error(stderr.split("\n").map((l) => "    " + l).join("\n"));
    return { ok: false, file: outFile };
  }

  const size = existsSync(outFile) ? statSync(outFile).size : 0;
  console.log(`  ${c.green("✔")} ${outFile} ${c.dim(`(${humanSize(size)})`)}`);
  return { ok: true, file: outFile, size };
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const flags = parseArgs(process.argv.slice(2));
  const fileEnv = ENV_FILES.reduce((acc, f) => Object.assign(acc, loadEnvFile(f)), {});
  const getEnv = (k) => (process.env[k] && process.env[k].trim()) || fileEnv[k] || "";

  const selected = PROJECTS.filter((p) => !flags.only || p.key === flags.only);

  console.log(c.bold("\nOrange One — database backup"));
  const mode = flags.schemaOnly ? "schema only" : flags.dataOnly ? "data only" : "full (schema + data)";
  console.log(c.dim(`  mode: ${mode}  •  output: ${BACKUPS_DIR}`));

  checkPgDump();

  // Verify all required connection strings are present before dumping anything.
  const missing = selected.filter((p) => !getEnv(p.envVar));
  if (missing.length) {
    die(
      `Missing connection string(s). Add them to ${ENV_FILES.join("  or  ")}:\n` +
        missing.map((p) => `    ${p.envVar}   (${p.label})`).join("\n") +
        "\n  Get each from Supabase → Connect → Session pooler (URI).\n" +
        "  Format: postgresql://postgres.<ref>:<DB_PASSWORD>@<host>:5432/postgres"
    );
  }

  mkdirSync(BACKUPS_DIR, { recursive: true });
  const ts = stamp();

  const results = [];
  for (const project of selected) {
    results.push({ project, ...dumpOne(project, getEnv(project.envVar), flags, ts) });
  }

  const okOnes = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log(c.bold("\nSummary"));
  for (const r of okOnes) {
    console.log(`  ${c.green("✔")} ${r.project.label}: ${r.file} ${c.dim(`(${humanSize(r.size)})`)}`);
  }
  for (const r of failed) {
    console.log(`  ${c.red("✖")} ${r.project.label}: failed`);
  }

  if (okOnes.length) {
    console.log(
      c.dim(`\n  Restore into a SCRATCH database (never the live one) with:\n` +
        `    psql "<scratch_connection_url>" -f "${okOnes[0].file}"`)
    );
  }

  if (failed.length) process.exit(1);
  console.log(c.green(`\n✔ Done — ${okOnes.length} backup file(s) written.\n`));
}

main();
