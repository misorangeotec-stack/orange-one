// Supabase Edge Function: followups-write
//
// Guarded write door for the ConnectWave (TallyCopilot) `receivables_followups` table that backs the
// Outstanding Dashboard payment-chase log. That table lives in a DIFFERENT Supabase project and is
// anon-READ-only there, so edits can't go direct from the browser (its anon client is sessionless —
// auth.uid() is null, so it cannot own a row).
//
// The caller is authenticated against THIS (identity) project, so we verify the login here, then write
// to ConnectWave with ITS service key. This is the same shape as `muster-write`, with ONE difference:
// follow-ups are logged by ordinary team members, so INSERT is allowed for any signed-in user; only
// UPDATE/DELETE are restricted to the row's author or an admin.
//
//   POST { action: "insert", entity_type, entity_name, remarks, outcome, next_followup_date,
//          promised_amount, promised_date, outstanding_at_entry, overdue_at_entry, salesperson }
//     -> { ok: true, row: { id } }
//   POST { action: "update", id, remarks, outcome, next_followup_date, promised_amount, promised_date }
//     -> { ok: true }           (author-or-admin only; 404 if the row is gone)
//   POST { action: "delete", id }
//     -> { ok: true }           (author-or-admin only; 404 if the row is gone)
//
// Deploy (IDENTITY project — where the login + the CONNECTWAVE_* secrets live):
//   supabase functions deploy followups-write --project-ref <identity ref>
//   (reuses the SAME CONNECTWAVE_URL / CONNECTWAVE_SERVICE_KEY secrets muster-write already uses —
//    do NOT set new ones. SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY of the
//    identity project are injected automatically.)
//
// ⚠️ THE CONNECTWAVE_* SECRETS ARE THE MOST DANGEROUS THING HERE (see muster-write's note): they were
// once found pointing at a stale ConnectWave project, so every save returned ok:true and landed in the
// wrong DB for months with `updated_by` NULL. If you ever touch them, PROVE the write lands rather than
// trusting a 200: insert a row, read it back in project ieeefdnyhzgrroifiqbb, confirm updated_by =
// caller email. A 200 only means "some database accepted it" — never "the right one did".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CW_URL = Deno.env.get("CONNECTWAVE_URL")!;
const CW_SERVICE_KEY = Deno.env.get("CONNECTWAVE_SERVICE_KEY")!;

const TABLE = "receivables_followups";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type AppRole = "admin" | "hod" | "sub_hod" | "employee";

const ENTITY_TYPES = ["customer", "group"];
const OUTCOMES = [
  "connected", "no_response", "promised_payment",
  "payment_disputed", "partial_received", "escalated", "other",
];

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** A numeric column value, or null when absent/blank. Rejects garbage (NaN) as an error upstream. */
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

  // ConnectWave service client — bypasses ConnectWave RLS to write the follow-ups table.
  const cw = createClient(CW_URL, CW_SERVICE_KEY, { auth: { persistSession: false } });

  // Lazily check identity admin (only needed to authorize edits/deletes of others' rows).
  const isAdmin = async (): Promise<boolean> => {
    const idAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await idAdmin.from("user_roles").select("role").eq("user_id", user.id);
    if (error) return false;
    return (data ?? []).some((r: { role: AppRole }) => r.role === "admin");
  };

  // ---- insert: any signed-in user, stamped as themselves ----
  if (body.action === "insert") {
    const entity_type = clean(body.entity_type);
    if (!entity_type || !ENTITY_TYPES.includes(entity_type)) {
      return json(400, { error: "entity_type must be 'customer' or 'group'" });
    }
    const entity_name = clean(body.entity_name);
    if (!entity_name) return json(400, { error: "entity_name required" });
    const remarks = clean(body.remarks);
    if (!remarks) return json(400, { error: "remarks required" });
    const outcome = clean(body.outcome);
    if (!outcome || !OUTCOMES.includes(outcome)) {
      return json(400, { error: `outcome must be one of: ${OUTCOMES.join(", ")}` });
    }
    const next_followup_date = ymd(body.next_followup_date);
    const promised_date = ymd(body.promised_date);
    if (next_followup_date === "BAD" || promised_date === "BAD") {
      return json(400, { error: "dates must be yyyy-mm-dd" });
    }
    const promised_amount = num(body.promised_amount);
    const outstanding_at_entry = num(body.outstanding_at_entry);
    const overdue_at_entry = num(body.overdue_at_entry);
    if ([promised_amount, outstanding_at_entry, overdue_at_entry].some((n) => Number.isNaN(n))) {
      return json(400, { error: "numeric fields must be numbers" });
    }

    const { data, error } = await cw
      .from(TABLE)
      .insert({
        entity_type,
        entity_name,
        remarks,
        outcome,
        next_followup_date,
        promised_amount,
        promised_date,
        outstanding_at_entry,
        overdue_at_entry,
        salesperson: clean(body.salesperson),
        created_by: user.id,
        created_by_email: user.email ?? null,
      })
      .select("id")
      .single();
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, row: data });
  }

  // ---- update: author-or-admin, conversation fields only ----
  if (body.action === "update") {
    const id = clean(body.id);
    if (!id) return json(400, { error: "id required" });

    const { data: existing, error: readErr } = await cw
      .from(TABLE).select("created_by").eq("id", id).maybeSingle();
    if (readErr) return json(400, { error: readErr.message });
    if (!existing) return json(404, { error: `follow-up ${id} not found` });
    if (existing.created_by !== user.id && !(await isAdmin())) {
      return json(403, { error: "you can only edit your own follow-ups" });
    }

    const outcome = clean(body.outcome);
    if (!outcome || !OUTCOMES.includes(outcome)) {
      return json(400, { error: `outcome must be one of: ${OUTCOMES.join(", ")}` });
    }
    const remarks = clean(body.remarks);
    if (!remarks) return json(400, { error: "remarks required" });
    const next_followup_date = ymd(body.next_followup_date);
    const promised_date = ymd(body.promised_date);
    if (next_followup_date === "BAD" || promised_date === "BAD") {
      return json(400, { error: "dates must be yyyy-mm-dd" });
    }
    const promised_amount = num(body.promised_amount);
    if (Number.isNaN(promised_amount)) return json(400, { error: "promised_amount must be a number" });

    // .select() so a zero-row match is a 404, not a silent ok:true (same trap muster-write documents).
    const { data, error } = await cw
      .from(TABLE)
      .update({ remarks, outcome, next_followup_date, promised_amount, promised_date })
      .eq("id", id)
      .select("id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `follow-up ${id} not found` });
    return json(200, { ok: true });
  }

  // ---- delete: author-or-admin ----
  if (body.action === "delete") {
    const id = clean(body.id);
    if (!id) return json(400, { error: "id required" });

    const { data: existing, error: readErr } = await cw
      .from(TABLE).select("created_by").eq("id", id).maybeSingle();
    if (readErr) return json(400, { error: readErr.message });
    if (!existing) return json(404, { error: `follow-up ${id} not found` });
    if (existing.created_by !== user.id && !(await isAdmin())) {
      return json(403, { error: "you can only delete your own follow-ups" });
    }

    const { data, error } = await cw.from(TABLE).delete().eq("id", id).select("id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `follow-up ${id} not found` });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
