import { useCallback, useEffect, useRef, useState } from "react";
import { localDraftStore } from "./draftStore";

/**
 * Autosave for any FMS step form.
 *
 * The FMS apps have no shared step-form engine: ~84 step forms across 10 apps
 * hold their fields as discrete named useStates, so there is nothing central to
 * hook into. This asks for the only two things every one of them CAN give — a
 * plain snapshot object, and a callback that fans a snapshot back into its
 * setters. Wiring a form up is about ten lines and no refactor.
 *
 * The contract:
 *  • `values` must be JSON-serialisable. Sets become arrays on the way in and
 *    Sets again in `apply`; a File cannot be drafted at all.
 *  • `key` is null whenever drafting is off — read-only, still loading, no
 *    signed-in user. Nothing is read or written while it is null.
 *  • The BASELINE is whatever `values` held the moment the key armed, i.e. the
 *    form's seeded state. Everything hangs off comparing against it:
 *      – still equal to it ⇒ the user has typed nothing, so there is no draft
 *      – a stored record that differs ⇒ real unsaved work, offer it back
 *  • `comparable` decides what "differs" MEANS. Use it wherever the form
 *    mutates itself without the user doing anything — LineGrid appending its
 *    trailing blank row a tick after seeding is the case that forced it. What
 *    gets STORED is always the full `values`; `comparable` only ever judges.
 *
 * Six traps this is built around, all of them found the hard way:
 *  1. `armedKeyRef` is NEVER reset in cleanup. React.StrictMode (on in
 *     main.tsx) runs effects twice in dev, and a second arm would re-snapshot
 *     the baseline from the values we had just restored — which would make
 *     Discard revert to the draft instead of to empty.
 *  2. `touchedRef` gates every write AND every delete. Without it, StrictMode's
 *     mount→cleanup→mount would flush a not-yet-re-rendered snapshot equal to
 *     the baseline and delete the very draft it just restored.
 *  3. Returning to the baseline DELETES the record rather than skipping the
 *     write. Skipping would resurrect, on the next visit, work the user had
 *     deliberately cleared.
 *  4. Without `comparable`, merely OPENING an edit form saved a draft — the
 *     grid's own trailing blank row counted as a change — and reopening then
 *     announced "Restored your unsaved entry" over work nobody had done. A
 *     false alarm teaches people to ignore the bar, which costs more than the
 *     feature adds.
 *  5. `flush` writes to `pendingKeyRef`, not the live key. A step modal's key
 *     goes null the moment it closes, so reading the live key threw away the
 *     last keystrokes before every close — the exact case this exists for.
 *  6. A null key RELEASES `armedKeyRef`. Modals are not unmounted when closed
 *     (a PO detail page keeps eleven alive), so reopening produces the very
 *     same key string; without the release it would never arm again and the
 *     draft would be silently ignored.
 */

const safeStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
};

export interface StepDraft {
  /** When the restored draft was written, epoch ms — non-null ⇒ show the bar. */
  restoredAt: number | null;
  /** When we last persisted, epoch ms — drives "Draft saved · 10:47". */
  savedAt: number | null;
  /** Throw the draft away and put the form back to how it opened. */
  discard: () => void;
  /** The entry was submitted (or explicitly abandoned) — forget the draft. */
  clear: () => void;
}

