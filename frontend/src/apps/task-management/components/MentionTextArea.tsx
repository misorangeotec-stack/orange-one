import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/shared/components/ui/Avatar";
import { useTaskStore } from "../mock/store";
import { applyMentionAt, mentionQueryAt } from "../lib/mentions";

/**
 * A textarea with @mention autocomplete — the shared input behind both the remark
 * composer and the task-description fields.
 *
 * People come from `mentionablePeople` (org-wide via the list_org_people RPC),
 * which the store already holds under the shared ["orgPeople"] query key, so
 * dropping this into another form costs no extra fetch.
 *
 * Mentions are written as plain "@Full Name" text. Nothing machine-readable is
 * embedded — the server resolves names to people when the row is written (see
 * public.resolve_mentions), which keeps one source of truth and means the stored
 * text stays readable everywhere it is displayed unhighlighted.
 *
 * TWO things here exist because of the EDIT case specifically:
 *  1. The token is matched at the CARET, not at the end of the value. Creating a
 *     task you type left-to-right so the two are the same; editing an existing
 *     description you click into the middle, where an end-anchored match finds
 *     nothing and the picker never opens.
 *  2. The menu is PORTALLED at fixed coords (same approach as shared Combobox,
 *     z-[70] above the z-[60]/z-[65] dialogs). An absolutely-positioned menu is
 *     clipped by the modal body's `overflow-y-auto`.
 */
export default function MentionTextArea({
  value,
  onChange,
  rows = 4,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const { mentionablePeople } = useTaskStore();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const hit = useMemo(() => mentionQueryAt(value, caret), [value, caret]);
  const suggestions = useMemo(() => {
    if (!hit || dismissed) return [];
    const q = hit.query.trim();
    return mentionablePeople.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [hit, dismissed, mentionablePeople]);
  const open = suggestions.length > 0;

  // Reset the highlighted row when the candidate set changes, so Enter can't pick
  // a stale index. Keyed on the query itself (not on whether one exists) so that
  // typing after an Escape re-opens the list.
  useEffect(() => {
    setActive(0);
    setDismissed(false);
  }, [hit?.query]);

  // Position the portalled menu under the textarea in fixed coords, and keep it
  // there while the modal body (or the page) scrolls — `true` catches scroll on
  // ancestor containers, not just the window.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = taRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Restore the caret after an insertion, otherwise it jumps to the end and
  // editing mid-text is broken all over again.
  useEffect(() => {
    if (pendingCaret.current === null) return;
    const at = pendingCaret.current;
    pendingCaret.current = null;
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(at, at);
    setCaret(at);
  }, [value]);

  const syncCaret = useCallback(() => {
    const ta = taRef.current;
    if (ta) setCaret(ta.selectionStart ?? 0);
  }, []);

  const pick = (name: string) => {
    const { next, caret: at } = applyMentionAt(value, caret, name);
    pendingCaret.current = at;
    setDismissed(false);
    onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Picks the highlighted person instead of inserting a newline — only while
      // the menu is open, so ordinary typing is unaffected.
      e.preventDefault();
      pick(suggestions[active].name);
    } else if (e.key === "Escape") {
      // Stop the dialog closing too — the user is dismissing the menu, not the form.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onSelect={syncCaret}
        onClick={syncCaret}
        onKeyUp={syncCaret}
        onFocus={syncCaret}
        onKeyDown={onKeyDown}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={
          className ??
          "w-full resize-none rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-grey-2 outline-none focus:border-orange focus:ring-4 focus:ring-orange/10 transition"
        }
      />
      {open &&
        pos &&
        createPortal(
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.width }}
            className="z-[70] max-w-[340px] bg-white border border-line rounded-xl shadow-card overflow-hidden"
          >
            {suggestions.map((p, i) => (
              <button
                key={p.id}
                type="button" // inside a <form> a bare button would submit it
                onMouseDown={(e) => e.preventDefault()} // keep focus on the textarea
                onClick={() => pick(p.name)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition ${
                  i === active ? "bg-page" : "hover:bg-page"
                }`}
              >
                <Avatar name={p.name} color={p.avatarColor} size={28} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-navy truncate">{p.name}</span>
                  <span className="block text-[11px] text-grey-2 truncate">{p.designation}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
