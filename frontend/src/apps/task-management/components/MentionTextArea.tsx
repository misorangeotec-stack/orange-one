import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import { useTaskStore } from "../mock/store";
import { applyMention, mentionQuery } from "../lib/mentions";

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
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const query = useMemo(() => mentionQuery(value), [value]);
  const suggestions = useMemo(() => {
    if (query === null || dismissed) return [];
    const q = query.trim();
    return mentionablePeople.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, dismissed, mentionablePeople]);

  // Reset the highlighted row whenever the candidate set changes, so Enter never
  // picks a stale index.
  useEffect(() => setActive(0), [query]);
  // A fresh "@" re-opens the list after an Escape.
  useEffect(() => setDismissed(false), [query === null]);

  const pick = (name: string) => {
    onChange(applyMention(value, name));
    setDismissed(false);
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter picks the highlighted person rather than inserting a newline — only
      // while the dropdown is open, so ordinary typing is unaffected.
      e.preventDefault();
      pick(suggestions[active].name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => window.setTimeout(() => setDismissed(true), 120)} // let a click land first
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={
          className ??
          "w-full resize-none rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-grey-2 outline-none focus:border-orange focus:ring-4 focus:ring-orange/10 transition"
        }
      />
      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-line rounded-xl shadow-card z-20 overflow-hidden">
          {suggestions.map((p, i) => (
            <button
              key={p.id}
              type="button" // inside a <form>, a bare button would submit it
              onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't beat the click
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
        </div>
      )}
    </div>
  );
}
