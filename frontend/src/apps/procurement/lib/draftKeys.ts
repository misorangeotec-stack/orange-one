import { draftKey } from "@/shared/lib/draftStore";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import type { StepKey } from "./steps";

/**
 * The draft key for one step form, or null when drafting must stay off.
 *
 * `enabled` is where the whole rollout lives, and it is always the same shape:
 *
 *     open && !readOnly && !stacked
 *
 * ⚠ `open` is LOAD-BEARING. A closed step modal is not unmounted — PoDetail keeps
 * eleven of them alive behind `open={modal === "…"}` — so without it, eleven
 * drafts would arm the moment someone opens a PO. Letting the key go null on
 * close is also what makes the modal re-arm (and re-restore) when it reopens.
 *
 * ⚠ `id` must separate every modal that can be alive at the same time:
 *   • PaymentModal is mounted TWICE on PoDetail — pass `kind` in the id.
 *   • Sourcing / Approval / Follow-up each have a create slot AND an edit slot
 *     alive together — pass `editing?.id`, or a "new" | "edit" discriminator.
 * Get this wrong and two forms quietly share one draft.
 *
 * Keyed on the EFFECTIVE identity, so a draft typed under a demo persona stays
 * with that persona instead of surfacing in real mode.
 */
export function usePoStepDraftKey(
  step: StepKey,
  enabled: boolean,
  id: string | null | undefined,
): string | null {
  const { user } = useEffectiveIdentity();
  if (!enabled || !id || !user?.id) return null;
  return draftKey(user.id, `procurement:${step}:${id}`);
}
