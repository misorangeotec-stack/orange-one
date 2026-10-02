// KB-1 · Ask the HR handbook — Supabase Edge Function (Deno).
//
//   Ask HR bubble (any screen) ──▶ this fn ──▶ Claude ──▶ {answer, section ordinals}
//
// The browser sends the QUESTION and the thread so far, and nothing else. This function
// reads the handbook server-side under the CALLER'S OWN JWT, so Postgres RLS decides
// whether they may see it at all (staff yes, a customer login never). The browser never
// chooses what the model reads, and the key never leaves the server.
//
// ── Why the WHOLE handbook goes in every prompt ───────────────────────────────
// It is ~62,000 tokens (MEASURED from live usage; an early estimate of 41,000 was 50% low,
// because all-caps headings and table pipes tokenise far worse than prose) and the model
// takes 1,000,000. There is no retrieval step, no
// pgvector and no embeddings, deliberately: retrieval can only LOSE a passage here, and a
// retrieval miss is silent — nobody can tell "not in the handbook" caused by a bad
// embedding from a real one. It also breaks the cross-chapter questions people actually
// ask ("I'm resigning: my loan, my leave, my laptop?" spans four chapters).
// Full reasoning: Task Prompts/KB-1-PROMPT.md §3.
//
// ── The answer cannot fabricate a citation ────────────────────────────────────
// The model returns SECTION ORDINALS, never prose quotes. Every ordinal is checked against
// the sections actually sent; anything else is dropped. The browser then renders OUR stored
// text for those sections. So a made-up reference cannot reach a reader, and a paraphrase
// always sits beside the real words.
//
// ── No streaming, on purpose ──────────────────────────────────────────────────
// Structured output arrives as half-built JSON while streaming, so the UI would have to
// parse partial JSON to show anything, and a streaming proxy would also have to be proved
// against this runtime's cumulative CPU ceiling (~2s, and yielding does not reset it). At
// effort "low" over one document the answer takes a few seconds; a spinner costs the reader
// nothing and removes both problems.
//
// Secrets (identity project icutjkrqkbzwvmnfbzpr — the same ANTHROPIC_API_KEY the other
// seven model-calling functions already use):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref icutjkrqkbzwvmnfbzpr
// Deploy (NO --no-verify-jwt):
//   supabase functions deploy ask-handbook --project-ref icutjkrqkbzwvmnfbzpr
//
// The model can be overridden with the HANDBOOK_MODEL secret.

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ⚠ Inlined rather than imported from ../_shared/cors.ts, which is what the other seven
// functions do. This one was deployed through the Supabase MCP tool, which bundles only the
// files it is handed, so a sibling import would not resolve. Keeping the constant here means
// the file in the repo is byte-for-byte what is running, which matters more than matching the
// others' import line. Redeploying with the CLI instead? Then switch back to the shared file.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Sonnet for a known quality bar: it is what analyze-receivables already runs for judgement
// work in this portal. Overridable via HANDBOOK_MODEL without a redeploy of anything else.
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Plenty for four lines plus its citations; the handbook is the big half of the bill. */
const MAX_TOKENS = 2000;

/** How many previous turns of the conversation to carry. Keeps a follow-up working. */
const MAX_THREAD = 8;

