// Supabase Edge Function: gstin-lookup
//
// Looks a GSTIN up and returns two different things about the taxpayer:
//
//   IDENTITY    who they are — legal name, trade name, registered address, city.
//               Fills in the Customer Onboarding form so a rep never retypes it
//               off a certificate photo.
//   COMPLIANCE  how they behave — GST return filing history, filing periodicity,
//               compliance category, aggregate turnover. This is what the credit
//               gate actually needs: a prospect asking for 60-day terms who has
//               not filed GSTR-3B since March is the single most useful thing you
//               can put in front of the approver.
//
// TWO PROVIDERS, ON PURPOSE (see mergeResults below)
//   Appyflow  — live, structured, ₹0.40–0.50/call. Its address comes back as a
//               real object (pradr.addr) with a separate city and pincode, so it
//               is the better IDENTITY source.
//   jamku     — free (1000/day via RapidAPI), but its address is ONE FLAT STRING
//               with the city buried inside it, and it serves a CACHED snapshot
//               whose age it reports in meta.syncMasterDate. That makes it a poor
//               identity source and an excellent COMPLIANCE one, since it is the
//               only one of the two that returns the filing history at all.
//
//   So both are called, concurrently, and each fills the half it is good at.
//   Either one missing (no key, provider down) degrades to the other.
//
// WHY AN EDGE FUNCTION AND NOT A BROWSER FETCH
//   The provider keys are billable credentials. Anything in the frontend bundle
//   is public — VITE_* vars included — so a browser-side call would publish a key
//   that anyone could then spend. They live here as secrets and never leave the
//   server. Same reasoning as analyze-receivables (whose whole point was that the
//   ported app used to ship an Anthropic key to the browser).
//
//   POST { gstin: "24AHHPA6524B1Z1" }
//     -> 200 { ok: true, found: true, data: { legalName, tradeName, registeredAddress,
//                                             city, pincode, stateCode, status,
//                                             registrationDate, constitution,
//                                             taxpayerType, compliance: {…} | null,
//                                             sources: […] } }
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
//   supabase secrets set GSTIN_API_KEY=<appyflow key_secret>   --project-ref <identity ref>
//   supabase secrets set GSTIN_JAMKU_KEY=<rapidapi key>        --project-ref <identity ref>
//   supabase functions deploy gstin-lookup --project-ref <identity ref>
//
//   GSTIN_API_PROVIDER (default "both") selects the strategy: "both" | "appyflow"
//   | "jamku". SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.
//
// ⚠ COST CONTROL: the Appyflow half is pay-per-call. The client only calls this
//   for a GSTIN that has already passed the 15-char format AND the mod-36
//   checksum locally, and it caches per GSTIN for the life of the page, so typing
//   one character at a time cannot spend money. Keep both of those guarantees if
//   you touch the caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const API_KEY = Deno.env.get("GSTIN_API_KEY") ?? "";
const JAMKU_KEY = Deno.env.get("GSTIN_JAMKU_KEY") ?? "";
const PROVIDER = (Deno.env.get("GSTIN_API_PROVIDER") ?? "both").toLowerCase();

const JAMKU_HOST = "gst-return-status.p.rapidapi.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/**
 * One filed return, newest first. `period` is the tax period the return covers
 * ("September"), NOT the date it was filed — a return filed in October for
 * September is normal, and conflating the two makes every filer look late.
 */
interface FiledReturn {
  type: string;          // GSTR1 | GSTR3B | …
  fy: string;            // "2022-2023"
  period: string;        // "September"
  filedOn: string | null; // dd/mm/yyyy as the portal reports it
}

/**
 * The credit-relevant half. Null when no compliance provider answered — the
 * panels must render without it, because it is the free, cached, best-effort
 * source and it will sometimes simply not be there.
 */
interface Compliance {
  /** jamku's own traffic-light: "Green" / "Amber" / … Provider opinion, not GSTN's. */
  category: string | null;
  aggregateTurnover: string | null;
  aggregateTurnoverFy: string | null;
  /** Monthly vs quarterly, keyed by "2022_Q1" → "M" | "Q". */
  filingFrequency: Record<string, string> | null;
  latestGstr1: string | null;
  latestGstr3b: string | null;
  eInvoiceMandated: string | null;
  /** Whether they are enabled to issue e-invoices, distinct from being mandated to. */
  eInvoiceEnabled: string | null;
  hsn: string[];
  natureOfBusiness: string[];
  centreJurisdiction: string | null;
  stateJurisdiction: string | null;
  returns: FiledReturn[];
  /**
   * ⚠ HOW STALE THIS IS. jamku serves a cached snapshot and reports the date it
   *   last synced. Always surface it — an approver reading "filed to September"
   *   needs to know whether that was checked yesterday or last year.
   */
  syncedOn: string | null;
  returnsSyncedOn: string | null;
}

