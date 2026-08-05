import { supabase } from "@/core/platform/supabase";

/**
 * JD reading — the client half of the `parse-jd` Edge Function.
 *
 * The AI PREFILLS the requisition form; it never writes to the database. Nothing
 * here throws: a requisition must stay raisable when the parse fails, the file is
 * a legacy .doc, or the network is down — the HOD just fills the form in instead,
 * and the file still attaches either way.
 *
 * It goes through the identity Supabase client so the user's JWT rides along (the
 * function runs with verify_jwt = true — a JD carries salary and headcount).
 *
 * ── WHY THE MASTERS GO UP WITH THE FILE ──────────────────────────────────────
 * The function turns each list into an ENUM in the response schema, so what comes
 * back is guaranteed to be a name that exists. This module then maps name → id
 * case-insensitively. A JD requirement with no master entry lands in
 * `otherSkills` / `otherQualifications` rather than being dropped, so the HOD can
 * see it and request the master rather than losing the requirement silently.
 */

export interface ParsedJd {
  /** Master ids, already resolved. Empty string / empty array means "not found". */
  jobTitleId: string;
  /** The title as printed on the JD — shown when it matched no master. */
  jobTitleText: string;
  departmentId: string;
  jobTypeId: string;
  locationId: string;

  roleSummary: string;
  responsibilities: string[];

  experienceMinYears: string;
  experienceMaxYears: string;
  freshersOk: boolean;

  qualificationIds: string[];
  skillIds: string[];
  preferredSkillIds: string[];

  salaryMin: string;
  salaryMax: string;
  salaryPeriod: "month" | "annum" | "";
  incentives: string;

  /** Asked for by the JD but absent from the masters — surfaced, never dropped. */
  otherSkills: string[];
  otherQualifications: string[];

  /** Which model read it, so extraction quality stays auditable. */
  model: string;
}

export type JdParseFailure =
  /** Legacy .doc and anything else neither Claude nor the function can read. */
  | "unsupported"
  /** Reached the model, but nothing usable came back (blank scan, wrong document). */
  | "unreadable"
  /** Gave up waiting — see TIMEOUT_MS. */
  | "timeout"
  /** The caller aborted (the HOD pressed "Stop waiting"). */
  | "cancelled"
  /** Network, auth, file too big — anything else. */
  | "error";

export type JdParseResult = { ok: true; data: ParsedJd } | { ok: false; reason: JdParseFailure };

/** A named master row, as the caller holds it. */
export interface NamedMaster {
  id: string;
  name: string;
}

export interface JdMasters {
  jobTitles: NamedMaster[];
  departments: NamedMaster[];
  employmentTypes: NamedMaster[];
  locations: NamedMaster[];
  skills: NamedMaster[];
  qualifications: NamedMaster[];
}

/**
 * The one file type nothing can read: pre-2007 binary .doc. Caught in the browser
 * rather than paying a round trip for a 415 we can already predict. `.docx` is
 * NOT here — the function unzips it.
 */
const UNSUPPORTED_EXT = /\.(doc|rtf|odt|pages)$/i;

const DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * How long to wait before giving up.
 *
 * A JD reads in 15–20 seconds; a long or scanned one takes longer. This sits just
 * above the function's own ceiling (one 45s attempt plus one retry) so the server's
 * honest error normally arrives first and this only catches what never returns at
 * all. Without it, a stalled request spins forever with no way out — worse than
 * being told to fill the form in.
 */
const TIMEOUT_MS = 100_000;

/** An aborted fetch arrives wrapped in FunctionsFetchError, with the DOMException inside. */
const isAbort = (e: unknown): boolean => {
  const ctx = (e as { context?: unknown } | null)?.context;
  return (
    (ctx instanceof Error || ctx instanceof DOMException) &&
    (ctx.name === "AbortError" || ctx.name === "TimeoutError")
  );
};

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

/** Some browsers hand us an empty `file.type` — fall back to the extension. */
function guessMediaType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return DOCX_MEDIA;
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "txt") return "text/plain";
  if (ext === "md") return "text/markdown";
  return "";
}