const MAX_QUESTION = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SYSTEM_RULES = [
  'You answer questions about the HR policy manual of Orange O Tec Pvt. Ltd., an Indian company, for its own staff.',
  '',
  'THE HANDBOOK IS BELOW. It is the whole manual, section by section. Each section starts with',
  '  its number in square brackets, then its heading path. Answer ONLY from what is there.',
  '',
  'Rules:',
  '1. SHAPE OF THE ANSWER. Lead with one or two short sentences that GIVE THE ANSWER,',
  '   including the actual number, rule or deadline they asked for. Then put anything that',
  '   still needs saying as bullets, each on its own line starting with "- ", at most four,',
  '   each one short line. Do not add a closing paragraph; the last bullet ends it.',
  '   If the answer is a single fact, give one sentence and no bullets.',
  '   Keep it tight, but NEVER at the cost of the fact they came for. An answer that drops',
  '   the number to stay brief is worthless: "the entitlement is fixed" tells nobody',
  '   anything. Cut background, history and edge cases instead. Brevity is second.',
  '2. No preamble. Do not open with "Based on the handbook" or "According to". Just answer.',
  '3. Return the bracketed number of every section you used, in "sections". Use the ones you',
  '   actually relied on, most relevant first, at most four.',
  '4. If the handbook does not cover the question, set "covered" to false, return no sections,',
  '   and say plainly that it is not in the handbook. Never guess and never fill the gap from',
  '   general knowledge about Indian employment law or other companies.',
  '5. If a section you cite carries a line beginning "NOTE FROM HR:", you MUST lead your answer',
  '   with that note in your own words. Those notes mark places where the handbook contradicts',
  '   itself, and the reader is about to act on it.',
  '6. Amounts are Indian rupees. Where the handbook writes a figure as "[CONFIRM - propose X]"',
  '   that is a PROPOSAL awaiting Director sign-off, not a rule. Say so; never present it as',
  '   settled policy.',
  '7. Leave, holidays and attendance are applied for through the HR One App or by e-mail, as the',
  '   handbook says. This portal does NOT take leave, travel or reimbursement requests. Never',
  '   imply that it does, and never invent a screen or a button.',
  '8. The handbook does not hold anyone\'s personal balances, salary or records. If asked "how',
  '   many leaves do I have left", say the balance lives in the HR One App, then give the rule',
  '   from the handbook if there is one.',
  '9. ANSWER IN THE LANGUAGE THE QUESTION WAS ASKED IN. The handbook is in English, but staff',
  '   here span Gujarati, Hindi and English. A Hindi question gets a Hindi answer.',
  '10. If the question is not about HR policy or this company at all, say politely that you only',
  '    answer questions about the HR handbook, set "covered" to false and return no sections.',
  '11. NEVER use an em dash (the long dash). Not once. Use a comma, a semicolon, a full stop or',
  '    brackets, and rewrite the sentence rather than swapping in a hyphen, which reads just as',
  '    odd. This is a standing instruction from the people who own this portal: they read an em',
  '    dash as the signature of machine-written text, and it undermines the answer.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sections: { type: 'array', items: { type: 'integer' } },
    covered: { type: 'boolean' },
  },
  required: ['answer', 'sections', 'covered'],
  additionalProperties: false,
};

interface SectionRow {
  id: string;
  ordinal: number;
  anchor: string;
  path_text: string;
  plain_text: string;
  in_force_note: string | null;
}

