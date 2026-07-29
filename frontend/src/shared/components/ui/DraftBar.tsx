import type { StepDraft } from "@/shared/lib/useStepDraft";

/** "10:42" — enough to recognise when you were last here. */
const atTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The only piece of draft UI in the app — one place so a step modal and an
 * intake page say exactly the same thing.
 *
 * Three states, in priority order:
 *  • restored — the loud one. Restoring silently would be worse than losing the
 *    work: the user has to know why the form isn't empty, and be able to undo it
 *    in one click.
 *  • saved — a quiet confirmation that leaving now costs nothing.
 *  • neither — renders nothing at all, which is also what happens in read-only
 *    mode (the draft key is null there, so nothing ever arms). That matters:
 *    `Modal` puts a read-only body inside a disabled <fieldset>, where this
 *    component's Discard button would be inert.
 *
 * Place it as the FIRST child of a modal body, or above the first field on a page.
 */
export default function DraftBar({
  draft,
  fileHint = false,
}: {
  draft: StepDraft;
  /**
   * This step needs a document that a draft cannot carry. A `File` is not
   * serialisable and uploads only happen on save, so the text comes back but the
   * attachment does not — and on the steps where the file is mandatory, Save
   * stays disabled until it is re-picked. Say so rather than let it look broken.
   */
  fileHint?: boolean;
}) {
  if (draft.restoredAt !== null) {
    return (
      <div className="mb-3 flex items-start gap-3 rounded-xl border border-orange/30 bg-orange/5 px-3.5 py-2.5">
        <svg
          className="shrink-0 mt-0.5 text-orange" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        <p className="text-[12.5px] leading-relaxed text-navy grow">
          <span className="font-semibold">Restored your unsaved entry from {atTime(draft.restoredAt)}.</span>{" "}
          <span className="text-grey">
            Saved on this device only.{fileHint ? " Re-attach the document to save." : ""}
          </span>
        </p>
        <button
          type="button"
          onClick={draft.discard}
          className="shrink-0 text-[12.5px] font-semibold text-grey hover:text-navy underline underline-offset-2"
        >
          Discard draft
        </button>
      </div>
    );
  }

  if (draft.savedAt !== null) {
    return (
      <p className="mb-3 text-[12px] text-grey-2">Draft saved · {atTime(draft.savedAt)} · this device</p>
    );
  }

  return null;
}
