/**
 * Resolve stored dispatch documents to displayable urls, in bulk.
 *
 * `fms-dispatch-docs` is a private bucket, so every image needs a signed url
 * before it can go in an `<img src>`. StepDocLink already does that — but it
 * signs ONE path, on click, and never caches. That is right for a text link and
 * wrong for a grid of thumbnails, which needs every url up front and would
 * otherwise fire one request per tile on every render.
 *
 * Hence: `createSignedUrls` (plural — one round trip for the whole grid) plus a
 * module-level cache keyed by path, mirroring leads-dashboard's mediaUrl.ts.
 *
 * ⚠ THE TTL IS SHORTER THAN THE SIGNATURE. A url signed for 10 minutes is
 *   cached for 9, so a thumbnail can never be handed out with seconds left on
 *   it and render as a broken image.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/core/platform/supabase";

const DOCS_BUCKET = "fms-dispatch-docs";
const SIGN_SECONDS = 60 * 10;
const TTL_MS = 9 * 60 * 1000;

const cache = new Map<string, { url: string; exp: number }>();

/**
 * Sign whatever is not already cached, in one call, and return a path → url map.
 *
 * A path that fails to sign is simply absent from the result rather than
 * throwing: one unreadable object (an orphan, a since-deleted file) must not
 * blank the whole grid.
 */
export async function signDocPaths(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const wanted: string[] = [];

  for (const p of paths) {
    if (!p) continue;
    const hit = cache.get(p);
    if (hit && hit.exp > now) out[p] = hit.url;
    else if (!wanted.includes(p)) wanted.push(p);
  }
  if (wanted.length === 0) return out;

  const { data, error } = await supabase.storage
    .from(DOCS_BUCKET)
    .createSignedUrls(wanted, SIGN_SECONDS);
  if (error || !data) return out;

  for (const row of data) {
    // `path` comes back on each row; a row that failed carries `error` and a
    // null url. Skip those — see the note above about one bad object.
    const path = row.path ?? "";
    if (!path || !row.signedUrl) continue;
    cache.set(path, { url: row.signedUrl, exp: now + TTL_MS });
    out[path] = row.signedUrl;
  }
  return out;
}

/**
 * Hook form: hand it the paths a grid is showing, get back a path → url map.
 *
 * Keyed on the joined path list so it re-signs when a page is added or removed
 * but not on every unrelated re-render of the form around it.
 */
export function useSignedDocUrls(paths: string[]): Record<string, string> {
  const key = paths.join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    if (!key) {
      setUrls({});
      return;
    }
    signDocPaths(key.split("|"))
      .then((m) => { if (active) setUrls(m); })
      .catch(() => { if (active) setUrls({}); });
    return () => { active = false; };
  }, [key]);

  return urls;
}
