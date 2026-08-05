// Job-description parsing — Supabase Edge Function (Deno).
//
//   HR Recruitment (Raise a Requisition, step 1) ──▶ this Edge Function ──▶ Claude API
//
// A HOD attaches the JD they already have; this reads it and returns the fields
// as STRICT JSON so the browser can PREFILL the form. It never writes to the
// database — the HOD reviews every field and submits, exactly as they would if
// they had typed it. Same governing principle as `parse-resume`.
//
// Why server-side: the Anthropic API key must never ship in the browser bundle.
//
// Why verify_jwt = true: a JD carries salary bands and headcount. Only a
// signed-in portal user may call this, and the caller's JWT rides along.
//
// ── THE MASTERS TRAVEL WITH THE REQUEST ──────────────────────────────────────
// The client sends its live master lists (job titles, skills, qualifications,
// employment types, locations, departments), and those lists become ENUMS in the
// response schema — a strong steer, though NOT a guarantee: see the note above
// pick()/pickAll(), which re-check the answer against the lists we sent.
//
// Anything the JD mentions that ISN'T in a master goes to the `other_*` fields
// instead of being silently dropped. The form shows those as a note so the HOD
// can request the missing master entry rather than losing the requirement.
//
// ── EVERY SCALAR IS A STRING ─────────────────────────────────────────────────
// Years, salary figures and booleans all come back as strings, with "" meaning
// "not stated". That matches how the MRF payload already talks to the RPCs ("" reads
// as NULL server-side) and keeps the JSON Schema to the subset structured outputs
// supports — no nullable unions, nothing to negotiate.
//
// Secrets/config (identity project icutjkrqkbzwvmnfbzpr — the same key
// parse-resume and extract-card already use):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref icutjkrqkbzwvmnfbzpr
// Deploy (NO --no-verify-jwt):
//   supabase functions deploy parse-jd --project-ref icutjkrqkbzwvmnfbzpr
//
// The model can be overridden with the JD_MODEL secret.

import Anthropic from 'npm:@anthropic-ai/sdk';
import JSZip from 'npm:jszip@3';

import { corsHeaders } from '../_shared/cors.ts';

// A JD is read once per requisition — a few times a year per department — and the
// task is harder than it looks: it has to map loose prose ("must know Kyocera
// heads") onto an exact master entry. That is worth the best model; the volume is
// nothing.
//
// EFFORT: 'low' was tried first, to keep the wait short, and it is not reliable
// enough here. Three runs of one identical JD returned: everything correct; then
// placeholder junk ("..." for the summary); then eleven essential skills collapsed
// into one. Matching loose prose against a 113-entry skill list is a reasoning
// task wearing an extraction task's clothes, and low effort does not give it room.
// Medium costs ~10 seconds more and the form now shows progress while it runs —
// a wrong answer in 17 seconds is worse than a right one in 30.
const DEFAULT_MODEL = 'claude-opus-5';
const EFFORT = 'medium';

// Thinking and the response share max_tokens on this model, and a truncated
// structured output is unparseable rather than partial — so this is generous on
// purpose. It costs nothing when unused.
const MAX_TOKENS = 32000;

// A JD is a page or three. Beyond this it's a scan dump or the wrong file.
const MAX_BYTES = 10 * 1024 * 1024;

// ── HOW LONG THIS IS ALLOWED TO TAKE ────────────────────────────────────────
// The SDK's defaults are a 10-minute timeout and TWO retries, which is right for
// a batch job and wrong for someone watching a spinner: one transient upstream
// blip became a 74-second wait that ended in a 502 (production, 2026-08-04, on a
// file that reads fine). A capped single attempt fails honestly instead — the
// form says "that didn't work, fill it in below", which beats an open-ended wait
// for an answer that is not coming.
const ATTEMPT_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 0;

const IMAGE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOCX_MEDIA = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type InboundFile = { media_type?: string; data?: string; name?: string };

/** The live master lists. Each becomes an enum in the response schema. */
type Masters = {
  job_titles?: string[];
  departments?: string[];
  employment_types?: string[];
  locations?: string[];
  skills?: string[];
  qualifications?: string[];
};

