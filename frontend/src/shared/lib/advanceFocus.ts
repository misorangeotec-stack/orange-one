/**
 * Move focus to the next form control after a selection, so a keyboard user can
 * chain answer → next field without reaching for the mouse.
 *
 * Lifted out of `Combobox` (OCPI-4, stage 1) when `ChoiceButtons` needed the same
 * behaviour. It was already generic — it works off the control's own container
 * element — and copying it would have left two implementations to drift apart.
 * Every form that relies on this chains through a MIXTURE of the two controls, so
 * they have to advance identically or the chain breaks at the seam.
 *
 * ⚠ SCOPED TO THE ENCLOSING DIALOG OR FORM, falling back to the document. Without
 *   the scope a pick in a modal would jump focus to whatever sits behind it.
 *
 * ⚠ SKIPS EVERY CONTROL INSIDE `container`. A combobox owns a trigger and a clear
 *   button; a ChoiceButtons owns one button per option plus a clear. Advancing to
 *   our own next button would look like nothing happened.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function advanceFocus(container: HTMLElement | null): void {
  if (!container) return;
  const scope = container.closest<HTMLElement>('[role="dialog"], form') ?? document.body;
  const focusables = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE))
    // `offsetParent === null` means display:none or a collapsed branch — focusing
    // one of those silently does nothing and the chain dies there.
    .filter((el) => el.offsetParent !== null);

  const first = container.querySelector<HTMLElement>("button");
  const start = first ? focusables.indexOf(first) : -1;

  for (let i = start + 1; i < focusables.length; i++) {
    const el = focusables[i];
    if (container.contains(el)) continue;
    el.focus();
    const inp = el as HTMLInputElement;
    if ((inp.tagName === "INPUT" || inp.tagName === "TEXTAREA") && typeof inp.select === "function") {
      try { inp.select(); } catch { /* some number inputs disallow select() */ }
    }
    break;
  }
}
