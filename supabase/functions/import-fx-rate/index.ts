// Live foreign-exchange rate — Supabase Edge Function (Deno).
//
//   Import Purchase FMS ──▶ this Edge Function ──▶ xe.com (primary) / FX APIs
//
// Import buying is priced in a foreign currency; the app needs a live rate to
// (a) route approval on an INR-equivalent at request time and (b) prefill the
// 100%-advance Payment. Browsers can't read xe.com directly (CORS), so the
// scrape runs here, server-side. xe.com HTML is brittle, so two public FX APIs
// back it up, and the caller can always override the returned rate by hand.
//
// Request  (POST JSON):  { "from": "USD", "to": "INR" }   // to defaults to INR
// Response (JSON):       { "base": "USD", "quote": "INR", "rate": 83.12,
//                          "fetched_at": "<iso>", "source": "xe.com" | "er-api" | "frankfurter" | "cache" }
//
// Deploy (identity project coshondiqdhorwvibrwu):
//   supabase functions deploy import-fx-rate --project-ref coshondiqdhorwvibrwu
// verify_jwt stays ON (config.toml) — the caller is always a signed-in portal user.

import { corsHeaders } from '../_shared/cors.ts';

type Body = { from?: string; to?: string };
type Rate = { base: string; quote: string; rate: number; fetched_at: string; source: string };

const CACHE_MS = 5 * 60 * 1000; // 5-minute cache; FX drifts slowly and xe rate-limits scrapers.
const cache = new Map<string, Rate>();

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const clean = (c: unknown, fallback: string): string => {
  const s = String(c ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : fallback;
};

/** Primary — scrape the xe.com converter page. Best-effort: HTML shape drifts. */
async function fromXe(from: string, to: string): Promise<number | null> {
  const url = `https://www.xe.com/currencyconverter/convert/?Amount=1&From=${from}&To=${to}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) return null;
  const html = await res.text();

  // xe's "USD to INR exchange rates today" results table renders one row per
  // amount (1, 5, 10, …). The FIRST row is the Amount=1 rate, shaped like:
  //   96.2863<!-- --> <!-- -->INR
  // i.e. the number, some hydration comment nodes, then the TO currency code.
  // Match that (it's the authoritative on-page rate); take the first (=1 unit).
  const rowRe = new RegExp(`([0-9][0-9,]*\\.[0-9]+)\\s*(?:<!--[^>]*-->\\s*)+${to}\\b`);
  const rowMatch = html.match(rowRe);
  if (rowMatch) {
    const n = Number(rowMatch[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }

  // Fallback — the summary line "1 US Dollar = 96.29 Indian Rupees".
  const lineRe = /=\s*<[^>]*>?\s*([0-9][0-9,]*\.[0-9]+)/;
  const lineMatch = html.match(lineRe);
  if (lineMatch) {
    const n = Number(lineMatch[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Fallback 1 — open.er-api.com (no key). */
async function fromErApi(from: string, to: string): Promise<number | null> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const n = data?.rates?.[to];
  return typeof n === 'number' && n > 0 ? n : null;
}

/** Fallback 2 — frankfurter.app (ECB, no key). */
async function fromFrankfurter(from: string, to: string): Promise<number | null> {
  const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const n = data?.rates?.[to];
  return typeof n === 'number' && n > 0 ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const from = clean(body.from, 'USD');
  const to = clean(body.to, 'INR');

  if (from === to) {
    return json({ base: from, quote: to, rate: 1, fetched_at: new Date().toISOString(), source: 'identity' });
  }

  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - Date.parse(hit.fetched_at) < CACHE_MS) {
    return json({ ...hit, source: 'cache' });
  }

  const attempts: Array<[string, () => Promise<number | null>]> = [
    ['xe.com', () => fromXe(from, to)],
    ['er-api', () => fromErApi(from, to)],
    ['frankfurter', () => fromFrankfurter(from, to)],
  ];

  for (const [source, fn] of attempts) {
    let rate: number | null = null;
    try {
      rate = await fn();
    } catch {
      rate = null;
    }
    if (rate && rate > 0) {
      const out: Rate = { base: from, quote: to, rate, fetched_at: new Date().toISOString(), source };
      cache.set(key, out);
      return json(out);
    }
  }

  // Everything failed — the UI keeps a manual-entry field for exactly this case.
  return json({ error: `Could not fetch a live ${from}→${to} rate; enter it manually.` }, 502);
});
