// Supabase Edge Function: admin-users
//
// Onboards / removes workspace users. These actions require the auth admin API
// (service role) and so can't run from the browser — the client invokes this
// function instead. The function verifies the CALLER is an admin before doing
// anything with the service-role key.
//
//   POST  body { action: "create", name, email, phone, designation?, designationId?,
//                role, departmentId?, subDepartmentId?, bandId?, employeeCode?,
//                hodIds?: string[],
//                moduleLevels?: Record<string, "view" | "edit">, moduleAccess?: string[],
//                receivablesSalespersons?: string[], receivablesHiddenMenus?: string[],
//                receivablesAdminMenus?: string[], receivablesAllowedReports?: string[] }
//                                                                          -> { id }
//                  (phone = mobile number; used as the initial login password;
//                   moduleLevels = the granted apps AND how much of each: its keys
//                     are the grants. moduleAccess is the pre-level shape, still
//                     accepted from an older bundle and read as full access;
//                   receivablesSalespersons  = Outstanding Dashboard scope tags;
//                   receivablesHiddenMenus   = menus that user may NOT see;
//                   receivablesAdminMenus    = menus they may use with admin depth;
//                   receivablesAllowedReports = the individual reports they may open —
//                     an ALLOW-list, so omitting it means NO reports, not all of them)
//   POST  body { action: "set-password", userId, password }       -> { ok: true }
//   POST  body { action: "set-email", userId, email }             -> { ok: true }
//   POST  body { action: "delete", userId }                       -> { ok: true }
//
// Deploy:  supabase functions deploy admin-users --project-ref <ref>
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected by
//  the platform automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type AppRole = "admin" | "hod" | "sub_hod" | "employee";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // 1) Authenticate the caller from their JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await caller.auth.getUser();
  if (authErr || !user) return json(401, { error: "not authenticated" });

  // 2) Authorize: the caller must be an admin (checked with the service role).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: roleRows, error: roleErr } = await admin.from("user_roles").select("role").eq("user_id", user.id);
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

  // ---- delete ----
  if (body.action === "delete") {
    const userId = String(body.userId ?? "");
    if (!userId) return json(400, { error: "userId required" });
    if (userId === user.id) return json(400, { error: "you can't delete your own account" });
    const { error } = await admin.auth.admin.deleteUser(userId); // cascades the profile (FK ON DELETE CASCADE)
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  // ---- set-password ----
  // Re-pin a user's login password (the admin user form calls this on save to
  // keep the password equal to the current mobile number).
  if (body.action === "set-password") {
    const userId = String(body.userId ?? "");
    const password = String(body.password ?? "").trim();
    if (!userId) return json(400, { error: "userId required" });
    if (password.length < 6) return json(400, { error: "password must be at least 6 characters" });
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { phone: password },
    });
    if (error) return json(400, { error: error.message });
    // Keep the profiles read-model in sync so the Users screen shows the number.
    await admin.from("profiles").update({ phone: password }).eq("id", userId);
    return json(200, { ok: true });
  }

  // ---- set-email ----
  // Change a user's LOGIN email. `profiles.email` is only a read-model copy — the
  // address the login form actually checks lives in auth.users, which the browser
  // can't touch. Editing the email in the admin form used to write the profile row
  // alone, so a corrected address showed up on every screen while the user was
  // still expected to sign in with the old one, and got "Invalid login credentials"
  // with nothing on screen to explain why. Both rows are written here, together.
  //
  // email_confirm marks the new address confirmed on the spot: without it GoTrue
  // parks the change in `email_change` pending a click in a confirmation mail, and
  // the login email would silently stay on the old value — the very bug this fixes.
  if (body.action === "set-email") {
    const userId = String(body.userId ?? "");
    const email = String(body.email ?? "").trim();
    if (!userId) return json(400, { error: "userId required" });
    if (!email) return json(400, { error: "email required" });
    const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) return json(400, { error: error.message });
    // Keep the profiles read-model in step (the caller writes it too; same value).
    const { error: profErr } = await admin.from("profiles").update({ email }).eq("id", userId);
    if (profErr) return json(400, { error: profErr.message });
    return json(200, { ok: true });
  }

  // ---- create ----
  if (body.action === "create") {
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    if (!name) return json(400, { error: "name required" });
    if (!email) return json(400, { error: "email required" });
    // The mobile number is the user's initial password, so it must satisfy the
    // auth minimum length.
    if (phone.length < 6) return json(400, { error: "phone (mobile) required, min 6 characters — it is the initial password" });
    const role = (body.role as AppRole) ?? "employee";
    const departmentId = (body.departmentId as string | null) ?? null;
    // The four organisation fields. `designation` (text) is the legacy mirror
    // list_org_people() returns for @mention pickers; `designationId` is the
    // source of truth. Both are written, always together.
    const designation = (body.designation as string | null) ?? null;
    const designationId = (body.designationId as string | null) ?? null;
    const subDepartmentId = (body.subDepartmentId as string | null) ?? null;
    const bandId = (body.bandId as string | null) ?? null;
    const employeeCode = (String(body.employeeCode ?? "").trim() || null) as string | null;
    const hodIds = Array.isArray(body.hodIds) ? (body.hodIds as string[]) : [];
    // Module grants arrive as { appId: 'view' | 'edit' } — the keys are the granted
    // apps, so there is no separate id list that could disagree with the levels.
    //
    // ⚠ `moduleAccess` (a bare string[]) is still accepted for one reason: an
    //   older frontend bundle in an open tab still sends it. Those ids default to
    //   'edit', which is what they meant before the level existed. Anything not
    //   recognised as 'view' is likewise 'edit' — the level must never be
    //   restricted by accident, only ever by an explicit choice.
    const rawLevels = (body.moduleLevels ?? null) as Record<string, unknown> | null;
    const legacyIds = Array.isArray(body.moduleAccess) ? (body.moduleAccess as string[]) : [];
    const moduleLevels: Record<string, "view" | "edit"> = {};
    for (const app_id of legacyIds) moduleLevels[app_id] = "edit";
    if (rawLevels && typeof rawLevels === "object") {
      for (const [app_id, level] of Object.entries(rawLevels)) moduleLevels[app_id] = level === "view" ? "view" : "edit";
    }
    const receivablesSalespersons = Array.isArray(body.receivablesSalespersons) ? (body.receivablesSalespersons as string[]) : [];
    // Outstanding Dashboard menu access, set on the SAME form as everything above. Both
    // used to be dropped on create (only the update path wrote them), so a brand-new user
    // silently landed on the defaults — every menu visible, nothing elevated — and the
    // admin's choices only took effect when they re-opened and saved the user a second time.
    const receivablesHiddenMenus = Array.isArray(body.receivablesHiddenMenus) ? (body.receivablesHiddenMenus as string[]) : [];
    const receivablesAdminMenus = Array.isArray(body.receivablesAdminMenus) ? (body.receivablesAdminMenus as string[]) : [];
    // Per-report grants. [] is the correct default here and is NOT the same shape of default
    // as the two above: this one is an allow-list, so an omitted value means "no reports",
    // which is exactly what a brand-new user should start with.
    const receivablesAllowedReports = Array.isArray(body.receivablesAllowedReports) ? (body.receivablesAllowedReports as string[]) : [];

    // Create the auth user with the mobile number as the initial password (email
    // pre-confirmed). The on_auth_user_created trigger inserts the profile + an
    // 'employee' role row. The user can change their password after first login.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: phone,
      email_confirm: true,
      user_metadata: { name, phone },
    });
    if (createErr || !created.user) return json(400, { error: createErr?.message ?? "could not create user" });
    const id = created.user.id;

    // Patch the auto-created profile + identity rows.
    const { error: profErr } = await admin
      .from("profiles")
      .update({
        name,
        designation,
        designation_id: designationId,
        department_id: departmentId,
        sub_department_id: subDepartmentId,
        band_id: bandId,
        employee_code: employeeCode,
        phone,
        receivables_salespersons: receivablesSalespersons,
        receivables_hidden_menus: receivablesHiddenMenus,
        receivables_admin_menus: receivablesAdminMenus,
        receivables_allowed_reports: receivablesAllowedReports,
      })
      .eq("id", id);
    if (profErr) return json(400, { error: profErr.message });

    if (role !== "employee") {
      await admin.from("user_roles").delete().eq("user_id", id);
      const { error } = await admin.from("user_roles").insert({ user_id: id, role });
      if (error) return json(400, { error: error.message });
    }
    if (hodIds.length) {
      const { error } = await admin.from("user_hods").insert(hodIds.map((hod_id) => ({ employee_id: id, hod_id })));
      if (error) return json(400, { error: error.message });
    }
    // The level goes in on CREATE, not only on the later update — the comment on
    // receivablesHiddenMenus above records what happens when a new per-user
    // setting is wired into one path and forgotten in the other.
    const grantedApps = Object.keys(moduleLevels);
    if (grantedApps.length) {
      const { error } = await admin
        .from("app_access")
        .insert(grantedApps.map((app_id) => ({ user_id: id, app_id, access_level: moduleLevels[app_id] })));
      if (error) return json(400, { error: error.message });
    }

    return json(200, { id });
  }

  return json(400, { error: "unknown action" });
});
