import type { ReactNode } from "react";

/**
 * One destination the sidebar search box can find — an FMS, a report section, a single
 * report, a dashboard. Built by `core/workspace/hubSearch` from the same rules as the
 * home menu, so search can never offer something the menu would hide.
 */
export interface SearchEntry {
  label: string;
  to: string;
  icon?: ReactNode;
  /** Where it lives in the menu ("Purchase", "Reports › Receivables"), shown under the label. */
  hint?: string;
  keywords?: string[];
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** At most one letter wrong, missing or extra — "inc" finds "ink", "purchse" finds "purchase". */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How well one typed word fits one word of the entry: 3 exact/prefix, 2 inside, 1 typo, 0 none. */
function wordScore(token: string, word: string): number {
  if (word.startsWith(token)) return 3;
  if (token.length >= 3 && word.includes(token)) return 2;
  // Typo tolerance only on words long enough to mean something, and against the
  // word's same-length start so a short query still matches a long word ("inc" ~ "ink").
  if (token.length >= 3 && (nearly(token, word) || nearly(token, word.slice(0, token.length)))) return 1;
  return 0;
}

/**
 * Entries matching the query, best first. EVERY typed word must land somewhere — in the
 * name (weighted highest), the menu group, or the keywords — so "sales report" narrows
 * rather than widens. Same destination listed twice keeps only its first entry. A one-letter
 * slip is forgiven, but only when nothing matches as typed.
 */
export function searchNav(entries: SearchEntry[], query: string, limit = 30): SearchEntry[] {
  const tokens = words(query);
  if (!tokens.length) return [];

  const scored: { e: SearchEntry; score: number; idx: number; typo: boolean }[] = [];
  const seen = new Set<string>();
  entries.forEach((e, idx) => {
    if (seen.has(e.to)) return;
    const name = words(e.label);
    const rest = words([e.hint ?? "", ...(e.keywords ?? [])].join(" "));
    let total = 0;
    let typo = false;
    for (const t of tokens) {
      const inName = Math.max(0, ...name.map((w) => wordScore(t, w)));
      const inRest = Math.max(0, ...rest.map((w) => wordScore(t, w)));
      const best = Math.max(inName * 3, inRest);
      if (!best) return;
      if (Math.max(inName, inRest) === 1) typo = true;
      total += best;
    }
    // A name that starts with what was typed is almost always the one meant.
    if (e.label.toLowerCase().startsWith(query.trim().toLowerCase())) total += 10;
    seen.add(e.to);
    scored.push({ e, score: total, idx, typo });
  });

  // Typo matches only when nothing matched as typed — otherwise "ims" would also offer
  // "Purchase RM Import" (imp) under the IMS sheets it was clearly after.
  const exact = scored.filter((s) => !s.typo);
  return (exact.length ? exact : scored)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map((s) => s.e);
}
