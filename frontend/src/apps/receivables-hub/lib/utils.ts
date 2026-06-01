import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an INR money amount in Lakhs/Crores. Always uses L for non-zero amounts
 * below 1 Cr (so ₹80,000 → ₹0.80 L, not the raw ₹80,000). Negative values are
 * prefixed with a minus sign.
 */
export function fmtINRMoney(n: number): string {
  if (!n || Math.abs(n) < 0.5) return "₹0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
}

/**
 * Format an INR amount with explicit +/− sign instead of a hidden minus.
 * Positive value → "+" (debit balance — customer owes more, bad for receivables).
 * Negative value → "−" (credit balance — customer has overpaid / pay-down, good).
 * Used for Journal Adjustments and other signed accounting entries.
 */
export function fmtINRDrCr(n: number): string {
  if (!n || Math.abs(n) < 0.5) return "₹0";
  const prefix = n < 0 ? "− " : "+ ";
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${prefix}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  return `${prefix}₹${(abs / 100_000).toFixed(2)} L`;
}

/**
 * Format a date as DD-MM-YYYY for the dashboard UI.
 * Accepts:
 *   - "YYYY-MM-DD"           → "DD-MM-YYYY"
 *   - "YYYY-MM-DD HH:MM..."  → "DD-MM-YYYY" (date part only)
 *   - ISO datetime           → "DD-MM-YYYY"
 * Returns the input unchanged if it can't be parsed.
 */
export function formatDateDMY(input: string | null | undefined): string {
  if (!input) return "";
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Format a date+time as "DD-MM-YYYY HH:MM" for "last updated" timestamps.
 * Accepts ISO datetimes and "YYYY-MM-DD HH:MM" strings.
 */
export function formatDateTimeDMY(input: string | null | undefined): string {
  if (!input) return "";
  const s = String(input).trim();
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    // Fallback: "YYYY-MM-DD HH:MM" without timezone — split manually
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}`;
    return s;
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()} ${hh}:${min}`;
}
