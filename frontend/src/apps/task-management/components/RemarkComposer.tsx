import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import { useTaskStore } from "../mock/store";
import MentionTextArea from "./MentionTextArea";
import { extractMentionIds } from "../lib/mentions";

/**
 * Remark box with @mention autocomplete. Mentioned users are resolved by scanning
 * the text for "@Full Name" against the people list, then passed to addRemark, which
 * (Stage B / B4) calls the add_task_remark RPC to persist the remark + fan out a
 * notification row per mentioned user.
 *
 * The input itself is the shared `MentionTextArea`, so remarks and task descriptions
 * behave identically (multi-word names, keyboard nav).
 */
export default function RemarkComposer({ taskId }: { taskId: string }) {
  const { addRemark, mentionablePeople, canRemark } = useTaskStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    const mentioned = extractMentionIds(body, mentionablePeople);
    setBusy(true);
    setError("");
    try {
      await addRemark(taskId, body, mentioned);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!canRemark) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-page px-3.5 py-2.5 text-[12.5px] text-grey-2">
        Posting remarks is read-only in this preview.
      </p>
    );
  }

  return (
    <div className="relative">
      <MentionTextArea
        value={text}
        onChange={setText}
        rows={2}
        placeholder="Add a remark…  use @ to mention a teammate"
      />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-grey-2">Type @ to mention</span>
        <Button size="sm" onClick={post} disabled={!text.trim() || busy}>
          {busy ? "Posting…" : "Post remark"}
        </Button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-[#d4493f]">{error}</p>}
    </div>
  );
}
