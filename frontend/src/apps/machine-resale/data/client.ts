import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/core/platform/supabase";
import { compressImage } from "@/shared/lib/imageCompress";

/**
 * THE ONLY DOOR FROM THE HUB TO THE MACHINE RESALE PORTAL.
 *
 * The portal (machines, masters, inquiries, photos, settings) lives in its OWN
 * Supabase project, not the hub's. Every query this module makes goes through the
 * client below; nothing else in the hub may talk to that project.
 *
 * Same shape as the Tally mirror's second client (`receivables-hub/lib/connectwaveSupabase.ts`),
 * with one addition, because this link WRITES: the publishable key alone opens no
 * table (the portal grants anon nothing), so every call carries a short-lived PASS
 * minted by the portal's `mr-session` function from the user's hub login. The pass
 * says who the user is and their Machine Resale level (`view` or `edit`), and the
 * portal's row rules read that level.
 *
 *   hub access token  --POST-->  mr-session  -->  {access_token, expires_at, level, user}
 *
 * The pass lasts an hour. It is fetched again a few minutes before it runs out,
 * and once more after any 401, so a form left open over lunch still saves: the
 * typed values live in React state and never depend on the pass.
 *
 * ⚠ The PUBLISHABLE key, never the legacy anon key: the legacy keys are retired
 *   before go-live (MR-1D).
 * ⚠ `supabase.auth.*` throws on a client built with `accessToken`; the portal has
 *   no users of its own, so nothing here needs it.
 */

const URL = import.meta.env.VITE_MR_SUPABASE_URL;
const KEY = import.meta.env.VITE_MR_SUPABASE_PUBLISHABLE_KEY;

/** The storage bucket for photos, documents and category images. Paths only are stored. */
export const MEDIA_BUCKET = "mr-media";

/** Fetch a fresh pass when less than this much of the current one remains. */
const REFRESH_MARGIN_S = 5 * 60;

export type PortalLevel = "view" | "edit";

export interface PortalPass {
  accessToken: string;
  /** Unix seconds. */
  expiresAt: number;
  level: PortalLevel;
  user: { id: string; name: string; email: string | null };
}

/** A failure the screens can word plainly, keyed by what went wrong. */
export class PortalError extends Error {
  constructor(
    public kind: "not-configured" | "signed-out" | "no-access" | "not-set-up" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

export function hasPortalConfig(): boolean {
  return Boolean(URL && KEY);
}

let pass: PortalPass | null = null;
let inFlight: Promise<PortalPass> | null = null;

// A pass belongs to one hub user. Drop it when the hub session ends or changes
// hands, or the next person at this browser would act under the last one's level.
// (Only a variable is cleared: no Supabase call inside the auth callback.)
let passOwner: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid !== passOwner) {
    pass = null;
    passOwner = uid;
  }
});

async function mintPass(): Promise<PortalPass> {
  if (!URL || !KEY) {
    throw new PortalError("not-configured", "Machine Resale is not set up on this server yet.");
  }
  const { data } = await supabase.auth.getSession();
  const hubToken = data.session?.access_token;
  if (!hubToken) throw new PortalError("signed-out", "Please sign in again.");
  passOwner = data.session?.user?.id ?? null;

  type Body = {
    access_token?: string;
    expires_at?: number;
    level?: string;
    user?: { id: string; name: string; email: string | null };
    error?: string;
  };
  // The function host now and then answers 502/503 on its own while a worker is
  // shutting down (seen 14-10 in testing: a bare 503 between two "shutdown" log
  // lines, every call around it fine). Those are retried; only the function's OWN
  // "not set up" answer is reported as such.
  let res: Response | null = null;
  let body: Body = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    try {
      res = await fetch(`${URL}/functions/v1/mr-session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hubToken}`, apikey: KEY },
      });
    } catch {
      res = null;
      continue;
    }
    body = (await res.json().catch(() => ({}))) as Body;
    const ownNotSetUp = res.status === 503 && /not set up/i.test(body.error ?? "");
    if (res.status < 500 || ownNotSetUp) break;
  }
  if (!res) throw new PortalError("unavailable", "Could not reach Machine Resale. Check the connection and try again.");
  if (res.status === 403) {
    throw new PortalError("no-access", body.error ?? "You do not have access to Machine Resale. Ask an admin for it.");
  }
  if (res.status === 401) throw new PortalError("signed-out", body.error ?? "Please sign in again.");
  if (res.status === 503 && /not set up/i.test(body.error ?? "")) {
    throw new PortalError("not-set-up", "Machine Resale is not set up on this server yet.");
  }
  if (!res.ok || !body.access_token || !body.expires_at || !body.user) {
    throw new PortalError("unavailable", body.error ?? "Could not open Machine Resale. Please try again.");
  }
  return {
    accessToken: body.access_token,
    expiresAt: body.expires_at,
    level: body.level === "edit" ? "edit" : "view",
    user: body.user,
  };
}

