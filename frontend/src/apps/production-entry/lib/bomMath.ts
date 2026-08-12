/**
 * The one place percentages and quantities convert into each other.
 *
 * ⚠ The percentage is ALWAYS the source of truth. A BOM stores `pct`; every
 * quantity anywhere — the job-card grid, the theoretical weight on the printed
 * issue slip — is derived from it as `fgQty * pct / 100`. The reverse direction
 * (`pctFromQty`) exists only so a user can type a quantity they already know and
 * have the split follow; it must never be used to write a value back into the
 * BOM master, or one card's typo would silently rewrite the formulation for
 * every future card.
 */

/**
 * The batch size these recipes are written against. The source spreadsheet lists
 * every BOM's components as quantities per 1000, so the editor offers that as a
 * second way to type the same number. Display-only — deliberately NOT a stored
 * column, because storing it would imply the percentages move when it changes.
 */
export const BOM_BASE_QTY = 1000;

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** This component's quantity for a given FG quantity. */
export const qtyForPct = (fgQty: number, pct: number): number => round3((fgQty * pct) / 100);

/** The split a quantity represents at a given FG quantity (0 when unknowable). */
export const pctFromQty = (fgQty: number, qty: number): number => (fgQty > 0 ? round6((qty / fgQty) * 100) : 0);

/** The same split expressed against the BOM_BASE_QTY batch the sheets use. */
export const qtyAtBase = (pct: number): number => round3((pct * BOM_BASE_QTY) / 100);

/** …and back, for a quantity typed against that batch. */
export const pctFromBaseQty = (qty: number): number => round6((qty / BOM_BASE_QTY) * 100);
