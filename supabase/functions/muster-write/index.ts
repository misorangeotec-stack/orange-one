// Supabase Edge Function: muster-write
//
// Guarded write door for the ConnectWave (TallyCopilot) muster tables that back the
// admin-only "Collection Report (Tally Live)" + "Customer Muster" screens. Those
// tables (ext_ledger_tags / ext_customer_group) live in a DIFFERENT Supabase project
// and are anon-READ-only there, so edits can't go direct from the browser.
//
// The Orange One admin is authenticated against THIS (identity) project, so we verify
// admin here (exactly like admin-users), then write to ConnectWave with ITS service
// key. Two secrets carry the ConnectWave connection (set once, see Deploy below).
//
//   POST body { action: "update_tag",  ledger_id, salesperson, category, checked }  -> { ok: true }
//   POST body { action: "update_group", ledger_id, group_name, collection_team, checked } -> { ok: true }
//     (both musters are keyed by the Tally ledger GUID, so a rename never orphans a mapping)
//
// Deploy (identity project):
//   supabase secrets set CONNECTWAVE_URL=<Tally CoPilot .env SUPABASE_URL> \
//                        CONNECTWAVE_SERVICE_KEY=<Tally CoPilot .env SUPABASE_SERVICE_KEY>
//   supabase functions deploy muster-write
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY of the identity project
//  are injected automatically; CONNECTWAVE_* are the two secrets you set above.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CW_URL = Deno.env.get("CONNECTWAVE_URL")!;
const CW_SERVICE_KEY = Deno.env.get("CONNECTWAVE_SERVICE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type AppRole = "admin" | "hod" | "sub_hod" | "employee";

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
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

  // 2) Authorize: the caller must be an admin (checked with the identity service role).
  const idAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: roleRows, error: roleErr } = await idAdmin.from("user_roles").select("role").eq("user_id", user.id);
  if (roleErr) return json(500, { error: roleErr.message });
  if (!(roleRows ?? []).some((r: { role: AppRole }) => r.role === "admin")) {
    return json(403, { error: "admin only" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  // Audit stamp: who made the edit (email preferred, id as fallback).
  const updated_by = user.email ?? user.id;

  // ConnectWave service client — bypasses ConnectWave RLS to write the musters.
  const cw = createClient(CW_URL, CW_SERVICE_KEY, { auth: { persistSession: false } });

  // ---- update_tag (ext_ledger_tags, keyed by Tally GUID) ----
  if (body.action === "update_tag") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required" });
    const { error } = await cw
      .from("ext_ledger_tags")
      .update({
        salesperson: clean(body.salesperson),
        category: clean(body.category) ?? "",
        checked: body.checked === true,
        updated_by,
      })
      .eq("ledger_id", ledger_id);
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  // ---- update_group (ext_ledger_group, keyed by Tally GUID) ----
  if (body.action === "update_group") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required" });
    // group_name is NOT NULL — only overwrite it when a non-empty value is sent (the client sends the
    // customer's own name when the field is left blank, so it never nulls the column).
    const patch: Record<string, unknown> = {
      collection_team: clean(body.collection_team),
      checked: body.checked === true,
      updated_by,
    };
    const gn = clean(body.group_name);
    if (gn !== null) patch.group_name = gn;
    const { error } = await cw.from("ext_ledger_group").update(patch).eq("ledger_id", ledger_id);
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
