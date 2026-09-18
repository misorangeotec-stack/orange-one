// Supabase Edge Function: muster-write
//
// Guarded write door for the ConnectWave (TallyCopilot) muster tables that back the
// admin-only "Collection Report (Tally Live)" + "Customer Muster" screens. Those
// tables (ext_ledger_tags / ext_customer_group) live in a DIFFERENT Supabase project
// and are anon-READ-only there, so edits can't go direct from the browser.
//
// The caller is authenticated against THIS (identity) project, so we verify authority
// here, then write to ConnectWave with ITS service key. Two secrets carry the
// ConnectWave connection (set once, see Deploy below).
//
// WHO MAY WRITE: an Orange One admin, or a user an admin granted FULL ACCESS to the
// Outstanding Dashboard's Settings menu (profiles.receivables_admin_menus contains
// 'settings'). Both are read with the identity service role, never taken from the
// request — see the authorize step in the handler.
//
// ONE EXCEPTION, added by RC-12: clear_redmark / reopen_redmark — and, since RC-13, clear_dispute /
// reopen_dispute. They are handled BEFORE that check and answer to their own, narrower rule so the
// collection team can close their own cases without being given the keys to every muster. Nothing
// else moved.
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
//   POST body { action: "update_segment_config", company_guid, small_max_pct, medium_max_pct }
//     -> { ok: true }  (the Customer Profile screen's "Edit Segments" bands, per company)
//   POST body { action: "clear_redmark",  ledger_id, clear_note } -> { ok: true, row }
//   POST body { action: "reopen_redmark", ledger_id }             -> { ok: true, row }
//     (RC-12. "Cleared" = the case is settled: the customer stops counting as Red Mark everywhere,
//      and the record STAYS with who cleared it, when and why. Delete is the other thing — "marked
//      by mistake" — and both remain.
//      🔴 THESE TWO DO NOT USE THE ADMIN CHECK BELOW. They carry their own rule: an admin, or a
//         Settings full-access user, on anyone — or a collector whose receivables_collection_teams
//         contains that ledger's ext_ledger_group.collection_team, on their own customers only. The
//         collectors are plain employees with no Settings grant, so anything behind that gate would
//         have been unreachable for the people the feature is for. That path may write ONLY the
//         four clear columns; see authorizeClear / handleClear.)
//   POST body { action: "insert_dispute", ledger_id, tally_name, bill_refs: string[], remarks,
//               item_description }                               -> { ok: true, rows }
//   POST body { action: "update_dispute", id, remarks?, item_description?, checked? } -> { ok: true, row }
//   POST body { action: "delete_dispute", id }                   -> { ok: true }
//   POST body { action: "clear_dispute",  id, clear_note }       -> { ok: true, row }
//   POST body { action: "reopen_dispute", id }                   -> { ok: true, row }
//     (RC-13. ext_dispute is per-BILL — one row per (ledger_id, bill_ref), addressed by its bigint id —
//      and stores only what a human types; the money is joined live by the report. Add / edit /
//      delete sit behind the admin gate like every muster write. Clear / reopen take the same
//      per-ledger door as Red Mark: the row names the ledger, and the ledger decides.)
//   POST body { action: "add_list_value",        list, name, note }        -> { ok: true }
//   POST body { action: "set_list_value_active", list, name, is_active }   -> { ok: true }
//   POST body { action: "rename_list_value",     list, from, to }          -> { ok: true, counts }
//     (the two managed vocabularies — `list` is "salesperson" | "collection_team", never a table
//      name. RC-15: a customer's salesperson and collection team are picked from a list instead of
//      typed, because matching is exact and case-sensitive, so a typo is a scope that silently
//      matches nothing. Entries are switched OFF, never deleted.)
//
// ⚠️ RENAME CASCADES ACROSS BOTH PROJECTS, AND THAT IS THE WHOLE POINT.
//   Nothing holds a foreign key to these masters — the name is stored as a bare string on ledgers
//   here and on user tags in the identity project. Renaming the master alone would leave 319
//   customers reading "NAKUL JI" against a master that no longer contains it: the exact bug the
//   feature exists to remove, re-created by the tool meant to fix it. So rename_list_value moves
//   ext_ledger_tags, ext_redmark, profiles.receivables_salespersons and
//   report_email_recipients.salesperson too, and returns a per-target count. A collection-team
//   rename moves ext_ledger_group and profiles.receivables_collection_teams (RC-11).
//   It is NOT atomic — five statements over two projects with no shared transaction — so a partial
//   failure reports what did move instead of failing bare.
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

// ── The two managed vocabularies (RC-15) ─────────────────────────────────────
// The client sends a `list` KEY, never a table name — a client-supplied table would be this
// function handing the browser its own service key.
type ListKind = "salesperson" | "collection_team";