/**
 * The current pass, fetching a new one when it is missing or about to expire.
 * Callers that arrive while a fetch is under way share it rather than each
 * asking `mr-session` again.
 */
export async function getPortalPass(force = false): Promise<PortalPass> {
  const now = Date.now() / 1000;
  if (!force && pass && pass.expiresAt - now > REFRESH_MARGIN_S) return pass;
  if (!inFlight) {
    inFlight = mintPass()
      .then((p) => {
        pass = p;
        return p;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Forget the pass (a 401, or a sign-out) so the next call mints a new one. */
export function clearPortalPass(): void {
  pass = null;
}

async function getPortalToken(): Promise<string> {
  return (await getPortalPass()).accessToken;
}

/**
 * fetch with one retry on a 401. supabase-js sets `Authorization` from
 * `accessToken` before calling this; a rejected pass (expired early, or a grant
 * changed) is replaced and the same request is sent once more. Request bodies here
 * are JSON strings or Files, both of which can be sent twice.
 */
async function portalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  clearPortalPass();
  const fresh = await getPortalPass(true);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${fresh.accessToken}`);
  return fetch(input, { ...init, headers });
}

let client: SupabaseClient | null = null;

export function getPortalClient(): SupabaseClient {
  if (!URL || !KEY) {
    throw new PortalError("not-configured", "Machine Resale is not set up on this server yet.");
  }
  if (!client) {
    client = createClient(URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      accessToken: getPortalToken,
      global: { fetch: portalFetch },
    });
  }
  return client;
}

/** Turn a supabase-js error into a thrown Error with its own message. */
export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------------------------------------------------------------------------
// Video (Bunny Stream), through the portal's mr-video-upload function
// ---------------------------------------------------------------------------

export interface VideoTicket {
  libraryId: string;
  videoId: string;
  expires: number;
  signature: string;
  tusEndpoint: string;
}

export interface VideoStatus {
  videoId: string;
  status: "created" | "processing" | "ready" | "failed";
  encodeProgress: number;
  lengthSeconds: number;
}

/** 503 from mr-video-upload: the video service keys have not been added yet. */
export const VIDEO_NOT_SET_UP = "Video upload is not set up yet. The video service keys have not been added.";

export async function callVideoFunction(body: { action: "create"; title?: string }): Promise<VideoTicket>;
export async function callVideoFunction(body: { action: "status"; videoId: string }): Promise<VideoStatus>;
export async function callVideoFunction(body: Record<string, unknown>): Promise<unknown> {
  if (!URL || !KEY) throw new PortalError("not-configured", "Machine Resale is not set up on this server yet.");
  const send = async (token: string) =>
    fetch(`${URL}/functions/v1/mr-video-upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  let res = await send(await getPortalToken());
  if (res.status === 401) {
    clearPortalPass();
    res = await send((await getPortalPass(true)).accessToken);
  }
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 503 && /not set up/i.test(out.error ?? "")) throw new PortalError("not-set-up", VIDEO_NOT_SET_UP);
  if (!res.ok) throw new Error(out.error ?? "The video service did not answer. Please try again.");
  return out;
}

// ---------------------------------------------------------------------------
// Storage: photos, documents, category images. PATHS are stored, never URLs.
// ---------------------------------------------------------------------------

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

/** Upload one file under `folder` (e.g. `machines/<id>`), photos compressed first. Returns its path. */
export async function uploadMedia(file: File, folder: string): Promise<string> {
  const ready = file.type.startsWith("image/") ? await compressImage(file) : file;
  const ext = EXT_BY_TYPE[ready.type];
  if (!ext) throw new Error(`"${file.name}" is not a JPG, PNG, WebP, AVIF or PDF file.`);
  if (ready.size > 15 * 1024 * 1024) throw new Error(`"${file.name}" is larger than 15 MB.`);
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await getPortalClient()
    .storage.from(MEDIA_BUCKET)
    .upload(path, ready, { contentType: ready.type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`"${file.name}" could not be uploaded: ${error.message}`);
  return path;
}

export async function removeMedia(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await getPortalClient().storage.from(MEDIA_BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}

/** A viewable URL for a stored path, for previews inside the hub only (the bucket is public-read). */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path || !URL) return null;
  return `${URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
