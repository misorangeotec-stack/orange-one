import { supabase } from "@/core/platform/supabase";

/**
 * CV reading — the client half of the `parse-resume` Edge Function.
 *
 * The AI PREFILLS the review rows; it never writes to the database. Nothing here
 * throws: a candidate must stay creatable even when the parse fails, the file is a
 * .docx, or the network is down — the human just types the details in instead.
 *
 * It goes through the identity Supabase client so the user's JWT rides along
 * (the function runs with verify_jwt = true — resumes are PII).
 */

export interface ParsedResume {
  name: string;
  phone: string;
  email: string;
  currentCompany: string;
  experienceYears: number | null;
  skills: string[];
  /** Which model read it — kept in parsed_json so extraction quality stays auditable. */
  model: string;
}

export type ParseFailure =
  /** .doc/.docx and anything else Claude cannot read as a document. */
  | "unsupported"
  /** Reached the model, but nothing usable came back (garbage scan, blank page). */
  | "unreadable"
  /** Network, timeout, auth, file too big — anything else. */
  | "error";

export type ParseResult = { ok: true; data: ParsedResume } | { ok: false; reason: ParseFailure };

/** Word files are the common one — say so, rather than a vague "couldn't read it". */
const UNSUPPORTED_EXT = /\.(docx?|rtf|odt|pages)$/i;

/** FileReader → the bare base64 payload (the `data:...;base64,` prefix is stripped). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = typeof reader.result === "string" ? reader.result : "";
      const comma = s.indexOf(",");
      resolve(comma === -1 ? s : s.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Read ONE CV. Never throws — every failure comes back as `{ ok: false }`.
 *
 * We short-circuit Word files in the browser rather than paying a round trip for a
 * 415 we can already predict from the extension.
 */
export async function parseResume(file: File): Promise<ParseResult> {
  try {
    const mediaType = file.type || "";
    if (UNSUPPORTED_EXT.test(file.name) || (!!mediaType && !isSupported(mediaType))) {
      return { ok: false, reason: "unsupported" };
    }

    const data = await toBase64(file);
    const { data: body, error } = await supabase.functions.invoke("parse-resume", {
      body: { file: { media_type: mediaType || guessMediaType(file.name), data, name: file.name } },
    });

    if (error) {
      // functions.invoke turns any non-2xx into an error; the real status/body is on
      // the raw Response, and 415 vs 422 changes what we tell HR.
      const status = (error as { context?: Response }).context?.status;
      if (status === 415) return { ok: false, reason: "unsupported" };
      if (status === 422) return { ok: false, reason: "unreadable" };
      return { ok: false, reason: "error" };
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const years = typeof b.experience_years === "number" ? b.experience_years : null;

    return {
      ok: true,
      data: {
        name: str(b.name),
        phone: str(b.phone),
        email: str(b.email),
        currentCompany: str(b.current_company),
        experienceYears: years,
        skills: Array.isArray(b.skills)
          ? b.skills.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim())
          : [],
        model: str(b.model),
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}

const SUPPORTED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
]);

const isSupported = (mediaType: string) => SUPPORTED.has(mediaType.toLowerCase());

/** Some browsers hand us an empty `file.type` — fall back to the extension. */
function guessMediaType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "txt") return "text/plain";
  return "";
}

/**
 * Read a BATCH of CVs — HR drops in 20–50 at a time, so they run in parallel with a
 * cap rather than one-at-a-time (slow) or all-at-once (rate limits). `onEach` fires
 * as each one lands, so the rows fill in progressively instead of in one jump.
 */
export async function parseResumes(
  files: { key: string; file: File }[],
  opts: { concurrency?: number; onEach: (key: string, result: ParseResult) => void },
): Promise<void> {
  const limit = Math.max(1, opts.concurrency ?? 3);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const { key, file } = files[i];
      const result = await parseResume(file);
      opts.onEach(key, result);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
}
