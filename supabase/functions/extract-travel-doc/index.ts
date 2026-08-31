// Travel document extraction — Supabase Edge Function (Deno).
//
//   Travel Desk ──▶ this Edge Function ──▶ Claude API (Anthropic SDK)
//
// The coordinator uploads a ticket (or, from phase 8, a bill) and this reads it
// so the booking form arrives filled in instead of empty. Cloned from
// `extract-card`, with `parse-resume`'s document handling because a travel
// ticket is nearly always a PDF and a bill is nearly always a photograph.
//
// ⚠ IT FILLS A FORM. IT NEVER WRITES A ROW.
//   Nothing here touches the database — the function has no service key, takes
//   no trip id and returns JSON to a screen where a human confirms every field
//   before saving. That is the `extract-card` contract and it is what keeps an
//   OCR misread out of a reimbursement. A ticket price read as 45,000 instead of
//   4,500 is a typo somebody catches; the same number written straight into
//   `ticket_cost` is a figure nobody ever looks at again.
//
// Why server-side: the Anthropic API key must never ship in the browser bundle.
// That is precisely why the source app's AI chat was NOT ported.
//
// Secrets (already set on the identity project, shared with five other
// functions):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref icutjkrqkbzwvmnfbzpr
// Deploy:
//   npx.cmd supabase@latest functions deploy extract-travel-doc --project-ref icutjkrqkbzwvmnfbzpr
//
// ⚠ verify_jwt = true, unlike extract-card. That one is called by the mobile app
//   with the anon key and has no session; every caller here is a signed-in portal
//   user, so this follows `parse-resume`'s reasoning instead.

import Anthropic from 'npm:@anthropic-ai/sdk';

import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const IMAGE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024;

type InboundFile = { media_type?: string; data?: string };
type Mode = 'ticket' | 'bill';
type RequestBody = { file?: InboundFile; mode?: Mode };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ⚠ THE TWO PROMPTS ARE SEPARATE, not one prompt with a flag. A ticket and a
//   hotel bill share almost no fields, and a single prompt that tried to cover
//   both taught the model to guess at whichever half was absent — which is how
//   an extractor starts inventing amounts.
const SYSTEM_TICKET =
  'You are an OCR and data-extraction engine for travel tickets and booking confirmations ' +
  '(air, rail, bus, cab and hotel), for an Indian company. ' +
  'Read the document and return what it says. ' +
  'Respond with STRICT JSON only — no markdown, no code fences, no commentary. Shape:\n' +
  '{"kind":"flight"|"train"|"bus"|"cab"|"hotel"|"","carrier":string,"bookingRef":string,' +
  '"travelClass":string,"fromCity":string,"toCity":string,' +
  '"startDate":string,"startTime":string,"endDate":string,"endTime":string,' +
  '"ticketCost":number|null,"otherCharges":number|null,"currency":string,' +
  '"passengers":[string],"confidence":"high"|"medium"|"low"}\n' +
  'Rules: dates as YYYY-MM-DD and times as HH:MM in 24-hour form. ' +
  'For a HOTEL, startDate is check-in and endDate is check-out, toCity is the city stayed in, and fromCity is empty. ' +
  'ticketCost is the BASE fare or room charge; otherCharges is taxes, GST, convenience and seat fees added together. ' +
  'If the document shows only one total and no breakdown, put it in ticketCost and leave otherCharges null. ' +
  'Amounts as plain numbers with no symbols, separators or currency words. ' +
  'currency is the ISO code shown, e.g. "INR"; leave it empty if none is printed. ' +
  'Set confidence to "low" when the scan is poor or a figure is ambiguous. ' +
  'If a value is not present, use an empty string or null. NEVER invent data — an empty field is always better than a guess. ' +
  'If this is not a travel document at all, return every field empty with kind "" and confidence "low".';

