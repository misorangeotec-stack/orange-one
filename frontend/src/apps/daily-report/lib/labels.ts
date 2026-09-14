/**
 * Daily Report — what the entities and account types are CALLED on screen.
 *
 * One definition, read by the report, the master, the entry form and both
 * exports, so a heading cannot drift between them.
 */

import type { BankAccountType } from "../types";

/**
 * Legal names for the three entities, keyed by mst_companies.alias.
 *
 * WHY A MAP AND NOT mst_companies.name — that column holds Tally's BOOK name,
 * which carries the financial year ("ORANGE O TEC ENTERPRISES PVT LTD(F.Y.
 * 2026-27)") and is re-minted every April. It is unusable as a heading and
 * changes under you annually.
 *
 * WHY NOT JUST THE ALIAS — the rest of the portal renders "O-tec", which is
 * right for an operator picking a company off a form. This is a document for
 * management and the CFO, where the legal entity is the thing being reported
 * on, so it prints the registered name. `entityLabel` falls back to the alias
 * for anything not listed, so a sixth company added tomorrow still renders
 * something true rather than blank.
 */
const LEGAL_NAME: Record<string, string> = {
  "O-tec": "Orange O Tec Pvt Ltd",
  Enterprise: "Orange O Tec Enterprises Pvt Ltd",
  Colorix: "Colorix Digital Printing Solutions LLP",
};

export const entityLabel = (alias: string): string => LEGAL_NAME[alias] ?? alias;

/**
 * The order entities print in — the same order the reference sheet uses, which
 * is by size, not alphabetical. Anything unlisted sorts last rather than first,
 * so a new entity announces itself at the bottom instead of displacing the one
 * everybody reads.
 */
const ENTITY_ORDER: Record<string, number> = { "O-tec": 1, Enterprise: 2, Colorix: 3 };

export const entityRank = (alias: string): number => ENTITY_ORDER[alias] ?? 99;

export const ACCOUNT_TYPE_LABEL: Record<BankAccountType, string> = {
  cc: "Cash credit",
  od: "Overdraft",
  current: "Current",
  savings: "Savings",
};

/**
 * Sort order for the account-type column.
 *
 * Not alphabetical: the facility block is about borrowing, so the borrowing
 * accounts lead. Declared separately from the label because MasterCrud sorts on
 * the text a cell RENDERS unless told otherwise, and "Cash credit" before
 * "Current" before "Overdraft" is the wrong order to read a bank position in.
 */
export const ACCOUNT_TYPE_RANK: Record<BankAccountType, number> = {
  cc: 0, od: 1, current: 2, savings: 3,
};

/** Account types that borrow, and so appear in the facility block. */
export const isFacilityAccount = (t: BankAccountType): boolean => t === "cc" || t === "od";

/**
 * Said once at the top of the page and again in every export.
 *
 * Without it somebody reconciles the report against a GST-inclusive figure out
 * of Tally, finds an 18% gap, and files it as a bug. The reference sheet is
 * GST-inclusive; this report is not, and that difference has to be stated
 * rather than discovered.
 */
export const BASIS_NOTE =
  "Sales and purchases are net of GST (taxable value). Amounts in ₹ lakhs.";

/** Why a bank cell can be empty. Printed under the balance grid and in exports. */
export const BLANK_NOTE =
  "A blank bank cell means no balance was recorded that day. Sundays are blank by design — the books are closed. A recorded zero shows as 0.00.";