type RequestBody = { file?: InboundFile; masters?: Masters };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * .docx text extraction.
 *
 * Claude reads PDFs and images natively but not Word files, and in an Indian
 * office the JD is very often a .docx — so without this the auto-fill would
 * silently fail for the most common format we get handed.
 *
 * A .docx is a zip of XML. `word/document.xml` holds the body; paragraph and
 * break tags become newlines BEFORE the remaining tags are stripped, otherwise
 * every bullet would run into the next one and the responsibilities list would
 * come back as a single sentence.
 */
async function docxToText(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const zip = await JSZip.loadAsync(bytes);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('not a word document');
  const xml: string = await doc.async('string');

  return (
    xml
      // Structure first — these are the only tags whose position carries meaning.
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      // Then everything else.
      .replace(/<[^>]+>/g, '')
      // XML entities, numeric ones included. `&amp;` LAST so "&amp;lt;" doesn't
      // become "<".
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** The model answered, but there is nothing usable in it — a 422, not a 502. */
class Unreadable extends Error {}

/**
 * One completion → the JSON object it carries.
 *
 * The refusal check comes first: safety classifiers can decline on this model and
 * that arrives as an ordinary 200 with empty or partial content, so indexing
 * content[0] would throw before we ever noticed why.
 */
function readJson(msg: Anthropic.Message): Record<string, unknown> {
  if (msg.stop_reason === 'refusal') throw new Unreadable('refused');

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // output_config.format is meant to guarantee schema-valid JSON, so a parse
  // failure means something upstream went wrong rather than the model improvising.
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Unreadable('not json');
  }
}

/** A string field constrained to a master list. "" is the no-match answer. */
const oneOf = (options: string[]) => ({ type: 'string', enum: ['', ...options] });

/**
 * ── THE SCHEMA IS A STRONG HINT, NOT A GUARANTEE ────────────────────────────
 * The enums were treated as load-bearing here — "a skill that isn't in the master
 * is impossible by construction". A live run disproved it: with 113 values in the
 * skills enum, the response came back with "Tally Certification" when the master
 * says "Tally certification". Close enough to look right, wrong enough to resolve
 * to no id at all, and the requirement would have vanished silently.
 *
 * So every enumerated field is re-checked against the list we actually sent.
 * Matching is case- and space-insensitive, which is what would have saved that
 * value; anything with no match is handed back as text (`spill`) so it lands in
 * other_skills / other_qualifications instead of disappearing.
 */
const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** One value → its canonical master spelling, or "" if the list has no match. */
function pick(value: unknown, options: string[]): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const key = canon(value);
  return options.find((o) => canon(o) === key) ?? '';
}

/** A list → the values that exist in the master, plus the ones that don't. */
function pickAll(values: unknown, options: string[]): { kept: string[]; spill: string[] } {
  const kept: string[] = [];
  const spill: string[] = [];
  if (Array.isArray(values)) {
    for (const v of values) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const hit = pick(v, options);
      if (hit) {
        if (!kept.includes(hit)) kept.push(hit);
      } else if (!spill.includes(v.trim())) {
        spill.push(v.trim());
      }
    }
  }
  return { kept, spill };
}

/** Free-text list, de-duplicated — used for the other_* fields. */
const textList = (values: unknown): string[] =>
  Array.isArray(values)
    ? [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()))]
    : [];

/**
 * ⚠ The wording here is load-bearing, and an earlier draft got it wrong.
 *
 * That draft led with "an absent value is an empty array — that is a correct
 * answer, not a failure", meant as a guard against invention. On a literal
 * instruction-follower it read as permission: the first live run returned every
 * scalar correctly and EVERY array empty, from a JD that plainly listed four
 * duties and eight skills. Blessing the empty answer made the empty answer the
 * safe one.
 *
 * So the extraction clauses are affirmative ("EVERY duty the JD states"), the
 * accuracy clause is scoped to invention rather than to omission, and the
 * matching clause tells it to prefer a sensible conceptual match over no match.
 */