const SYSTEM_BILL =
  'You are an OCR and data-extraction engine for expense receipts and invoices, for an Indian company. ' +
  'Read the document and return what it says. ' +
  'Respond with STRICT JSON only — no markdown, no code fences, no commentary. Shape:\n' +
  '{"vendor":string,"invoiceNo":string,"date":string,"city":string,' +
  '"amount":number|null,"gstAmount":number|null,"gstin":string,' +
  '"category":string,"description":string,"currency":string,"confidence":"high"|"medium"|"low"}\n' +
  'Rules: date as YYYY-MM-DD. Amounts as plain numbers with no symbols or separators. ' +
  'amount is the GROSS total payable including tax; gstAmount is the tax component if it is shown separately. ' +
  'gstin is the vendor 15-character GSTIN if printed. ' +
  'category is a short free-text guess such as "Hotel", "Meal", "Taxi", "Fuel" — it is a hint for a human, not a decision. ' +
  'Set confidence to "low" when the scan is poor or a figure is ambiguous. ' +
  'If a value is not present, use an empty string or null. NEVER invent data. ' +
  'If this is not a receipt or invoice at all, return every field empty with confidence "low".';

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Salvage the first {...} block — a model that prefaces its JSON with a
    // sentence is a bad day, not an unreadable document.
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

  const mode: Mode = payload.mode === 'bill' ? 'bill' : 'ticket';
  const file = payload.file;
  if (!file?.data) return json({ error: 'No file data provided' }, 400);

  const mediaType = (file.media_type ?? '').toLowerCase();
  const isPdf = mediaType === 'application/pdf';
  const isImage = IMAGE_MEDIA.has(mediaType);

  // 415 is the screen's cue to say "type the details in yourself". The upload
  // and the row are unaffected — reading is a convenience, never a gate.
  if (!isPdf && !isImage) {
    return json(
      {
        error: 'unsupported_type',
        message: 'This file type cannot be read automatically. Please type the details in.',
      },
      415
    );
  }

  // base64 is ~4 chars per 3 bytes; check before decoding anything big.
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
      { error: 'Server is missing ANTHROPIC_API_KEY. Run: supabase secrets set ANTHROPIC_API_KEY=... --project-ref icutjkrqkbzwvmnfbzpr' },
      500
    );
  }

  const PRIMARY_MODEL = Deno.env.get('TRAVEL_DOC_MODEL') ?? DEFAULT_MODEL;
  const FALLBACK_MODEL = Deno.env.get('TRAVEL_DOC_FALLBACK_MODEL') ?? 'claude-sonnet-5';
  const anthropic = new Anthropic({ apiKey });

  // A PDF goes in as a `document` block, which lets the model read both the text
  // layer and the page images — so a scanned ticket works as well as a generated
  // one. Claude reads PDFs natively; no converter is needed.
  const fileBlock = isPdf
    ? {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: file.data },
      }
    : {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data: file.data },
      };

  const content: Anthropic.MessageParam['content'] = [
    fileBlock,
    {
      type: 'text' as const,
      text:
        mode === 'bill'
          ? 'Extract the receipt details as strict JSON per the system instructions.'
          : 'Extract the travel booking details as strict JSON per the system instructions.',
    },
  ];

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : [];

  /**
   * Numbers only, and null for anything else.
   *
   * ⚠ A STRING THAT IS NOT A NUMBER BECOMES NULL, NEVER 0. "₹4,500" parses; "on
   *   request" does not, and returning 0 for it would put a free ticket on the
   *   form. Null renders as an empty box the human has to fill, which is the
   *   honest outcome.
   */
  const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const cleaned = v.replace(/[^0-9.\-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const KINDS = new Set(['flight', 'train', 'bus', 'cab', 'hotel']);
  const CONF = new Set(['high', 'medium', 'low']);

  function normalize(parsed: unknown): Record<string, unknown> | null {
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const confidence = CONF.has(str(o.confidence)) ? str(o.confidence) : 'low';

    if (mode === 'bill') {
      return {
        vendor: str(o.vendor),
        invoiceNo: str(o.invoiceNo),
        date: str(o.date),
        city: str(o.city),
        amount: num(o.amount),
        gstAmount: num(o.gstAmount),
        gstin: str(o.gstin).toUpperCase(),
        category: str(o.category),
        description: str(o.description),
        currency: str(o.currency).toUpperCase(),
        confidence,
      };
    }
    return {
      kind: KINDS.has(str(o.kind)) ? str(o.kind) : '',
      carrier: str(o.carrier),
      bookingRef: str(o.bookingRef),
      travelClass: str(o.travelClass),
      fromCity: str(o.fromCity),
      toCity: str(o.toCity),
      startDate: str(o.startDate),
      startTime: str(o.startTime),
      endDate: str(o.endDate),
      endTime: str(o.endTime),
      ticketCost: num(o.ticketCost),
      otherCharges: num(o.otherCharges),
      currency: str(o.currency).toUpperCase(),
      passengers: strArr(o.passengers),
      confidence,
    };
  }

  // "Weak" = nothing usable came back, so the fallback model is worth the cost.
  const isWeak = (r: Record<string, unknown> | null): boolean => {
    if (!r) return true;
    if (mode === 'bill') return !r.vendor && r.amount === null;
    return !r.kind && !r.carrier && !r.bookingRef && r.ticketCost === null;
  };

  /*
    The failure REASON is captured, never swallowed. A blanket `catch {}` once
    made an outage indistinguishable from a blurry photo in extract-card: when
    the API rejected a model id, every card came back "could not parse" — advice
    that is right for a bad scan and useless for a broken key, with nothing in
    the logs to tell them apart.
  */
  const failures: string[] = [];
  async function tryModel(model: string): Promise<Record<string, unknown> | null> {
    try {
      const completion = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: mode === 'bill' ? SYSTEM_BILL : SYSTEM_TICKET,
        messages: [{ role: 'user', content }],
      });
      const text = completion.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      const out = normalize(extractJson(text));
      if (!out) failures.push(`${model}: model replied with unparseable JSON`);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${model}: ${msg}`);
      console.error(`[extract-travel-doc] ${model} failed: ${msg}`);
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

  // Both models down → an OUTAGE, not an unreadable document. Say so, and carry
  // the reason so the next person sees it without a redeploy.
  if (!result) {
    return json(
      {
        error: 'Document reading is temporarily unavailable. Please type the details in.',
        detail: failures.join(' | '),
      },
      422
    );
  }

  /*
    ⚠ `currency` IS RETURNED AND THE SCREEN WARNS ON IT. Policy §11.3 excludes
      foreign currency from this module entirely, so a ticket priced in USD is
      not something to convert — it is something a human has to be told about
      before they type an amount into a rupee field.
  */
  return json({ mode, ...result, model: modelUsed });
});
