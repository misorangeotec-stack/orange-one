/**
 * Duplicate-contact matching, shared by the manual Upload form (at-save prompt)
 * and the background sync (post-extraction check on scanned cards). A contact is
 * a duplicate of another when they share a phone number OR an email, across the
 * person's and company's numbers/emails.
 */

import type { CompanyInfo, PersonInfo } from './types';

/** Last 10 digits, so "+91 98…", "098…", "98…" all compare equal. */
export const normalizePhone = (s: string) => s.replace(/\D/g, '').slice(-10);
export const normalizeEmail = (s: string) => s.trim().toLowerCase();

/** The minimum a contact needs for matching — works for both Contact and ContactDraft. */
export type MatchLike = { id?: string; person: PersonInfo; additionalPeople?: PersonInfo[]; company: CompanyInfo };

/** Every person on the card (primary + extras) plus the company. */
const allPeople = (c: MatchLike): PersonInfo[] => [c.person, ...(c.additionalPeople ?? [])].filter(Boolean);

function phonesOf(c: MatchLike): Set<string> {
  return new Set(
    [...allPeople(c).flatMap((p) => p?.mobiles ?? []), ...(c.company?.mobiles ?? [])]
      .map(normalizePhone)
      .filter((p) => p.length >= 7)
  );
}
function emailsOf(c: MatchLike): Set<string> {
  return new Set(
    [...allPeople(c).flatMap((p) => p?.emails ?? []), ...(c.company?.emails ?? [])]
      .map(normalizeEmail)
      .filter(Boolean)
  );
}

/** True if `a` and `b` share any phone or email. */
export function isSameContact(a: MatchLike, b: MatchLike): boolean {
  const aPhones = phonesOf(a);
  const bPhones = phonesOf(b);
  for (const p of aPhones) if (bPhones.has(p)) return true;
  const aEmails = emailsOf(a);
  const bEmails = emailsOf(b);
  for (const e of aEmails) if (bEmails.has(e)) return true;
  return false;
}

/** Every contact in `candidates` that matches `target` (by phone or email). */
export function findDuplicates<T extends MatchLike>(target: MatchLike, candidates: T[]): T[] {
  const tPhones = phonesOf(target);
  const tEmails = emailsOf(target);
  if (tPhones.size === 0 && tEmails.size === 0) return [];
  return candidates.filter((c) => isSameContact(target, c));
}

/** First contact in `candidates` that matches `target`, or null. */
export function findDuplicate<T extends MatchLike>(target: MatchLike, candidates: T[]): T | null {
  return findDuplicates(target, candidates)[0] ?? null;
}
