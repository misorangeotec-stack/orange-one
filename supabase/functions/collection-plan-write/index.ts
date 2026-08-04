// Supabase Edge Function: collection-plan-write
//
// Guarded write door for the ConnectWave (TallyCopilot) `receivables_collection_plan` table that
// backs the Salesperson Collection Report's monthly payment plan. That table lives in a DIFFERENT
// Supabase project and is anon-READ-only there, so edits can't go direct from the browser (its
// anon client is sessionless — auth.uid() is null, so it cannot own a row).
//
// The caller is authenticated against THIS (identity) project, so we verify the login here, then
// write to ConnectWave with ITS service key. Same shape as `followups-write` / `muster-write`.
//
//   POST { action: "upsert", month, entity_type, entity_name, planned_amount,
//          expected_date, note, salesperson, due_at_plan, outstanding_at_plan }
//     -> { ok: true, row: { ... } }
//   POST { action: "upsert_many", entries: [ {...same fields...} ] }
//     -> { ok: true, count: n }
//   POST { action: "delete", month, entity_type, entity_name }
//     -> { ok: true }           (author-or-admin only; 404 if the row is gone)
//
// AUTHORIZATION — and why it DELIBERATELY DIVERGES from followups-write:
//   A follow-up is a personal utterance ("here is what I discussed on the phone"), so nobody else
//   may rewrite it and edits are own-or-admin. A collection plan is a SHARED CELL: the table's
//   unique (month, entity_type, entity_name) constraint means there is only ever ONE row, so
//   "your row" is decided by whoever typed first. A manager revising a number they are accountable
//   for is the intended workflow, and own-rows-only would lock them out with delete-and-re-enter
//   as the only workaround — which destroys the authorship trail. Therefore:
//     upsert / upsert_many -> ANY signed-in user, stamped with updated_by
//     delete               -> author-or-admin (deletion is the only irreversible action here)
//   The residual risk is a silent overwrite. The table's `revision` + updated_by/updated_at make
//   that DETECTABLE in the UI ("revised by X, rev 3"), not prevented. An append-only audit log is
//   deliberately out of v1.
//
//   Rejected alternative: gating on is_admin() or profiles.receivables_admin_menus @> '["settings"]'
//   (the muster-write rule). That grant governs MASTERS — salesperson tags, group mappings.
//   Planning is line-level daily work; routing every salesperson's plan through an admin would
//   recreate the manual-Excel bottleneck this feature exists to remove.
//
//   NOT enforced here: per-salesperson scope. This function has no salesperson map, and the row's
//   own `salesperson` column is FROZEN CONTEXT — it goes stale the moment the muster reassigns a
//   customer, at which point enforcing on it would start rejecting legitimate saves. Scoping stays
//   UI-level, exactly as it is for follow-ups and for the dashboard itself (see lib/scope.tsx).
//   This is not data isolation and must not be described as such.
//
// Deploy (IDENTITY project — where the login + the CONNECTWAVE_* secrets live):
//   supabase functions deploy collection-plan-write --project-ref <identity ref>
//   (reuses the SAME CONNECTWAVE_URL / CONNECTWAVE_SERVICE_KEY secrets followups-write and
//    muster-write already use — do NOT set new ones. SUPABASE_URL / SUPABASE_ANON_KEY /
//    SUPABASE_SERVICE_ROLE_KEY of the identity project are injected automatically.)
//
// ⚠️ THE CONNECTWAVE_* SECRETS ARE THE MOST DANGEROUS THING HERE (see muster-write's note): they
// were once found pointing at a stale ConnectWave project, so every save returned ok:true and
// landed in the wrong DB for months with `updated_by` NULL. If you ever touch them, PROVE the
// write lands rather than trusting a 200: save a plan, read it back in project
// ieeefdnyhzgrroifiqbb, confirm updated_by_email = caller email. A 200 only means "some database
// accepted it" — never "the right one did".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CW_URL = Deno.env.get("CONNECTWAVE_URL")!;
const CW_SERVICE_KEY = Deno.env.get("CONNECTWAVE_SERVICE_KEY")!;

const TABLE = "receivables_collection_plan";
const CONFLICT = "month,entity_type,entity_name";
/** Batch ceiling for upsert_many. A planning batch is a month's worth of customers, not a bulk load. */
const MAX_ENTRIES = 500;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type AppRole = "admin" | "hod" | "sub_hod" | "employee";