/** Case-insensitive name → id. Built once per parse. */
const indexOf = (rows: NamedMaster[]) =>
  new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));

const idFor = (idx: Map<string, string>, name: unknown): string =>
  typeof name === "string" && name.trim() ? (idx.get(name.trim().toLowerCase()) ?? "") : "";

const idsFor = (idx: Map<string, string>, names: unknown): string[] =>
  Array.isArray(names)
    ? names.map((n) => idFor(idx, n)).filter(Boolean)
    : [];

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : [];

/**
 * Read ONE job description. Never throws — every failure comes back as
 * `{ ok: false }`, and the caller carries on with an empty form.
 */
export async function parseJd(
  file: File,
  masters: JdMasters,
  opts: { signal?: AbortSignal } = {},
): Promise<JdParseResult> {
  try {
    if (UNSUPPORTED_EXT.test(file.name)) return { ok: false, reason: "unsupported" };

    const mediaType = file.type || guessMediaType(file.name);
    const data = await toBase64(file);

    const { data: body, error } = await supabase.functions.invoke("parse-jd", {
      body: {
        file: { media_type: mediaType, data, name: file.name },
        // Names only — the ids never leave the browser, so the function has
        // nothing to leak and the schema stays readable.
        masters: {
          job_titles: masters.jobTitles.map((r) => r.name),
          departments: masters.departments.map((r) => r.name),
          employment_types: masters.employmentTypes.map((r) => r.name),
          locations: masters.locations.map((r) => r.name),
          skills: masters.skills.map((r) => r.name),
          qualifications: masters.qualifications.map((r) => r.name),
        },
      },
      signal: opts.signal,
      timeout: TIMEOUT_MS,
    });

    if (error) {
      // An abort is either the HOD pressing "Stop waiting" or our own ceiling —
      // the caller's signal tells the two apart, and they read very differently.
      if (isAbort(error)) return { ok: false, reason: opts.signal?.aborted ? "cancelled" : "timeout" };

      // functions.invoke turns any non-2xx into an error; the real status is on the
      // raw Response, and 415 vs 422 changes what we tell the user.
      const status = (error as { context?: Response }).context?.status;
      if (status === 415) return { ok: false, reason: "unsupported" };
      if (status === 422 || status === 413) return { ok: false, reason: "unreadable" };
      return { ok: false, reason: "error" };
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    const titleIdx = indexOf(masters.jobTitles);
    const deptIdx = indexOf(masters.departments);
    const typeIdx = indexOf(masters.employmentTypes);
    const locIdx = indexOf(masters.locations);
    const skillIdx = indexOf(masters.skills);
    const qualIdx = indexOf(masters.qualifications);

    const mustHave = idsFor(skillIdx, b.must_have_skills);
    // A skill the JD lists as both essential and preferred is a must-have — keep
    // one meaning per skill so the two chips rows never contradict each other.
    const preferred = idsFor(skillIdx, b.good_to_have_skills).filter((id) => !mustHave.includes(id));

    const period = str(b.salary_period);

    return {
      ok: true,
      data: {
        jobTitleId: idFor(titleIdx, b.job_title),
        jobTitleText: str(b.job_title_text),
        departmentId: idFor(deptIdx, b.department),
        jobTypeId: idFor(typeIdx, b.employment_type),
        locationId: idFor(locIdx, b.location),

        roleSummary: str(b.role_summary),
        responsibilities: strList(b.responsibilities),

        experienceMinYears: str(b.experience_min_years),
        experienceMaxYears: str(b.experience_max_years),
        freshersOk: str(b.freshers_ok) === "yes",

        qualificationIds: idsFor(qualIdx, b.qualifications),
        skillIds: mustHave,
        preferredSkillIds: preferred,

        salaryMin: str(b.salary_min),
        salaryMax: str(b.salary_max),
        salaryPeriod: period === "month" || period === "annum" ? period : "",
        incentives: str(b.incentives),

        otherSkills: strList(b.other_skills),
        otherQualifications: strList(b.other_qualifications),

        model: str(b.model),
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}
