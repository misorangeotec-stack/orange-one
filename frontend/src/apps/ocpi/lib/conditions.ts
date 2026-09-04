import type { OcpiDeal } from "../types";
import { isUsdDealRow, type DealFacts } from "./fieldSpec";
import { resolve } from "./tokens";

/**
 * Conditional template text — the sibling of `{{token}}`, and the answer to
 * OCPI-31 and OCPI-33.
 *
 * 🔴 BOTH BUGS WERE THE SAME BUG: a condition the code already knew about,
 *    written as UNCONDITIONAL TEXT inside a machine template. On a deal whose
 *    dryer category means "no dryer", OCPI-8 correctly removed the four
 *    deal-derived dryer rows from both papers — and the machine's own wording
 *    went on selling a dryer, including in the priced line the customer signs
 *    under TOTAL NET AMOUNT OF THE SUPPLY. The forex clause was the same shape:
 *    `quotationPdf.ts` prints it on dollar deals alone and says why, while the
 *    order confirmation carried it on every deal because it is literal text
 *    inside SALE CONDITIONS.
 *
 * ⚠ WHY NOT A TOKEN, WHICH WAS THE OBVIOUS CHEAP ROUTE. Three reasons, and the
 *   first is fatal on its own:
 *     · `resolve()` treats an empty value as MISSING and prints the ruled blank.
 *       A `{{dryer_clause}}` resolving to "" would print `________`, so "no
 *       renderer change" was never true.
 *     · The spec rows would need machine-specific electrical data — "Dryer：
 *       AC380V three phase｜16 kW" — carried in code rather than in the template.
 *     · The forex clause is worded FOUR ways across the four machines that carry
 *       it ("Forex Impact Clause:", "Forex Clause Impact:", and one unlabelled
 *       trailing sentence). One token flattens four wordings into one, which is
 *       a content change to a signed document beyond the fix.
 *   A per-section visibility flag was the other candidate and reaches neither
 *   `supply_description` nor `spec_rows`, which are not sections — and the forex
 *   clause is ONE LINE inside a section that must keep printing.
 *
 * ⚠ IT LIVES HERE AND NOT IN `tokens.ts`, DELIBERATELY. `frontend/scripts/
 *   ocpi-field-map.mjs` — the OCPI-23 map, `npm run field-map` — reads
 *   `tokens.ts` as TEXT, slicing it from `export function tokensFor` to the
 *   `const TOKEN_RE` line and throwing if that shape changes. A sibling file
 *   removes the coupling and leaves `resolve()` byte-identical.
 *
 * ⚠ THE FAILURE MODE IS "MARKERS PRINT", NEVER "TEXT VANISHES". Every rule below
 *   is chosen so that the worst outcome is visible on the page and reported to
 *   the template author, because `[` and `]` are not in pdfBrand's
 *   `GLYPH_FALLBACK` and Poppins carries both — a leaked marker renders crisply
 *   on a customer's contract. That is bad; silently deleting a clause is worse.
 */

/** What each condition is worth on one deal. */
export type Conditions = Record<string, boolean>;

/**
 * The conditions a template author may use.
 *
 * ⚠ THE VOCABULARY IS CLOSED, and small on purpose. Each name is a rule that
 *   already exists somewhere else in the module; none of them is invented here.
 *   A name this table does not carry is reported in the template editor.
 */
export const CONDITION_HELP: { name: string; means: string }[] = [
  {
    name: "dryer",
    means:
      "this deal carries a dryer — false on a dryer category that means none, and on Sublimation / Other / POD",
  },
  { name: "centering", means: "the deal includes a centering device" },
  { name: "usd", means: "the deal is quoted in dollars" },
];

/*
  ⚠ SINGLE LINE ONLY, AND THE `[^\n]` IS THE LOAD-BEARING PART. A body matcher of
    `[\s\S]*?` would pair a stray opening marker on line 3 with a closing one on
    line 40 and silently delete thirty-seven lines of a contract. Bounded to one
    line, the worst mispairing leaves markers on the page, where somebody sees
    them. Every real site in the twenty-one templates is one line or a fragment
    of one, so nothing is given up for it.

  ⚠ THE PATTERNS ARE STRINGS AND THE RegExp IS BUILT PER CALL. A module-level
    /g/ regex carries `lastIndex` between calls — the footgun `tokensUsedIn` in
    tokens.ts already has to step around with an explicit reset. Building fresh
    costs nothing at this scale and cannot be got wrong.
*/
const COND_SRC = "\\[\\[if\\s+(!?)\\s*([a-z0-9_]+)\\s*\\]\\]([^\\n]*?)\\[\\[\\/if\\]\\]";
/** Any marker at all, opening or closing — for counting and for stripping. */
const MARKER_SRC = "\\[\\[\\s*(\\/?)\\s*if\\b[^\\]\\n]*\\]\\]";

