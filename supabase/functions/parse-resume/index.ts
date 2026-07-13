// Resume/CV parsing — Supabase Edge Function (Deno).
//
//   HR Recruitment (Add candidates) ──▶ this Edge Function ──▶ Claude API
//
// HR drops 20–50 CVs into the Add-candidates modal. This function reads ONE file
// and returns the candidate's details as STRICT JSON, which the browser uses to
// PREFILL the editable review row. It never writes to the database — a human
// always confirms before anything is saved.
//
// Why server-side: the Anthropic API key must never ship in the browser bundle.
//
// Why verify_jwt = true (unlike extract-card): resumes are PII. Only a signed-in
// portal user may call this, and the caller's JWT rides along on the invoke.
//
// Secrets/config (already set on the identity project coshondiqdhorwvibrwu —
// extract-card uses the same key):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref coshondiqdhorwvibrwu
// Deploy (NO --no-verify-jwt):
//   supabase functions deploy parse-resume --project-ref coshondiqdhorwvibrwu
//
// The models can be overridden with the RESUME_MODEL / RESUME_FALLBACK_MODEL secrets.

import Anthropic from 'npm:@anthropic-ai/sdk';

import { corsHeaders } from '../_shared/cors.ts';

// Haiku 4.5 reads a typical CV (text PDF or clean scan) well and is far cheaper than
// Sonnet — this runs once per CV in batches of 50. Sonnet is the fallback for the
// messy ones (dense two-column layouts, photographed pages).
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// A CV is a few pages. 10 MB decoded is generous; beyond that it's a scan dump and
// the request would just burn the model's time (and the Anthropic 32 MB request cap).
const MAX_BYTES = 10 * 1024 * 1024;

type InboundFile = { media_type?: string; data?: string; name?: string };
type RequestBody = { file?: InboundFile };

const IMAGE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const SYSTEM =
  'You are a data-extraction engine for recruitment. You are given ONE candidate resume/CV ' +
  '(a PDF, a scanned image of one, or plain text). Read it and return the candidate\'s details. ' +
  'Respond with STRICT JSON only — no markdown, no code fences, no commentary. Shape:\n' +
  '{"name":string,"phone":string,"email":string,"current_company":string,' +
  '"experience_years":number|null,"skills":string[]}\n' +
  'Rules: "name" is the CANDIDATE\'s full name (usually the heading) — never a referee, ' +
  'a manager, or a company name. "phone" and "email" are the candidate\'s own contact details; ' +
  'keep the phone number as printed (with country code if shown). ' +
  '"current_company" is the employer of the MOST RECENT role — if the CV says the candidate is ' +
  'between jobs or it is a fresher CV, use "". ' +
  '"experience_years" is total professional experience in years as a number (decimals allowed, ' +
  'e.g. 4.5). If the CV states it, use that. Otherwise compute it from the work history if the ' +
  'dates make it unambiguous; if you cannot tell, use null. NEVER guess. ' +
  '"skills" is the technical/professional skills the CV actually lists — at most 20, each a short ' +
  'phrase. Do not invent skills the CV does not name. ' +
  'If a value is not present, use an empty string, null, or an empty array. NEVER invent data. ' +
  'If the document is unreadable or is not a resume at all, return every field empty.';

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

  const file = payload.file;
  if (!file?.data) return json({ error: 'No file data provided' }, 400);

  const mediaType = (file.media_type ?? '').toLowerCase();

  // Word documents are the common case here and Claude cannot read them as a
  // content block. 415 is the client's cue to say "type the details in yourself" —
  // the row and the file upload are unaffected.
  const isPdf = mediaType === 'application/pdf';
  const isImage = IMAGE_MEDIA.has(mediaType);
  const isText = mediaType === 'text/plain';
  if (!isPdf && !isImage && !isText) {
    return json(
      {
        error: 'unsupported_type',
        message: 'This file type cannot be read automatically. Please type the details in.',
      },
      415
    );
  }

  // base64 is ~4 chars per 3 bytes; check before we decode anything big.
  const approxBytes = Math.floor((file.data.length * 3) / 4);
  if (approxBytes > MAX_BYTES) {
    return json(
      {
        error: 'too_large',
        message: 'This file is too big to read automatically (over 10 MB). Please type the details in.',
      },
      413
    );
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref coshondiqdhorwvibrwu' },
      500
    );
  }

  // Primary = cheap/fast Haiku; fallback = Sonnet, used ONLY when Haiku comes back
  // empty (a hard-to-read scan). Both overridable via secrets.
  const PRIMARY_MODEL = Deno.env.get('RESUME_MODEL') ?? DEFAULT_MODEL;
  const FALLBACK_MODEL = Deno.env.get('RESUME_FALLBACK_MODEL') ?? 'claude-sonnet-5';
  const anthropic = new Anthropic({ apiKey });

  // Build the document/image/text block. A PDF goes in as a `document` block, which
  // lets the model read BOTH the text layer and the page images — so a scanned PDF
  // is handled by the same call as a clean one.
  let source: Anthropic.MessageParam['content'];
  if (isPdf) {
    source = [
      {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file.data },
      },
    ];
  } else if (isImage) {
    source = [
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data: file.data },
      },
    ];
  } else {
    let decoded = '';
    try {
      decoded = new TextDecoder().decode(
        Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
      );
    } catch {
      return json({ error: 'Could not decode the text file.' }, 400);
    }
    // A text CV that long is not a CV; the tail adds nothing but tokens.
    source = [{ type: 'text' as const, text: decoded.slice(0, 200_000) }];
  }

  const content: Anthropic.MessageParam['content'] = [
    ...(source as Anthropic.ContentBlockParam[]),
    {
      type: 'text' as const,
      text: 'Extract this candidate\'s details as strict JSON per the system instructions.',
    },
  ];

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()).slice(0, 20)
      : [];
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v.trim());
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  type Parsed = {
    name: string;
    phone: string;
    email: string;
    current_company: string;
    experience_years: number | null;
    skills: string[];
  };

  function normalize(parsed: unknown): Parsed | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const years = num(o.experience_years);
    return {
      name: str(o.name),
      phone: str(o.phone),
      email: str(o.email),
      current_company: str(o.current_company),
      // A negative or absurd figure is a misread, not data.
      experience_years: years !== null && years >= 0 && years <= 60 ? years : null,
      skills: strArr(o.skills),
    };
  }

  // "Weak" = nothing usable to prefill with — worth one Sonnet retry.
  const isWeak = (p: Parsed | null) =>
    !p || (!p.name && !p.phone && !p.email && !p.current_company && !p.skills.length);

  // One model call → normalized result, or null on API/parse failure (never throws).
  async function tryModel(model: string): Promise<Parsed | null> {
    try {
      const completion = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      });
      const text = completion.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return normalize(extractJson(text));
    } catch {
      return null;
    }
  }

  let result = await tryModel(PRIMARY_MODEL);
  let modelUsed = PRIMARY_MODEL;
  if (isWeak(result) && FALLBACK_MODEL !== PRIMARY_MODEL) {
    const fb = await tryModel(FALLBACK_MODEL);
    if (fb && !isWeak(fb)) {
      result = fb;
      modelUsed = FALLBACK_MODEL;
    }
  }

  if (isWeak(result)) {
    return json(
      {
        error: 'unreadable',
        message: 'Could not read this CV. Please type the details in.',
      },
      422
    );
  }

  return json({ ...(result as Parsed), model: modelUsed });
});
