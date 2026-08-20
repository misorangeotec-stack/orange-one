// Supabase Edge Function: masters-sync
//
// Pulls the CENTRAL MASTERS from the ConnectWave (TallyCopilot) Tally mirror into
// this (identity) project's mst_* tables. One direction only: Tally -> Orange One.
// Nothing here ever writes to ConnectWave.
//
//   POST { trigger: "manual" | "schedule", force?: boolean }
//     -> { ok: true, skipped: true, watermark }            nothing changed in Tally
//     -> { ok: true, runId, watermark, counts: { ... } }   pulled
//
// WHY A FUNCTION AND NOT A BROWSER FETCH
//   The browser holds a read-only anon key for ConnectWave and a user JWT for this
//   project. Writing ~27,000 master rows under a user's RLS would be both slow and
//   wrong. The caller is authenticated HERE, we verify authority HERE, then read
//   ConnectWave with its own key and write with this project's service role.
//
// THE WATCHER CONTRACT (why this is cheap to call every 15 minutes)
//   The Tally connector is driven by a human clicking Sync, so its runs are
//   irregular. Rather than pulling on a fixed clock, we ask the mirror one cheap
//   question — receivables_last_sync() — and compare it with the newest successful
//   run in mst_sync_runs. Unchanged => return immediately, having done one RPC.
//
//   ⚠ THE WATERMARK IS COMPARED AS TEXT, NEVER PARSED. receivables_last_sync()
//     returns a naive IST clock string with no offset ("2026-08-14T10:17"). Cast
//     to a Date it is read as UTC and lands 5.5 hours in the future, so every
//     comparison would mismatch and the watcher would pull on EVERY tick — the
//     exact opposite of what it is for. See 20260902120300.
//
// HOW A LEDGER'S ROLE IS DECIDED (it is not the group alone any more)
//   is_customer / is_vendor are the Tally group chain OR the trade registers:
//   a ledger with sales booked against it in a book is a customer of that book
//   whatever Tally files it under, and likewise purchases and vendors. The
//   group test is unchanged and the register is OR-ed onto it, so the flags
//   only ever widen. See the block above the party upsert for why - in short,
//   "Branch / Divisions" is a reserved PRIMARY group, so our own branches came
//   out neither customer nor vendor and vanished from every screen despite
//   trading every week.
//
// WHAT IS TALLY-OWNED AND WHAT IS NOT
//   Overwritten on every pull: party name/gstin/sub_group/group_chain/credit_*,
//   is_customer/is_vendor, item name/group/unit, company tally_name/gstin/address.
//   NEVER touched: modules, active, sort_order, company_id, location, contact_name,
//   phone, email, hsn_code, gate_pass_prefix — and mst_companies.name, which is a
//   human's clean label, not Tally's FY-suffixed book name.
//
//   ⚠ mst_companies.name IS WHY COMPANIES ARE NOT A PLAIN UPSERT. An upsert sets
//     every supplied column on conflict, so including `name` would rewrite the
//     curated label on every pull. Companies are split into insert-new /
//     update-existing below; parties and items, whose names ARE Tally's, upsert.
//
// THREE SHAPES OF THE MIRROR THAT MUST BE HANDLED (all verified against live data)
//   1. v_company returns one row PER FINANCIAL YEAR — 7 rows for 5 distinct
//      company_guid. Deduplicated by guid.
//   2. v_ledger_detail returns the same guid under a base tenant AND under
//      "<tenant>~YYYYMMDD" prior-FY tenants. Deduplicated by guid, preferring the
//      base tenant.
//   3. The same firm is a SEPARATE ledger in each Tally company with its own guid
//      and its own credit limit (APEX IMPEX exists in Colorix, Enterprise and
//      O-tec). That is deliberately preserved as one mst_parties row per Tally
//      company — it mirrors Tally, and it matches how Dispatch already ties every
//      customer to a billing company.
//
// EVERYTHING ARRIVES INVISIBLE. Tally holds ~9,400 ledgers and ~17,500 stock items;
// Dispatch offers ~326 customers and ~246 items. A newly synced row lands with
// modules = '{}' — present and searchable in Masters, but in NO module's dropdown
// until an admin ticks it. Sync never writes `modules`, so that tick is permanent.
//
// Deploy (identity project):
//   supabase secrets set CONNECTWAVE_URL=<ConnectWave SUPABASE_URL> \
//                        CONNECTWAVE_SERVICE_KEY=<ConnectWave SUPABASE_SERVICE_KEY>
//   supabase functions deploy masters-sync --project-ref icutjkrqkbzwvmnfbzpr
//
// ⚠️ VERIFY THE SECRETS POINT AT THE RIGHT PROJECT. muster-write's header records
//   that CONNECTWAVE_* was once found aimed at a STALE ConnectWave project: every
//   write returned 200 and evaporated, for months. This function only READS from
//   ConnectWave, so the same failure shows up differently — as a sync that reports
//   success with plausible-but-wrong counts. After any secret change, check that
//   mst_sync_runs.counts matches what the mirror actually holds (companies 5,
//   parties ~9.4k, items ~17.5k as of 2026-08-14), not merely that ok:true came back.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** PostgREST caps a response at 1000 rows. Every mirror read here is bigger than
 *  that (9.4k ledgers, 17.5k items), so every one of them pages. Missing this is
 *  how a sync silently imports exactly 1000 of everything and calls it success. */
