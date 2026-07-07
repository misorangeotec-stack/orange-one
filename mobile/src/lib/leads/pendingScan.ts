/**
 * One-shot handoff of a scanned/extracted draft from the camera screen to the
 * Upload Contact form (avoids serialising a big draft through route params).
 */

import type { ContactDraft } from './types';

let pending: ContactDraft | null = null;

export function setPendingScan(draft: ContactDraft): void {
  pending = draft;
}

export function consumePendingScan(): ContactDraft | null {
  const p = pending;
  pending = null;
  return p;
}
