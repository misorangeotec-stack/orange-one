// Business-card extraction — Supabase Edge Function (Deno).
//
//   Mobile App ──▶ this Edge Function ──▶ Claude API (vision, Anthropic SDK)
//
// The app captures a business-card photo (front, optional back), sends the
// image(s) as base64, and this function asks Claude to READ the card and return
// STRICT JSON of the person + company fields. The app fills the Upload Contact
// form with that real data.
//
// Why server-side: the Anthropic API key must never ship in the app bundle.
//
// Secrets/config (set once with the Supabase CLI, on the identity project
// coshondiqdhorwvibrwu):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref coshondiqdhorwvibrwu
// Deploy:
//   supabase functions deploy extract-card --project-ref coshondiqdhorwvibrwu --no-verify-jwt
//
// The model can be overridden with the CARD_MODEL secret if the default id changes.

import Anthropic from 'npm:@anthropic-ai/sdk';

import { corsHeaders } from '../_shared/cors.ts';

// Haiku 4.5 reads printed business cards well and is ~3x cheaper than Sonnet for
// vision — the biggest per-contact cost. Override with the CARD_MODEL secret to
// escalate to Sonnet if card OCR accuracy ever needs it.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

type InboundImage = { media_type?: string; data?: string };
type RequestBody = { images?: InboundImage[] };

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SYSTEM =
  'You are an OCR + data-extraction engine for business cards at a trade exhibition. ' +
  'You are given one or two images of a single business card (front and optionally back). ' +
  'A card may list MULTIPLE people — capture EVERY person printed on it as a separate entry. ' +
  'Read ALL text and return the contact details. ' +
  'Respond with STRICT JSON only — no markdown, no code fences, no commentary. Shape:\n' +
  '{"people":[{"name":string,"jobTitles":string[],"mobiles":string[],"emails":string[]}],' +
  '"company":{"name":string,"mobiles":string[],"emails":string[],"websites":string[],"addresses":string[]}}\n' +
  'Rules: List the most prominent / first-printed person first. ' +
  'Capture EVERY phone number and email you can read — never drop extras (a card often has 2-3 numbers). ' +
  'Put a phone/email under the person it clearly belongs to; shared or organisation-level ones go under company. ' +
  'Keep phone numbers as printed (with country code if shown). Combine multi-line addresses into one string. ' +
  'If a value is not present, use an empty string or empty array. NEVER invent data. ' +
  'CRITICAL: whenever ANY name is visible on the card you MUST return at least that person — ' +
  'never return an empty "people" array when a name is present, even if there are two or more names. ' +
  'Only return an empty "people" array if the image genuinely has no person name at all. ' +
  'If the image is not a business card or is unreadable, return {"people":[],"company":{ ...empty... }}.';

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to salvage the first {...} block.
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: RequestBody;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const images = (payload.images ?? [])
    .filter((im): im is Required<InboundImage> => !!im?.data)
    .slice(0, 2)
    .map((im) => ({
      media_type: ALLOWED_MEDIA.has(im.media_type ?? '') ? (im.media_type as string) : 'image/jpeg',
      data: im.data,
    }));

  if (images.length === 0) return json({ error: 'No image data provided' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref coshondiqdhorwvibrwu' },
      500
    );
  }

  // Primary = cheap/fast Haiku; fallback = Sonnet, used ONLY when Haiku returns an
  // empty/weak read (messy or hard-to-read card). Both overridable via secrets.
  const PRIMARY_MODEL = Deno.env.get('CARD_MODEL') ?? DEFAULT_MODEL;
  const FALLBACK_MODEL = Deno.env.get('CARD_FALLBACK_MODEL') ?? 'claude-sonnet-5';
  const anthropic = new Anthropic({ apiKey });

  const content: Anthropic.MessageParam['content'] = [
    ...images.map((im) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: im.media_type as 'image/jpeg', data: im.data },
    })),
    {
      type: 'text' as const,
      text: 'Extract the business card details as strict JSON per the system instructions.',
    },
  ];

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  type Person = { name: string; jobTitles: string[]; mobiles: string[]; emails: string[] };
  type Card = {
    people: Person[];
    company: { name: string; mobiles: string[]; emails: string[]; websites: string[]; addresses: string[] };
  };

  const normPerson = (p: Record<string, unknown>): Person => ({
    name: str(p.name),
    jobTitles: strArr(p.jobTitles),
    mobiles: strArr(p.mobiles),
    emails: strArr(p.emails),
  });
  const personEmpty = (p: Person) => !p.name && !p.jobTitles.length && !p.mobiles.length && !p.emails.length;

  function normalize(parsed: unknown): Card | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const company = (obj.company ?? {}) as Record<string, unknown>;
    // Accept the new people[] shape, or a legacy single `person` for safety.
    let peopleRaw: unknown[] = [];
    if (Array.isArray(obj.people)) peopleRaw = obj.people;
    else if (obj.person && typeof obj.person === 'object') peopleRaw = [obj.person];
    const people = peopleRaw
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map(normPerson)
      .filter((p) => !personEmpty(p));
    return {
      people,
      company: { name: str(company.name), mobiles: strArr(company.mobiles), emails: strArr(company.emails), websites: strArr(company.websites), addresses: strArr(company.addresses) },
    };
  }

  // "Weak" = no usable identity at all (no person found, and no company name).
  const isWeak = (c: Card | null) => !c || (c.people.length === 0 && !c.company.name);

  // One model call → normalized card, or null on API/parse failure (never throws).
  async function tryModel(model: string): Promise<Card | null> {
    try {
      const completion = await anthropic.messages.create({ model, max_tokens: 1024, system: SYSTEM, messages: [{ role: 'user', content }] });
      const text = completion.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
      return normalize(extractJson(text));
    } catch {
      return null;
    }
  }

  let result = await tryModel(PRIMARY_MODEL);
  let modelUsed = PRIMARY_MODEL;
  if (isWeak(result) && FALLBACK_MODEL !== PRIMARY_MODEL) {
    const fb = await tryModel(FALLBACK_MODEL);
    if (fb && (!isWeak(fb) || !result)) {
      result = fb;
      modelUsed = FALLBACK_MODEL;
    }
  }

  if (!result) return json({ error: 'Could not parse card. Please fill the details manually.' }, 422);
  // Return `people` (new, all contacts) AND a legacy `person` (= the primary) so
  // older app builds that read `body.person` keep working after this deploys.
  const primary = result.people[0] ?? { name: '', jobTitles: [], mobiles: [], emails: [] };
  return json({ people: result.people, person: primary, company: result.company, model: modelUsed });
});