const PAGE = 1000;

/**
 * ⚠ `orderBy` IS MANDATORY, AND IT IS NOT A TIDINESS ARGUMENT.
 *
 *   LIMIT/OFFSET over a query with NO ORDER BY has no defined row order in
 *   Postgres. Page 3 may repeat a row from page 2 and omit one entirely, and
 *   which rows those are changes run to run. This function paged unordered for
 *   months and the damage was invisible because nothing is ever deleted:
 *   v_ledger_detail holds 9,384 rows, a single run wrote 6,193 distinct guids,
 *   and mst_parties had accumulated 7,832 - the UNION of many runs, each having
 *   silently dropped a different ~1,600.
 *
 *   How it surfaced: ORANGE O TEC PRIVATE LIMITED(NOIDA) sat at
 *   tally_synced_at = 2026-08-16 while the mirror plainly still returned its
 *   guid, so it read as "Tally deleted this" when the truth was "our pager
 *   skipped it, twice". Rows a sync misses do not error - they go stale, and
 *   the "In Tally" column then blames Tally.
 *
 *   Order on something UNIQUE per row. tenant_id+guid, not guid alone: the same
 *   ledger guid appears under both the base tenant and its ~YYYYMMDD prior-FY
 *   twin, and a non-unique sort key leaves ties free to reshuffle between
 *   pages - the same bug wearing a hat.
 *
 *   It is also FASTER: an ordered page of v_ledger_detail measured ~4s against
 *   ~17s unordered, because the planner can walk an index instead of
 *   re-materialising the view to skip 8,000 rows.
 */