/** The handbook as the model reads it. Ordinals, not UUIDs: 356 UUIDs cost ~3,000 tokens. */
function renderHandbook(rows: SectionRow[]): string {
  const out: string[] = ['=== HR POLICY MANUAL ==='];
  for (const r of rows) {
    out.push('');
    out.push(`[${r.ordinal}] ${r.path_text}`);
    if (r.in_force_note) out.push(`NOTE FROM HR: ${r.in_force_note}`);
    const body = r.plain_text.startsWith(r.path_text)
      ? r.plain_text.slice(r.path_text.length).trim()
      : r.plain_text;
    if (body) out.push(body);
  }
  return out.join('\n');
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  let payload: { question?: unknown; thread?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  const question = str(payload.question).slice(0, MAX_QUESTION);
  if (!question) return json({ error: 'Ask a question first.' }, 400);

  const thread = Array.isArray(payload.thread)
    ? (payload.thread as unknown[])
        .filter(
          (m): m is { role: string; content: string } =>
            !!m && typeof m === 'object' &&
            ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'assistant') &&
            typeof (m as { content?: unknown }).content === 'string'
        )
        .slice(-MAX_THREAD)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }))
    : [];

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref icutjkrqkbzwvmnfbzpr' },
      500
    );
  }

  // Anon key + the caller's own Authorization header. Everything below is read as THEM, so
  // RLS is what decides they may see the handbook — this function re-checks nothing.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  // The daily cap, BEFORE the model. Insurance against a loop in the client billing real
  // money overnight; it also refuses a customer login, which never gets this far anyway.
  const { data: allowed, error: rlErr } = await supabase.rpc('kb_rate_limit_take', { p_cap: 50 });
  if (rlErr) return json({ error: rlErr.message }, 400);
  if (allowed === false) {
    return json(
      { error: 'That is a lot of questions for one day. Try again tomorrow, or ask HR directly.' },
      429
    );
  }

  const { data: doc, error: docErr } = await supabase
    .from('kb_documents')
    .select('id, title, version')
    .eq('is_current', true)
    .maybeSingle();
  if (docErr) return json({ error: docErr.message }, 400);
  if (!doc) return json({ error: 'No handbook has been published yet.' }, 503);

  const { data: rows, error: secErr } = await supabase
    .from('kb_sections')
    .select('id, ordinal, anchor, path_text, plain_text, in_force_note')
    .eq('document_id', doc.id)
    .order('ordinal', { ascending: true });
  if (secErr) return json({ error: secErr.message }, 400);

  const sections = (rows ?? []) as SectionRow[];
  if (!sections.length) return json({ error: 'The handbook is published but empty.' }, 503);

  const byOrdinal = new Map(sections.map((s) => [s.ordinal, s]));
  const anthropic = new Anthropic({ apiKey });
  const model = Deno.env.get('HANDBOOK_MODEL') ?? DEFAULT_MODEL;

  let parsed: { answer: string; sections: number[]; covered: boolean };
  let usage: unknown = null;
  try {
    const res = await anthropic.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // Extraction-with-citation over one document, not hard reasoning. Low effort is both
      // faster and cheaper, and this is a chat box where the wait is felt.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: [
        { type: 'text', text: SYSTEM_RULES },
        {
          type: 'text',
          text: renderHandbook(sections),
          // The handbook is the same bytes on every call, so it is the cached prefix. The
          // default 5-minute TTL: follow-ups inside one conversation ride the cache nearly
          // free. No keep-alive and no 1-hour TTL — at this volume the doubled write price
          // costs more than the misses it would save.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [...thread, { role: 'user', content: question }],
    });

    usage = res.usage ?? null;

    if (res.stop_reason === 'refusal') {
      return json({ error: 'The assistant declined to answer that one. Please ask HR directly.' }, 200);
    }

    const text = res.content.find((b) => b.type === 'text');
    const raw = text && text.type === 'text' ? text.text : '';
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `The assistant could not answer just now. ${msg}` }, 502);
  }

  // 🔴 Every returned ordinal is checked against what was actually sent. An ordinal we did
  // not send is dropped silently: a fabricated citation must not reach a reader.
  const cited = Array.isArray(parsed.sections)
    ? parsed.sections
        .map((n) => byOrdinal.get(Number(n)))
        .filter((s): s is SectionRow => !!s)
        .slice(0, 4)
    : [];

  const answer = str(parsed.answer);
  const covered = parsed.covered === true && cited.length > 0;

  // Logged WITHOUT a name. kb_log_question never stamps asked_by; only the reader pressing
  // "Send this question to HR" does, which is them choosing to be identified.
  const { data: token, error: logErr } = await supabase.rpc('kb_log_question', {
    p_question: question,
    p_answer: answer,
    p_section_ids: cited.map((s) => s.id),
    p_covered: covered,
    p_model: model,
    p_usage: usage as never,
    p_document_id: doc.id,
  });
  if (logErr) console.error('kb_log_question failed:', logErr.message);

  return json({
    answer,
    covered,
    token: token ?? null,
    sections: cited.map((s) => ({
      id: s.id,
      anchor: s.anchor,
      pathText: s.path_text,
      note: s.in_force_note,
    })),
  });
});
