// Supabase Edge Function: admin-users
//
// Onboards / removes workspace users. These actions require the auth admin API
// (service role) and so can't run from the browser — the client invokes this
// function instead. The function verifies the CALLER is an admin before doing
// anything with the service-role key.
//
//   POST  body { action: "create", name, email, phone, designation?, role,
//                departmentId?, hodIds?: string[], moduleAccess?: string[] }  -> { id }
//                  (phone = mobile number; used as the initial login password)
//   POST  body { action: "set-password", userId, password }       -> { ok: true }
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
    const designation = (body.designation as string | null) ?? null;
    const hodIds = Array.isArray(body.hodIds) ? (body.hodIds as string[]) : [];
    const moduleAccess = Array.isArray(body.moduleAccess) ? (body.moduleAccess as string[]) : [];

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
      .update({ name, designation, department_id: departmentId, phone })
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
    if (moduleAccess.length) {
      const { error } = await admin.from("app_access").insert(moduleAccess.map((app_id) => ({ user_id: id, app_id })));
      if (error) return json(400, { error: error.message });
    }

    return json(200, { id });
  }

  return json(400, { error: "unknown action" });
});