const LISTS: Record<ListKind, { table: string; label: string }> = {
  salesperson: { table: "ext_salesperson_master", label: "salesperson" },
  collection_team: { table: "ext_collection_team_master", label: "collection team" },
};

const listKind = (v: unknown): ListKind | null =>
  v === "salesperson" || v === "collection_team" ? v : null;

/**
 * Is this value permitted for the given list? Returns an error string, or null when it is fine.
 *
 * ⚠ IT GUARDS AGAINST INTRODUCING AN OFF-LIST VALUE, NOT AGAINST LEAVING ONE ALONE. `current` is
 *   what the row already holds, and an unchanged value always passes. Without that, a row carrying
 *   a name from before this feature existed — Red Mark holds 4 at "PURAV JI" and 2 at "MAYANK" —
 *   could never be saved again, so editing its REASON would fail on a field the user never touched.
 *   The cell offers that value back for exactly the same reason; the two must agree, or the picker
 *   suggests something the server then refuses.
 *
 * ⚠ ACTIVE AND INACTIVE BOTH PASS. Inactive means "not offered for NEW mappings", not "invalid".
 *   Rejecting it would 400 every save on the rows of a salesperson who has left — including a save
 *   that only ticked the Checked box — which is precisely the orphaning the feature promises not to
 *   do. Only a value absent from the master ENTIRELY, and not already on the row, is refused.
 *
 * ⚠ NULL ALWAYS PASSES. 37 ledgers have no salesperson and they are not 'OTHERS'.
 *
 * ⚠ AND IT FAILS CLOSED. If the master cannot be read the write is refused, not waved through: a
 *   validator that quietly becomes a no-op is worse than no validator, because the screen still
 *   claims the value was checked.
 */
async function checkListValue(
  cw: ReturnType<typeof createClient>,
  list: ListKind,
  value: string | null,
  current: string | null,
): Promise<string | null> {
  if (value === null) return null;
  if (current !== null && current !== "" && value === current) return null;
  const { table, label } = LISTS[list];
  const { data, error } = await cw.from(table).select("name").eq("name", value).maybeSingle();
  if (error) return `could not read the ${label} master, so the save was refused: ${error.message}`;
  if (!data) {
    return `"${value}" is not in the ${label} master. Add it under Settings → Masters first, ` +
           `then set it here.`;
  }
  return null;
}

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

// ── Clear / reopen a case (RC-12) ────────────────────────────────────────────
// A Red Mark is cleared when the case is SETTLED: the customer stops counting as red-marked
// everywhere, and the record stays with who cleared it, when and why. Delete still exists and still
// means something different — "this should never have been red-marked".
//
// 🔴 THIS PAIR HAS ITS OWN AUTHORISATION RULE, AND THAT IS WHY IT IS HANDLED BEFORE THE ADMIN GATE
//    BELOW. Every other action in this function requires an admin or a Settings full-access user.
//    Clearing was asked for by the client (03-09-2026) as something the COLLECTION TEAM does on
//    their own customers — and the three collectors are plain employees with no Settings grant, so
//    an action placed beside the others would have been unreachable for exactly the people it is
//    for. The existing check is NOT widened: it is untouched, and this path is a second, narrower
//    door that may set ONLY the four clear columns.
//
// ⚠ EVERY INPUT TO THE DECISION IS READ SERVER-SIDE. The caller's role, their Settings grant, their
//   module access level and their collection teams come from the identity project with the service
//   role; the ledger's owning team comes from ConnectWave. Nothing is taken from the request body
//   except which ledger, and the note.
//
// ⚠ AND IT FAILS CLOSED. Any read error refuses the write (500) rather than falling through to
//   "allowed": a check that quietly becomes a no-op is worse than no check, because the screen
//   still says it was made.
//
// ── RC-13 (disputed bills) reuses it, and that needed more than a line in CLEARABLE ──
// 🔴 THE ROW KEY AND THE AUTHORISATION KEY ARE TWO DIFFERENT THINGS. Red Mark is one row per LEDGER,
//    so the ledger that decides who may clear is also the key that finds the row. A dispute is one row
//    per BILL and a customer can have several. Looked up by ledger_id, `.maybeSingle()` errors the
//    moment a customer has two disputes — and an update `.eq("ledger_id", …)` would clear EVERY dispute
//    on that customer at once. So a clearable master now says how its row is addressed (`rowKey`) and
//    whether that key already IS the ledger (`keyIsLedger`); a dispute is found by its id, and the
//    authorisation is decided on the ledger_id read off that row.
type ClearableKind = "redmark" | "dispute";

interface Clearable {
  table: string;
  /** The column that addresses exactly ONE row. */
  rowKey: string;
  /** The request-body field carrying that key (named in the 400). */
  keyField: string;
  /** The key from the body, or null when absent/garbage. */
  keyOf: (body: Record<string, unknown>) => string | number | null;
  /** True when the row key is itself the ledger GUID, so authorisation can run before the row is read. */
  keyIsLedger: boolean;
  label: string;
}

