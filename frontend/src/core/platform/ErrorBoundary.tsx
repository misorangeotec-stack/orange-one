import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * The portal's one error boundary, wrapped around the whole tree in main.tsx.
 *
 * ⚠ WHY IT EXISTS: until this was added there was no boundary anywhere in the
 *   app, and React's behaviour when a render throws is to unmount the ENTIRE
 *   tree. The result was a pure-white page at whatever URL you were on — no
 *   message, no logged error a user could report, and no control to click. Every
 *   such bug therefore reached us as the same sentence, "the page is blank and I
 *   have to refresh", which says nothing about which of the ~30 components on
 *   the screen actually threw.
 *
 *   A boundary does not make the underlying bug go away. What it does is make it
 *   NAMED and RECOVERABLE: the reader gets the message and a Reload button, and
 *   the stack still reaches the console instead of being swallowed with the tree.
 *
 * Reload is a real page load, not an SPA navigate, on purpose: whatever state
 * produced the crash is in memory, so the only reliable way back is to drop it.
 */
interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack — it is the one clue that says WHICH screen threw,
    // and React only hands it to a boundary.
    console.error("[Orange One] render crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-page-grad px-6 text-center">
        <div className="max-w-md">
          <p className="text-[15px] font-semibold text-navy">Something went wrong on this screen</p>
          <p className="text-[13px] text-grey mt-1">
            The page couldn't be displayed. Reloading usually clears it — if it keeps happening,
            send this message to your admin.
          </p>
          <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-[12px] font-mono text-grey-2 break-words">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-orange-grad px-6 py-3 text-[15px] font-semibold text-white shadow-cta cursor-pointer"
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
