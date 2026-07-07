/**
 * Turns a voice note's Claude analysis (suggestedInterest, followUps, summary)
 * into concrete form patches: pick the matching Interest level + Follow-up
 * action masters, and a Notes prefill. Only suggests values for fields that are
 * still empty (never overrides a manual choice).
 */

import type { Masters, VoiceNote } from './types';

export type VoiceAutofill = {
  interestLevelId?: string;
  followUpActionId?: string;
  noteText?: string;
};

const norm = (s: string) => s.trim().toLowerCase();

export function autofillFromVoice(
  note: VoiceNote,
  masters: Masters,
  has: { interest: boolean; followUp: boolean; notes: boolean }
): VoiceAutofill {
  const out: VoiceAutofill = {};

  // Interest level — Claude returns one of the interest labels verbatim.
  if (!has.interest && note.suggestedInterest) {
    const want = norm(note.suggestedInterest);
    const match = masters.interestLevels.find((m) => norm(m.label) === want);
    if (match) out.interestLevelId = match.id;
  }

  // Follow-up action — free-text follow-ups; match a master label appearing in
  // (or matching) any suggested follow-up.
  if (!has.followUp && note.followUps?.length) {
    const texts = note.followUps.map(norm);
    const match = masters.followUpActions.find((m) => {
      const label = norm(m.label);
      return texts.some((t) => t.includes(label) || label.includes(t));
    });
    if (match) out.followUpActionId = match.id;
  }

  // Notes — prefill with the summary + follow-ups if there are no notes yet.
  if (!has.notes) {
    const parts: string[] = [];
    if (note.summary) parts.push(note.summary);
    if (note.followUps?.length) parts.push(`Follow-ups: ${note.followUps.join('; ')}`);
    if (parts.length) out.noteText = parts.join('\n');
  }

  return out;
}