const CLEARABLE: Record<ClearableKind, Clearable> = {
  redmark: {
    table: "ext_redmark", rowKey: "ledger_id", keyField: "ledger_id",
    keyOf: (b) => clean(b.ledger_id), keyIsLedger: true, label: "red mark",
  },
  dispute: {
    table: "ext_dispute", rowKey: "id", keyField: "id",
    keyOf: (b) => rowId(b.id), keyIsLedger: false, label: "dispute",
  },
};

/** The clear/reopen actions, all routed ahead of the admin gate. */
const CLEAR_ACTIONS: Record<string, { kind: ClearableKind; mode: "clear" | "reopen" }> = {
  clear_redmark: { kind: "redmark", mode: "clear" },
  reopen_redmark: { kind: "redmark", mode: "reopen" },
  clear_dispute: { kind: "dispute", mode: "clear" },
  reopen_dispute: { kind: "dispute", mode: "reopen" },
};

/** Null when this caller may clear/reopen this ledger; otherwise the status + message to return. */
async function authorizeClear(
  idAdmin: ReturnType<typeof createClient>,
  cw: ReturnType<typeof createClient>,
  userId: string,
  ledgerId: string,
): Promise<{ status: number; error: string } | null> {
  // 1. An Orange One admin may clear anything.
  const { data: roleRows, error: roleErr } = await idAdmin
    .from("user_roles").select("role").eq("user_id", userId);
  if (roleErr) return { status: 500, error: roleErr.message };
  if ((roleRows ?? []).some((r: { role: AppRole }) => r.role === "admin")) return null;

  const { data: prof, error: profErr } = await idAdmin
    .from("profiles")
    .select("receivables_admin_menus,receivables_collection_teams")
    .eq("id", userId)
    .maybeSingle();
  if (profErr) return { status: 500, error: profErr.message };

  // 2. A Settings full-access user is the steward of these musters — same grant the other actions
  //    require, so they can clear anything too (Jayshree holds this today).
  if ((prof?.receivables_admin_menus ?? []).includes("settings")) return null;

  // 3. Otherwise: the collection team, on their own customers only.
  //    The module grant is a CEILING, mirroring useHubMenuAccess().canEdit in the browser — a
  //    view-only user reads every screen and has no buttons, and must not be able to clear by
  //    calling this directly. No app is "universal" (frontend/src/apps/universal.ts is empty), so
  //    an edit row is genuinely required rather than implied.
  const { data: access, error: accErr } = await idAdmin
    .from("app_access").select("access_level")
    .eq("user_id", userId).eq("app_id", "outstanding-dashboard");
  if (accErr) return { status: 500, error: accErr.message };
  if (!(access ?? []).some((a: { access_level: string }) => a.access_level === "edit")) {
    return {
      status: 403,
      error: "your access to the Outstanding Dashboard is view-only, so you cannot clear or reopen a case.",
    };
  }

  const teams = (prof?.receivables_collection_teams ?? []) as string[];
  if (teams.length === 0) {
    return {
      status: 403,
      error: "clearing is for the customer's collection team (or an administrator), and you are not " +
             "tagged to a collection team.",
    };
  }

  const { data: grp, error: grpErr } = await cw
    .from("ext_ledger_group").select("collection_team").eq("ledger_id", ledgerId).maybeSingle();
  if (grpErr) return { status: 500, error: grpErr.message };
  const team = String(grp?.collection_team ?? "").trim();
  if (!team) {
    return {
      status: 403,
      error: "this customer has no collection team set, so only an administrator can clear or reopen it.",
    };
  }
  // Exact, case-sensitive — the same matching every other scope in this system uses. A near-miss is
  // a refusal, never a silent pass. See the frontend's lib/scopeParties.ts.
  if (!teams.includes(team)) {
    return {
      status: 403,
      error: `this customer belongs to the "${team}" collection team, so you cannot clear or reopen it.`,
    };
  }
  return null;
}

