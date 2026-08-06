/**
 * Stable per-person avatar tint.
 *
 * The same face keeps the same colour everywhere a candidate appears — the board
 * card, the candidate page, the discussion trail and the all-candidates list. That
 * only holds if all of them hash the same seed against the same palette, which is
 * why this is one function rather than the four copies it grew into.
 *
 * NOT the `AvatarColor` union from core/platform/types. That list also carries
 * `violet` and `rose`; this palette deliberately drops them so a candidate never
 * renders purple against the orange/navy shell.
 *
 * Seed on the id, not the name: two people called "Rahul Sharma" should not share
 * a colour, and someone's row should not change colour when a typo in their name
 * is fixed.
 */
const TINTS = ["blue", "orange", "teal", "green", "navy"];

export const tintFor = (seed: string): string => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
};
