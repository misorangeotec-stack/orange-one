import { useMemo, useRef, useState } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import { useTaskStore } from "../mock/store";

/**
 * Remark box with @mention autocomplete. Mentioned users are resolved by scanning
 * the text for "@Full Name" against the people list, then passed to addRemark so
 * notifications fan out (Stage B persists these to task_remark_mentions/notifications).
 */
export default function RemarkComposer({ taskId }: { taskId: string }) {
  const { addRemark, profiles } = useTaskStore();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // trailing "@token" → suggestions
  const query = useMemo(() => {
    const m = text.match(/@([\p{L}]*)$/u);
    return m ? m[1].toLowerCase() : null;
  }, [text]);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    return profiles.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 5);
  }, [query]);

  const pick = (name: string) => {
    setText((t) => t.replace(/@[\p{L}]*$/u, `@${name} `));
    taRef.current?.focus();
  };

  const post = () => {
    const body = text.trim();
    if (!body) return;
    const mentioned = profiles.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    addRemark(taskId, body, mentioned);
    setText("");
  };

  return (
    <div className="relative">
      <div className="rounded-xl border border-line bg-white focus-within:border-orange focus-within:ring-4 focus-within:ring-orange/10 transition">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Add a remark…  use @ to mention a teammate"
          className="w-full resize-none bg-transparent px-3.5 py-2.5 text-[14px] text-ink placeholder:text-grey-2 outline-none"
        />
        <div className="flex items-center justify-between px-3 pb-2.5">
          <span className="text-[11px] text-grey-2">Type @ to mention</span>
          <Button size="sm" onClick={post} disabled={!text.trim()}>
            Post remark
          </Button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-line rounded-xl shadow-card z-20 overflow-hidden">
          {suggestions.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p.name)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-page transition text-left"
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
