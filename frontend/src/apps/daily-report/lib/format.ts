/**
 * Daily Report — numbers, dates and the three states a bank cell can be in.
 *
 * The whole report is in ₹ LAKHS to two decimals. One unit down a column is
 * what makes it scannable; a column that switches between lakhs and crores per
 * row cannot be read down or added up by eye. The ONLY place a unit changes is
 * a KPI tile, where a single headline figure gets `fmtSmart`.
 */

/** A money cell: lakhs, two decimals, Indian grouping. Never carries a unit. */
export function fmtLacs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A money figure WITH its unit: "₹78.33 L".
 *
 * ⚠ ALWAYS LAKHS. NEVER CRORES, ANYWHERE ON THIS REPORT.
 *
 *   The first cut switched to crores above 100 lakhs for headline figures, on
 *   the reasoning that "₹1.07 Cr" reads faster than "₹106.69 L". It does — and
 *   it put BOTH on the same card: the What sold heading said ₹1.07 Cr while the
 *   Total row three lines below said 106.69. Ritesh Bhai read them as two
 *   different numbers, which is exactly what they look like.
 *
 *   One unit for the whole report, and the unit printed beside the number, is
 *   worth more than the reading speed of any single figure. A reader should
 *   never have to work out which scale a number is on.
 */
export function fmtMoney(lacs: number | null | undefined): string {
  if (lacs == null || !Number.isFinite(lacs)) return "—";
  // The sign goes BEFORE the symbol. Formatting the raw number put it after —
  // "₹-3.55 L" — which reads as a currency called "₹-" before it reads as a
  // negative amount.
  const sign = lacs < 0 ? "−" : "";
  return `${sign}₹${fmtLacs(Math.abs(lacs))} L`;
}

/**
 * @deprecated Kept only so an unconverted caller fails loudly in review rather
 * than silently mixing scales again. Use `fmtMoney`.
 */
export const fmtSmart = fmtMoney;

/** Rupees from ConnectWave to the lakhs this module works in. */
export const toLacs = (rupees: number | null | undefined): number =>
  (Number(rupees) || 0) / 1e5;

/** A quantity in kilograms — ink is sold by weight and the sheet says "kg". */
export function fmtKg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("en-IN")} kg`;
}

/** A countable quantity — print heads, machines. */
export function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n.toFixed(3)).toLocaleString("en-IN");
}

/* ------------------------------------------------------------------ dates */

/** Today in IST, as yyyy-mm-dd — the same day boundary the database uses. */
export function todayIso(): string {
  const now = new Date();
  // IST is UTC+5:30 and never observes daylight saving, so a fixed offset is
  // exact here. Intl with a timeZone would also work but returns a formatted
  // string this then has to re-parse.
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60_000);
  return isoOf(ist);
}

/** A Date to yyyy-mm-dd, read in local time (never toISOString, which is UTC). */
export function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** yyyy-mm-dd to a local Date at midnight — safe to do arithmetic on. */
export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** yyyy-mm-dd → "YYYYMMDD", the form Tally and the ConnectWave tables use. */
export const isoToYmd = (iso: string): string => iso.replace(/-/g, "");

/** "08-09-2026" — the house date format. */
export function dmy(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "";
  return `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

/** "Tue, 8 Sep" — for a column head, where the year is already established. */
export function shortDay(iso: string): string {
  return dateOf(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** "Tuesday, 8 September 2026" — the report's own dateline. */
export function longDate(iso: string): string {
  return dateOf(iso).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

/** "19:42" from a timestamp — for the "rebuilt at" caption. */
export function timeOfDay(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Step a yyyy-mm-dd by whole days, forwards or back. */
export function addDays(iso: string, days: number): string {
  const d = dateOf(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/**
 * Is this a Sunday?
 *
 * Load-bearing, not cosmetic. The books are closed and nobody records a bank
 * balance, so a Sunday's blank means "closed", not "somebody forgot". The two
 * must never render alike — see BankCellState.
 */
export const isSunday = (iso: string): boolean => dateOf(iso).getDay() === 0;

/** Every date from `from` to `to` inclusive, oldest first. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Working days in the month up to and including `iso`, excluding Sundays.
 *
 * The KPI tiles divide month-to-date by this rather than by calendar days.
 * Sundays are zero by construction — the books are shut — so including them
 * would drag every run rate down by a sixth and make the comparison useless.
 */
export function workingDaysMtd(iso: string): number {
  const d = dateOf(iso);
  let n = 0;
  for (let day = 1; day <= d.getDate(); day++) {
    if (new Date(d.getFullYear(), d.getMonth(), day).getDay() !== 0) n++;
  }
  return Math.max(1, n);
}

/** First of `iso`'s month, as yyyy-mm-dd. */
export const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`;

/* ------------------------------------------------- the three blank states */

/**
 * WHY THIS IS AN ENUM AND NOT A `number | null`.
 *
 * A bank cell has THREE states that must look different on screen:
 *
 *   closed     — a Sunday. The books are shut and nobody was asked to record.
 *   missing    — a working day nobody typed. Somebody should be chased.
 *   value      — a real figure, including a genuine 0.00.
 *
 * Collapse "closed" and "missing" and the report stops distinguishing a quiet
 * weekend from an unchased gap. Collapse "missing" and "value" — by defaulting
 * a missing day to zero — and the report silently UNDERSTATES cash, which is
 * the worst of the three failures and the hardest to notice.
 */
export type BankCellState =
  | { kind: "closed" }
  | { kind: "missing" }
  | { kind: "value"; lacs: number };

export function bankCell(iso: string, lacs: number | undefined): BankCellState {
  if (lacs != null) return { kind: "value", lacs };
  return isSunday(iso) ? { kind: "closed" } : { kind: "missing" };
}
