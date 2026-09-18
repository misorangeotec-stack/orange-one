// kpi-facts — the KRA / KPI scorecard's facts (KPI-1), computed with the portal's OWN code.
//
// WHAT IT DOES, EACH RUN
//   Rebuilds every fact — one row per (person, piece of work): each FMS step from CC-1's
//   scorers, each Task Management task through Task Management's own fetcher and
//   predicates — and swaps the new set in whole. No period is stored; kpi_report places
//   each fact in the period of its due date. `_shared/kpiFacts.bundle.js` is the modules'
//   code compiled for Deno by `node supabase/ranking/build.mjs kpi`.
//
// HOW, AND WHY IN PIECES
//   Loading every module in one request needs more CPU than the ~2 s an edge request gets
//   (the ranking measured 2.3 s on 18-09-2026). So one request CONDUCTS and does no module
//   work:
//     { run: true }                        → the conductor. Opens a run, calls this same
//                                            function once per module, in parallel, then
//                                            asks SQL to make the run current (kpi_finish).
//     { module, runId }                    → one module's facts, written in chunks.
//   Every call needs the `x-dispatch-secret` header (EMAIL_DISPATCH_SECRET), exactly as the
//   ranking and work-snapshot do. Deploy with --no-verify-jwt.
//
//   { run: true, dryRun: true } does everything but write, and reports each module's fact
//   counts, drops and timings — the way to measure before anything is scheduled.
//   { clock: true } reports which clock the bundle is on.
//
// NEVER HALF-WRITTEN. Rows go in under a new run id; kpi_finish makes the run current only
//   when every module reported and every row arrived, then deletes the previous run's rows
//   in the same transaction. A module that fails leaves last night's run current.
//
// ⚠ SERVICE ROLE. The bundle reads with the service-role key, so row-level security narrows
//   nothing here. Nothing this function returns carries anyone's rows — only counts. People
//   read their figures through kpi_report, which decides what each of them may see.
//
// ⚠ THIS RUNTIME IS UTC. The bundle corrects the clock at the module boundary and
//   assertIstClock() proves it before any figure is written.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { istToday, resolvedTz } from "../_shared/istClock.ts";
import {
  RANKED_MODULES,
  NOT_SCORED,
  TASK_MODULE,
  assertIstClock,
  assertSheetArithmetic,
  moduleFacts,
  moduleNameOf,
  todayIso,
} from "../_shared/kpiFacts.bundle.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("EMAIL_DISPATCH_SECRET") ?? "";
const SELF = `${SUPABASE_URL}/functions/v1/kpi-facts`;

/** Rows per write. ~2,000 facts is ~1 MB of JSON — well inside a request, and few round trips. */
const CHUNK = 2000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Staff only: My Work is asked about staff, never about an external (customer) login. */
async function loadStaffIds(): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id,is_external");
  if (error) throw new Error(`profiles: ${error.message}`);
  return (data ?? []).filter((p) => !p.is_external).map((p) => p.id as string);
}

// ── One module ────────────────────────────────────────────────────────────────

async function workModule(body: Record<string, unknown>) {
  const module = String(body.module);
  if (module !== TASK_MODULE && !RANKED_MODULES[module]) return json(400, { error: `no facts for ${module}` });
  const runId = String(body.runId);
  const dryRun = body.dryRun === true;

  const t0 = Date.now();
  const staff = module === TASK_MODULE ? [] : await loadStaffIds();
  const res = await moduleFacts(module, staff);
  const t1 = Date.now();

  let written = 0;
  if (!dryRun) {
    for (let i = 0; i < res.facts.length; i += CHUNK) {
      const { data, error } = await admin.rpc("kpi_put_rows", { p_run: runId, p_rows: res.facts.slice(i, i + CHUNK) });
      if (error) throw new Error(`${module} rows ${i}: ${error.message}`);
      written += Number(data ?? 0);
    }
  }
  const ms = { ...res.ms, write: Date.now() - t1, total: Date.now() - t0 };
  const stats = { ...res.stats, name: moduleNameOf(module), ms };
  if (!dryRun) {
    const { error } = await admin.rpc("kpi_put_module", { p_run: runId, p_module: module, p_stats: stats });
    if (error) throw new Error(`${module} stats: ${error.message}`);
  }
  return json(200, { module, ok: true, written, stats });
}

// ── The conductor ─────────────────────────────────────────────────────────────

async function conduct(dryRun: boolean) {
  const started = Date.now();
  const asOf = new Date().toISOString();
  const runId = crypto.randomUUID();

  // CC-1's per-module switch: a module switched out of the ranking because it is not in
  // use yet is out of this report too, and the report's footer says so.
  const { data: mods, error: mErr } = await admin.from("fms_rank_modules").select("module,active");
  if (mErr) throw new Error(mErr.message);
  const active = (mods ?? []).filter((m) => m.active).map((m) => m.module as string);
  const fms = active.filter((k) => !!RANKED_MODULES[k]);
  const skipped = [
    ...(mods ?? []).filter((m) => !m.active).map((m) => ({ module: m.module, name: moduleNameOf(m.module), why: "switched off in the FMS ranking" })),
    ...active.filter((k) => !RANKED_MODULES[k]).map((k) => ({ module: k, name: moduleNameOf(k), why: NOT_SCORED[k] ?? "no scorer" })),
  ];
  const expected = [...fms, TASK_MODULE];

  if (!dryRun) {
    const { error } = await admin.rpc("kpi_run_begin", { p_run: runId, p_as_of: asOf, p_expected: expected, p_skipped: skipped });
    if (error) throw new Error(`kpi_run_begin: ${error.message}`);
  }

  const results = await Promise.all(
    expected.map(async (module) => {
      try {
        const r = await fetch(SELF, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-dispatch-secret": SECRET },
          body: JSON.stringify({ module, runId, dryRun }),
        });
        const text = await r.text();
        if (!r.ok) return { module, ok: false, status: r.status, error: text.slice(0, 300) };
        return JSON.parse(text);
      } catch (e) {
        return { module, ok: false, error: String((e as Error)?.message ?? e) };
      }
    }),
  );
  const failed = results.filter((r) => !r.ok).map((r) => r.module as string);

  let finish: unknown = null;
  if (!dryRun) {
    if (failed.length) {
      const note = `modules failed: ${failed.join(", ")}`;
      const { error } = await admin.rpc("kpi_run_fail", { p_run: runId, p_note: note });
      finish = error ? { ok: false, error: error.message } : { ok: false, note };
    } else {
      const { data, error } = await admin.rpc("kpi_finish", { p_run: runId });
      finish = error ? { ok: false, error: error.message } : data;
    }
  }

  return json(200, {
    dryRun,
    runId,
    asOf,
    today: todayIso(),
    expected,
    skipped,
    modules: results,
    failed,
    finish,
    facts: results.reduce((n, r) => n + (r.stats?.facts ?? 0), 0),
    ms: Date.now() - started,
  });
}

// ── handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.clock === true) {
      return json(200, { runtimeTz: resolvedTz(), istToday: istToday(), bundleToday: todayIso() });
    }

    // Every other path is the server's alone.
    if (!SECRET || req.headers.get("x-dispatch-secret") !== SECRET) {
      return json(401, { error: "requires the dispatch secret" });
    }
    assertIstClock();
    assertSheetArithmetic();

    if (typeof body.module === "string") return await workModule(body);
    if (body.run === true) return await conduct(body.dryRun === true);
    return json(400, { error: "pass { run: true } (optionally dryRun) or { clock: true }" });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