/**
 * One additional place of business, from the GSTIN's `adadr` list.
 *
 * `nature` is the portal's own description of what the premises IS — "Factory /
 * Manufacturing", "Warehouse / Depot", "Retail Business". That label is the
 * whole reason this is worth capturing: it is what lets the form fill in the
 * FACTORY address specifically rather than guessing at the first entry.
 */
interface AdditionalPlace {
  address: string;
  nature: string | null;
}

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
  cancellationDate: string | null;
  constitution: string | null;
  /** Regular | Composition | … — a Composition dealer cannot pass on ITC. */
  taxpayerType: string | null;
  /** Appyflow only — jamku does not return these at all. */
  additionalPlaces: AdditionalPlace[];
  compliance: Compliance | null;
  /** Which providers actually answered, for the console and the lookup card. */
  sources: string[];
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

type Attempt = { found: boolean; data?: LookupResult; reason?: string };

const clean = (v: unknown): string | null => String(v ?? "").trim() || null;

/** An empty result, so each adapter only fills what it actually knows. */
function blank(gstin: string): LookupResult {
  return {
    legalName: null, tradeName: null, registeredAddress: null, city: null,
    pincode: null, stateCode: gstin.slice(0, 2), status: null,
    registrationDate: null, cancellationDate: null, constitution: null,
    taxpayerType: null, additionalPlaces: [], compliance: null, sources: [],
  };
}

/**
 * The `adadr` list → one flat line each, with the premises nature kept alongside.
 *
 * Each entry mirrors pradr's shape ({ addr: {…}, ntr }), so the same joiner runs
 * over it. Entries whose address flattens to nothing are dropped rather than
 * emitted blank — a row reading "— (Factory)" is worse than no row.
 */
function additionalPlaces(adadr: unknown): AdditionalPlace[] {
  if (!Array.isArray(adadr)) return [];
  const out: AdditionalPlace[] = [];
  for (const entry of adadr) {
    const e = entry as Record<string, unknown> | null;
    const addr = (e?.addr ?? null) as Record<string, unknown> | null;
    const line = joinAddress(addr);
    if (!line) continue;
    const pin = String(addr?.pncd ?? "").trim();
    const city = String(addr?.city ?? addr?.dst ?? "").trim();
    out.push({
      address: [line, city, pin].filter(Boolean).join(", "),
      nature: clean(e?.ntr),
    });
  }
  return out;
}

/** Appyflow: GET /api/verifyGST?gstNo=…&key_secret=… → the raw GSTN taxpayerInfo. */
async function lookupAppyflow(gstin: string): Promise<Attempt> {
  const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { found: false, reason: `appyflow_${res.status}` };

  const body = await res.json().catch(() => null);
  if (!body) return { found: false, reason: "appyflow_parse" };

  // Appyflow reports a bad GSTIN as { error: true, message } with a 200.
  if (body.error) return { found: false, reason: "appyflow_not_found" };

  const info = body.taxpayerInfo ?? body.data?.taxpayerInfo;
  if (!info) return { found: false, reason: "appyflow_not_found" };

  const addr = info.pradr?.addr ?? null;
  return {
    found: true,
    data: {
      ...blank(gstin),
      legalName: clean(info.lgnm),
      tradeName: clean(info.tradeNam),
      registeredAddress: joinAddress(addr),
      city: clean(addr?.city) ?? clean(addr?.dst),
      pincode: clean(addr?.pncd),
      stateCode: (info.gstin ?? gstin).slice(0, 2),
      status: clean(info.sts),
      registrationDate: clean(info.rgdt),
      cancellationDate: clean(info.cxdt),
      constitution: clean(info.ctb),
      taxpayerType: clean(info.dty),
      additionalPlaces: additionalPlaces(info.adadr),
      sources: ["appyflow"],
    },
  };
}

/**
 * Best-effort city out of jamku's single flat address string.
 *
 * ⚠ THIS IS A GUESS, AND IT IS ONLY EVER A FALLBACK. jamku has no city field;
 *   the address arrives as one comma-joined line that ends, by convention:
 *     "…, Savarkar Nagar, Thane, Maharashtra, 400606"
 *                          ^city   ^state      ^pin
 *   So: drop a trailing 6-digit pincode, drop a trailing state name, and take
 *   what is left at the end. When Appyflow answered, its real `city` field wins
 *   in mergeResults and this is discarded — which is the whole reason Appyflow
 *   is the identity source.
 */
