// Supabase Edge Function: gstin-lookup
//
// Looks a GSTIN up on the GST portal (via Appyflow) and returns the taxpayer's
// legal name, trade name and registered address, so the Customer Onboarding
// wizard can fill those in instead of asking a rep to retype them off a
// certificate photo.
//
// WHY AN EDGE FUNCTION AND NOT A BROWSER FETCH
//   The provider key is a billable credential. Anything in the frontend bundle is
//   public — VITE_* vars included — so a browser-side call would publish a key
//   that anyone could then spend. It lives here as a secret and never leaves the
//   server. Same reasoning as analyze-receivables (whose whole point was that the
//   ported app used to ship an Anthropic key to the browser).
//
//   POST { gstin: "24AHHPA6524B1Z1" }
//     -> 200 { ok: true, found: true, data: { legalName, tradeName, registeredAddress,
//                                             city, pincode, stateCode, status,
//                                             registrationDate, constitution } }
//     -> 200 { ok: true, found: false, reason: "not_found" | "not_configured" | "upstream" }
//     -> 400 { ok: false, error }   bad input
//     -> 401 { ok: false, error }   not signed in
//
// ⚠ "found: false" IS A SUCCESS, NOT AN ERROR. The wizard treats a miss exactly
//   like the offline case: the user types the address themselves. A lookup that
//   returns 500 when the provider is down would turn a convenience into an
//   outage, so every upstream failure is flattened into found:false and the
//   reason is carried for the console, not the user.
//
// Deploy (IDENTITY project — where the login lives):
//   supabase secrets set GSTIN_API_KEY=<appyflow key_secret> --project-ref <identity ref>
//   supabase functions deploy gstin-lookup --project-ref <identity ref>
//
//   Optional: GSTIN_API_PROVIDER (default "appyflow") selects the adapter below.
//   SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.
//
// ⚠ COST CONTROL: this is pay-per-call. The client only calls it for a GSTIN that
//   has already passed the 15-char format AND the mod-36 checksum locally, and it
//   caches per GSTIN for the life of the page, so typing one character at a time
//   cannot spend money. Keep both of those guarantees if you touch the caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const API_KEY = Deno.env.get("GSTIN_API_KEY") ?? "";
const PROVIDER = (Deno.env.get("GSTIN_API_PROVIDER") ?? "appyflow").toLowerCase();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Same shape the frontend's GstinLookup interface expects. */
interface LookupResult {
  legalName: string | null;
  tradeName: string | null;
  registeredAddress: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
  status: string | null;
  registrationDate: string | null;
  constitution: string | null;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** Mod-36 check digit — the same algorithm as the SQL and TS copies. */
function checksumOk(g: string): boolean {
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = A.indexOf(g[i]);
    if (v < 0) return false;
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return A[(36 - (sum % 36)) % 36] === g[14];
}

/**
 * Flatten the GSTN address object into one line.
 *
 * The portal returns up to ten fragments, most of them usually blank, and the
 * useful ones are not in a fixed order of presence — so join whatever is there
 * rather than assuming a template. door/floor/building/street/locality, then the
 * city and district are handled separately because the form has its own City field.
 */
function joinAddress(addr: Record<string, unknown> | undefined | null): string | null {
  if (!addr) return null;
  const part = (k: string) => String(addr[k] ?? "").trim();
  const bits = ["flno", "bno", "bnm", "st", "landMark", "loc"]
    .map(part)
    .filter((v) => v && v !== "NA");
  // De-duplicate: the portal frequently repeats the locality in two fields.
  const seen = new Set<string>();
  const uniq = bits.filter((b) => {
    const k = b.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const line = uniq.join(", ");
  return line || null;
}

/** Appyflow: GET /api/verifyGST?gstNo=…&key_secret=… → the raw GSTN taxpayerInfo. */
async function lookupAppyflow(gstin: string): Promise<{ found: boolean; data?: LookupResult; reason?: string }> {
  const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { found: false, reason: `upstream_${res.status}` };

  const body = await res.json().catch(() => null);
  if (!body) return { found: false, reason: "upstream_parse" };

  // Appyflow reports a bad GSTIN as { error: true, message } with a 200.
  if (body.error) return { found: false, reason: "not_found" };

  const info = body.taxpayerInfo ?? body.data?.taxpayerInfo;
  if (!info) return { found: false, reason: "not_found" };

  const addr = info.pradr?.addr ?? null;
  return {
    found: true,
    data: {
      legalName: (info.lgnm ?? "").trim() || null,
      tradeName: (info.tradeNam ?? "").trim() || null,
      registeredAddress: joinAddress(addr),
      city: (addr?.city ?? addr?.dst ?? "").trim() || null,
      pincode: (addr?.pncd ?? "").trim() || null,
      stateCode: (info.gstin ?? gstin).slice(0, 2),
      status: (info.sts ?? "").trim() || null,
      registrationDate: (info.rgdt ?? "").trim() || null,
      constitution: (info.ctb ?? "").trim() || null,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

  // Signed-in callers only — this spends money per call.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "Not signed in" });

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json(401, { ok: false, error: "Not signed in" });

  let payload: { gstin?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: "Body must be JSON" });
  }

  const gstin = String(payload.gstin ?? "").toUpperCase().replace(/[\s-]+/g, "").trim();
  if (!GSTIN_RE.test(gstin) || !checksumOk(gstin)) {
    return json(400, { ok: false, error: "Not a valid GSTIN" });
  }

  // No key configured yet: a clean, non-alarming miss. The wizard already handles
  // this path — it is the same one it uses when the lookup is switched off.
  if (!API_KEY) return json(200, { ok: true, found: false, reason: "not_configured" });

  try {
    const result = PROVIDER === "appyflow"
      ? await lookupAppyflow(gstin)
      : { found: false, reason: `unknown_provider_${PROVIDER}` };

    return json(200, { ok: true, ...result });
  } catch (e) {
    // Never surface an upstream failure as an error: a provider outage must not
    // stop anyone onboarding a customer by hand.
    console.error("gstin-lookup failed", e);
    return json(200, { ok: true, found: false, reason: "upstream_exception" });
  }
});
