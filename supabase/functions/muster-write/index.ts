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
//   POST body { action: "update_company_map", company_guid, tally_company, company, location, checked }
//     -> { ok: true }  (keyed by the Tally COMPANY GUID — the raw book name embeds the financial
//                       year and is re-minted every April, so it can never be the key)
//   POST body { action: "insert_other_payment", ledger_id, tally_name, payment_date, amount,
//               allocation_type, ref_invoice, payment_ref, remarks, checked } -> { ok: true, row }
//   POST body { action: "update_other_payment", id, ...same fields } -> { ok: true }
//   POST body { action: "delete_other_payment", id }                 -> { ok: true }
//     (ext_other_payments is per-TRANSACTION, so unlike the musters above it has no natural key —
//      the bigint id PK addresses a row. Every row still carries the Tally ledger GUID, which is
//      what the Live (Tally) netting groups by.)
//
// Deploy (identity project):
//   supabase secrets set CONNECTWAVE_URL=<Tally CoPilot .env SUPABASE_URL> \
//                        CONNECTWAVE_SERVICE_KEY=<Tally CoPilot .env SUPABASE_SERVICE_KEY>
//   supabase functions deploy muster-write
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY of the identity project
//  are injected automatically; CONNECTWAVE_* are the two secrets you set above.)
//
// ⚠️ THE CONNECTWAVE_* SECRETS ARE THE MOST DANGEROUS THING ABOUT THIS FUNCTION (2026-07-17).
// They were found pointing at a DIFFERENT (stale) ConnectWave project. Every save from the Masters
// screen returned ok:true and wrote to that other database — for months. Nothing errored: the UI
// said "Saved", mutated its row in memory, and the edit evaporated on the next reload. The tell was
// that `updated_by` was NULL on every row of every muster table in the real project — no in-app
// write had EVER landed. Repointed to ieeefdnyhzgrroifiqbb and verified.
//
// If you ever touch these secrets, PROVE the write lands rather than trusting a 200:
//   1. call update_tag with a row's EXISTING values (a no-op edit);
//   2. read that row back in the target project;
//   3. `updated_by` must be the caller's email and `updated_at` must have moved.
// A 200 from this function only means "some database accepted it" — never "the right one did".

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

/** The only two allocation types. Pinned here, by a DB check constraint, and by the UI's Select —
 *  that three-sided lock is what lets liveOtherPayments.ts compare === "AGST REF" exactly. */
const ALLOCATION_TYPES = ["AGST REF", "ON ACCOUNT"];

/**
 * Validate + normalise an Other Payment from the request body.
 * Returns the column patch, or an error string for a 400.
 */
function parseOtherPayment(body: Record<string, unknown>): { row: Record<string, unknown> } | { err: string } {
  const ledger_id = clean(body.ledger_id);
  if (!ledger_id) return { err: "ledger_id required (pick a customer)" };

  // Number("") is 0 and Number("abc") is NaN — both must be rejected before reaching a numeric column.
  // The amount is a magnitude; direction is carried by allocation_type.
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { err: "amount must be a number greater than 0" };

  const allocation_type = clean(body.allocation_type);
  if (!allocation_type || !ALLOCATION_TYPES.includes(allocation_type)) {
    return { err: `allocation_type must be one of: ${ALLOCATION_TYPES.join(", ")}` };
  }

  const payment_date = clean(body.payment_date);
  if (payment_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) {
    return { err: "payment_date must be yyyy-mm-dd" };
  }

  return {
    row: {
      ledger_id,
      tally_name: clean(body.tally_name),
      payment_date,
      amount,
      allocation_type,
      ref_invoice: clean(body.ref_invoice),
      payment_ref: clean(body.payment_ref),
      remarks: clean(body.remarks),
      checked: body.checked === true,
      match_status: "guid_matched",
      source: "muster",
    },
  };
}

/** The id PK as a positive integer, or null when absent/garbage. */
const rowId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Validate + normalise a Red Mark row from the request body.
 * Red Mark is a per-ledger flag keyed by the Tally GUID (presence = flagged), so ledger_id is the
 * only hard requirement; everything else is display metadata. Returns the column patch or an error.
 */