function cityFromFlatAddress(adr: string | null): string | null {
  if (!adr) return null;
  const parts = adr.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  if (/^\d{6}$/.test(parts[parts.length - 1])) parts.pop();
  // The last remaining part is the state; the one before it is the city. Only
  // drop it when something is actually left underneath, so a two-part address
  // does not reduce to nothing.
  if (parts.length >= 2) parts.pop();
  return parts[parts.length - 1] ?? null;
}

/**
 * jamku (via RapidAPI): GET /free/gstin/{GSTIN}.
 *
 * Returns `{ success, data: { … } }`. The identity half duplicates Appyflow but
 * flatter; the value is `returns`, `fillingFreq`, `compCategory` and
 * `aggreTurnOver`, which Appyflow does not carry at all.
 */
async function lookupJamku(gstin: string): Promise<Attempt> {
  const res = await fetch(`https://${JAMKU_HOST}/free/gstin/${encodeURIComponent(gstin)}`, {
    headers: {
      "content-type": "application/json",
      "x-rapidapi-key": JAMKU_KEY,
      "x-rapidapi-host": JAMKU_HOST,
    },
  });
  // 429 is the free tier's daily/minute cap. It is a miss, not an outage — the
  // Appyflow half still answers and the form still fills.
  if (!res.ok) return { found: false, reason: `jamku_${res.status}` };

  const body = await res.json().catch(() => null);
  const d = body?.data;
  if (!body?.success || !d) return { found: false, reason: "jamku_not_found" };

  // Newest first. dof is dd/mm/yyyy, so sort on a rebuilt ISO key rather than
  // the raw string — lexicographic order on dd/mm/yyyy is meaningless.
  const returns: FiledReturn[] = (Array.isArray(d.returns) ? d.returns : [])
    .map((r: Record<string, unknown>) => ({
      type: String(r.rtntype ?? "").trim(),
      fy: String(r.fy ?? "").trim(),
      period: String(r.taxp ?? "").trim(),
      filedOn: clean(r.dof),
    }))
    .sort((a: FiledReturn, b: FiledReturn) => isoKey(b.filedOn).localeCompare(isoKey(a.filedOn)));

  const adr = jclean(d.adr);
  return {
    found: true,
    data: {
      ...blank(gstin),
      legalName: jclean(d.lgnm),
      tradeName: jclean(d.tradeName),
      registeredAddress: adr,
      city: cityFromFlatAddress(adr),
      // Verified live: the dedicated pincode field is often null even though the
      // pincode sits at the end of `adr`. Not worth re-parsing — Appyflow carries
      // a real one, and the flat address already displays it.
      pincode: jclean(d.pincode),
      stateCode: (jclean(d.gstin) ?? gstin).slice(0, 2),
      status: jclean(d.sts),
      registrationDate: jclean(d.rgdt),
      cancellationDate: jclean(d.cxdt),
      constitution: jclean(d.ctb),
      taxpayerType: jclean(d.dty),
      compliance: {
        category: jclean(d.compCategory),
        aggregateTurnover: jclean(d.aggreTurnOver),
        aggregateTurnoverFy: jclean(d.aggreTurnOverFY),
        filingFrequency: d.fillingFreq && typeof d.fillingFreq === "object" ? d.fillingFreq : null,
        latestGstr1: jclean(d.meta?.latestgtsr1),
        latestGstr3b: jclean(d.meta?.latestgtsr3b),
        eInvoiceMandated: jclean(d.mandatedeInvoice),
        // jamku returns this too, so the Appyflow-only assumption was wrong —
        // it arrives free alongside everything else.
        eInvoiceEnabled: jclean(d.einvoiceStatus),
        hsn: Array.isArray(d.hsn) ? d.hsn.map(String) : [],
        natureOfBusiness: Array.isArray(d.nba) ? d.nba.map(String) : [],
        centreJurisdiction: jclean(d.ctj),
        stateJurisdiction: jclean(d.stj),
        returns,
        syncedOn: jclean(d.meta?.syncMasterDate),
        returnsSyncedOn: jclean(d.meta?.syncReturnDate),
      },
      sources: ["jamku"],
    },
  };
}