/** clear_* / reopen_* for any CLEARABLE master. Writes ONLY the clear columns, on ONE row. */
async function handleClear(
  idAdmin: ReturnType<typeof createClient>,
  cw: ReturnType<typeof createClient>,
  user: { id: string },
  body: Record<string, unknown>,
  updated_by: string,
  kind: ClearableKind,
  mode: "clear" | "reopen",
): Promise<Response> {
  const { table, rowKey, keyField, keyOf, keyIsLedger, label } = CLEARABLE[kind];

  const key = keyOf(body);
  if (key === null) return json(400, { error: `${keyField} required` });

  // `unknown`, and compared with `=== true` below: an untyped client, so never trust the shape.
  let cur: { cleared: unknown } | null;
  if (keyIsLedger) {
    // Red Mark. Authorise BEFORE reading the row: "not yours" is the answer whether or not it exists.
    const refusal = await authorizeClear(idAdmin, cw, user.id, String(key));
    if (refusal) return json(refusal.status, { error: refusal.error });

    const { data, error: curErr } = await cw
      .from(table).select("cleared").eq(rowKey, key).maybeSingle();
    if (curErr) return json(400, { error: curErr.message });
    cur = data;
  } else {
    // A dispute. The ledger lives ON the row, so the row has to be read before anyone can say whose it
    // is. A missing id therefore answers 404 ahead of the authorisation — which reveals nothing, since
    // the table is read-open to every signed-in browser anyway.
    const { data, error: curErr } = await cw
      .from(table).select("cleared,ledger_id").eq(rowKey, key).maybeSingle();
    if (curErr) return json(400, { error: curErr.message });
    if (data) {
      const refusal = await authorizeClear(idAdmin, cw, user.id, String(data.ledger_id));
      if (refusal) return json(refusal.status, { error: refusal.error });
    }
    cur = data;
  }
  if (!cur) return json(404, { error: `${label} ${key} not found` });

  if (mode === "clear") {
    if (cur.cleared === true) {
      return json(409, { error: "this case is already cleared. Reopen it first if it is live again." });
    }
    // Required, and required in the database too (ext_redmark_cleared_needs_who_when_note, and
    // ext_dispute_cleared_needs_who_when_note). A
    // partly-paid case may always be cleared, so the note is the only thing that explains a cleared
    // row with money still owed against it.
    const clear_note = clean(body.clear_note);
    if (!clear_note) {
      return json(400, { error: "a clear note is required — say how the case was settled." });
    }
    // `.eq("cleared", false)` makes this lose a race rather than overwrite the winner's record, and
    // `.select()` turns a zero-row match into a 409 instead of the silent ok:true an `update` gives.
    const { data, error } = await cw
      .from(table)
      .update({
        cleared: true,
        cleared_at: new Date().toISOString(),
        cleared_by: updated_by,
        clear_note,
        updated_by,
      })
      // One row: the ledger for a red mark, the id for a dispute — never "every dispute on a ledger".
      .eq(rowKey, key)
      .eq("cleared", false)
      .select();
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(409, { error: "somebody else cleared this case a moment ago." });
    return json(200, { ok: true, row: data[0] });
  }

  if (cur.cleared !== true) {
    return json(409, { error: "this case is not cleared, so there is nothing to reopen." });
  }
  // Reopening KEEPS cleared_at / cleared_by / clear_note: they are the record of how the case was
  // closed last time, which is the history this master exists to build. Who reopened it, and when,
  // is `updated_by` plus the table's touch trigger's `updated_at`.
  const { data, error } = await cw
    .from(table)
    .update({ cleared: false, updated_by })
    .eq(rowKey, key)
    .eq("cleared", true)
    .select();
  if (error) return json(400, { error: error.message });
  if (!data?.length) return json(409, { error: "somebody else reopened this case a moment ago." });
  return json(200, { ok: true, row: data[0] });
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

  // 2) Read the body. It comes BEFORE authorisation because the action decides WHICH rule applies:
  //    clear_redmark / reopen_redmark carry their own (see authorizeClear), everything else needs
  //    the admin / Settings grant below. The only visible difference for an unauthorised caller is
  //    that a malformed body now answers 400 instead of 403.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  // Audit stamp: who made the edit (email preferred, id as fallback).
  const updated_by = user.email ?? user.id;

  const idAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ConnectWave service client — bypasses ConnectWave RLS to write the musters.
  const cw = createClient(CW_URL, CW_SERVICE_KEY, { auth: { persistSession: false } });

  // ---- clear_* / reopen_* — Red Mark (RC-12) and disputed bills (RC-13) ----
  // Handled here, ahead of the gate below, because the collection team must reach it and holds no
  // Settings grant. It may write only the four clear columns. See the header on handleClear.
  const clearAction = typeof body.action === "string" && Object.hasOwn(CLEAR_ACTIONS, body.action)
    ? CLEAR_ACTIONS[body.action]
    : null;
  if (clearAction) {
    return await handleClear(idAdmin, cw, user, body, updated_by, clearAction.kind, clearAction.mode);
  }

  // 3) Authorize with the identity service role: the caller must be an admin, OR a user an
  //    admin granted FULL ACCESS to the Settings menu (profiles.receivables_admin_menus
  //    contains 'settings' — the same grant that renders the Masters tab in the hub).
  //
  //    Read with the SERVICE ROLE, never from the request. The browser decides what to draw;
  //    this decides what may be written. RLS would let a caller read their own profile row,
  //    but not writing that check here would mean trusting a client-supplied claim.
  //
  //    ⚠ UNCHANGED BY RC-12, DELIBERATELY. Clearing got its own narrower door above rather than a
  //      widening of this one, so update_redmark / delete_redmark / every muster write still
  //      require exactly what they always did. RC-13's insert / update / delete_dispute sit here too:
  //      a collector may clear their own customers' disputes, never add, edit or delete one.
  const { data: roleRows, error: roleErr } = await idAdmin.from("user_roles").select("role").eq("user_id", user.id);
  if (roleErr) return json(500, { error: roleErr.message });
  let authorized = (roleRows ?? []).some((r: { role: AppRole }) => r.role === "admin");
  if (!authorized) {
    const { data: prof, error: profErr } = await idAdmin
      .from("profiles")
      .select("receivables_admin_menus")
      .eq("id", user.id)
      .maybeSingle();
    if (profErr) return json(500, { error: profErr.message });
    authorized = (prof?.receivables_admin_menus ?? []).includes("settings");
  }
  if (!authorized) {
    return json(403, { error: "you don't have full access to the Outstanding Dashboard settings" });
  }

  // ---- update_tag (ext_ledger_tags, keyed by Tally GUID) ----
  if (body.action === "update_tag") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required" });
    // Read the row first: it tells us what the mapping is TODAY (so an unchanged off-list value is
    // not blocked), and it turns a ledger_id that matches nothing into a 404 instead of the silent
    // ok:true this action used to return — the same trap update_company_map documents above.
    const { data: curTag, error: curTagErr } = await cw
      .from("ext_ledger_tags").select("salesperson").eq("ledger_id", ledger_id).maybeSingle();
    if (curTagErr) return json(400, { error: curTagErr.message });
    if (!curTag) return json(404, { error: `customer ${ledger_id} is not in the muster` });
    // The picker in the browser is a drawing decision; this is the constraint. (category is
    // deliberately NOT validated — it is free text and out of RC-15's scope.)
    const bad = await checkListValue(cw, "salesperson", clean(body.salesperson), curTag.salesperson);
    if (bad) return json(400, { error: bad });
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
    const { data: curGrp, error: curGrpErr } = await cw
      .from("ext_ledger_group").select("collection_team").eq("ledger_id", ledger_id).maybeSingle();
    if (curGrpErr) return json(400, { error: curGrpErr.message });
    if (!curGrp) return json(404, { error: `customer ${ledger_id} is not in the group muster` });
    const badTeam = await checkListValue(
      cw, "collection_team", clean(body.collection_team), curGrp.collection_team);
    if (badTeam) return json(400, { error: badTeam });
    // group_name is NOT NULL — only overwrite it when a non-empty value is sent (the client sends the
    // customer's own name when the field is left blank, so it never nulls the column).
    // group_name is a per-customer label, not a vocabulary, so it is not validated against a master.
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
    // An insert always INTRODUCES the value, so there is nothing to grandfather.
    const badSp = await checkListValue(cw, "salesperson", clean(body.salesperson), null);
    if (badSp) return json(400, { error: badSp });
    // ⚠ `cleared: false` IS LOAD-BEARING (RC-12). The upsert only writes the columns it is given, so
    //   re-flagging a customer whose case had been CLEARED would otherwise leave cleared = true —
    //   a row on the master that the dashboard, the risk register and every filter still ignore.
    //   Re-adding somebody is a new case, so it reopens. The previous clearing's who/when/note stay
    //   on the row as the record of how the last one ended.
    const { data, error } = await cw
      .from("ext_redmark")
      .upsert({ ...parsed.row, cleared: false, updated_by }, { onConflict: "ledger_id" })
      .select()
      .single();
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, row: data });
  }

  if (body.action === "update_redmark") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required" });
    const { data: curRm, error: curRmErr } = await cw
      .from("ext_redmark").select("salesperson").eq("ledger_id", ledger_id).maybeSingle();
    if (curRmErr) return json(400, { error: curRmErr.message });
    if (!curRm) return json(404, { error: `red mark ${ledger_id} not found` });
    const badRmSp = await checkListValue(
      cw, "salesperson", clean(body.salesperson), curRm.salesperson);
    if (badRmSp) return json(400, { error: badRmSp });
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

  // ---- ext_dispute (RC-13: per-BILL, addressed by the bigint id PK) ----
  // A customer bill under dispute. The row holds only what a human types — remark, item description,
  // the clear status — and names its bill by (ledger_id, bill_ref); the report joins the money live.
  // Clear / reopen are NOT here: they are routed ahead of the admin gate (CLEAR_ACTIONS).

  if (body.action === "insert_dispute") {
    const ledger_id = clean(body.ledger_id);
    if (!ledger_id) return json(400, { error: "ledger_id required (pick a customer)" });
    // ⚠ Bill references are NOT trimmed. They must equal the snapshot's own spelling byte for byte, or
    //   the report can never find the bill again and the dispute reads "no longer open" on day one.
    const bill_refs = [...new Set(
      (Array.isArray(body.bill_refs) ? body.bill_refs : [])
        .filter((v): v is string => typeof v === "string" && v.trim() !== ""),
    )];
    if (!bill_refs.length) return json(400, { error: "tick at least one bill" });

    // Only an OPEN bill of THIS customer may be put in dispute. The dialog only offers those; this is
    // the constraint, so a direct call cannot type a bill number the screens would never find.
    // Fails closed: if the snapshot cannot be read, nothing is saved.
    const { data: open, error: openErr } = await cw
      .from("collection_invoice_snapshot").select("bill_ref")
      .eq("ledger_id", ledger_id).in("bill_ref", bill_refs);
    if (openErr) {
      return json(500, { error: `could not check the bills against Tally, so nothing was saved: ${openErr.message}` });
    }
    const openSet = new Set((open ?? []).map((r: { bill_ref: string }) => r.bill_ref));
    const notOpen = bill_refs.filter((b) => !openSet.has(b));
    if (notOpen.length) {
      return json(400, {
        error: `${notOpen.join(", ")} ${notOpen.length === 1 ? "is not an open bill" : "are not open bills"} ` +
               `of this customer in Tally, so nothing was saved.`,
      });
    }

    // Already on the list — say which, and whether it is open or cleared, rather than surfacing the
    // raw unique-constraint text. A CLEARED one is reopened, not added again: re-adding would lose the
    // record of how the last dispute on that bill ended.
    const { data: dupes, error: dupErr } = await cw
      .from("ext_dispute").select("bill_ref,cleared")
      .eq("ledger_id", ledger_id).in("bill_ref", bill_refs);
    if (dupErr) return json(400, { error: dupErr.message });
    if (dupes?.length) {
      const list = (dupes as { bill_ref: string; cleared: boolean }[])
        .map((d) => `${d.bill_ref}${d.cleared ? " (cleared — reopen it instead)" : ""}`).join(", ");
      return json(409, { error: `already on the disputed bills list: ${list}. Nothing was saved.` });
    }

    // ⚠ `cleared: false` IS SET EXPLICITLY, as insert_redmark learned (RC-12): a write that leaves the
    //   clear columns to chance is how a re-added case came back cleared and invisible.
    const rows = bill_refs.map((bill_ref) => ({
      ledger_id,
      bill_ref,
      tally_name: clean(body.tally_name),
      remarks: clean(body.remarks),
      item_description: clean(body.item_description),
      cleared: false,
      checked: true,
      match_status: "guid_matched",
      source: "muster",
      updated_by,
    }));
    // One statement, so several ticked bills land together or not at all.
    const { data, error } = await cw.from("ext_dispute").insert(rows).select();
    if (error) {
      if (error.code === "23505") {
        return json(409, { error: "somebody put one of these bills on the list a moment ago. Nothing was saved — reload and try again." });
      }
      return json(400, { error: error.message });
    }
    return json(200, { ok: true, rows: data });
  }

  if (body.action === "update_dispute") {
    const id = rowId(body.id);
    if (id === null) return json(400, { error: "id required" });
    // Only the fields SENT are written. The report edits the remark alone; sending the rest back from
    // a screen loaded minutes ago would quietly overwrite a colleague's item description.
    const patch: Record<string, unknown> = { updated_by };
    if ("remarks" in body) patch.remarks = clean(body.remarks);
    if ("item_description" in body) patch.item_description = clean(body.item_description);
    if ("checked" in body) patch.checked = body.checked !== false;
    if (Object.keys(patch).length === 1) {
      return json(400, { error: "nothing to update — send remarks, item_description or checked" });
    }
    // .select() so a zero-row match is a 404, not a silent ok:true.
    const { data, error } = await cw.from("ext_dispute").update(patch).eq("id", id).select();
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `dispute ${id} not found` });
    return json(200, { ok: true, row: data[0] });
  }

  if (body.action === "delete_dispute") {
    // Delete is for a row entered by MISTAKE. A settled dispute is cleared, and the record stays.
    const id = rowId(body.id);
    if (id === null) return json(400, { error: "id required" });
    const { data, error } = await cw.from("ext_dispute").delete().eq("id", id).select("id");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `dispute ${id} not found` });
    return json(200, { ok: true });
  }

  // ---- update_segment_config (ext_customer_segment_config, keyed by the Tally COMPANY GUID) ----
  // The Customer Profile screen's "Edit Segments" bands. UPSERT for exactly the reason
  // update_company_map documents: most companies have no row until someone first edits their bands,
  // so an `update` would match nothing and return ok:true while saving NOTHING.
  // The DB also enforces 0 < small < medium < 100; validate here too so the user gets a readable
  // message instead of a raw constraint-violation string.
  if (body.action === "update_segment_config") {
    const company_guid = clean(body.company_guid);
    if (!company_guid) return json(400, { error: "company_guid required" });

    const small = Number(body.small_max_pct);
    const medium = Number(body.medium_max_pct);
    if (!Number.isFinite(small) || !Number.isFinite(medium)) {
      return json(400, { error: "small_max_pct and medium_max_pct must be numbers" });
    }
    if (!(small > 0 && small < medium && medium < 100)) {
      return json(400, { error: "bands must satisfy 0 < small < medium < 100" });
    }

    const { error } = await cw
      .from("ext_customer_segment_config")
      .upsert({
        company_guid,
        small_max_pct: small,
        medium_max_pct: medium,
        updated_at: new Date().toISOString(),
        updated_by,
      }, { onConflict: "company_guid" });
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  // ── The two managed vocabularies (RC-15) ───────────────────────────────────
  // ext_salesperson_master / ext_collection_team_master. Switched off, never deleted.

  if (body.action === "add_list_value") {
    const list = listKind(body.list);
    if (!list) return json(400, { error: "list must be salesperson or collection_team" });
    const name = clean(body.name);
    if (!name) return json(400, { error: "name required" });
    const { table, label } = LISTS[list];

    const { error } = await cw.from(table).insert({ name, note: clean(body.note), updated_by });
    if (error) {
      // 23505 is either the primary key or the case-insensitive unique index beside it. Name the
      // spelling that is already there: "already exists" about a name the user cannot see in the
      // list is baffling, and the near-miss is the whole reason the index is there.
      if (error.code === "23505") {
        const { data: all } = await cw.from(table).select("name");
        const existing =
          (all ?? []).find((r: { name: string }) => r.name.toUpperCase() === name.toUpperCase())?.name;
        return json(409, {
          error: !existing || existing === name
            ? `"${name}" is already in the ${label} list.`
            : `The ${label} list already contains "${existing}". Two spellings differing only in ` +
              `capitalisation would be two different ${label}s everywhere else, so only one is kept.`,
        });
      }
      return json(400, { error: error.message });
    }
    return json(200, { ok: true });
  }

  if (body.action === "set_list_value_active") {
    const list = listKind(body.list);
    if (!list) return json(400, { error: "list must be salesperson or collection_team" });
    const name = clean(body.name);
    if (!name) return json(400, { error: "name required" });
    const is_active = body.is_active === true;
    const { table, label } = LISTS[list];

    const { data: row, error: readErr } = await cw
      .from(table).select("name,is_protected").eq("name", name).maybeSingle();
    if (readErr) return json(400, { error: readErr.message });
    if (!row) return json(404, { error: `"${name}" is not in the ${label} list.` });
    if (row.is_protected && !is_active) {
      return json(400, {
        error: `"${name}" cannot be switched off. Every sync writes that exact value onto ` +
               `brand-new customers, so a list without it would make each of them invalid on arrival.`,
      });
    }

    const { data, error } = await cw
      .from(table).update({ is_active, updated_by }).eq("name", name).select("name");
    if (error) return json(400, { error: error.message });
    if (!data?.length) return json(404, { error: `"${name}" is not in the ${label} list.` });
    return json(200, { ok: true });
  }

  if (body.action === "rename_list_value") {
    const list = listKind(body.list);
    if (!list) return json(400, { error: "list must be salesperson or collection_team" });
    const from = clean(body.from);
    const to = clean(body.to);
    if (!from || !to) return json(400, { error: "from and to are both required" });
    if (from === to) return json(400, { error: "the new name is the same as the old one" });
    const { table, label } = LISTS[list];

    const { data: src, error: srcErr } = await cw
      .from(table).select("name,is_protected").eq("name", from).maybeSingle();
    if (srcErr) return json(400, { error: srcErr.message });
    if (!src) return json(404, { error: `"${from}" is not in the ${label} list.` });
    if (src.is_protected) {
      return json(400, {
        error: `"${from}" cannot be renamed. Every sync writes that exact spelling onto brand-new ` +
               `customers, so renaming it would break each of them on arrival.`,
      });
    }

    // Renaming ONTO an existing name is refused rather than merged: a merge would have to delete a
    // master row, and no master row is ever deleted. Compared case-insensitively, because the list
    // cannot hold two spellings that differ only in capitalisation.
    const { data: allNames, error: allErr } = await cw.from(table).select("name");
    if (allErr) return json(400, { error: allErr.message });
    const clash = (allNames ?? []).find(
      (r: { name: string }) => r.name !== from && r.name.toUpperCase() === to.toUpperCase(),
    );
    if (clash) {
      return json(409, {
        error: `The ${label} list already contains "${clash.name}". To combine the two, reassign ` +
               `the customers on "${from}" and then switch "${from}" off.`,
      });
    }

    const counts = { master: 0, ledgers: 0, redmark: 0, userTags: 0, recipients: 0 };
    const moved = () =>
      `Moved so far — list ${counts.master}, customers ${counts.ledgers}, red marks ` +
      `${counts.redmark}, user tags ${counts.userTags}, report recipients ${counts.recipients}.`;
    const stop = (where: string, msg: string) =>
      json(500, {
        error: `Renamed part-way and stopped at ${where}: ${msg}. ${moved()} The Masters screen ` +
               `flags any name in use but missing from the list, so the gap is visible.`,
        counts,
      });

    // 1. The master row. First because it is the likeliest to be refused (a constraint, a clash),
    //    and failing before 300 customers have moved is better than failing after.
    {
      const { data, error } = await cw
        .from(table).update({ name: to, updated_by }).eq("name", from).select("name");
      if (error) return json(400, { error: error.message });
      if (!data?.length) return json(404, { error: `"${from}" is not in the ${label} list.` });
      counts.master = data.length;
    }

    // 2. The customer mappings.
    // ⚠ The COUNT is capped by PostgREST's max-rows (1000) even though the UPDATE itself is not —
    //    the update always applies to every matching row, but a name on more than 1000 customers
    //    would under-report here. The largest today is OTHERS at 682, and OTHERS cannot be renamed.
    {
      const col = list === "salesperson" ? "salesperson" : "collection_team";
      const tbl = list === "salesperson" ? "ext_ledger_tags" : "ext_ledger_group";
      const { data, error } = await cw
        .from(tbl).update({ [col]: to, updated_by }).eq(col, from).select("ledger_id");
      if (error) return stop("the customer muster", error.message);
      counts.ledgers = data?.length ?? 0;
    }

    if (list === "collection_team") {
      // 3. The user tags, in the IDENTITY project. Until RC-11 a collection team could not be tagged
      //    on anybody, so this cascade legitimately did nothing and said so. Now it can, and leaving
      //    it out would recreate the phantom-tag bug on the new dimension: a user carrying a team
      //    name the master no longer contains, matching nothing, with no screen saying so.
      const { data: profs, error: profErr } = await idAdmin
        .from("profiles").select("id,receivables_collection_teams")
        .contains("receivables_collection_teams", [from]);
      if (profErr) return stop("the user tags", profErr.message);
      for (const p of profs ?? []) {
        const next = [...new Set(
          ((p.receivables_collection_teams ?? []) as string[]).map((t) => (t === from ? to : t)),
        )];
        const { error: upErr } = await idAdmin
          .from("profiles").update({ receivables_collection_teams: next }).eq("id", p.id);
        if (upErr) return stop("the user tags", upErr.message);
        counts.userTags++;
      }
    }

    if (list === "salesperson") {
      // 3. Red Mark keeps its own copy of the salesperson.
      const { data: rm, error: rmErr } = await cw
        .from("ext_redmark").update({ salesperson: to, updated_by })
        .eq("salesperson", from).select("ledger_id");
      if (rmErr) return stop("the red mark master", rmErr.message);
      counts.redmark = rm?.length ?? 0;

      // 4. The user tags, in the IDENTITY project. text[], and PostgREST cannot express
      //    array_replace — so read, rewrite, write back, one row at a time. Every update carries
      //    its id: PostgREST refuses an unqualified write.
      const { data: profs, error: profErr } = await idAdmin
        .from("profiles").select("id,receivables_salespersons")
        .contains("receivables_salespersons", [from]);
      if (profErr) return stop("the user tags", profErr.message);
      for (const p of profs ?? []) {
        // De-duplicate. Somebody tagged with BOTH names would otherwise hold the new one twice, and
        // how many names a person carries is a figure the scheduled send reports on.
        const next = [...new Set(
          ((p.receivables_salespersons ?? []) as string[]).map((s) => (s === from ? to : s)),
        )];
        const { error: upErr } = await idAdmin
          .from("profiles").update({ receivables_salespersons: next }).eq("id", p.id);
        if (upErr) return stop("the user tags", upErr.message);
        counts.userTags++;
      }

      // 5. The scheduled-report recipients, also identity. There is NO unique key on
      //    (report_key, scope, salesperson), so renaming onto a name already ticked on the same
      //    report would quietly give that rep two copies of the mail. Drop the old row instead.
      const { data: recips, error: recErr } = await idAdmin
        .from("report_email_recipients").select("id,report_key")
        .eq("scope", "salesperson").eq("salesperson", from);
      if (recErr) return stop("the report recipients", recErr.message);
      for (const r of recips ?? []) {
        const { data: dupe, error: dupErr } = await idAdmin
          .from("report_email_recipients").select("id")
          .eq("report_key", r.report_key).eq("scope", "salesperson").eq("salesperson", to).limit(1);
        if (dupErr) return stop("the report recipients", dupErr.message);
        const { error: wErr } = dupe?.length
          ? await idAdmin.from("report_email_recipients").delete().eq("id", r.id)
          : await idAdmin.from("report_email_recipients").update({ salesperson: to }).eq("id", r.id);
        if (wErr) return stop("the report recipients", wErr.message);
        counts.recipients++;
      }
    }

    return json(200, { ok: true, counts });
  }

  return json(400, { error: "unknown action" });
});
