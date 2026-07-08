/**
 * Sends a recorded voice note to the `transcribe-voice` Edge Function
 * (Deepgram STT → Claude translate + analyze) and returns the English
 * transcript plus a short summary, a suggested interest level, and follow-ups.
 * Fails soft: returns ok:false so the note is still saved (just without text).
 */

import { bytesBase64FromUri } from './media';

export type VoiceAnalysis = {
  transcript: string;
  summary: string;
  suggestedInterest: string;
  followUps: string[];
};

type Result = { ok: boolean; data?: VoiceAnalysis; error?: string };

const FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/transcribe-voice`;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Guess a mime type from the recording uri extension. */
function mimeFor(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  if (ext === 'caf') return 'audio/x-caf';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'aac') return 'audio/aac';
  return 'audio/m4a';
}

export async function transcribeVoice(uri: string): Promise<Result> {
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL) return { ok: false, error: 'Backend URL not configured.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000); // STT + Claude can be slow, but never hang forever
  try {
    // Reads a local file OR a Supabase storage path (lead-media/...) — the latter
    // is the case on a device that pulled the lead and has no local audio copy.
    const base64 = await bytesBase64FromUri(uri);
    if (!base64) return { ok: false, error: 'Could not read audio.' };
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ audio: base64, mime: mimeFor(uri) }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return {
      ok: true,
      data: {
        transcript: typeof body.transcript === 'string' ? body.transcript : '',
        summary: typeof body.summary === 'string' ? body.summary : '',
        suggestedInterest: typeof body.suggestedInterest === 'string' ? body.suggestedInterest : '',
        followUps: Array.isArray(body.followUps) ? body.followUps.filter((x: unknown) => typeof x === 'string') : [],
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  } finally {
    clearTimeout(timer);
  }
}