/**
 * jamku's free tier returns UPSELL COPY IN DATA FIELDS, not nulls.
 *
 * Verified live 29-07-2026: `aggreTurnOver` and `aggreTurnOverFY` both come back
 * as the literal string "Available in Paid Version of API". Passed through, the
 * approver's card would read "Turnover: Available in Paid Version of API" — an
 * advertisement rendered as though it were the customer's financials.
 *
 * ⚠ APPLIED TO EVERY jamku STRING, not just the two known fields. The provider
 *   can add the same placeholder to any field in a future tier change, and the
 *   failure mode is silent and reaches an approver's screen.
 */
function jclean(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  return /available in (the )?paid version/i.test(s) ? null : s;
}

/** dd/mm/yyyy → yyyy-mm-dd, for sorting only. Anything unparseable sorts last. */
function isoKey(dmy: string | null): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/**
 * Appyflow wins identity, jamku supplies compliance.
 *
 * Field by field rather than object-spread: either provider can be absent, and
 * either can return a null for a field the other filled. `a ?? b` per field
 * means a partial answer from the preferred source never blanks a good value
 * from the other one.
 */
function mergeResults(gstin: string, primary: Attempt, secondary: Attempt): Attempt {
  const p = primary.found ? primary.data! : null;
  const s = secondary.found ? secondary.data! : null;
  if (!p && !s) {
    return { found: false, reason: primary.reason ?? secondary.reason ?? "not_found" };
  }

  const pick = <K extends keyof LookupResult>(k: K): LookupResult[K] =>
    (p?.[k] ?? s?.[k] ?? null) as LookupResult[K];

  return {
    found: true,
    data: {
      legalName: pick("legalName"),
      tradeName: pick("tradeName"),
      registeredAddress: pick("registeredAddress"),
      city: pick("city"),
      pincode: pick("pincode"),
      stateCode: pick("stateCode") ?? gstin.slice(0, 2),
      status: pick("status"),
      registrationDate: pick("registrationDate"),
      cancellationDate: pick("cancellationDate"),
      constitution: pick("constitution"),
      taxpayerType: pick("taxpayerType"),
      // ⚠ NOT via pick(): that coalesces to null, and these two are arrays whose
      //   empty case must stay []. Only Appyflow fills additionalPlaces and only
      //   jamku fills compliance, so take whichever side actually has it.
      additionalPlaces: (p?.additionalPlaces?.length ? p.additionalPlaces : s?.additionalPlaces) ?? [],
      compliance: p?.compliance ?? s?.compliance ?? null,
      sources: [...(p?.sources ?? []), ...(s?.sources ?? [])],
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

  // Which halves can actually run. A key that is not set simply switches that
  // provider off rather than failing — running on jamku alone (free) or Appyflow
  // alone are both valid configurations.
  const useAppyflow = Boolean(API_KEY) && PROVIDER !== "jamku";
  const useJamku = Boolean(JAMKU_KEY) && PROVIDER !== "appyflow";

  // No key configured yet: a clean, non-alarming miss. The wizard already handles
  // this path — it is the same one it uses when the lookup is switched off.
  if (!useAppyflow && !useJamku) {
    return json(200, { ok: true, found: false, reason: "not_configured" });
  }

  try {
    // Concurrent, not sequential: the two are independent, and the rep is sitting
    // in front of a spinner. One provider's failure must not delay or fail the
    // other, hence allSettled and the per-attempt catch.
    const miss = (reason: string): Attempt => ({ found: false, reason });
    const [appy, jam] = await Promise.all([
      useAppyflow
        ? lookupAppyflow(gstin).catch((e) => miss(`appyflow_threw_${(e as Error).message}`))
        : Promise.resolve(miss("appyflow_off")),
      useJamku
        ? lookupJamku(gstin).catch((e) => miss(`jamku_threw_${(e as Error).message}`))
        : Promise.resolve(miss("jamku_off")),
    ]);

    const result = mergeResults(gstin, appy, jam);
    if (!result.found) {
      // Carry both reasons: "appyflow_402 | jamku_429" is a diagnosable line in
      // the function log, "not_found" is not.
      console.warn("gstin-lookup miss", gstin, appy.reason, jam.reason);
    }
    return json(200, { ok: true, ...result });
  } catch (e) {
    // Never surface an upstream failure as an error: a provider outage must not
    // stop anyone onboarding a customer by hand.
    console.error("gstin-lookup failed", e);
    return json(200, { ok: true, found: false, reason: "upstream_exception" });
  }
});
