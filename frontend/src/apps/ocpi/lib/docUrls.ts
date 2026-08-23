/**
 * Resolve stored OCPI documents to displayable urls, in bulk.
 *
 * `fms-ocpi-docs` is a private bucket, so every scanned page needs a signed url
 * before it can go in an `<img src>` — and the signed order confirmation runs
 * to several pages, all shown at once. Signing them one at a time, on render,
 * would fire a request per tile every time the panel re-drew.
 *
 * Hence `createSignedUrls` (plural — one round trip for the whole strip) plus a
 * module-level cache keyed by path, the same shape order-to-dispatch settled on
 * in `receiverDocUrls.ts`.
 *
 * ⚠ THE CACHE TTL IS SHORTER THAN THE SIGNATURE. A url signed for ten minutes
 *   is cached for nine, so a page can never be handed out with seconds left on
 *   it and render as a broken image.
 *
 * ⚠ THIS IS A CONVENIENCE, NOT A BOUNDARY. Signing is refused for an object the
 *   caller may not select, and what they may select is decided by
 *   `fms_ocpi_can_see_doc` in the database — the deal's own visibility rule,
 *   applied to the file. Nothing here grants access to anything.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/core/platform/supabase";

export const OCPI_DOCS_BUCKET = "fms-ocpi-docs";
const SIGN_SECONDS = 60 * 10;
const TTL_MS = 9 * 60 * 1000;

const cache = new Map<string, { url: string; exp: number }>();

/**
 * Sign whatever is not already cached, in one call, and return a path → url map.
 *
 * A path that fails to sign is simply absent from the result rather than
 * throwing: one unreadable object — an orphan, a since-deleted file — must not
 * blank the whole strip.
 */
export async function signOcpiDocs(paths: string[]): Promise<Record<string, string>> {
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
    .from(OCPI_DOCS_BUCKET)
    .createSignedUrls(wanted, SIGN_SECONDS);
  if (error || !data) return out;

  for (const row of data) {
    const path = row.path ?? "";
    if (!path || !row.signedUrl) continue;
    cache.set(path, { url: row.signedUrl, exp: now + TTL_MS });
    out[path] = row.signedUrl;
  }
  return out;
}

/**
 * Hook form: hand it the paths a strip is showing, get back a path → url map.
 *
 * Keyed on the joined path list, so it re-signs when a page is added or removed
 * but not on every unrelated re-render of the panel around it.
 */
export function useOcpiDocUrls(paths: string[]): Record<string, string> {
  const key = paths.filter(Boolean).join("|");
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    if (!key) {
      setUrls({});
      return;
    }
    signOcpiDocs(key.split("|"))
      .then((m) => { if (active) setUrls(m); })
      .catch(() => { if (active) setUrls({}); });
    return () => { active = false; };
  }, [key]);

  return urls;
}

/**
 * Pull a stored PDF back as a blob, so it can be previewed, printed and
 * downloaded through the same panel that shows a freshly rendered one.
 *
 * ⚠ THE STORED FILE IS PREFERRED OVER RE-RENDERING, and that is the whole
 *   point. The order confirmation the customer is about to sign must be the
 *   bytes management approved, not a fresh render from a template somebody may
 *   have reworded in the meantime. Callers fall back to rendering only when
 *   there is no stored file at all, and say so on screen when they do.
 */
export async function fetchStoredPdf(path: string | null): Promise<Blob | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(OCPI_DOCS_BUCKET).download(path);
  if (error || !data) return null;
  return data;
}