function parseRedmark(body: Record<string, unknown>): { row: Record<string, unknown> } | { err: string } {
  const ledger_id = clean(body.ledger_id);
  if (!ledger_id) return { err: "ledger_id required (pick a customer)" };
  return {
    row: {
      ledger_id,
      tally_name: clean(body.tally_name),
      company: clean(body.company),
      location: clean(body.location),
      salesperson: clean(body.salesperson),
      reason: clean(body.reason),
      checked: body.checked !== false, // default true — presence means flagged
      match_status: "guid_matched",
      source: "muster",
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

  // ---- update_company_map (ext_company_map, keyed by the Tally COMPANY GUID) ----
  // Maps a Tally book to the finance-facing (company, location) pair the reports render.
  // UPSERT, not update: collection_refresh stubs a row for each active book, but a company added to
  // Tally since the last refresh has no row yet — an `update` would then match nothing and return
  // ok:true while saving NOTHING. company/location are NOT NULL, so coalesce rather than send null.
  if (body.action === "update_company_map") {
    const company_guid = clean(body.company_guid);
    if (!company_guid) return json(400, { error: "company_guid required" });
    const company = clean(body.company);
    if (!company) return json(400, { error: "company required" });
    const { error } = await cw
      .from("ext_company_map")
      .upsert({
        company_guid,
        tally_company: clean(body.tally_company),
        company,
        location: clean(body.location) ?? "",
        checked: body.checked === true,
        updated_by,
      }, { onConflict: "company_guid" });
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  // ---- ext_other_payments (per-TRANSACTION, addressed by the bigint id PK) ----
  // Manual money paid outside Tally. The Live (Tally) view nets these out of the ConnectWave
  // snapshot in the browser (liveOtherPayments.ts), grouping by ledger_id — so a row without a
  // valid Tally GUID would be invisible and would silently lose money. ledger_id is NOT NULL in
  // the DB and required by parseOtherPayment; both gates are deliberate.

  if (body.action === "insert_other_payment") {
    const parsed = parseOtherPayment(body);
    if ("err" in parsed) return json(400, { error: parsed.err });
    // Return the created row so the client can append it without re-reading the whole table.
    // id is `generated always as identity` — never send it.
    const { data, error } = await cw
      .from("ext_other_payments")
      .insert({ ...parsed.row, updated_by })
      .select()
      .single();
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, row: data });
  }

  if (body.action === "update_other_payment") {
    const id = rowId(body.id);
    if (id === null) return json(400, { error: "id required" });
    const parsed = parseOtherPayment(body);
    if ("err" in parsed) return json(400, { error: parsed.err });
    // .select() so a zero-row match is a 404, not a silent ok:true — same trap update_company_map
    // documents above: an `update` that matches nothing reports success while saving nothing.
    const { data, error } = await cw
      .from("ext_other_payments")
      .update({ ...parsed.row, updated_by })
      .eq("id", id)
      .select("id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `other payment ${id} not found` });
    return json(200, { ok: true });
  }

  if (body.action === "delete_other_payment") {
    const id = rowId(body.id);
    if (id === null) return json(400, { error: "id required" });
    const { data, error } = await cw
      .from("ext_other_payments")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `other payment ${id} not found` });
    return json(200, { ok: true });
  }

  // ---- ext_redmark (per-ledger flag, keyed by the Tally GUID) ----
  // "Red Mark" customers — a hand-curated list. A row's presence flags the customer; deleting the
  // row un-flags them. Live (Tally) reads membership by ledger_id (= Customer.id). Insert upserts so
  // re-flagging an already-marked customer is idempotent rather than a PK-conflict error.

  if (body.action === "insert_redmark") {
    const parsed = parseRedmark(body);
    if ("err" in parsed) return json(400, { error: parsed.err });
    const { data, error } = await cw
      .from("ext_redmark")
      .upsert({ ...parsed.row, updated_by }, { onConflict: "ledger_id" })
      .select()
      .single();
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, row: data });
  }

  if (body.action === "update_redmark") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required" });
    // Only the editable metadata is patched here (not the key). .select() so a zero-row match is a
    // 404, not a silent ok:true.
    const { data, error } = await cw
      .from("ext_redmark")
      .update({
        salesperson: clean(body.salesperson),
        reason: clean(body.reason),
        checked: body.checked !== false,
        updated_by,
      })
      .eq("ledger_id", ledger_id)
      .select("ledger_id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `red mark ${ledger_id} not found` });
    return json(200, { ok: true });
  }

  if (body.action === "delete_redmark") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required" });
    const { data, error } = await cw
      .from("ext_redmark")
      .delete()
      .eq("ledger_id", ledger_id)
      .select("ledger_id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `red mark ${ledger_id} not found` });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