/**
 * Are this line's markers a FLAT, CLOSED sequence — open, close, open, close?
 *
 * 🔴 THIS EXISTS BECAUSE THE MATCHER ALONE DELETED WORDS. A lazy body matcher
 *    reads `x[[if dryer]]a[[if usd]]b[[/if]]c[[/if]]y` as one block whose body is
 *    `a[[if usd]]b`, so a false `dryer` threw away "a" and "b" — two words gone
 *    from a contract, with only the leftover `[[/if]]` to show for it. Caught by
 *    the harness before any template used a marker, which is the only reason it
 *    is a comment rather than an incident.
 *
 * A line that fails this is not evaluated at all: its markers are stripped, every
 * word is kept, and the author is told. Refusing to act on an instruction nobody
 * can read is the whole doctrine of this file.
 */
function flatAndClosed(line: string): boolean {
  const re = new RegExp(MARKER_SRC, "gi");
  let m: RegExpExecArray | null;
  let open = false;
  while ((m = re.exec(line))) {
    if (m[1] === "/") {
      if (!open) return false;
      open = false;
    } else {
      if (open) return false;
      open = true;
    }
  }
  return !open;
}

export interface ConditionResult {
  text: string;
  /** Condition names the resolver does not know — reported, never obeyed. */
  unknown: string[];
  /** A marker was left unpaired, or nested. Reported; the content is kept. */
  unbalanced: boolean;
  /**
   * The text said something and a condition emptied it.
   *
   * ⚠ THIS IS WHAT LETS A SPEC ROW OR A BULLET DISAPPEAR RATHER THAN GO BLANK.
   *   jsPDF's `splitTextToSize("")` returns `[""]`, not `[]`, so an emptied
   *   value still draws a fully bordered 17pt row labelled "Dryer" with nothing
   *   in it, and an emptied bullet still draws its orange dot. The flag is
   *   trustworthy because `resolve()` can never shrink a non-empty string to
   *   empty — an unanswered token becomes a ruled blank — so an emptied string
   *   is unambiguously a condition's doing.
   */
  emptied: boolean;
}

/**
 * Resolve every conditional in a string.
 *
 * ⚠ AN UNKNOWN CONDITION KEEPS ITS CONTENT. The module's `NO_DEAL_FACTS` picks
 *   the OPEN default for the same reason and states it: an open default costs
 *   nothing and a closed one silently eats data. Here the asymmetry is sharper
 *   still — failing open leaves exactly today's wording and lights a red card in
 *   the template editor, while failing closed deletes words from a contract with
 *   nothing anywhere to say so.
 *
 * ⚠ A LINE THAT CARRIED A MARKER AND CAME OUT EMPTY IS DROPPED — and a line that
 *   was ALREADY blank is kept. The difference is the whole rule: the blank line
 *   before "Bank Details:" is deliberate paragraph spacing, while the blank left
 *   where a clause used to be is debris. Both shapes are live: Rocket's dryer
 *   paragraph sits between two blank lines, and Position Printer's forex
 *   sentence is the last line of its section with a blank line above it.
 */
export function applyConditions(text: string, conditions: Conditions): ConditionResult {
  // A template with no markers is returned byte for byte. This fast path is what
  // makes "nothing changes on the templates nobody edited" a fact, not a hope.
  if (!text || !text.includes("[[")) {
    return { text, unknown: [], unbalanced: false, emptied: false };
  }

  const cond = new RegExp(COND_SRC, "gi");
  const marker = new RegExp(MARKER_SRC, "gi");
  const unknown = new Set<string>();
  let unbalanced = false;

  const keepWords = (line: string): string | null => {
    unbalanced = true;
    marker.lastIndex = 0;
    const bare = line.replace(marker, "");
    return bare.trim() === "" ? null : bare;
  };

  // null marks a line a condition emptied — kept distinct from "" so the repair
  // below can tell debris from deliberate spacing.
  const out: (string | null)[] = text.split("\n").map((line) => {
    if (!line.includes("[[")) return line;

    // Unbalanced or nested: strip and keep, never evaluate. See `flatAndClosed`.
    if (!flatAndClosed(line)) return keepWords(line);

    cond.lastIndex = 0;
    const next = line.replace(cond, (_m, neg: string, name: string, body: string) => {
      const key = name.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(conditions, key)) {
        unknown.add(key);
        return body;
      }
      return (neg === "!" ? !conditions[key] : conditions[key]) ? body : "";
    });

    // A backstop for the structurally valid but unreadable — `[[if 2-fast]]`
    // passes the balance check and the matcher cannot pair it, so nothing was
    // replaced and every word is still here. Strip and report.
    marker.lastIndex = 0;
    if (marker.test(next)) return keepWords(next);

    return next.trim() === "" ? null : next;
  });

  /*
    The local repair. Dropping a line between two blank lines leaves a DOUBLED
    paragraph gap where there was one, and dropping the last line leaves the
    blank above it dangling. Repair at the drop site only — a global "collapse
    every run of blanks" would quietly reformat the sections nobody touched.
  */
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    let j = i;
    while (j + 1 < out.length && out[j + 1] === null) j++;
    const prev = i - 1;
    const next = j + 1;
    if (next >= out.length) {
      // The run reached the end: what is above it is now trailing whitespace.
      for (let k = prev; k >= 0 && out[k] !== null && out[k]!.trim() === ""; k--) out[k] = null;
    } else {
      const prevBlank = prev < 0 || (out[prev] !== null && out[prev]!.trim() === "");
      const nextBlank = out[next] !== null && out[next]!.trim() === "";
      // One gap, not two.
      if (prevBlank && nextBlank) out[next] = null;
    }
    i = j;
  }

  const result = out.filter((l): l is string => l !== null).join("\n");
  return {
    text: result,
    unknown: [...unknown],
    unbalanced,
    emptied: text.trim() !== "" && result.trim() === "",
  };
}