const ENTITY_TYPES = ["customer", "group"];
/** The hub's month vocabulary, 'MMM-YY'. Same pattern the table's check constraint pins. */
const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/;

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** A numeric column value, or null when absent/blank. Returns NaN for garbage (rejected upstream). */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** A yyyy-mm-dd date value, or null. Returns the sentinel string "BAD" when malformed. */
const ymd = (v: unknown): string | null | "BAD" => {
  const s = clean(v);
  if (s === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "BAD";
};

interface PlanRow {
  month: string;
  entity_type: string;
  entity_name: string;
  planned_amount: number;
  expected_date: string | null;
  note: string | null;
  salesperson: string | null;
  due_at_plan: number | null;
  outstanding_at_plan: number | null;
}

/**
 * Validate one plan entry into a row, or return the reason it is invalid.
 *
 * The month gate is the important one: a bad month writes SUCCESSFULLY and then renders as
 * "unplanned" forever, because nothing on the read side will ever ask for that label.
 */
function parseEntry(e: Record<string, unknown>): { row: PlanRow } | { error: string } {
  const month = clean(e.month);
  if (!month || !MONTH_RE.test(month)) {
    return { error: "month must be a 'MMM-YY' label, e.g. Aug-26" };
  }
  const entity_type = clean(e.entity_type) ?? "customer";
  if (!ENTITY_TYPES.includes(entity_type)) {
    return { error: "entity_type must be 'customer' or 'group'" };
  }
  const entity_name = clean(e.entity_name);
  if (!entity_name) return { error: "entity_name required" };

  const planned_amount = num(e.planned_amount);
  if (planned_amount === null || Number.isNaN(planned_amount)) {
    return { error: "planned_amount must be a number" };
  }
  if (planned_amount < 0) return { error: "planned_amount must not be negative" };

  const expected_date = ymd(e.expected_date);
  if (expected_date === "BAD") return { error: "expected_date must be yyyy-mm-dd" };

  const due_at_plan = num(e.due_at_plan);
  const outstanding_at_plan = num(e.outstanding_at_plan);
  if ([due_at_plan, outstanding_at_plan].some((n) => Number.isNaN(n))) {
    return { error: "numeric fields must be numbers" };
  }

  return {
    row: {
      month,
      entity_type,
      entity_name,
      planned_amount,
      expected_date,
      note: clean(e.note),
      salesperson: clean(e.salesperson),
      due_at_plan,
      outstanding_at_plan,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  if (!CW_URL || !CW_SERVICE_KEY) {
    return json(500, { error: "server not configured: CONNECTWAVE_URL / CONNECTWAVE_SERVICE_KEY missing" });
  }

  // 1) Authenticate the caller from their JWT (identity project).
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await caller.auth.getUser();
  if (authErr || !user) return json(401, { error: "not authenticated" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  // ConnectWave service client — bypasses ConnectWave RLS to write the plan table.
  const cw = createClient(CW_URL, CW_SERVICE_KEY, { auth: { persistSession: false } });

  // Lazily check identity admin (only needed to authorize deleting someone else's row).
  const isAdmin = async (): Promise<boolean> => {
    const idAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await idAdmin.from("user_roles").select("role").eq("user_id", user.id);
    if (error) return false;
    return (data ?? []).some((r: { role: AppRole }) => r.role === "admin");
  };

  // Author stamp. created_* is only honoured on INSERT — the table's trigger restores the
  // original values from `old` on every UPDATE, so a revision can never rewrite the row's origin.
  const stamp = {
    created_by: user.id,
    created_by_email: user.email ?? null,
    updated_by: user.id,
    updated_by_email: user.email ?? null,
  };

  // ---- upsert: any signed-in user (shared cell — see the header) ----
  if (body.action === "upsert") {
    const parsed = parseEntry(body);
    if ("error" in parsed) return json(400, { error: parsed.error });

    // upsert, not insert-then-update: the UI edits a cell and must not care whether a row already
    // exists. onConflict is the natural key, so two people editing the same cell converge on one
    // row instead of racing to create two.
    const { data, error } = await cw
      .from(TABLE)
      .upsert({ ...parsed.row, ...stamp }, { onConflict: CONFLICT })
      .select("id, month, entity_type, entity_name, planned_amount, expected_date, note, updated_by_email, updated_at, revision")
      .single();
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, row: data });
  }

  // ---- upsert_many: one round trip for a whole month's plan ----
  if (body.action === "upsert_many") {
    const entries = body.entries;
    if (!Array.isArray(entries)) return json(400, { error: "entries must be an array" });
    if (entries.length === 0) return json(200, { ok: true, count: 0 });
    if (entries.length > MAX_ENTRIES) {
      return json(400, { error: `at most ${MAX_ENTRIES} entries per request` });
    }

    // Validate the WHOLE batch before writing any of it: partial success on a planning batch is
    // worse than a clean rejection — the user cannot tell which half landed.
    const rows: PlanRow[] = [];
    for (let i = 0; i < entries.length; i++) {
      const parsed = parseEntry(entries[i] as Record<string, unknown>);
      if ("error" in parsed) return json(400, { error: `entry ${i}: ${parsed.error}` });
      rows.push(parsed.row);
    }

    const { data, error } = await cw
      .from(TABLE)
      .upsert(rows.map((r) => ({ ...r, ...stamp })), { onConflict: CONFLICT })
      .select("id");
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, count: data?.length ?? 0 });
  }

  // ---- delete: author-or-admin ----
  // Addressed by the NATURAL key, never by id: the client knows (month, entity) and may never
  // have read an id back for a row it is clearing.
  if (body.action === "delete") {
    const month = clean(body.month);
    if (!month || !MONTH_RE.test(month)) {
      return json(400, { error: "month must be a 'MMM-YY' label, e.g. Aug-26" });
    }
    const entity_type = clean(body.entity_type) ?? "customer";
    if (!ENTITY_TYPES.includes(entity_type)) {
      return json(400, { error: "entity_type must be 'customer' or 'group'" });
    }
    const entity_name = clean(body.entity_name);
    if (!entity_name) return json(400, { error: "entity_name required" });

    const { data: existing, error: readErr } = await cw
      .from(TABLE).select("created_by")
      .eq("month", month).eq("entity_type", entity_type).eq("entity_name", entity_name)
      .maybeSingle();
    if (readErr) return json(400, { error: readErr.message });
    // Already gone is the caller's desired end state, but say so rather than reporting success on
    // a row that may never have existed (e.g. a typo'd entity_name).
    if (!existing) return json(404, { error: `no plan for ${entity_name} in ${month}` });
    if (existing.created_by !== user.id && !(await isAdmin())) {
      return json(403, { error: "you can only delete a plan you created" });
    }

    // .select() so a zero-row match is a 404, not a silent ok:true.
    const { data, error } = await cw
      .from(TABLE).delete()
      .eq("month", month).eq("entity_type", entity_type).eq("entity_name", entity_name)
      .select("id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `no plan for ${entity_name} in ${month}` });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
