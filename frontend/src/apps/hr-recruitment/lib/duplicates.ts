import type { Candidate } from "../types";

/**
 * Is this CV already on this vacancy?
 *
 * ⚠ MIRRORS the SQL in `fms_hr_norm_*` / `fms_hr_candidate_duplicate` EXACTLY.
 * Change one and you must change the other, or the modal will show a warning the
 * RPC does not enforce — or, worse, refuse to save something the RPC would accept.
 * (Same arrangement as receivables-hub's GstinGate, for the same reason.)
 *
 * ── Why five signals and not the two we had ─────────────────────────────────────
 *
 * `duplicatesOf` used to compare phone and email only, and returned `[]` when both
 * were missing. **30 of the 119 live candidate rows have neither** — the CV parser
 * failed or never ran — so for a quarter of the data no warning was possible. Two
 * people were entered twice on the Executive Assistant vacancy and one was entered
 * twice on Finance manager while sitting at Interview Round 3, none of which the old
 * check could see.
 *
 * Measured against the six duplicate groups actually live on 05-Sep-2026, NO SINGLE
 * SIGNAL CATCHES THEM ALL — email/phone gets 3, filename gets 4, name gets 4:
 *
 *   Harsha Jain ×2    email + phone + name        (two different CV files)
 *   Kajal Bhalerao ×3 email + phone + name + file ("Kajal Bhalerao (1).pdf")
 *   Sunil Sharma ×2   filename + name only        (one row has no contact details)
 *   CA Vandit Mehta×2 filename + name only        (both at Interview R3 — the dangerous one)
 *   Manali Desai ×2   all five
 *   Purvi Upadhyay ×2 filename only               (no email, no phone, on either row)
 *
 * Together they catch all six. That is the whole argument for the extra three.
 */

/* -------------------------------------------------------------------------- */
/*  Normalisers — each one earns its place from a real row that got past us.    */
/* -------------------------------------------------------------------------- */

/** Matches `fms_hr_candidates_email_idx`, which is `lower(email)`. */
export const normEmail = (v: string | null | undefined): string | null =>
  v?.trim().toLowerCase() || null;

/**
 * Last ten digits. `+91 9723542928` and `9723542928` are one phone number, and
 * the old check compared them as raw strings, so they were not.
 */
