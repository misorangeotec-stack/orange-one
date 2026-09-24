// fms-ranking — the monthly FMS ranking (CC-1), computed with the portal's OWN code.
//
// WHAT IT DOES, EACH RUN
//   1. Freezes every FINISHED month not yet frozen (from START_MONTH on) — so a run
//      missed on the 1st loses nothing: the next one catches the month up.
//   2. Recomputes the running month to date.
//   The numbers are the modules' own: `_shared/fmsRanking.bundle.js` is their queue
//   logic compiled for Deno by supabase/ranking/build.mjs. SQL (fms_rank_rescore)
//   only adds the rows up.
//
// HOW, AND WHY IN PIECES
//   Loading every module in one request needs ~2.3 s of CPU against a ~2 s edge limit
//   (measured 18-09-2026). So one request CONDUCTS and does no module work:
//     { run: true }                       → the conductor. Calls this same function
//                                            once per active module, in parallel, then
//                                            closes each month in SQL.
//     { module, months, runId, today }    → one module's rows for those months.
//   Every call needs the `x-dispatch-secret` header (EMAIL_DISPATCH_SECRET), exactly as
//   work-snapshot's server path does. Deploy with --no-verify-jwt.
//
//   { run: true, dryRun: true } does everything but write, and reports each module's
//   row counts, drops and timings — the way to measure before anything is scheduled.
//   { clock: true } reports which clock the bundle is on.
//
// ⚠ SERVICE ROLE. The bundle reads with the service-role key, so row-level security
//   does not narrow anything here. Nothing this function returns carries anyone's rows
//   — only counts. People read the ranking through fms_rank_board, which is what
//   decides what each of them may see.
//
// ⚠ THIS RUNTIME IS UTC. The bundle corrects the clock at the module boundary and
//   assertIstClock() proves it before any figure is written.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { istToday, resolvedTz } from "../_shared/istClock.ts";
import {
  RANKED_MODULES,
  NOT_SCORED,
  assertIstClock,
  monthOf,
  nextMonth,
  runModule,
  todayIso,
  type Person,
} from "../_shared/fmsRanking.bundle.js";

/** The first month the ranking covers. Nothing earlier is ever computed or frozen. */
const START_MONTH = "2026-08-01";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("EMAIL_DISPATCH_SECRET") ?? "";
const SELF = `${SUPABASE_URL}/functions/v1/fms-ranking`;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Every profile, with when it was made — who may be charged for a finished month. */
async function loadPeople(): Promise<Person[]> {
  const { data, error } = await admin.from("profiles").select("id,created_at,is_external");
  if (error) throw new Error(`profiles: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    createdAt: p.created_at as string,
    external: !!p.is_external,
  }));
}

// ── One module ────────────────────────────────────────────────────────────────

async function workModule(body: Record<string, unknown>) {
  const module = String(body.module);
  if (!RANKED_MODULES[module]) return json(400, { error: `no scorer for ${module}` });
  const months = (body.months as { month: string; final: boolean }[]) ?? [];
  const today = String(body.today);
  const runId = String(body.runId);
  const dryRun = body.dryRun === true;

  const people = await loadPeople();
  const t0 = Date.now();
  const res = await runModule(module, months, today, people);
  const t1 = Date.now();

  const report = [];
  for (const m of res.months) {
    const stats = m.stats[module] ?? {};
    if (!dryRun) {
      const { error } = await admin.rpc("fms_rank_put_module", {
        p_month: m.month,
        p_module: module,
        p_rows: m.rows,
        p_stats: stats,
        p_run: runId,
      });
      if (error) throw new Error(`${module} ${m.month}: ${error.message}`);
    }
    report.push({
      month: m.month,
      final: m.final,
      rows: m.rows.length,
      scored: m.rows.filter((r) => r.outcome !== "upcoming").length,
      stats,
    });
  }
  return json(200, { module, ok: true, months: report, ms: { ...res.ms, write: Date.now() - t1, total: Date.now() - t0 } });
}

// ── The conductor ─────────────────────────────────────────────────────────────

async function conduct(dryRun: boolean) {
  const started = Date.now();
  const today = todayIso();
  const current = monthOf(today);
  const runId = crypto.randomUUID();

  const [{ data: mods, error: mErr }, { data: frozen, error: fErr }] = await Promise.all([
    admin.from("fms_rank_modules").select("module,active"),
    admin.from("fms_rank_months").select("month").not("frozen_at", "is", null),
  ]);
  if (mErr) throw new Error(mErr.message);
  if (fErr) throw new Error(fErr.message);

  // Every finished month from the start, not yet frozen — then the running month.
  const frozenSet = new Set((frozen ?? []).map((r) => String(r.month).slice(0, 10)));
  const months: { month: string; final: boolean }[] = [];
  for (let m = START_MONTH; m < current; m = nextMonth(m)) {
    if (!frozenSet.has(m)) months.push({ month: m, final: true });
  }
  if (current >= START_MONTH) months.push({ month: current, final: false });

  const active = (mods ?? []).filter((m) => m.active).map((m) => m.module as string);
  const scorable = active.filter((k) => !!RANKED_MODULES[k]);
  // Switched on but with no scorer: said out loud, never silently skipped.
  const unscorable = active.filter((k) => !RANKED_MODULES[k]).map((k) => ({ module: k, why: NOT_SCORED[k] ?? "no scorer" }));

  const results = await Promise.all(
    scorable.map(async (module) => {
      try {
        const r = await fetch(SELF, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-dispatch-secret": SECRET },
          body: JSON.stringify({ module, months, today, runId, dryRun }),
        });
        const text = await r.text();
        if (!r.ok) return { module, ok: false, status: r.status, error: text.slice(0, 300) };
        return JSON.parse(text);
      } catch (e) {
        return { module, ok: false, error: String((e as Error)?.message ?? e) };
      }
    }),
  );

  // Close each month. A finished month freezes only if EVERY scorable module wrote it
  // in THIS run — fms_rank_finish checks that itself and otherwise leaves it open.
  const closed = [];
  if (!dryRun) {
    for (const m of months) {
      const { data, error } = await admin.rpc("fms_rank_finish", {
        p_month: m.month,
        p_freeze: m.final,
        p_run: runId,
        p_expected: scorable,
      });
      closed.push(error ? { month: m.month, error: error.message } : data);
    }
  }

  return json(200, {
    dryRun,
    runId,
    today,
    months,
    modules: results,
    failed: results.filter((r) => !r.ok).map((r) => r.module),
    unscorable,
    closed,
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

    if (typeof body.module === "string") return await workModule(body);
    if (body.run === true) return await conduct(body.dryRun === true);
    return json(400, { error: "pass { run: true } (optionally dryRun) or { clock: true }" });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
