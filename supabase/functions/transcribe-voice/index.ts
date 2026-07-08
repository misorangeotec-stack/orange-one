// Voice-note transcription + analysis — Supabase Edge Function (Deno).
//
//   Mobile App ──▶ this function ──▶ Deepgram (nova-3 STT) ──▶ Claude (translate + analyze)
//
// The app records a voice note (expo-audio) and sends it as base64. Deepgram
// transcribes the audio (handles Hindi / Gujarati / English code-switching);
// Claude then translates the transcript to natural English and extracts a short
// summary, a suggested interest level, and follow-up actions.
//
// Secrets (identity project coshondiqdhorwvibrwu):
//   supabase secrets set DEEPGRAM_API_KEY=... --project-ref coshondiqdhorwvibrwu
//   (ANTHROPIC_API_KEY is already set for extract-card and reused here.)
// Deploy:
//   supabase functions deploy transcribe-voice --project-ref coshondiqdhorwvibrwu --no-verify-jwt

import Anthropic from 'npm:@anthropic-ai/sdk';

import { corsHeaders } from '../_shared/cors.ts';

// Haiku 4.5: this is a small translate/summarize/classify task, so the fast model
// is plenty and cuts analysis latency a lot vs Sonnet. Override with VOICE_MODEL.
const MODEL = Deno.env.get('VOICE_MODEL') ?? 'claude-haiku-4-5-20251001';
const DG_QUERY = Deno.env.get('DEEPGRAM_QUERY') ?? 'model=nova-3&smart_format=true&punctuate=true&language=multi';
const INTEREST_OPTIONS = ['Not interested', 'Slightly interested', 'Very interested', 'Ready to buy'];

type RequestBody = { audio?: string; mime?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  return (
    tryParse(cleaned) ??
    (() => {
      const a = cleaned.indexOf('{');
      const b = cleaned.lastIndexOf('}');
      return a !== -1 && b > a ? tryParse(cleaned.slice(a, b + 1)) : null;
    })()
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: RequestBody;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!payload.audio) return json({ error: 'No audio provided' }, 400);

  const dgKey = Deno.env.get('DEEPGRAM_API_KEY');
  if (!dgKey) {
    return json({ error: 'Server is missing DEEPGRAM_API_KEY. Run: supabase secrets set DEEPGRAM_API_KEY=... --project-ref coshondiqdhorwvibrwu' }, 500);
  }
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return json({ error: 'Server is missing ANTHROPIC_API_KEY.' }, 500);

  // 1) Deepgram STT
  let rawTranscript = '';
  try {
    const audioBytes = b64ToBytes(payload.audio);
    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${DG_QUERY}`, {
      method: 'POST',
      headers: { Authorization: `Token ${dgKey}`, 'Content-Type': payload.mime || 'audio/m4a' },
      body: audioBytes,
    });
    if (!dgRes.ok) {
      const t = await dgRes.text();
      return json({ error: `Deepgram failed (${dgRes.status}): ${t.slice(0, 200)}` }, 502);
    }
    const dg = await dgRes.json();
    rawTranscript = dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  } catch (e) {
    return json({ error: `Deepgram request failed: ${e instanceof Error ? e.message : 'unknown'}` }, 502);
  }

  if (!rawTranscript.trim()) {
    return json({ transcript: '', summary: '', suggestedInterest: '', followUps: [] });
  }

  // 2) Claude translate + analyze
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const system =
    'You analyze a salesperson\'s voice note about a lead captured at a trade exhibition. ' +
    'The transcript may mix Hindi, Gujarati, and English. ' +
    'Respond with STRICT JSON only (no markdown, no code fences): ' +
    '{"transcript":string,"summary":string,"suggestedInterest":string,"followUps":string[]}. ' +
    'transcript = the note rewritten in clear, natural ENGLISH (translate anything non-English). ' +
    'summary = one concise sentence. ' +
    `suggestedInterest = the single best fit from ${JSON.stringify(INTEREST_OPTIONS)} or "" if unclear. ` +
    'followUps = short action items (e.g. "Send quote for 500 units"), or []. ' +
    'Base everything ONLY on the transcript. Never invent facts.';

  try {
    const completion = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: `Voice note transcript:\n\n${rawTranscript}` }],
    });
    const text = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const parsed = extractJson(text);
    if (!parsed) return json({ transcript: rawTranscript, summary: '', suggestedInterest: '', followUps: [] });

    const suggested = typeof parsed.suggestedInterest === 'string' && INTEREST_OPTIONS.includes(parsed.suggestedInterest)
      ? parsed.suggestedInterest
      : '';
    return json({
      transcript: typeof parsed.transcript === 'string' && parsed.transcript.trim() ? parsed.transcript.trim() : rawTranscript,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      suggestedInterest: suggested,
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : [],
    });
  } catch (e) {
    // STT worked even if analysis failed — return the raw transcript.
    return json({ transcript: rawTranscript, summary: '', suggestedInterest: '', followUps: [], warning: `Analysis failed: ${e instanceof Error ? e.message : 'unknown'}` });
  }
});
