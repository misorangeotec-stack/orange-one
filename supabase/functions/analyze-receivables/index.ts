// Receivables AI analysis — Supabase Edge Function (Deno).
//
//   Top-Exposure report → Analysis tab → "Generate AI Insights" ──▶ this fn ──▶ Claude API
//
// The browser sends a COMPACT, already-computed JSON summary of the shown Top-N accounts
// (totals, breakdowns, and the top ~50 rows with names/figures). This function does NOT read
// any database — it just asks Claude to turn that summary into a collections narrative and
// returns STRICT JSON, which the panel renders as four sections.
//
// Why server-side: the Anthropic API key must never ship in the browser bundle.
// Why verify_jwt = true: receivables figures are sensitive; only a signed-in portal user
// may call this, and the caller's JWT rides along on the invoke.
//
// Secrets/config (identity project coshondiqdhorwvibrwu — same ANTHROPIC_API_KEY as parse-resume):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref coshondiqdhorwvibrwu
// Deploy (NO --no-verify-jwt):
//   supabase functions deploy analyze-receivables --project-ref coshondiqdhorwvibrwu
//
// The model can be overridden with the ANALYSIS_MODEL secret.

import Anthropic from 'npm:@anthropic-ai/sdk';

import { corsHeaders } from '../_shared/cors.ts';

// Sonnet for judgement quality — this runs on-demand (a button click), admin-only, so volume
// is low and the better analysis is worth it. Overridable via ANALYSIS_MODEL.
const DEFAULT_MODEL = 'claude-sonnet-5';

// The payload is a compact summary (~50 rows max), so this is generous.
const MAX_BYTES = 512 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SYSTEM =
  'You are a receivables collections analyst for an Indian company. Amounts are in Indian rupees ' +
  '(₹); write large numbers the Indian way (Cr = crore = 10,000,000; L = lakh = 100,000). ' +
  'You are given a JSON summary of the TOP exposure / overdue customer accounts currently shown ' +
  'in a "call-list" report (already filtered and ranked by the user). Analyse ONLY what is in the ' +
  'JSON — never invent customers, figures, or history not present. ' +
  'Respond with STRICT JSON only — no markdown, no code fences, no commentary. Shape:\n' +
  '{"summary":string,"callList":[{"customer":string,"reason":string}],' +
  '"patterns":[string],"nextSteps":[string]}\n' +
  'Rules: "summary" = 2-4 sentence executive read of the risk (total exposure, how concentrated it ' +
  'is, how much is overdue, over-limit count). "callList" = the accounts to chase FIRST, most ' +
  'urgent first, at most 8, each "customer" being an exact name from the JSON and "reason" one ' +
  'short specific sentence citing that account\'s figures (exposure, overdue, days, utilisation). ' +
  'Prioritise by RECOVERABLE risk — big + very overdue + over limit beats big-but-current. ' +
  '"patterns" = up to 5 short observations across the set (a sale type or salesperson concentrating ' +
  'risk, clusters of over-limit or 180+ day accounts, etc.). "nextSteps" = up to 5 concrete actions ' +
  'beyond calls (credit holds, limit reviews, escalations, legal). Be specific and cite figures. ' +
  'If the JSON is empty, return empty string/arrays.';

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strArr = (v: unknown, cap: number): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()).slice(0, cap)
    : [];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const payload = body.payload;
  if (!payload || typeof payload !== 'object') return json({ error: 'No payload provided' }, 400);

  const payloadText = JSON.stringify(payload);
  if (payloadText.length > MAX_BYTES) return json({ error: 'Payload too large' }, 413);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref coshondiqdhorwvibrwu' },
      500,
    );
  }

  const model = Deno.env.get('ANALYSIS_MODEL') ?? DEFAULT_MODEL;
  const anthropic = new Anthropic({ apiKey });

  let text = '';
  try {
    const completion = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Analyse this receivables call-list and return the strict JSON per the system instructions:\n\n${payloadText}`,
        },
      ],
    });
    text = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  } catch (e) {
    return json({ error: `Model call failed: ${e instanceof Error ? e.message : 'unknown'}` }, 502);
  }

  const parsed = extractJson(text) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') {
    return json({ error: 'unreadable', message: 'The analysis came back empty. Please try again.' }, 422);
  }

  const callList = Array.isArray(parsed.callList)
    ? (parsed.callList as unknown[])
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          return { customer: str(o.customer), reason: str(o.reason) };
        })
        .filter((c) => c.customer)
        .slice(0, 8)
    : [];

  return json({
    summary: str(parsed.summary),
    callList,
    patterns: strArr(parsed.patterns, 5),
    nextSteps: strArr(parsed.nextSteps, 5),
    model,
  });
});
