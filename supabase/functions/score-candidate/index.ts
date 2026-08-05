// ===========================================================================
// score-candidate — read ONE CV against ONE vacancy's job description and
// return an advisory fit score out of 10, with five parameters showing where
// the number came from.
//
// Why server-side: the Anthropic API key must never ship in the browser bundle.
// verify_jwt = true: a CV is PII and this answer paraphrases one.
//
// ── THIS FUNCTION HOLDS NO SERVICE-ROLE KEY, ON PURPOSE ────────────────────
// The body is `{ candidate_id }` and nothing else. Every read — the candidate,
// the requisition, the CV file — goes through a Supabase client built from the
// CALLER'S OWN Authorization header, so Postgres RLS decides what it may see.
// The authorisation rule is never restated in TypeScript and so cannot drift,
// and a bug in here cannot reach anything the caller could not already open in
// the CV tab of the candidate page. (Pattern: admin-users/index.ts.)
//
//   fms_hr_candidates read  = fms_hr_can_read_requisition(...)   -- 20260712140000
//   fms-hr-docs      read   = is_coordinator OR is_any_step_owner -- 20260712120000
//
// Those two are ANDed here because both must pass. That is strictly tighter
// than either alone, and deliberately tighter than fms_hr_may_touch_candidate,
// which admits every `mrf` step owner — i.e. every department HOD. See
// 20260712180000_fms_hr_restrict_candidate_pii.sql: "A Sales HOD could read the
// Purchase team's applicants."
//
// It also NEVER WRITES. The browser posts the returned score through
// fms_hr_save_candidate_score, exactly as every other AI function in this
// project leaves the write to a human-triggered RPC.
//
// Deploy:
//   supabase functions deploy score-candidate --project-ref icutjkrqkbzwvmnfbzpr
//   (ANTHROPIC_API_KEY is already set on this project — parse-jd and
//    parse-resume run on it. Optional: SCORE_MODEL to override the model.)
// ===========================================================================

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3';
import { corsHeaders } from '../_shared/cors.ts';

// ── MODEL ───────────────────────────────────────────────────────────────────
// Sonnet 5, not Opus. parse-jd uses Opus because a JD is parsed once per
// vacancy; a CV is scored once per PERSON, fifteen-plus per column. Reading a
// CV against a fixed rubric is squarely Sonnet work and several times cheaper
// at exactly the volume this feature creates. SCORE_MODEL raises it without a
// redeploy if the judgement ever proves too thin.
const DEFAULT_MODEL = 'claude-sonnet-5';
const EFFORT = 'medium';

// Thinking and the response share max_tokens on this model, and a truncated
// structured output is unparseable rather than partial — generous on purpose.
const MAX_TOKENS = 32000;

// A CV is a page or three. Beyond this it is a scan dump or the wrong file.
const MAX_BYTES = 10 * 1024 * 1024;

// One capped attempt, no SDK retries — same reasoning as parse-jd: someone is
// watching a spinner, and an honest failure beats an open-ended wait.
const ATTEMPT_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 0;

// Cost backstop, checked BEFORE a single token is spent. The RPC enforces the
// same ceiling on the write side for the racy path.
const MAX_SCORES_PER_HOUR = 6;

const IMAGE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOCX_EXT = /\.docx$/i;
const LEGACY_DOC_EXT = /\.(doc|rtf|odt|pages)$/i;

/** The five axes, their labels, and what share of the score each carries. */
const AXES = [
  { key: 'must_have_skills', label: 'Must-have skills', weight: 35 },
  { key: 'experience', label: 'Experience', weight: 25 },
  { key: 'role_fit', label: 'Done the job', weight: 20 },
  { key: 'preferred_skills', label: 'Good to have', weight: 10 },
  { key: 'qualifications', label: 'Education', weight: 10 },
] as const;

type AxisKey = (typeof AXES)[number]['key'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** The model answered, but there is nothing usable in it — a 422, not a 502. */
class Unreadable extends Error {}

/**
 * One completion → the JSON object it carries.
 *
 * The refusal check comes first: safety classifiers can decline and that
 * arrives as an ordinary 200 with empty or partial content, so indexing
 * content[0] would throw before we ever noticed why.
 */
function readJson(msg: Anthropic.Message): Record<string, unknown> {
  if (msg.stop_reason === 'refusal') throw new Unreadable('refused');

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Unreadable('not json');
  }
}