export const normPhone = (v: string | null | undefined): string | null => {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Filenames that say nothing about WHO the CV belongs to. Two different people
 * both sending "Resume.pdf" is not evidence of anything, and treating it as
 * evidence would block a real hire — which is worse than the bug being fixed.
 */
const GENERIC_FILE_NAMES = new Set([
  "resume",
  "cv",
  "curriculumvitae",
  "biodata",
  "document",
  "untitled",
  "download",
  "attachment",
]);

/**
 * Auto-generated filenames: WhatsApp exports, camera rolls, scanner output. They
 * encode a DATE, not an identity.
 *
 * This is not hypothetical. CAN-2627-0033 and CAN-2627-0040 — two candidates on
 * two different vacancies — both carry the byte-identical name
 * `DOC-20260604-WA0001. (1).pdf`, because both CVs arrived over WhatsApp and were
 * uploaded without renaming. Without this list they normalise to the same key and
 * get reported as the same person, which nobody can actually tell from the data.
 */
const AUTO_FILE_NAME: RegExp[] = [
  /^(?:doc|img|vid|aud|ptt|mvimg)\d{6,}wa\d+$/, // WhatsApp — DOC-20260604-WA0001
  /^(?:img|dsc|pxl|mvimg)\d{3,}$/, // camera roll — IMG_1234
  /^screenshot/, // Screenshot 2026-06-04 at 11.04
  /^scan(?:ned)?\d*$/,
  /^(?:image|photo|file|doc|document|new)\d*$/,
  /^\d+$/, // a bare timestamp
];

/**
 * The CV's own filename, folded onto the thing two copies have in common.
 *
 * Three real transformations, in order:
 *   "Kajal Bhalerao (2).pdf"              → kajalbhalerao   (browser download collision)
 *   "1787824267285-Sunil_Sharma_CV.pdf"   → sunilsharmacv   (an upload-id prefix, re-downloaded)
 *   "Manali Desai_CV.pdf"                 → manalidesaicv
 *
 * ⚠ Deliberately does NOT strip "cv"/"resume" tokens the way normPersonName does.
 * A filename is not a name: stripping them collapses "Resume.pdf" to nothing, and
 * every generic CV in the batch would match every other one. The stop-list above
 * handles that case honestly instead, by declining to answer.
 */
export const normResumeName = (v: string | null | undefined): string | null => {
  const base = (v ?? "")
    .trim()
    .replace(/\.[^./\\]+$/, "") // extension
    .replace(/^\d{8,}[-_\s]+/, "") // upload-id / epoch prefix
    .replace(/[\s_-]*\(\d+\)$/, "") // "(1)", "(2)" — the browser's collision suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!base || GENERIC_FILE_NAMES.has(base)) return null;
  if (AUTO_FILE_NAME.some((re) => re.test(base))) return null;
  return base;
};

/**
 * Tokens that ride along on a name lifted from a filename. Nobody is called CV,
 * so removing these from a PERSON's name is safe in a way it is not for a file.
 *
 * This is what makes the name signal work at all: when the parser fails, the name
 * is derived from the filename, so the live data holds "CV   CA Vandit Mehta",
 * "Sunil Sharma CV" and "Purvi Upadhyay   EA" beside their properly-parsed twins.
 */
const NAME_NOISE =
  /\b(cv|resume|resumes|curriculumvitae|curriculum|vitae|biodata|naukri|final|updated|new|copy|doc|document|img|image|photo|file|scan|scanned|screenshot|whatsapp|wa|vid|aud)\b/g;

export const normPersonName = (v: string | null | undefined): string | null => {
  const base = (v ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "") // a name that is still literally a filename
    .replace(/[^a-z\s]/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/[^a-z]/g, "");
  // Two letters is not a name — it is an initial, or the remains of one.
  return base.length >= 3 ? base : null;
};

/* -------------------------------------------------------------------------- */
/*  Matching                                                                    */
/* -------------------------------------------------------------------------- */

export type DupSignal = "file" | "email" | "phone" | "resume" | "name";

/**
 * How sure we are, and therefore what the UI is entitled to do about it.
 *
 * `certain` — the same file, the same email or the same phone. Not a judgement
 *   call, so on the SAME vacancy it blocks, and the RPC enforces the same rule.
 * `likely` — the same filename or the same normalised name. Two real people can
 *   share a name, so this asks rather than refuses.
 */
export type DupConfidence = "certain" | "likely";

const CERTAIN: ReadonlySet<DupSignal> = new Set<DupSignal>(["file", "email", "phone"]);

export interface DupMatch {
  candidate: Candidate;
  /** Every signal that fired, strongest first. Rendered so HR can see WHY. */
  signals: DupSignal[];
  confidence: DupConfidence;
  /** Same vacancy = data corruption. Different vacancy = a legitimate second application. */
  sameRequisition: boolean;
}

/**
 * The identifying fields, however they arrive — a saved candidate row, or a row
 * still being typed into the Add-candidates modal. Having one shape lets the same
 * comparison serve both, which is what stops the two from drifting apart.
 */
export interface DupIdentity {
  name: string | null;
  phone: string | null;
  email: string | null;
  resumeName: string | null;
  /** SHA-256 of the file itself. Null when it could not be computed — see fileSha256. */
  sha256: string | null;
}

/** What we know about the CV being added, before it is saved. */
export interface DupProbe extends DupIdentity {
  /** Set when re-checking a candidate that already exists, so it cannot match itself. */
  excludeId?: string;
}

const identityOf = (c: Candidate): DupIdentity => ({
  name: c.name,
  phone: c.phone,
  email: c.email,
  resumeName: c.resumeName,
  sha256: c.resumeSha256,
});

/**
 * Every signal on which these two look like the same person. Empty = they do not.
 *
 * The single comparison in this module: `matchesOf` runs it against saved rows,
 * and the modal runs it between two rows of one batch.
 */
export function signalsBetween(a: DupIdentity, b: DupIdentity): DupSignal[] {
  const out: DupSignal[] = [];
  const sha = a.sha256?.trim() || null;
  const email = normEmail(a.email);
  const phone = normPhone(a.phone);
  const resume = normResumeName(a.resumeName);
  const name = normPersonName(a.name);

  if (sha && b.sha256 && b.sha256 === sha) out.push("file");
  if (email && normEmail(b.email) === email) out.push("email");
  if (phone && normPhone(b.phone) === phone) out.push("phone");
  if (resume && normResumeName(b.resumeName) === resume) out.push("resume");
  if (name && normPersonName(b.name) === name) out.push("name");
  return out;
}

export const confidenceOf = (signals: DupSignal[]): DupConfidence =>
  signals.some((s) => CERTAIN.has(s)) ? "certain" : "likely";

export const SIGNAL_LABEL: Record<DupSignal, string> = {
  file: "the identical CV file",
  email: "the same email address",
  phone: "the same phone number",
  resume: "the same CV filename",
  name: "the same name",
};

/**
 * "the identical CV file, the same email address and the same name".
 *
 * Joined properly because all five can fire at once, and "A and B and C and D"
 * reads like a stammer in the one sentence that has to be convincing.
 */
export function describeSignals(signals: DupSignal[]): string {
  const parts = signals.map((s) => SIGNAL_LABEL[s]);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The DISTINCT vacancies a set of matches sits on.
 *
 * Distinct matters: where the other vacancy itself holds two rows for this person
 * — which is the very defect being fixed, and true of three vacancies today — a
 * plain map produced "Also applied to MRF-2627-0019, MRF-2627-0019".
 */
export function matchedRequisitionIds(matches: DupMatch[]): string[] {
  return [...new Set(matches.map((m) => m.candidate.requisitionId))];
}

/**
 * Everyone in `pool` who looks like the same person as `probe`.
 *
 * Ordered strongest first — same vacancy before other vacancies, certain before
 * likely — because the first card is the one HR will read.
 */
export function matchesOf(probe: DupProbe, pool: Candidate[], requisitionId: string): DupMatch[] {
  // Nothing identifying at all — a blank row mid-typing. Say nothing rather than
  // matching everything.
  if (!normEmail(probe.email) && !normPhone(probe.phone) && !normResumeName(probe.resumeName)
      && !normPersonName(probe.name) && !probe.sha256?.trim()) {
    return [];
  }

  const out: DupMatch[] = [];
  for (const c of pool) {
    if (c.id === probe.excludeId) continue;
    const signals = signalsBetween(probe, identityOf(c));
    if (!signals.length) continue;
    out.push({
      candidate: c,
      signals,
      confidence: confidenceOf(signals),
      sameRequisition: c.requisitionId === requisitionId,
    });
  }

  const weight = (m: DupMatch) => (m.sameRequisition ? 0 : 2) + (m.confidence === "certain" ? 0 : 1);
  return out.sort((a, b) => weight(a) - weight(b));
}

/**
 * Would this row be refused?
 *
 * ONLY a certain match on the SAME vacancy. Applying to two vacancies is normal
 * and stays a note; a shared name is a question, not a fact.
 */
export const isBlocking = (m: DupMatch): boolean => m.sameRequisition && m.confidence === "certain";

/** A same-vacancy likely match: not refused, but it must be acknowledged. */
export const needsAck = (m: DupMatch): boolean => m.sameRequisition && m.confidence === "likely";

/* -------------------------------------------------------------------------- */
/*  The file fingerprint                                                        */
/* -------------------------------------------------------------------------- */

/**
 * SHA-256 of the file's bytes, as lowercase hex.
 *
 * The only signal that is PROOF rather than inference: every duplicate that got
 * past the old check was literally the same PDF uploaded a second time.
 *
 * ⚠ Returns null rather than throwing. `crypto.subtle` exists only in a secure
 * context — localhost and https, but NOT a dev server reached over a LAN IP — and
 * a CV that cannot be hashed must still be addable. The other four signals cover
 * it. This modal's whole design principle is that the candidate is creatable no
 * matter what fails around them.
 */
export async function fileSha256(file: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
