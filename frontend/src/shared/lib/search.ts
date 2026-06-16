/**
 * Shared free-text search helpers, used by every search box in the app.
 *
 * The naive approach — `haystack.toLowerCase().includes(query.toLowerCase())` —
 * only matches when the query is a *contiguous* substring. That breaks the
 * moment the stored text differs from what the user types by a space or a bit of
 * punctuation: a title saved as "IMS SHEET-INK" (or "IMS  SHEET -INK" with a
 * double space) won't match a typed "IMS SHEET -INK", even though every word is
 * there. Searching a single word like "IMS" still works, which is exactly the
 * confusing "the space breaks it" behaviour users hit.
 *
 * `matchesSearch` fixes this by normalising punctuation/whitespace away and
 * requiring every query *term* to appear (in any order), so word-by-word search
 * just works.
 */

/**
 * Lowercase and reduce a string to space-separated word tokens: every run of
 * non-(letter/number) characters becomes a single space. So "IMS SHEET-INK",
 * "IMS  SHEET -INK" and "ims sheet - ink" all normalise to "ims sheet ink".
 * Unicode-aware, so accented names survive.
 */
export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Whitespace- and punctuation-tolerant match. Splits `query` into terms and
 * returns true only if EVERY term appears somewhere in the combined `fields`
 * (order-independent, substring per term). An empty/whitespace-only query
 * matches everything.
 *
 * @example matchesSearch("IMS SHEET -INK", task.title) // true for "IMS SHEET-INK"
 * @example matchesSearch(q, customer.name, customer.id) // search across two fields
 */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const terms = normalizeText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalizeText(fields.join(" "));
  return terms.every((term) => haystack.includes(term));
}
