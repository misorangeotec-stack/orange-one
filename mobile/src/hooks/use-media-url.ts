/**
 * Resolve a stored media uri to something an <Image> can actually load.
 *
 * The `lead-media` bucket is PRIVATE, so media captured on one device is stored
 * in the lead payload as a storage PATH (`lead-media/<user>/<contact>/x.jpg`) — not
 * a loadable URL. On the capturing phone the local `file://` uri is kept, so images
 * show; but on any other device / a fresh install the lead is pulled from Supabase
 * with only the storage path, which fails to render unless signed first.
 *
 * This hook signs `lead-media/...` paths (via resolveMediaUrl) and passes local
 * `file://` / `content://` / `http(s)` uris straight through. Signed URLs are cached
 * module-wide (they last ~1h) so the same image isn't re-signed on every render.
 */

import { useEffect, useState } from 'react';

import { resolveMediaUrl } from '@/lib/leads/sync';

const isStoragePath = (uri: string) => uri.startsWith('lead-media/');

// path → { signed url, when it should be refreshed }. Signed URLs live ~1h.
const CACHE = new Map<string, { url: string; expiresAt: number }>();
const TTL_MS = 55 * 60 * 1000;

export function useMediaUrl(uri?: string | null): string | null {
  const initial = !uri || !isStoragePath(uri) ? uri ?? null : CACHE.get(uri)?.url ?? null;
  const [url, setUrl] = useState<string | null>(initial);

  useEffect(() => {
    // Local file / http: usable as-is.
    if (!uri || !isStoragePath(uri)) {
      setUrl(uri ?? null);
      return;
    }
    const hit = CACHE.get(uri);
    if (hit && hit.expiresAt > Date.now()) {
      setUrl(hit.url);
      return;
    }
    let active = true;
    (async () => {
      const signed = await resolveMediaUrl(uri);
      if (!active) return;
      if (signed) {
        CACHE.set(uri, { url: signed, expiresAt: Date.now() + TTL_MS });
        setUrl(signed);
      } else {
        setUrl(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [uri]);

  return url;
}
