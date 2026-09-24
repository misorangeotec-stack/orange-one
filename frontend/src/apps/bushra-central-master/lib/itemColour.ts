/**
 * COLOUR, READ OUT OF THE DESCRIPTION.
 *
 * Central Masters carries no colour column (MS-1), so this screen's Colour cell sat
 * empty on all 5,500 rows and every one of them would have had to be typed by hand.
 * It did not have to be: Tally's own item name — which is what the Description column
 * now shows — already ends in the colour for every ink and most consumables.
 * "KY REACTIVE INK PRO BLACK MCT" is black, and nothing but the reader was deciding so.
 *
 * ⚠ THIS IS A DEFAULT, NOT AN ANSWER. It is the value the cell starts at, exactly as
 *   Central's own value is for Type or Code, and it is overwritten the moment you type
 *   over it — see `centralValue` in store.ts. Nothing here is written to Tally or to
 *   `mst_items`, and a wrong guess costs one edit.
 *
 * ⚠ THE LAST COLOUR WORD WINS, and that is the rule that makes it work. Tally names
 *   run general-to-specific and finish on the colour, so a range name earlier in the
 *   line must not beat the shade at the end of it: "AQUA PREMIUM BLUE" is BLUE, not
 *   aqua, and "AQUA ABSOLUTE BLACK" is BLACK. Reading the FIRST match gets both wrong.
 *
 * Measured against all 4,744 item names holding stock on 24-09-2026: 788 carry a
 * colour. The rest are cables, bearings, pumps and spares that genuinely have none,
 * and they are left blank rather than guessed at.
 */

/**
 * The shades. Longest first: alternation is ordered, so "GOLD" listed before "GOLDEN"
 * would claim the first four letters of GOLDEN and leave the rest dangling.
 */
const BASE = [
  "TURQUOISE", "MAGENTA", "SCARLET", "CRIMSON", "VIOLET", "PURPLE", "INDIGO", "YELLOW",
  "ORANGE", "MAROON", "GOLDEN", "SILVER", "BLACK", "GREEN", "WHITE", "CREAM", "BEIGE",
  "OLIVE", "KHAKI", "LILAC", "PEACH", "BROWN", "CYAN", "BLUE", "GREY", "GRAY", "PINK",
  "GOLD", "NAVY", "TEAL", "RED",
];

/**
 * Words that qualify a shade rather than being the whole of it — "DEEP BLACK",
 * "LIGHT RED", "DARK BLUE" are real, separately stocked inks, and dropping the
 * qualifier would file them under the plain shade they are sold apart from.
 * Only counted when a shade follows, so the LIGHT in "LIGHT FITTING" is not a colour.
 */
const MODIFIER = [
  "FLUORESCENT", "TURQUOISE", "BRIGHT", "GOLDEN", "ROYAL", "LIGHT", "NEON", "DARK",
  "DEEP", "PALE", "LEMON", "NAVY", "SKY",
];

/**
 * Deliberately NOT colours here, each for its own reason — every one of them was
 * read off the real names before being excluded:
 *   AQUA    a product range ("AQUA PREMIUM CYAN"), never the shade itself.
 *   ROSE    a supplier — both occurrences are "ROSE PRINTECH".
 *   COPPER  the metal: "COPPER FLEXIBLE CABLE", "copper sulphate".
 * Add one back only after checking what it actually sits next to.
 */

const RX = new RegExp(
  `(?:\\b(${MODIFIER.join("|")})\\s+)?\\b(${BASE.join("|")})\\b`,
  "g",
);

/** "DEEP BLACK" → "Deep Black" — a grid is read, not shouted at. */
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * The colour named in an item's description, or null when it names none.
 *
 * Case-insensitive, because Tally's names are not consistently capitalised
 * ("copper sulphate ANHYDROUS" sits beside "10L CAP ORANGE").
 */
export function colourFromDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const matches = [...description.toUpperCase().matchAll(RX)];
  if (matches.length === 0) return null;
  const [, modifier, base] = matches[matches.length - 1];
  return titleCase(modifier ? `${modifier} ${base}` : base);
}
