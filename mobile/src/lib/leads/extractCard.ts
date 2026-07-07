/**
 * Real business-card extraction. Sends the captured image(s) as base64 to the
 * `extract-card` Supabase Edge Function (which runs Claude vision server-side)
 * and maps the structured response into a ContactDraft to prefill the form.
 *
 * Fails gracefully: on any error it returns an empty draft (keeping the captured
 * card image) plus ok:false, so the caller can fall back to manual entry.
 */

import { emptyDraft, type ContactDraft } from './types';

export type CapturedImage = { uri: string; base64?: string | null };

type ExtractResult = { draft: ContactDraft; ok: boolean; error?: string };

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/extract-card`;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim());
}

export async function extractCardDraft(front?: CapturedImage | null, back?: CapturedImage | null): Promise<ExtractResult> {
  const base: ContactDraft = {
    ...emptyDraft(),
    cardImages: { front: front?.uri ?? null, back: back?.uri ?? null },
  };

  const images = [front, back]
    .filter((i): i is CapturedImage => !!i?.base64)
    .map((i) => ({ media_type: 'image/jpeg', data: i.base64 }));

  if (!images.length) return { draft: base, ok: false, error: 'No image data captured.' };
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) return { draft: base, ok: false, error: 'Backend URL not configured.' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000); // Claude vision can be slow, but never hang forever
  try {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify({ images }),
      signal: ctrl.signal,
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { draft: base, ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }

    const p = body.person ?? {};
    const c = body.company ?? {};
    const draft: ContactDraft = {
      ...base,
      person: {
        name: typeof p.name === 'string' ? p.name : '',
        photoUri: null,
        mobiles: arr(p.mobiles),
        emails: arr(p.emails),
        jobTitles: arr(p.jobTitles),
      },
      company: {
        name: typeof c.name === 'string' ? c.name : '',
        logoUri: null,
        mobiles: arr(c.mobiles),
        emails: arr(c.emails),
        websites: arr(c.websites),
        addresses: arr(c.addresses),
      },
    };
    return { draft, ok: true };
  } catch (e) {
    return { draft: base, ok: false, error: e instanceof Error ? e.message : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}