/**
 * Conditions first, tokens second — and the order is not a preference.
 *
 * 🔴 DEAL DATA MUST NEVER BECOME TEMPLATE SYNTAX. `payment_terms`, `remarks`,
 *    `centering_details` and the customer's own address are free text a
 *    salesperson types. Substitute tokens first and a value carrying an opening
 *    marker would be read as an instruction on the contract it was typed into.
 *    Only an admin edits templates; this ordering is what keeps that true.
 *
 * ⚠ AND `{{bank_block}}` RESOLVES TO FIVE LINES. A line-local conditional pass
 *   running after it would see one line become five and lose track of which line
 *   a marker was on.
 */
export function render(
  text: string,
  tokens: Record<string, string | null>,
  conditions: Conditions,
): { text: string; unresolved: string[]; unknownConditions: string[]; unbalanced: boolean; emptied: boolean } {
  const c = applyConditions(text, conditions);
  const r = resolve(c.text, tokens);
  return {
    text: r.text,
    unresolved: r.unresolved,
    unknownConditions: c.unknown,
    unbalanced: c.unbalanced,
    emptied: c.emptied,
  };
}

/** Every condition a template uses — for the editor's "is this recognised?" card. */
export function conditionsUsedIn(text: string): string[] {
  if (!text || !text.includes("[[")) return [];
  const out = new Set<string>();
  const re = new RegExp("\\[\\[if\\s+!?\\s*([a-z0-9_]+)\\s*\\]\\]", "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.add(m[1].toLowerCase());
  return [...out];
}

/**
 * Does this text carry a marker that will not resolve as written?
 *
 * ⚠ A DIFFERENT MISTAKE FROM AN UNKNOWN NAME, so the editor reports it
 *   separately. A misspelt condition prints today's wording on every deal; an
 *   unclosed marker prints on none of them and means the author's intent is
 *   simply absent. One message for both would tell a reader neither.
 */
export function hasUnbalancedMarkers(text: string): boolean {
  if (!text || !text.includes("[[")) return false;
  // The same two tests `applyConditions` makes, in the same order: a line whose
  // markers do not nest flatly, or a pair the matcher cannot read.
  return text
    .split("\n")
    .some((line) => line.includes("[[") &&
      (!flatAndClosed(line) || line.replace(new RegExp(COND_SRC, "gi"), "").includes("[[")));
}

/**
 * What each condition is worth on one deal — the mirror of `tokensFor`.
 *
 * ⚠ EVERY PREDICATE IS A RULE THAT ALREADY EXISTS. Nothing is invented here, and
 *   that is the point: a fourth opinion about whether a deal carries a dryer is
 *   how the form, the server and the paper come to disagree.
 *
 *   `dryer` is byte-for-byte `hasDryerShipment` in branching.ts, whose own twin
 *   is `v_dryer_ships` in `fms_ocpi_write_oc`. It is NOT `dryerIncluded === true`
 *   — a false there means the dryer is charged OUTSIDE the machine price, and
 *   the same page then prints "Dryer Value INR" eleven lines further down, so
 *   suppressing the words would deny a dryer the customer is being invoiced for.
 *   And it is NOT a `dryer_type` string match: that column holds a NAME, and
 *   matching "Not Applicable" would switch this branch off silently the day
 *   somebody renamed the category in Masters.
 *
 *   `centering` is the same truthiness test `optionalExtras` already uses for
 *   the composition bullet, so the priced supply line and the bullets printed
 *   thirty points below it cannot contradict each other. A null answer counts as
 *   no, exactly as it already does for the bullet — and two Homer K32 deals that
 *   never answered the question do lose the words on their next reprint, which
 *   was put to Ritesh Bhai and taken deliberately.
 *
 *   `usd` reads the stored currency, which is what the money rows forty lines
 *   above the clause branch on. `isUsdDeal` is the draft-side predicate and
 *   carries a high-seas disjunct this one deliberately drops — see its note in
 *   fieldSpec.ts.
 */
export function conditionsFor({ deal, facts }: { deal: OcpiDeal; facts: DealFacts }): Conditions {
  return {
    dryer: facts.showsDryer && !facts.noDryerCategory,
    centering: deal.inclCentering === true,
    usd: isUsdDealRow(deal),
  };
}
