import type { ReactNode } from "react";

/**
 * The one place @mention text is parsed and rendered.
 *
 * Mentions are stored as PLAIN TEXT — `@Ravi Kumar`, no marker syntax, no embedded
 * uuid. That is why a description or remark is safe to render raw anywhere we
 * haven't got round to highlighting (task table, dashboard, My Work, the xlsx
 * export): the worst case is an unstyled "@Name", never leaked markup.
 *
 * These regexes used to live as four separate, disagreeing copies — the composer's
 * trigger and insert patterns couldn't span a space while the highlighter spanned
 * exactly one, which is why "@Ravi Kumar Singh" could be picked from the dropdown
 * but only half of it lit up. One definition each, here.
 */

/** How many words a name may span when we scan for it. Covers "Ravi Kumar Singh". */
const NAME_WORDS = 3;

/** The trailing "@token" being typed, e.g. "@Ravi Ku" → "ravi ku". Null when not mentioning. */
export function mentionQuery(text: string): string | null {
  // Allow spaces inside the token so multi-word names are searchable, but stop at
  // NAME_WORDS so a whole sentence after an "@" doesn't count as one long query.
  const m = text.match(new RegExp(`@([\\p{L}]*(?:\\s[\\p{L}]+){0,${NAME_WORDS - 1}})$`, "u"));
  return m ? m[1].toLowerCase() : null;
}

/** Replace the trailing "@token" with the picked name. */
export function applyMention(text: string, name: string): string {
  return text.replace(
    new RegExp(`@[\\p{L}]*(?:\\s[\\p{L}]+){0,${NAME_WORDS - 1}}$`, "u"),
    `@${name} `
  );
}

/**
 * Which people are mentioned in a block of text.
 *
 * LONGEST NAME FIRST, masking each hit out of a working copy — the same algorithm as
 * the server-side `public.resolve_mentions`, deliberately. The old one-liner
 * (`body.includes("@" + p.name)`) is wrong whenever one name prefixes another: this
 * directory has both "Bharat" and "Bharat Singh", so tagging @Bharat Singh notified
 * BOTH of them. Masking fixes that while still handling the honest case where both
 * are genuinely mentioned.
 */
export function extractMentionIds<T extends { id: string; name: string }>(
  text: string,
  people: T[]
): string[] {
  if (!text || !text.includes("@")) return [];
  let rest = text;
  const ids: string[] = [];
  for (const p of [...people].filter((p) => p.name?.trim()).sort((a, b) => b.name.length - a.name.length)) {
    const token = `@${p.name}`;
    if (rest.includes(token)) {
      ids.push(p.id);
      rest = rest.split(token).join(" ");
    }
  }
  return ids;
}

/**
 * Highlight the @mentions inside a block of text.
 *
 * Matches against the REAL people list rather than "any @word", so an address like
 * "@ 5pm" or a stray "@notarealperson" stays plain — and so a multi-word name
 * highlights in full. Longest name first for the same reason the server-side
 * resolver does it: "Bharat" is a prefix of "Bharat Singh", and matching the short
 * one first would leave " Singh" dangling outside the highlight.
 */
export function renderMentions(text: string, people: { name: string }[] = []): ReactNode {
  if (!text) return text;

  const names = people
    .map((p) => p.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  // No people loaded yet (the org list resolves async) — fall back to a plain
  // one-or-two-word heuristic so mentions still read as mentions on first paint.
  const pattern = names.length
    ? names.map(escapeRegExp).join("|")
    : `[\\p{L}]+(?:\\s[\\p{L}]+)?`;

  const parts = text.split(new RegExp(`(@(?:${pattern}))`, "gu"));
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="text-orange font-medium">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