/** .docx is a zip of XML. Same reader parse-jd uses for JD files. */
async function docxToText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Unreadable('not a docx');
  const xml = await doc.async('string');
  return xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ── THE SYSTEM PROMPT ───────────────────────────────────────────────────────
const SYSTEM = `
You are a CV screening assistant for the HR recruitment system at Orange O Tec, a
manufacturer and distributor of industrial digital textile printing machinery in India.
You read one candidate's CV against one vacancy's job description and score the fit.

ADVISORY, NOT A DECISION
Your output is advice for a human recruiter. It does not shortlist, reject, schedule or
move anyone. Never recommend rejection, and never phrase a conclusion as though the
decision is yours.

THE FIVE AXES — score each 0-10 against these anchors
Use the anchors. Without them a 6 and a 7 mean nothing when two candidates are compared,
and comparison is the only thing a score is for.

1. must_have_skills — the skills the vacancy lists as required.
   10 every required skill evidenced by concrete described work
    7 most evidenced, one or two only listed
    4 about half present
    1 one or two present
    0 none present

2. experience — years and depth against the vacancy's band.
   10 comfortably inside the band with directly relevant depth
    7 inside the band, or just outside with strong relevance
    4 materially short or materially over, or relevant only in part
    1 largely unrelated experience
    0 no relevant experience
   If the vacancy accepts freshers, do not penalise a candidate for having none.

3. role_fit — has this person actually done this job?
   Compare the CV's described responsibilities against the vacancy's role summary and
   duties. Judge the work performed, not the job title.
   10 has done substantially this job
    7 has done most of it, or a close neighbour
    4 overlaps in parts
    1 same field only
    0 unrelated

4. preferred_skills — the nice-to-haves. Absence is never a fault, only a missed bonus.
   10 nearly all present · 7 several · 4 a couple · 1 one · 0 none

5. qualifications — the education or certification the vacancy asks for.
   10 holds what is asked · 7 holds an equivalent · 4 partially · 1 related field · 0 none

EVIDENCE BEATS CLAIM
A skill in a "Skills" bullet list is CLAIMED. A skill visible inside a described role is
EVIDENCED. Say which in the evidence line, and score claims lower than evidence. Never
infer a skill from a job title alone.

WHAT YOU MUST IGNORE
Ignore, and never mention: name, gender, age, date of birth, photograph, marital status,
nationality, religion, caste, mother tongue, native place, father's or spouse's name,
disability, pregnancy or maternity — and any inference drawn from a name about any of
these. Do not reward or penalise the prestige of a university or an employer; judge only
what the CV shows the person did. Career gaps are not a scoring input. Do not comment on
English fluency or CV formatting unless the vacancy names communication as a required
skill.

WHEN THE VACANCY SAYS NOTHING ABOUT AN AXIS
Set applicable to "no", score 0, and name the missing part in notes. Never guess what the
vacancy "probably" wants from its job title, and never invent a requirement so that there
is something to score against.

WHEN THE CV IS A SCAN
Score only what you can actually read, set cv_quality to "scanned", and say in notes what
was unreadable. A page you cannot read is NOT a missing skill.

UNCERTAINTY, NOT INVENTION
Where the CV is ambiguous — dates that do not add up, a company that could be either role
— say so in the evidence line and score the LOWER reading. Never invent an employer, a
date, a certification or a skill. "The CV does not say" is a correct answer.

EVERY AXIS GETS AN EVIDENCE SENTENCE
One or two sentences quoting or paraphrasing what in the CV justified the number. An axis
with an empty evidence string has not been assessed.

LENGTH AND SCOPE
Evidence: at most two sentences. notes: at most two sentences, or "". Produce the five
scores, the verdict and the fields asked for — do not propose next steps, interview
questions, or a hiring recommendation.
`.trim();

const AXIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'applicable', 'evidence'],
  properties: {
    // An integer enum, NOT minimum/maximum — numeric range constraints are
    // stripped from structured-output schemas and never reach the model.
    score: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    applicable: { type: 'string', enum: ['yes', 'no'] },
    evidence: { type: 'string' },
  },
} as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['axes', 'verdict', 'cv_quality', 'notes'],
  properties: {
    // An OBJECT with five required keys, not an array: that makes "all five,
    // exactly once" structural rather than something to validate afterwards.
    axes: {
      type: 'object',
      additionalProperties: false,
      required: AXES.map((a) => a.key),
      properties: Object.fromEntries(AXES.map((a) => [a.key, AXIS_SCHEMA])),
    },
    verdict: { type: 'string', enum: ['strong', 'possible', 'weak'] },
    cv_quality: { type: 'string', enum: ['text', 'scanned', 'thin'] },
    notes: { type: 'string' },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const startedAt = Date.now();

  let body: { candidate_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const candidateId = clean(body.candidate_id);
  if (!candidateId) return json({ error: 'candidate_id required' }, 400);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref icutjkrqkbzwvmnfbzpr' },
      500,
    );
  }

  // ── THE CALLER'S OWN CLIENT ───────────────────────────────────────────────
  // Anon key + the caller's Authorization header. Everything below is read as
  // them, so RLS is the authorisation and there is nothing to restate here.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    },
  );

  // 1. The candidate. A miss here is either "no such candidate" or "not yours",
  //    and we deliberately do not distinguish: telling an unauthorised caller
  //    that a candidate exists is itself a leak.
  const { data: cand } = await supabase
    .from('fms_hr_candidates')
    .select('id, requisition_id, resume_path, resume_name, experience_years, skills, current_company')
    .eq('id', candidateId)
    .maybeSingle();

  if (!cand) {
    return json(
      { error: 'forbidden', message: "You don't have access to this candidate." },
      403,
    );
  }
  if (!clean(cand.resume_path)) {
    return json(
      { error: 'no_cv', message: "There's no CV on file for this candidate." },
      422,
    );
  }

  // 2. Cost backstop, before any token is spent.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recent } = await supabase
    .from('fms_hr_candidate_scores')
    .select('id', { count: 'exact', head: true })
    .eq('candidate_id', candidateId)
    .gt('scored_at', hourAgo);

  if ((recent ?? 0) >= MAX_SCORES_PER_HOUR) {
    return json(
      {
        error: 'rate_limited',
        message: 'This CV has been scored several times in the last hour — read the score you already have rather than running it again.',
      },
      429,
    );
  }

  // 3. The vacancy, and the master names behind its uuid[] columns.
  const { data: req_ } = await supabase
    .from('fms_hr_requisitions')
    .select(
      'id, mrf_no, job_title, role_summary, key_responsibilities, required_skills, preferred_experience, skills_note, skill_ids, preferred_skill_ids, qualification_ids, experience_min_years, experience_max_years, freshers_ok',
    )
    .eq('id', cand.requisition_id)
    .maybeSingle();

  if (!req_) {
    return json({ error: 'forbidden', message: "You don't have access to this vacancy." }, 403);
  }

  const skillIds: string[] = [
    ...(req_.skill_ids ?? []),
    ...(req_.preferred_skill_ids ?? []),
  ];
  const [{ data: skillRows }, { data: qualRows }] = await Promise.all([
    skillIds.length
      ? supabase.from('fms_hr_skills').select('id, name').in('id', skillIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    (req_.qualification_ids ?? []).length
      ? supabase.from('fms_hr_qualifications').select('id, name').in('id', req_.qualification_ids)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const nameOf = (rows: { id: string; name: string }[] | null, ids: string[]) =>
    ids.map((id) => rows?.find((r) => r.id === id)?.name).filter((n): n is string => !!n);

  const mustHave = nameOf(skillRows, req_.skill_ids ?? []);
  const niceToHave = nameOf(skillRows, req_.preferred_skill_ids ?? []);
  const quals = nameOf(qualRows, req_.qualification_ids ?? []);

  // 4. A score against no job description is a score of the candidate AS A
  //    PERSON, which is exactly the thing that must never happen. Hard stop —
  //    before the model call, so it costs nothing and reads as a data nudge.
  const jdBits = [
    clean(req_.role_summary),
    clean(req_.key_responsibilities),
    clean(req_.required_skills),
    clean(req_.preferred_experience),
    clean(req_.skills_note),
  ].filter(Boolean);

  const hasJd =
    jdBits.length > 0 ||
    mustHave.length > 0 ||
    quals.length > 0 ||
    req_.experience_min_years !== null ||
    req_.experience_max_years !== null;

  if (!hasJd) {
    return json(
      {
        error: 'no_jd',
        message: `${req_.mrf_no ?? 'This vacancy'} has no job description to score against.`,
      },
      409,
    );
  }

  // Thin, but not empty: proceed and let the UI caveat it.
  const jdQuality = clean(req_.role_summary) || clean(req_.key_responsibilities) ? 'full' : 'thin';

  // 5. The CV itself, through the same client — so the storage policy applies
  //    too. A caller who may see the candidate but not the CV lands here, which
  //    is correct: no AI paraphrase of a document you may not read.
  const { data: blob, error: dlErr } = await supabase.storage
    .from('fms-hr-docs')
    .download(cand.resume_path as string);

  if (dlErr || !blob) {
    return json(
      {
        error: 'no_cv',
        message: "We couldn't open this candidate's CV. You may not have access to it, or the file is missing.",
      },
      403,
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    return json({ error: 'too_large', message: 'This CV is too big to read automatically (over 10 MB).' }, 413);
  }

  const name = clean(cand.resume_name) || clean(cand.resume_path);
  const mediaType = blob.type || '';
  const isPdf = mediaType === 'application/pdf' || /\.pdf$/i.test(name);
  const isImage = IMAGE_MEDIA.has(mediaType);

  let source: Anthropic.ContentBlockParam[];
  if (isPdf) {
    // The PDF goes in whole so the model reads both the text layer and the page
    // images — a scanned CV needs no separate path.
    source = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytesToBase64(bytes) } },
    ];
  } else if (isImage) {
    source = [
      { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg', data: bytesToBase64(bytes) } },
    ];
  } else if (DOCX_EXT.test(name)) {
    let text: string;
    try {
      text = await docxToText(bytes);
    } catch {
      return json({ error: 'unsupported_type', message: "We couldn't read this Word file." }, 415);
    }
    if (!text) return json({ error: 'unreadable', message: 'That CV came through empty.' }, 422);
    source = [{ type: 'text', text: `CV (${name}):\n\n${text}` }];
  } else if (LEGACY_DOC_EXT.test(name)) {
    return json(
      { error: 'unsupported_type', message: "We can't read this file type. Re-upload the CV as a PDF." },
      415,
    );
  } else {
    const text = new TextDecoder().decode(bytes).trim();
    if (!text) return json({ error: 'unreadable', message: 'That CV came through empty.' }, 422);
    source = [{ type: 'text', text: `CV (${name}):\n\n${text}` }];
  }

  // 6. The vacancy, as text the model can read.
  const band = (() => {
    const lo = req_.experience_min_years;
    const hi = req_.experience_max_years;
    if (lo === null && hi === null) return req_.freshers_ok ? 'Not stated. Freshers are welcome.' : 'Not stated.';
    const range = lo !== null && hi !== null ? `${lo} to ${hi} years` : lo !== null ? `at least ${lo} years` : `up to ${hi} years`;
    return req_.freshers_ok ? `${range}. Freshers are welcome.` : range;
  })();

  const jd = [
    `Job title: ${clean(req_.job_title) || 'Not stated'}`,
    `Role summary: ${clean(req_.role_summary) || 'Not stated'}`,
    `Key responsibilities:\n${clean(req_.key_responsibilities) || 'Not stated'}`,
    `Must-have skills: ${mustHave.length ? mustHave.join(', ') : 'None listed'}`,
    `Nice-to-have skills: ${niceToHave.length ? niceToHave.join(', ') : 'None listed'}`,
    `Qualifications required: ${quals.length ? quals.join(', ') : 'None listed'}`,
    `Experience required: ${band}`,
    clean(req_.skills_note) ? `Other skill notes: ${clean(req_.skills_note)}` : '',
    clean(req_.required_skills) ? `Skills (free text): ${clean(req_.required_skills)}` : '',
    clean(req_.preferred_experience) ? `Preferred experience (free text): ${clean(req_.preferred_experience)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const anthropic = new Anthropic({ apiKey, timeout: ATTEMPT_TIMEOUT_MS, maxRetries: MAX_RETRIES });
  const model = Deno.env.get('SCORE_MODEL') ?? DEFAULT_MODEL;

  const ASK =
    `Score this CV against the job description below, per the system instructions.\n\n` +
    `=== JOB DESCRIPTION ===\n${jd}\n=== END JOB DESCRIPTION ===\n\n` +
    `Work through each of the five axes against the anchors, and give every axis an ` +
    `evidence sentence naming what in the CV justified the number.`;

  // STREAMED, and not optionally: the SDK refuses a non-streaming request whose
  // max_tokens it estimates could outlive the HTTP timeout. Nothing here
  // consumes the events — finalMessage() just waits for the assembled message.
  const attempt = (ask: string) =>
    anthropic.messages
      .stream({
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [...source, { type: 'text', text: ask }] }],
      } as never)
      .finalMessage();

  /**
   * ── THE HOLLOW ANSWER ─────────────────────────────────────────────────────
   * parse-jd's scar tissue, and it applies here twice over. A schema-valid
   * object with every axis at 0 and no evidence is not a low score — it is a
   * failed read wearing a number, and it would ship as "3/10 — Light on paper"
   * against a real person. So we look, and ask once more.
   */
  const hollow = (p: Record<string, unknown>): boolean => {
    const axes = (p.axes ?? {}) as Record<string, { applicable?: string; evidence?: string }>;
    const rows = AXES.map((a) => axes[a.key]).filter(Boolean);
    if (rows.length === 0) return true;
    if (!rows.some((r) => clean(r?.evidence))) return true;
    // Every axis inapplicable while the JD is full means it did not read the JD.
    if (jdQuality === 'full' && rows.every((r) => r?.applicable === 'no')) return true;
    return false;
  };

  const RETRY_ASK =
    ASK +
    '\n\nIMPORTANT: a previous attempt on this exact CV returned an empty answer — no ' +
    'evidence on any axis — which is wrong. The CV above does contain readable content. ' +
    'Read it line by line and fill every field the schema asks for.';

  let completion: Anthropic.Message;
  let parsed: Record<string, unknown>;
  let attempts = 0;
  try {
    attempts = 1;
    completion = await attempt(ASK);
    parsed = readJson(completion);

    if (hollow(parsed)) {
      console.warn(
        `score-candidate: hollow answer on attempt 1 after ${Date.now() - startedAt}ms ` +
          `(out=${completion.usage?.output_tokens}, stop=${completion.stop_reason}) — retrying`,
      );
      attempts = 2;
      completion = await attempt(RETRY_ASK);
      parsed = readJson(completion);
    }
  } catch (e) {
    const elapsed = Date.now() - startedAt;
    console.error(`score-candidate: failed after ${elapsed}ms (attempts=${attempts})`, e);
    if (e instanceof Unreadable) {
      return json(
        { error: 'unreadable', message: "We couldn't get a usable read of this CV.", attempts, elapsed_ms: elapsed },
        422,
      );
    }
    const status = (e as { status?: number }).status;
    return json(
      {
        error: 'upstream',
        message: 'The scoring service did not answer. Try again in a moment.',
        status,
        request_id: (e as { request_id?: string }).request_id,
        attempts,
        elapsed_ms: elapsed,
      },
      502,
    );
  }

  if (hollow(parsed)) {
    return json(
      { error: 'unreadable', message: "We couldn't get a usable read of this CV.", attempts, elapsed_ms: Date.now() - startedAt },
      422,
    );
  }

  // 7. Score the arithmetic OURSELVES.
  //
  //    The model never emits `overall` and the schema has no such field. Models
  //    are unreliable at consistent arithmetic over a rubric, and a single
  //    visible contradiction — 7 overall with every axis at 3 — destroys trust
  //    in the whole thing. Computing it also makes one class of hollow answer
  //    structurally impossible, and lets anyone recompute the number from the
  //    stored axes and get the same answer.
  const rawAxes = (parsed.axes ?? {}) as Record<AxisKey, { score?: unknown; applicable?: unknown; evidence?: unknown }>;

  const axes = AXES.map((a) => {
    const row = rawAxes[a.key] ?? {};
    const applicable = row.applicable !== 'no';
    // Clamp regardless of the schema. The schema is a strong hint, not a guarantee.
    const score = applicable ? Math.max(0, Math.min(10, Math.round(Number(row.score) || 0))) : 0;
    return {
      key: a.key,
      label: a.label,
      score,
      weight: applicable ? a.weight : 0,
      applicable,
      evidence: clean(row.evidence),
    };
  });

  // Weights renormalise across the applicable axes. Without this, a vacancy
  // that names no qualification silently caps every candidate at 9.
  const liveWeight = axes.reduce((n, a) => n + a.weight, 0);
  const overall = liveWeight
    ? Math.max(0, Math.min(10, Math.round(axes.reduce((n, a) => n + a.score * a.weight, 0) / liveWeight)))
    : 0;

  const verdict = ['strong', 'possible', 'weak'].includes(clean(parsed.verdict))
    ? (clean(parsed.verdict) as 'strong' | 'possible' | 'weak')
    : 'possible';

  return json({
    overall,
    verdict,
    axes,
    notes: clean(parsed.notes),
    cv_quality: ['text', 'scanned', 'thin'].includes(clean(parsed.cv_quality)) ? clean(parsed.cv_quality) : 'text',
    jd_quality: jdQuality,
    model,
    attempts,
    stop_reason: completion.stop_reason,
    usage: completion.usage,
    elapsed_ms: Date.now() - startedAt,
  });
});
