/**
 * Where a portalled dropdown menu goes, given its trigger.
 *
 * Every menu in the app (Combobox, MultiSelect) is rendered into <body> at
 * `position: fixed` so it escapes the `overflow-hidden` of whatever Card or
 * table it was opened inside. That escape is also what leaves the VIEWPORT as
 * the only edge still able to cut it off: a picker sitting low on the screen
 * drew its list straight off the bottom of the page, and the rows below the fold
 * were unreachable — the item picker on the sales-order grid, which lives at the
 * foot of a long form, is where this is felt.
 *
 * So: keep the menu under the trigger while it fits, FLIP it above when there is
 * more room there, and either way hand back the `maxHeight` that actually fits
 * on screen — the list then scrolls inside the menu instead of off the page.
 */

export interface MenuPos {
  /** Set when the menu hangs below its trigger. */
  top?: number;
  /** Set INSTEAD of `top` when it is flipped above — CSS `bottom`, off the viewport. */
  bottom?: number;
  left?: number;
  right?: number;
  minWidth: number;
  /** Always set. The menu must own a scroll area rather than overflow the screen. */
  maxHeight: number;
}

const GAP = 4; // breathing room between trigger and menu
const EDGE = 8; // never sit flush against the viewport edge

/**
 * The smallest menu worth flipping for. Below this, both sides are unusable and
 * flipping just moves the problem — so stay put and let the list scroll.
 */
const MIN_HEIGHT = 140;

/** Row/chrome heights used to guess how tall a menu WANTS to be (see `menuHeightFor`). */
const ROW = 38;
const LIST_MAX = 240; // matches the `max-h-60` on every menu's <ul>
const SEARCH_BOX = 53;
const HEADER_BAR = 33;

/**
 * A rough natural height for a menu of `rowCount` rows. Only ever used to decide
 * WHETHER to flip — never to size the menu — so an approximation is enough.
 */
export function menuHeightFor(
  rowCount: number,
  extras: { search?: boolean; header?: boolean } = {},
): number {
  return (
    (extras.search ? SEARCH_BOX : 0) +
    (extras.header ? HEADER_BAR : 0) +
    Math.min(LIST_MAX, Math.max(rowCount, 1) * ROW + 8)
  );
}

export function placeMenu(
  anchor: DOMRect,
  opts: { align?: "left" | "right"; wantedHeight: number },
): MenuPos {
  const { align = "left", wantedHeight } = opts;
  const below = window.innerHeight - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  /*
   * Flip only when the menu does NOT fit below AND above is genuinely roomier.
   * A menu that fits stays exactly where it always was, so a short list never
   * jumps over its trigger for no reason.
   */
  const flip = wantedHeight > below && above > below;
  return {
    ...(flip
      ? { bottom: window.innerHeight - anchor.top + GAP }
      : { top: anchor.bottom + GAP }),
    ...(align === "right" ? { right: window.innerWidth - anchor.right } : { left: anchor.left }),
    minWidth: anchor.width,
    // The space on the chosen side — the menu's own max-heights keep it shorter
    // than this whenever the list is short.
    maxHeight: Math.max(flip ? above : below, MIN_HEIGHT),
  };
}