const SYSTEM =
  'You are a data-extraction engine for an HR recruitment system at Orange O Tec, ' +
  'a manufacturer and distributor of industrial digital textile printing machinery. ' +
  'You are given ONE job description (a PDF, a scan of one, or plain text) and you ' +
  'return the fields a manpower requisition needs.\n\n' +
  'WHAT TO EXTRACT\n' +
  '- responsibilities: EVERY duty, task or responsibility the JD states — one short ' +
  'line each, in the JD\'s order, imperative voice, no bullet characters and no ' +
  'numbering. Do not merge two duties into one line or split one across two. A JD ' +
  'that lists duties must never come back with an empty list.\n' +
  '- must_have_skills and good_to_have_skills: EVERY skill, tool, software, ' +
  'language and certification the JD names. must_have is what it calls essential / ' +
  'required / must-have; good_to_have is what it calls preferred / desirable / ' +
  'added advantage / nice-to-have. If the JD does not separate them, everything is ' +
  'must-have. A skill belongs in one list, not both. A JD with an essential-skills ' +
  'section must never come back with an empty must_have_skills list.\n' +
  '- qualifications: every educational requirement the JD names.\n' +
  '- role_summary: two or three sentences on the purpose of the role and the impact ' +
  'expected. Write one from the JD\'s content if it has no summary section. Never a ' +
  'placeholder — "..." is not a summary.\n' +
  '- incentives: any allowance, commission, bonus or incentive mentioned alongside ' +
  'the salary.\n' +
  '- Numbers are digits only, as strings: "2", "5", "25000". Convert Indian ' +
  'shorthand — "25k" is "25000"; "6 LPA" is "600000" with salary_period "annum". A ' +
  'single stated figure goes in salary_min AND salary_max. "Fresher", "0-2 years" ' +
  'or "no experience required" means freshers_ok "yes".\n' +
  '- job_title_text is the title as PRINTED on the JD, always — even when job_title ' +
  'matched one of the listed values.\n\n' +
  'MATCHING THE ENUMERATED FIELDS\n' +
  'Several fields accept only the values listed in the schema. Copy the value you ' +
  'choose EXACTLY as the list spells it, character for character. Match by MEANING, ' +
  'not by wording, and prefer a sensible conceptual match over no match: "Kyocera ' +
  'printhead servicing" is the Kyocera printhead handling entry; "ready to travel ' +
  'across India" is the pan-India travel entry; "Diploma in Electronics & ' +
  'Communication" is the Diploma - Electronics & Communication entry. Work through ' +
  'the JD\'s skill lines one at a time and place each one before moving on. Only when ' +
  'nothing in the list is about the same thing, leave it out and put the JD\'s own ' +
  'wording in the matching other_* field (other_skills, other_qualifications) so ' +
  'the requirement is not lost.\n\n' +
  'ACCURACY\n' +
  'Extract what the document says. Do not invent a requirement, a salary, a ' +
  'headcount or a skill it does not state. Leave a field empty only when the JD ' +
  'genuinely does not address it.';

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

  const m = payload.masters ?? {};
  const mediaType = (file.media_type ?? '').toLowerCase();
  const name = (file.name ?? '').toLowerCase();

  // .docx often arrives with a blank or wrong media_type from the browser, so the
  // extension is the tiebreaker.
  const isPdf = mediaType === 'application/pdf';
  const isImage = IMAGE_MEDIA.has(mediaType);
  const isText = mediaType === 'text/plain' || mediaType === 'text/markdown';
  const isDocx = mediaType === DOCX_MEDIA || name.endsWith('.docx');

  if (!isPdf && !isImage && !isText && !isDocx) {
    // Legacy .doc is a binary format from 1997 — there is no honest way to read it
    // here. The file still uploads and attaches; only the auto-fill is skipped.
    return json(
      {
        error: 'unsupported_type',
        message: name.endsWith('.doc')
          ? "Old .doc files can't be read automatically. Save it as .docx or PDF, or fill the form in below."
          : "This file type can't be read automatically. Fill the form in below.",
      },
      415,
    );
  }

  const approxBytes = Math.floor((file.data.length * 3) / 4);
  if (approxBytes > MAX_BYTES) {
    return json(
      { error: 'too_large', message: 'This file is too big to read automatically (over 10 MB).' },
      413,
    );
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref icutjkrqkbzwvmnfbzpr' },
      500,
    );
  }

  // Build the document block. A PDF goes in whole so the model reads both the text
  // layer and the page images — a scanned JD needs no separate path.
  let source: Anthropic.ContentBlockParam[];
  if (isPdf) {
    source = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } },
    ];
  } else if (isImage) {
    source = [
      { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: file.data } },
    ];
  } else {
    let decoded = '';
    try {
      decoded = isDocx
        ? await docxToText(file.data)
        : new TextDecoder().decode(Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0)));
    } catch {
      return json(
        { error: 'unreadable', message: "Couldn't read that file. Fill the form in below." },
        422,
      );
    }
    if (!decoded.trim()) {
      return json(
        { error: 'unreadable', message: 'That file has no readable text in it. Fill the form in below.' },
        422,
      );
    }
    source = [{ type: 'text', text: decoded.slice(0, 200_000) }];
  }

  // The response schema. Every master list the client sent becomes an enum — a
  // strong steer for the model, re-checked below because it is not a guarantee.
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: [
      'job_title', 'job_title_text', 'department', 'employment_type', 'location',
      'role_summary', 'responsibilities',
      'experience_min_years', 'experience_max_years', 'freshers_ok',
      'qualifications', 'must_have_skills', 'good_to_have_skills',
      'salary_min', 'salary_max', 'salary_period', 'incentives',
      'other_skills', 'other_qualifications',
    ],
    properties: {
      job_title: oneOf(m.job_titles ?? []),
      job_title_text: { type: 'string' },
      department: oneOf(m.departments ?? []),
      employment_type: oneOf(m.employment_types ?? []),
      location: oneOf(m.locations ?? []),

      role_summary: { type: 'string' },
      responsibilities: { type: 'array', items: { type: 'string' } },

      experience_min_years: { type: 'string' },
      experience_max_years: { type: 'string' },
      freshers_ok: { type: 'string', enum: ['yes', 'no', ''] },

      qualifications: { type: 'array', items: { type: 'string', enum: m.qualifications ?? [] } },
      must_have_skills: { type: 'array', items: { type: 'string', enum: m.skills ?? [] } },
      good_to_have_skills: { type: 'array', items: { type: 'string', enum: m.skills ?? [] } },

      salary_min: { type: 'string' },
      salary_max: { type: 'string' },
      salary_period: { type: 'string', enum: ['month', 'annum', ''] },
      incentives: { type: 'string' },

      // What the JD asked for that no master covers. Surfaced to the HOD rather
      // than dropped, so a genuinely new requirement becomes a master request
      // instead of vanishing.
      other_skills: { type: 'array', items: { type: 'string' } },
      other_qualifications: { type: 'array', items: { type: 'string' } },
    },
  };

  const anthropic = new Anthropic({ apiKey, timeout: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES });
  const model = Deno.env.get('JD_MODEL') ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const ASK =
    'Extract this job description per the system instructions. Work through it ' +
    'section by section so no listed duty, skill or qualification is left out.';

  // STREAMED, and not optionally: the SDK refuses a non-streaming request whose
  // max_tokens it estimates could outlive the 10-minute HTTP timeout, so the
  // budget this needs and `messages.create` are mutually exclusive. Nothing here
  // consumes the events — `finalMessage()` just waits for the assembled message.
  const attempt = (ask: string) =>
    anthropic.messages
      .stream({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: [...source, { type: 'text', text: ask }] }],
      } as never)
      .finalMessage();

  /**
   * ── THE HOLLOW ANSWER ───────────────────────────────────────────────────────
   * The real failure in production was not an error. It was a 200 in 4.9 seconds
   * carrying a valid, schema-shaped, EMPTY object: the experience band read
   * correctly off the JD, and no summary, no duties, no skills. The form dutifully
   * announced "filled in from the JD" over three fields.
   *
   * It is not deterministic — the same file and the same masters extracted
   * perfectly three times in a row minutes earlier — so effort alone cannot fix
   * it; 'low' made it frequent and 'medium' made it rarer. What DOES fix it is
   * noticing: a JD whose text we read but whose duties and summary both came back
   * empty has not been extracted, whatever the schema says. So we look, and ask
   * again once, telling the model what went wrong.
   */
  const hollow = (p: Record<string, unknown>): boolean =>
    !(typeof p.role_summary === 'string' && p.role_summary.trim()) ||
    !(Array.isArray(p.responsibilities) && p.responsibilities.length > 0);

  const RETRY_ASK =
    ASK +
    '\n\nIMPORTANT: a previous attempt on this exact document returned an empty ' +
    'answer — no role summary and no responsibilities — which is wrong. The ' +
    'document above does contain them. Read it line by line and fill every field ' +
    'the schema asks for.';

  let completion: Anthropic.Message;
  let parsed: Record<string, unknown>;
  let attempts = 0;
  try {
    attempts = 1;
    completion = await attempt(ASK);
    parsed = readJson(completion);

    if (hollow(parsed)) {
      console.warn(
        `parse-jd: hollow answer on attempt 1 after ${Date.now() - startedAt}ms ` +
          `(out=${completion.usage?.output_tokens}, stop=${completion.stop_reason}) — retrying`,
      );
      attempts = 2;
      completion = await attempt(RETRY_ASK);
      parsed = readJson(completion);
    }
  } catch (e) {
    // Logged, not just returned: the browser turns a non-2xx into an opaque
    // "didn't work", so without this line a failure leaves no trace anywhere and
    // the next one has to be re-diagnosed from scratch. The request id is what
    // Anthropic support can look up.
    if (e instanceof Unreadable) {
      console.error(`parse-jd unreadable after ${Date.now() - startedAt}ms — ${e.message}`);
      return json(
        { error: 'unreadable', message: "Couldn't read this JD automatically. Fill the form in below." },
        422,
      );
    }
    const err = e as { status?: number; name?: string; message?: string; request_id?: string };
    console.error(
      `parse-jd failed after ${Date.now() - startedAt}ms — ${err?.name ?? 'Error'}` +
        `${err?.status ? ` (HTTP ${err.status})` : ''}` +
        `${err?.request_id ? ` [request ${err.request_id}]` : ''}: ${err?.message ?? 'no message'}`,
    );
    return json(
      {
        error: 'error',
        message: err?.message ?? "Couldn't read this JD automatically.",
        status: err?.status,
        request_id: err?.request_id,
        attempts,
        elapsed_ms: Date.now() - startedAt,
      },
      502,
    );
  }

  // Re-check everything the schema was trusted to constrain. A near-miss spelling
  // is corrected; a genuine non-match becomes an other_* entry the HOD can see.
  const must = pickAll(parsed.must_have_skills, m.skills ?? []);
  const good = pickAll(parsed.good_to_have_skills, m.skills ?? []);
  const quals = pickAll(parsed.qualifications, m.qualifications ?? []);

  const checked = {
    ...parsed,
    job_title: pick(parsed.job_title, m.job_titles ?? []),
    department: pick(parsed.department, m.departments ?? []),
    employment_type: pick(parsed.employment_type, m.employment_types ?? []),
    location: pick(parsed.location, m.locations ?? []),
    qualifications: quals.kept,
    must_have_skills: must.kept,
    // A skill claimed as both essential and preferred is essential — one meaning
    // per skill, so the two chip rows can never contradict each other.
    good_to_have_skills: good.kept.filter((s) => !must.kept.includes(s)),
    other_skills: [...new Set([...textList(parsed.other_skills), ...must.spill, ...good.spill])],
    other_qualifications: [...new Set([...textList(parsed.other_qualifications), ...quals.spill])],
  };

  // `thin` rides along so the form can be honest: a JD that yielded a summary and
  // duties gets "filled in from the JD"; one that didn't should not claim it did.
  return json({
    ...checked,
    model,
    attempts,
    thin: hollow(checked),
    stop_reason: completion.stop_reason,
    usage: completion.usage,
    elapsed_ms: Date.now() - startedAt,
  });
});
