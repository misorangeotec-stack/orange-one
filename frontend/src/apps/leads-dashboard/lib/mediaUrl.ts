/**
 * Resolves lead media (card scans, person photos, voice notes) for display.
 * Media is stored in the PRIVATE `lead-media` bucket as storage paths like
 * `lead-media/<userId>/<contactId>/x.jpg` (see the mobile app's resolveMediaUrl).
 * Here we sign those paths to short-lived HTTPS urls via the identity client,
 * caching each so the same image/audio isn't re-signed on every render.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/core/platform/supabase";

const BUCKET = "lead-media";
const TTL_MS = 55 * 60 * 1000; // signed urls last 1h; refresh a little early
const cache = new Map<string, { url: string; exp: number }>();

/** Sign a stored `lead-media/...` path; pass through anything already a url. */
export async function signLeadMedia(uri: string | null | undefined): Promise<string | null> {
  if (!uri) return null;
  if (!uri.startsWith(`${BUCKET}/`)) return uri; // already an http(s) url or local (n/a on web)
  const now = Date.now();
  const hit = cache.get(uri);
  if (hit && hit.exp > now) return hit.url;
  const path = uri.slice(BUCKET.length + 1);
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  const url = data?.signedUrl ?? null;
  if (url) cache.set(uri, { url, exp: now + TTL_MS });
  return url;
}

/** Hook form: returns the signed url (or a pass-through url) + loading state. */
export function useSignedMedia(uri: string | null | undefined): { url: string | null; loading: boolean } {
  const passthrough = !!uri && !uri.startsWith(`${BUCKET}/`);
  const [url, setUrl] = useState<string | null>(passthrough ? (uri as string) : null);
  const [loading, setLoading] = useState<boolean>(!!uri && !passthrough);

  useEffect(() => {
    let active = true;
    if (!uri) {
      setUrl(null);
      setLoading(false);
      return;
    }
    if (!uri.startsWith(`${BUCKET}/`)) {
      setUrl(uri);
      setLoading(false);
      return;
    }
    setLoading(true);
    signLeadMedia(uri)
      .then((u) => active && (setUrl(u), setLoading(false)))
      .catch(() => active && (setUrl(null), setLoading(false)));
    return () => {
      active = false;
    };
  }, [uri]);

  return { url, loading };
}