export function useStepDraft<T>(opts: {
  key: string | null;
  values: T;
  apply: (v: T) => void;
  /**
   * Projection used ONLY to answer "has anything meaningful changed?". Strip
   * the parts of `values` the form churns on its own — blank grid rows, row
   * ids, untrimmed whitespace. Omit it and the whole snapshot is compared.
   */
  comparable?: (v: T) => unknown;
  /** Quiet period after the last keystroke before we persist. */
  delay?: number;
}): StepDraft {
  const { key, values, apply, comparable, delay = 800 } = opts;

  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // `values` and `apply` are fresh identities on every render, so they live in
  // refs and the arm effect can depend on `key` alone.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const keyRef = useRef(key);
  keyRef.current = key;
  const comparableRef = useRef(comparable);
  comparableRef.current = comparable;

  // Only serialised while a draft is actually live. A PO detail page keeps ELEVEN
  // step modals mounted at once, so doing this unconditionally would be twenty-two
  // wasted JSON.stringify calls on every render of a page where nothing is open.
  /** What gets stored. */
  const snapshot = key ? safeStringify(values) : "";
  /** What gets judged. */
  const signature = key ? safeStringify(comparable ? comparable(values) : values) : "";

  /** The seeded state's signature. Typed-vs-untouched is measured against it. */
  const baselineRef = useRef<string | null>(null);
  /** The seeded state in full — what Discard puts back. */
  const baselineValuesRef = useRef<string | null>(null);
  /** Which key we have already armed — see trap 1 above. */
  const armedKeyRef = useRef<string | null>(null);
  /** Has the signature ever differed from the baseline? — see traps 2 and 4. */
  const touchedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingSigRef = useRef<string | null>(null);
  /** The key `pendingRef` belongs to — see trap 5. */
  const pendingKeyRef = useRef<string | null>(null);
  /** Set by clear(): the entry is gone, so the exit flush must not re-save it. */
  const clearedRef = useRef(false);

  // ── Arm: snapshot the baseline, then offer back anything saved earlier.
  useEffect(() => {
    // A null key means drafting is off right now — a closed modal, a read-only
    // view, no signed-in user. Releasing the guard is what lets the SAME key arm
    // again when the modal reopens (trap 6).
    if (!key) {
      armedKeyRef.current = null;
      return;
    }
    if (armedKeyRef.current === key) return;
    armedKeyRef.current = key;
    clearedRef.current = false;
    touchedRef.current = false;
    // Nulled synchronously: the save effect refuses to run without a baseline, so
    // nothing can be written in the window before the deferred capture below.
    baselineRef.current = null;

    /**
     * The ENTIRE arm runs in a macrotask, not inline. Two reasons, both learned
     * the hard way:
     *
     * 1. The baseline must be POST-seed. Every step modal seeds its fields from a
     *    `useEffect`, which runs before this one commits its result — so an inline
     *    snapshot captures the values from BEFORE the modal was populated. The
     *    seed itself then reads as "the user typed something", and a draft is
     *    written the instant the modal opens. Reopening then announces a restore
     *    over work nobody did. (Step 1's page seeds during render, so it never
     *    showed this — which is exactly why it had to be caught by reasoning.)
     * 2. The restore must be the last word. LineGrid appends its trailing blank
     *    row from a CHILD effect using a captured `rows` array, and StrictMode
     *    replays that setup with the same stale array — landing after an inline
     *    restore and silently putting the seeded rows back.
     *
     * Deliberately not cancelled on cleanup: StrictMode's teardown would kill the
     * only scheduled arm, and the guard above stops pass 2 rescheduling it. A
     * setState on an unmounted component is a harmless no-op in React 18.
     */
    setTimeout(() => {
      // Opened and closed again, or switched rows, before this ran.
      if (keyRef.current !== key) return;
      const sigOf = (v: T) => safeStringify(comparableRef.current ? comparableRef.current(v) : v);
      const baseline = sigOf(valuesRef.current);
      baselineRef.current = baseline;
      baselineValuesRef.current = safeStringify(valuesRef.current);

      const rec = localDraftStore.read<T>(key);
      if (!rec) return;
      if (sigOf(rec.values) === baseline) {
        // Identical to how the form opens — there is nothing to restore.
        localDraftStore.remove(key);
        return;
      }
      applyRef.current(rec.values);
      setRestoredAt(rec.at);
      setSavedAt(rec.at);
    }, 0);
  }, [key]);

  /** Persist (or delete) right now, skipping the debounce. */
  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The key the pending snapshot was captured under — NOT `keyRef.current`,
    // which has already gone null by the time a modal close is processed. Reading
    // the live key here silently dropped the last keystrokes before every close.
    const k = pendingKeyRef.current;
    const next = pendingRef.current;
    const nextSig = pendingSigRef.current;
    pendingRef.current = null;
    pendingSigRef.current = null;
    pendingKeyRef.current = null;
    if (!k || next === null || clearedRef.current || !touchedRef.current) return;

    if (nextSig === baselineRef.current) {
      // Back to where it started: the user undid their own work, so the draft
      // goes with it. Skipping here would resurrect it on the next visit.
      localDraftStore.remove(k);
      setSavedAt(null);
      return;
    }
    try {
      localDraftStore.write(k, JSON.parse(next) as T);
      setSavedAt(Date.now());
    } catch {
      /* unparseable snapshot — nothing sensible to store */
    }
  }, []);

  // ── Save: debounced, and only once the key has armed.
  useEffect(() => {
    if (!key || armedKeyRef.current !== key || baselineRef.current === null) return;
    if (clearedRef.current) return;
    if (signature !== baselineRef.current) touchedRef.current = true;
    pendingRef.current = snapshot;
    pendingSigRef.current = signature;
    pendingKeyRef.current = key;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [key, signature, snapshot, delay, flush]);

  // ── Closing a modal is a "key change", not an unmount — the component lives on
  //    (a PO detail page keeps eleven of them mounted). Flushing on the key's
  //    cleanup covers closing, switching rows AND unmounting in one place.
  //    Ordering is safe: React runs this cleanup before the next arm effect, so
  //    the flush still sees the outgoing key's baseline and touched flag.
  useEffect(() => () => flush(), [key, flush]);

  // ── Leaving must never cost the last few hundred ms of typing. This is the
  //    "let me go and check something" case the whole feature exists for.
  useEffect(() => {
    const onPageHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  const discard = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    pendingSigRef.current = null;
    pendingKeyRef.current = null;
    touchedRef.current = false;
    const k = keyRef.current;
    if (k) localDraftStore.remove(k);
    // Undo the restore: put the form back to exactly how it opened. Stays
    // armed, so typing again starts a fresh draft against the same baseline.
    if (baselineValuesRef.current !== null) {
      try {
        applyRef.current(JSON.parse(baselineValuesRef.current) as T);
      } catch {
        /* baseline unparseable — leave the fields alone */
      }
    }
    setRestoredAt(null);
    setSavedAt(null);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    pendingSigRef.current = null;
    pendingKeyRef.current = null;
    touchedRef.current = false;
    // Blocks the unmount flush below — otherwise submitting and navigating away
    // would immediately rewrite the draft we just cleared.
    clearedRef.current = true;
    const k = keyRef.current;
    if (k) localDraftStore.remove(k);
    setRestoredAt(null);
    setSavedAt(null);
  }, []);

  return { restoredAt, savedAt, discard, clear };
}