async function fetchAll<T>(
  // deno-lint-ignore no-explicit-any
  build: () => any,
  orderBy: string[],
): Promise<T[]> {
  if (!orderBy.length) throw new Error("fetchAll needs a stable sort key");
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = build();
    for (const col of orderBy) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1) as
      { data: T[] | null; error: unknown };
    if (error) throw new Error(`mirror read failed: ${JSON.stringify(error)}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Writes go out in batches; one 27k-row upsert is a statement timeout waiting to
 *  happen, and a failure halfway through tells you nothing about what landed. */
async function upsertChunked(
  db: ReturnType<typeof createClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  const SIZE = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE);
    const { error } = await db.from(table).upsert(chunk, { onConflict, ignoreDuplicates: false });
    if (error) throw new Error(`${table} upsert failed at row ${i}: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** "acct_orange::<company_guid>" and "acct_orange::<company_guid>~20240401" both
 *  mean the same company. The suffix is a prior-financial-year snapshot. */
const companyGuidOf = (tenantId: string): string =>
  String(tenantId ?? "").split("::")[1]?.split("~")[0] ?? "";

const isPriorFyTenant = (tenantId: string): boolean => String(tenantId ?? "").includes("~");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let runId: string | null = null;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const trigger: string = body?.trigger === "manual" ? "manual" : "schedule";
    const force = body?.force === true;

    // ---------------------------------------------------------- authorize --
    //
    // Two callers, two proofs. A person pressing "Sync now" sends their own JWT
    // and must be an admin. The scheduler (pg_cron -> pg_net) sends a
    // service_role JWT.
    //
    // ⚠ THE SCHEDULER IS RECOGNISED BY ITS ROLE CLAIM, NOT BY STRING-MATCHING
    //   THE KEY. The first version compared the bearer token against
    //   SUPABASE_SERVICE_ROLE_KEY and it FAILED IN PRODUCTION with 401 "Not
    //   signed in" on every scheduled run: the key stored for pg_net and the key
    //   injected into the function are not guaranteed to be the same string (a
    //   project can hold more than one valid service credential, and either can
    //   be rotated independently). Equal authority, different bytes.
    //
    //   Reading the claim is also SAFE here, which is the part that makes this
    //   work: the function is deployed with verify_jwt = true, so the Supabase
    //   gateway has already validated the token's signature against the project
    //   JWT secret before any of this runs. A forged role claim never reaches
    //   us. If verify_jwt is ever turned off, THIS CHECK BECOMES A HOLE — the
    //   two settings are a pair.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let actorId: string | null = null;

    const claimedRole = ((): string | null => {
      try {
        const payload = token.split(".")[1];
        if (!payload) return null;
        const pad = payload.replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(pad + "=".repeat((4 - (pad.length % 4)) % 4)))?.role ?? null;
      } catch {
        return null;
      }
    })();

    if (claimedRole === "service_role" || (token && token === SERVICE_ROLE_KEY)) {
      // the scheduler
    } else {
      const { data: userRes } = await db.auth.getUser(token);
      const uid = userRes?.user?.id ?? null;
      if (!uid) return json(401, { error: "Not signed in" });
      const { data: isAdmin } = await db.rpc("is_admin", { _user_id: uid });
      if (isAdmin !== true) return json(403, { error: "Only an admin may run the masters sync" });
      actorId = uid;
    }

    const cw = createClient(CW_URL, CW_SERVICE_KEY, { auth: { persistSession: false } });

    // ------------------------------------------------ the watcher's question --
    const { data: watermarkRaw, error: wmErr } = await cw.rpc("receivables_last_sync");
    if (wmErr) throw new Error(`mirror watermark unavailable: ${wmErr.message}`);
    const watermark = clean(watermarkRaw);

    const { data: lastRun } = await db
      .from("mst_sync_runs")
      .select("source_watermark")
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Compared as TEXT. See the header - parsing this string moves it 5.5 hours.
    if (!force && watermark && lastRun?.source_watermark === watermark) {
      return json(200, { ok: true, skipped: true, watermark, reason: "Tally has not synced since the last pull" });
    }

    const { data: runRow, error: runErr } = await db
      .from("mst_sync_runs")
      .insert({ status: "running", trigger, source_watermark: watermark, created_by: actorId })
      .select("id")
      .single();
    if (runErr) throw new Error(`could not open a sync run: ${runErr.message}`);
    runId = runRow.id as string;

    // =================================================================== read --
    const [companyRows, cleanNames, ledgerRows, itemRows] = await Promise.all([
      fetchAll<{ tenant_id: string; company_guid: string; company_name: string }>(() =>
        cw.from("v_company").select("tenant_id,company_guid,company_name"),
        ["tenant_id", "company_guid"]),
      fetchAll<{ company_guid: string; company: string; location: string }>(() =>
        cw.from("ext_company_map").select("company_guid,company,location"),
        ["company_guid"]),
      fetchAll<{
        tenant_id: string; guid: string; ledger: string; sub_group: string | null;
        group_chain: string[] | null; gstin: string | null;
        credit_limit: number | null; credit_period: string | null;
      }>(() => cw.from("v_ledger_detail").select(
        "tenant_id,guid,ledger,sub_group,group_chain,gstin,credit_limit,credit_period"),
        ["tenant_id", "guid"]),
      fetchAll<{ tenant_id: string; guid: string; item: string; stock_group: string | null; base_unit: string | null }>(
        () => cw.from("v_master_stock_item").select("tenant_id,guid,item,stock_group,base_unit"),
        ["tenant_id", "guid"]),
    ]);

    // ============================================================== companies --
    //
    // Dedupe v_company's per-FY rows down to one per guid, then label each from
    // the mirror's curated ext_company_map rather than from Tally's book name.
    const nameByGuid = new Map(cleanNames.map((c) => [c.company_guid, c]));
    const companyByGuid = new Map<string, { tally_name: string; tenant_id: string }>();
    for (const c of companyRows) {
      if (!c.company_guid) continue;
      const seen = companyByGuid.get(c.company_guid);
      // Prefer the base tenant; among equals the later FY name wins, which is
      // only ever shown as provenance.
      if (!seen || (isPriorFyTenant(seen.tenant_id) && !isPriorFyTenant(c.tenant_id))) {
        companyByGuid.set(c.company_guid, { tally_name: c.company_name, tenant_id: c.tenant_id });
      }
    }

    const { data: existingCompanies } = await db
      .from("mst_companies").select("id,tally_guid").not("tally_guid", "is", null);
    const companyIdByGuid = new Map<string, string>(
      (existingCompanies ?? []).map((r: Record<string, string>) => [r.tally_guid, r.id]));

    let companiesInserted = 0;
    let companiesUpdated = 0;
    for (const [guid, c] of companyByGuid) {
      const curated = nameByGuid.get(guid);
      // `name` IS Tally's book name and IS refreshed — including each April when
      // the new financial-year file opens and the string changes.
      const tallyOwned = {
        name: c.tally_name,
        tally_name: c.tally_name,
        tally_tenant: c.tenant_id,
        tally_synced_at: new Date().toISOString(),
        source: "tally",
      };
      const existingId = companyIdByGuid.get(guid);
      if (existingId) {
        // ⚠ `alias` AND `location` ARE ABSENT ON PURPOSE. The alias is what every
        //   FMS renders; rewriting it here is precisely the thing that would make
        //   a year-end rollover change every picker, order header and gate pass
        //   in the portal. It is the human's, permanently.
        const { error } = await db.from("mst_companies").update(tallyOwned).eq("id", existingId);
        if (error) throw new Error(`company update failed (${guid}): ${error.message}`);
        companiesUpdated++;
      } else {
        const { data, error } = await db.from("mst_companies").insert({
          ...tallyOwned,
          tally_guid: guid,
          // Seeded once from the mirror's curated map. A company Tally has but the
          // map does not gets a null alias, which the Masters screen flags as
          // "Set an alias" rather than silently inventing one.
          alias: clean(curated?.company),
          location: clean(curated?.location),
        }).select("id").single();
        if (error) throw new Error(`company insert failed (${guid}): ${error.message}`);
        companyIdByGuid.set(guid, data.id as string);
        companiesInserted++;
      }
    }

    // ========================================================== groups + units --
    //
    // Name-keyed: Tally reports a stock item's group and unit as strings on the
    // item, not as referenced objects.
    // ⚠ GROUPS ARE PER COMPANY, UNITS ARE NOT. 103 group names are used by more
    //   than one company, so a global group list silently merges several
    //   companies' stock groups into one row. Units are a measure — KGS is KGS
    //   in every company — so all 13 stay global.
    // One timestamp for the whole pull, so every row it touches carries the same
    // tally_synced_at and "what did this run write?" is a single comparison.
    const stamp = new Date().toISOString();

    const groupPairs = new Map<string, { name: string; companyId: string | null }>();
    for (const i of itemRows) {
      const name = clean(i.stock_group);
      if (!name) continue;
      const companyId = companyIdByGuid.get(companyGuidOf(i.tenant_id)) ?? null;
      groupPairs.set(`${companyId ?? ""}|${name.toLowerCase()}`, { name, companyId });
    }
    const unitNames = [...new Set(itemRows.map((i) => clean(i.base_unit)).filter(Boolean))] as string[];

    if (groupPairs.size) {
      // onConflict names the COLUMNS, but the index is on
      // (coalesce(company_id::text,''), lower(name)) — an expression index
      // PostgREST cannot address. So this inserts and tolerates the duplicate
      // rather than upserting.
      const existing = await fetchAll<{ id: string; name: string; company_id: string | null }>(
        () => db.from("mst_item_groups").select("id,name,company_id"), ["id"]);
      const have = new Set(existing.map((g) => `${g.company_id ?? ""}|${g.name.toLowerCase()}`));
      const missing = [...groupPairs.entries()]
        .filter(([k]) => !have.has(k))
        .map(([, v]) => ({ name: v.name, company_id: v.companyId, source: "tally", tally_synced_at: stamp }));
      for (let i = 0; i < missing.length; i += 500) {
        const { error } = await db.from("mst_item_groups").insert(missing.slice(i, i + 500));
        if (error) throw new Error(`item group insert failed: ${error.message}`);
      }
    }
    if (unitNames.length) {
      await upsertChunked(db, "mst_units",
        unitNames.map((name) => ({ name, source: "tally", tally_synced_at: stamp })), "name");
    }

    const groupRows = await fetchAll<{ id: string; name: string; company_id: string | null }>(
      () => db.from("mst_item_groups").select("id,name,company_id"), ["id"]);
    const unitRows = await fetchAll<{ id: string; name: string }>(() => db.from("mst_units").select("id,name"), ["id"]);
    // Keyed by company AND name, so an item lands in ITS company's group.
    const groupIdByKey = new Map(groupRows.map((r) => [`${r.company_id ?? ""}|${r.name.toLowerCase()}`, r.id]));
    const unitIdByName = new Map(unitRows.map((r) => [r.name, r.id]));

    // =================================================================== items --
    const itemByGuid = new Map<string, typeof itemRows[number]>();
    for (const i of itemRows) {
      if (!i.guid) continue;
      const seen = itemByGuid.get(i.guid);
      if (!seen || (isPriorFyTenant(seen.tenant_id) && !isPriorFyTenant(i.tenant_id))) itemByGuid.set(i.guid, i);
    }

    // hsn_code and modules are absent: both are portal-owned. An upsert only sets
    // the columns present here, so an admin's edits survive every pull.
    const itemsWritten = await upsertChunked(db, "mst_items", [...itemByGuid.values()].map((i) => ({
      tally_guid: i.guid,
      name: i.item,
      tally_tenant: i.tenant_id,
      tally_synced_at: stamp,
      source: "tally",
      // Items are managed per company, and the tenant IS the company. Refreshed
      // on every pull, which is safe: an item cannot move between Tally companies.
      company_id: companyIdByGuid.get(companyGuidOf(i.tenant_id)) ?? null,
      group_id: groupIdByKey.get(
        `${companyIdByGuid.get(companyGuidOf(i.tenant_id)) ?? ""}|${(clean(i.stock_group) ?? "").toLowerCase()}`,
      ) ?? null,
      unit_id: unitIdByName.get(clean(i.base_unit) ?? "") ?? null,
    })), "tally_guid");

    // ================================================================= parties --
    const ledgerByGuid = new Map<string, typeof ledgerRows[number]>();
    for (const l of ledgerRows) {
      if (!l.guid) continue;
      const seen = ledgerByGuid.get(l.guid);
      if (!seen || (isPriorFyTenant(seen.tenant_id) && !isPriorFyTenant(l.tenant_id))) ledgerByGuid.set(l.guid, l);
    }

    // ⚠ ROLE COMES FROM group_chain, NOT sub_group. A creditor's sub_group is its
    //   own bucket ("CREDITOR FOR OTHER"); only the chain carries "Sundry Creditors".
    const inChain = (chain: string[] | null, want: string) => (chain ?? []).some((g) => g === want);

    // ======================================= who actually trades with us --
    //
    // ⚠ THE TALLY GROUP IS AN ACCOUNTING LABEL, NOT A STATEMENT OF TRADE.
    //   Deciding the role from the group alone hid real customers, in two ways:
    //
    //   1. A ledger under "Branch / Divisions" is NEITHER a debtor nor a
    //      creditor, so BOTH flags came out false and the row appeared on
    //      neither tab and in no module picker - present in the master,
    //      unreachable in the UI. ORANGE O TEC PVT. LTD.(SURAT BRANCH) sat
    //      there with 130 sale lines and 1,836 purchase lines against it in
    //      the Noida book. "Branch / Divisions" is one of Tally's RESERVED
    //      PRIMARY groups: its parent is empty, so the chain never reaches
    //      Sundry Debtors no matter how deep the walk goes.
    //   2. A firm filed under a creditor group that nonetheless buys from us
    //      was offered as a vendor only. reconcile.ts has carried a note about
    //      exactly this since before the cutover (GARTEX TEXPROCESS INDIA:
    //      creditor group, eleven sales).
    //
    //   So the registers get a vote. A ledger with sales booked against it in
    //   a book IS a customer of that book, whatever Tally files it under; same
    //   for purchases and vendors. Evidence cannot drift the way a hand-kept
    //   exception list would, and it self-corrects: a branch that starts
    //   trading next month is picked up by the next pull.
    //
    // ⚠ THE FLAGS ONLY EVER WIDEN. The group test stays exactly as it was and
    //   the register is OR-ed onto it, so no row can lose a role it has today.
    //
    // ⚠ NO `kind` FILTER ON THE SALES READ. The catalogue below wants item
    //   lines only, but 709 of the register's rows are `kind='ledger'` - a
    //   sale with no stock item, which is still proof of a trading
    //   relationship. Read everything here; the catalogue narrows it itself.
    const salesRows = await fetchAll<{
      kind: string; company_guid: string; party: string; particulars: string;
      vch_date: string; quantity: number;
    }>(() => cw.from("rpt_sales_register")
      .select("kind,company_guid,party,particulars,vch_date,quantity"),
      // One voucher line is (tenant, voucher, line_no) - unique, so no ties.
      ["tenant_id", "voucher_guid", "line_no"]);

    const purchaseRows = await fetchAll<{ company_guid: string; party: string }>(
      () => cw.from("rpt_purchase_item").select("company_guid,party"),
      ["tenant_id", "voucher_guid", "line_no"]);

    /** Keyed on company GUID, not company_id, so the sets exist before the
     *  parties are written. companyGuidOf() strips both the `acct_orange::`
     *  prefix and the `~YYYYMMDD` prior-FY suffix; the registers carry
     *  company_guid bare, so the two sides meet. */
    const evidenceKey = (companyGuid: string, name: string) =>
      `${companyGuid}|${String(name ?? "").trim().toLowerCase()}`;

    const soldTo = new Set(salesRows.map((s) => evidenceKey(s.company_guid, s.party)));
    const boughtFrom = new Set(purchaseRows.map((p) => evidenceKey(p.company_guid, p.party)));

    const traded = (l: { tenant_id: string; ledger: string }) => {
      const key = evidenceKey(companyGuidOf(l.tenant_id), l.ledger);
      return { sold: soldTo.has(key), bought: boughtFrom.has(key) };
    };

    // company_id is portal-owned in general, but on INSERT it is the one thing we
    // can derive honestly: the ledger physically belongs to that Tally company.
    // It is included here, which means a pull DOES refresh it - acceptable and
    // correct, because a ledger cannot move between Tally companies.
    const partiesWritten = await upsertChunked(db, "mst_parties", [...ledgerByGuid.values()].map((l) => ({
      tally_guid: l.guid,
      name: l.ledger,
      tally_tenant: l.tenant_id,
      tally_synced_at: stamp,
      source: "tally",
      is_customer: inChain(l.group_chain, "Sundry Debtors") || traded(l).sold,
      is_vendor: inChain(l.group_chain, "Sundry Creditors") || traded(l).bought,
      gstin: clean(l.gstin),
      sub_group: clean(l.sub_group),
      group_chain: l.group_chain ?? null,
      credit_limit: l.credit_limit ?? null,
      credit_period: clean(l.credit_period),
      company_id: companyIdByGuid.get(companyGuidOf(l.tenant_id)) ?? null,
    })), "tally_guid");

    // ============================== customer-item catalogue, from real sales --
    //
    // Which items a customer may order, evidenced by what they have actually
    // bought. Beats a hand-kept list: it cannot drift from reality, and it needs
    // nobody to maintain it for 1,838 customers.
    //
    // ⚠ THE REGISTER IS KEYED BY NAME. rpt_sales_register is a REPORT — it
    //   carries `party` and `particulars` as plain strings, not guids. So each
    //   line is resolved by (company + lower(name)) against what we just wrote.
    //   Anything that will not resolve is COUNTED AND SKIPPED, never guessed:
    //   a wrong catalogue row is worse than a missing one, because it puts an
    //   item a customer has never bought onto their order form.
    // Read once, above, for the role flags - narrowed to item lines HERE, because
    // a catalogue row needs an item and a `kind='ledger'` sale has none.
    const saleItemRows = salesRows.filter((s) => s.kind === "item");

    const writtenParties = await fetchAll<{ id: string; name: string; company_id: string | null }>(
      () => db.from("mst_parties").select("id,name,company_id"), ["id"]);
    const writtenItems = await fetchAll<{ id: string; name: string; company_id: string | null }>(
      () => db.from("mst_items").select("id,name,company_id"), ["id"]);

    const nameKey = (companyId: string | null, name: string) =>
      `${companyId ?? ""}|${String(name ?? "").trim().toLowerCase()}`;
    const partyIdByKey = new Map(writtenParties.map((p) => [nameKey(p.company_id, p.name), p.id]));
    const itemIdByKey = new Map(writtenItems.map((i) => [nameKey(i.company_id, i.name), i.id]));

    /** "20260806" -> "2026-08-06". The register stores dates as YYYYMMDD text. */
    const ymd = (s: string): string | null => {
      const v = String(s ?? "");
      return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
    };

    const pairs = new Map<string, { party_id: string; item_id: string; last: string | null; count: number }>();
    let unresolvedParty = 0;
    let unresolvedItem = 0;
    for (const s of saleItemRows) {
      const companyId = companyIdByGuid.get(s.company_guid) ?? null;
      const partyId = partyIdByKey.get(nameKey(companyId, s.party));
      const itemId = itemIdByKey.get(nameKey(companyId, s.particulars));
      if (!partyId) { unresolvedParty++; continue; }
      if (!itemId) { unresolvedItem++; continue; }
      const key = `${partyId}|${itemId}`;
      const date = ymd(s.vch_date);
      const cur = pairs.get(key);
      if (cur) {
        cur.count++;
        if (date && (!cur.last || date > cur.last)) cur.last = date;
      } else {
        pairs.set(key, { party_id: partyId, item_id: itemId, last: date, count: 1 });
      }
    }

    // `active` and `sort_order` are absent: an upsert sets only what it is given,
    // so a pair an admin deactivated by hand stays deactivated through a re-sync.
    const catalogueWritten = pairs.size
      ? await upsertChunked(db, "mst_party_items", [...pairs.values()].map((p) => ({
          party_id: p.party_id,
          item_id: p.item_id,
          source: "sales_register",
          last_sold_on: p.last,
          sale_count: p.count,
        })), "party_id,item_id")
      : 0;

    // ================================================================== close --
    const counts = {
      companies_inserted: companiesInserted,
      companies_updated: companiesUpdated,
      item_groups: groupPairs.size,
      units: unitNames.length,
      items: itemsWritten,
      parties: partiesWritten,
      // ⚠ COUNT WHAT WAS WRITTEN, not what the group test alone would have said.
      //   These used to recompute `inChain(...)` and would now UNDER-report the
      //   flags actually set - a count that quietly disagrees with the table is
      //   worse than no count. The `_by_evidence` pair is the interesting half:
      //   it is how many rows owe their role to trade rather than to the group,
      //   so a sudden jump is visible here instead of being a mystery later.
      customers: [...ledgerByGuid.values()]
        .filter((l) => inChain(l.group_chain, "Sundry Debtors") || traded(l).sold).length,
      vendors: [...ledgerByGuid.values()]
        .filter((l) => inChain(l.group_chain, "Sundry Creditors") || traded(l).bought).length,
      customers_by_evidence: [...ledgerByGuid.values()]
        .filter((l) => !inChain(l.group_chain, "Sundry Debtors") && traded(l).sold).length,
      vendors_by_evidence: [...ledgerByGuid.values()]
        .filter((l) => !inChain(l.group_chain, "Sundry Creditors") && traded(l).bought).length,
      customer_items: catalogueWritten,
      // Surfaced, not swallowed: a rising unresolved count is how you find out
      // the register and the masters have drifted apart on naming.
      sales_lines_read: salesRows.length,
      sale_item_lines: saleItemRows.length,
      purchase_lines_read: purchaseRows.length,
      unresolved_party: unresolvedParty,
      unresolved_item: unresolvedItem,
    };

    await db.from("mst_sync_runs")
      .update({ status: "success", finished_at: new Date().toISOString(), counts })
      .eq("id", runId);

    return json(200, { ok: true, runId, watermark, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A failed run must be RECORDED, not just returned - otherwise the watcher
    // sees no successful run, re-pulls every tick, and nobody learns why.
    if (runId) {
      await db.from("mst_sync_runs")
        .update({ status: "error", finished_at: new Date().toISOString(), error: message })
        .eq("id", runId);
    }
    return json(500, { error: message });
  }
});
