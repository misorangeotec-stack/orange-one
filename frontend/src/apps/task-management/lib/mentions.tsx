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

/**
 * The "@token" being typed immediately BEFORE the caret.
 *
 * Anchored to the caret, not to the end of the string. That distinction is the
 * whole point: when you create a task you type left-to-right so the token is
 * always last, but when you EDIT an existing description you click into the
 * middle — an end-anchored match finds nothing there and the picker never opens.
 *
 * Allows spaces inside the token so multi-word names are searchable, capped at
 * NAME_WORDS so a whole sentence after an "@" isn't treated as one long query.
 */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(new RegExp(`@([\\p{L}]*(?:\\s[\\p{L}]+){0,${NAME_WORDS - 1}})$`, "u"));
  if (!m) return null;
  return { query: m[1].toLowerCase(), start: before.length - m[0].length };
}

/**
 * Replace the "@token" before the caret with the picked name, keeping whatever
 * follows the caret intact. Returns the new caret position so the component can
 * restore it — otherwise the cursor jumps to the end and editing mid-text is
 * just as broken as before.
 */
export function applyMentionAt(
  text: string,
  caret: number,
  name: string
): { next: string; caret: number } {
  const hit = mentionQueryAt(text, caret);
  const start = hit ? hit.start : caret;
  // Don't add a separator when the text already has one at the caret (mid-text
  // edits usually do) — that would leave a double space. Step the caret over the
  // existing one instead, which also matters because a caret sitting directly
  // after the name would re-match and immediately re-open the menu.
  const nextChar = text.slice(caret, caret + 1);
  const hasSeparator = nextChar === " " || nextChar === "\n";
  const inserted = hasSeparator ? `@${name}` : `@${name} `;
  return {
    next: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length + (hasSeparator ? 1 : 0),
  };
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
