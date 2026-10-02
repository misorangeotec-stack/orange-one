#!/usr/bin/env node
/**
 * check-handbook-answers.mjs — does the Ask HR bubble still answer correctly?
 *
 * This repo has no test runner, so a prompt edit that quietly breaks citations would ship
 * unnoticed: the build is green either way. This is the gate for `ask-handbook`, and the
 * cases live beside it in handbook-questions.json.
 *
 * USAGE (from `frontend/`):
 *   npm run handbook-check                 # every case
 *   npm run handbook-check -- --only 12    # one case, while iterating on the prompt
 *
 * ⚠ IT CALLS THE LIVE FUNCTION AND SPENDS REAL MONEY. Roughly two rupees a full run with
 *   a warm cache. It is a gate to run before shipping a prompt change, not a watch task.
 *
 * ⚠ IT SIGNS IN AS A REAL PERSON and every question it asks lands in kb_questions, exactly
 *   as a staff question would. That is deliberate — testing the real path is the point —
 *   but it means the question log will carry these. They are anonymous like any other.
 *
 * Needs the repo-root `.env` (SUPABASE_URL) and `frontend/.env.local` (VITE_SUPABASE_*),
 * plus the browser-test credentials file. Prints answers, never the password.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CREDS = "C:/Users/Admin/.claude/projects/d--AI-Development-Orange-One/test-credentials.local.json";

const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf("--only");
const ONLY = onlyIdx >= 0 && argv[onlyIdx + 1] ? Number(argv[onlyIdx + 1]) : null;

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
      return m ? [m[1], m[2].trim().replace(/^["']|["']$/g, "")] : null;
    }).filter(Boolean)
  );
}

const env = { ...readEnv(path.join(REPO, ".env")), ...readEnv(path.join(REPO, "frontend", ".env.local")) };
const URL_ = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY;

if (!URL_ || !ANON) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.");
  process.exit(1);
}
if (!fs.existsSync(CREDS)) {
  console.error(`Missing the browser-test credentials file:\n  ${CREDS}`);
  process.exit(1);
}

const { cases } = JSON.parse(fs.readFileSync(path.join(HERE, "handbook-questions.json"), "utf8"));

async function signIn() {
  const o = JSON.parse(fs.readFileSync(CREDS, "utf8")).orangeOne;
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: o.username, password: o.password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sign-in failed (${r.status})`);
  return j.access_token;
}

async function ask(tok, question) {
  const t0 = Date.now();
  const r = await fetch(`${URL_}/functions/v1/ask-handbook`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ms: Date.now() - t0, ...body };
}

function judge(c, res) {
  const fails = [];
  if (res.status !== 200) return [`HTTP ${res.status}: ${res.error ?? ""}`];

  const anchors = (res.sections ?? []).map((s) => s.anchor);
  const text = (res.answer ?? "").toLowerCase();

  if (c.anchors.length === 0) {
    if (res.covered) fails.push(`expected "not in the handbook", got covered:true`);
    if (anchors.length) fails.push(`expected no citation, got ${anchors.join(", ")}`);
  } else if (!anchors.some((a) => c.anchors.includes(a))) {
    fails.push(`cited ${anchors.length ? anchors.join(", ") : "nothing"}; wanted one of ${c.anchors.join(", ")}`);
  }

  for (const m of c.must ?? []) if (!text.includes(m.toLowerCase())) fails.push(`answer is missing "${m}"`);
  for (const m of c.mustNot ?? []) if (text.includes(m.toLowerCase())) fails.push(`answer should not say "${m}"`);
  return fails;
}

const list = ONLY ? [cases[ONLY - 1]].filter(Boolean) : cases;
if (!list.length) {
  console.error(`No such case. There are ${cases.length}.`);
  process.exit(1);
}

const tok = await signIn();
console.log(`\nAsking ${list.length} question${list.length === 1 ? "" : "s"} of the live handbook…\n`);

let passed = 0;
const failures = [];
for (const [i, c] of list.entries()) {
  const n = ONLY ?? i + 1;
  const res = await ask(tok, c.ask);
  const fails = judge(c, res);
  const ok = fails.length === 0;
  if (ok) passed += 1;
  else failures.push({ n, c, res, fails });

  console.log(`${ok ? "PASS" : "FAIL"}  ${String(n).padStart(2)}. ${c.ask}   (${res.ms}ms)`);
  if (!ok) {
    for (const f of fails) console.log(`        ${f}`);
    console.log(`        answer: ${(res.answer ?? res.error ?? "").slice(0, 240)}`);
    console.log(`        why this case exists: ${c.why}`);
  }
}

console.log(`\n${passed}/${list.length} passed.`);
if (failures.length) {
  console.log(`\nFailures are not automatically bugs in the prompt — check first whether the`);
  console.log(`handbook itself changed, or whether an anchor moved in a re-publish.`);
  process.exit(1);
}
