/**
 * KB-1 · "Ask HR" — a bubble on every screen of the hub.
 *
 * ⚠ ASKING IS NOT A MENU ITEM AND NOT A PAGE. That was the user's decision (KB-1 §0):
 * people should be able to ask wherever they already are, without going somewhere first.
 * Do not add a nav entry for the bubble.
 *
 * READING the manual is a different thing and DOES have one, added 30-09-2026: an
 * "HR Handbook" row under Home, plus the "Open the handbook" link in this panel's header.
 *
 * MOUNTED ONCE, IN App.tsx, BESIDE <Routes> — not inside AppShell, which was the obvious
 * home and is the wrong one for three reasons:
 *   1. Every app renders its OWN AppShell, so moving from Task Management to Recruitment
 *      would unmount the widget and throw the conversation away mid-thread.
 *   2. /account does not use AppShell at all (the announcements strip has that gap today).
 *   3. AppShell is a shared file several sessions are editing; this needs none of it.
 * A fixed-position element does not need to sit inside the shell's DOM, so nothing is lost.
 *
 * Three states, one component: a bubble, a chat panel, and a WIDE two-pane overlay where
 * the conversation keeps the left and the real handbook opens on the right at the cited
 * section, highlighted. The reader never leaves the screen they were on.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { useSession } from "@/core/platform/session";
import HandbookPane from "./HandbookPane";
import {
  askHandbook,
  rateAnswer,
  sendToHr,
  SUGGESTED_QUESTIONS,
  type AskAnswer,
  type ChatTurn,
} from "./askData";

type Mode = "closed" | "chat" | "wide";

/* --------------------------------- icons ----------------------------------- */

const Icon = {
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.6-.7L3 21l1.9-4.8A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
      <path d="M19 18v3H6.5" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  up: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 14.5 12 9l5 5.5" />
    </svg>
  ),
  down: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 9.5 12 15l5-5.5" />
    </svg>
  ),
};

/* ------------------------------- one answer -------------------------------- */

/**
 * The answer, as a short paragraph then pointers.
 *
 * The model is told to lead with a sentence or two and put the details in bullets, because
 * a single dense paragraph is unreadable when somebody is standing at their desk hunting
 * for one number. This turns the "- " lines it returns into a real list. It is NOT a
 * markdown renderer and must not become one: bullets and paragraphs are the whole grammar.
 */
function AnswerText({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const blocks: ({ kind: "p"; text: string } | { kind: "ul"; items: string[] })[] = [];

  for (const line of lines) {
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else {
      blocks.push({ kind: "p", text: line });
    }
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="text-[13.5px] leading-relaxed text-navy">
            {b.text}
          </p>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-4 text-[13.5px] leading-relaxed text-navy marker:text-orange">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function AnswerBlock({
  answer,
  rated,
  sent,
  onOpen,
  onRate,
  onSend,
}: {
  answer: AskAnswer;
  rated: 1 | -1 | undefined;
  sent: boolean;
  onOpen: (anchor: string) => void;
  onRate: (r: 1 | -1) => void;
  onSend: () => void;
}) {
  return (
    <div className="space-y-2">
      <AnswerText text={answer.answer} />

      {answer.sections.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            Where this comes from
          </p>
          {answer.sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.anchor)}
              className="flex w-full items-start gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-left text-[12px] leading-snug text-navy transition hover:border-orange hover:text-orange"
            >
              <span className="mt-[1px] w-3.5 shrink-0 text-orange">{Icon.book}</span>
              <span className="min-w-0">{s.pathText}</span>
            </button>
          ))}
        </div>
      )}

      {/* Not covered. Never a dead end: the question becomes HR's to answer, and only
          pressing this attaches a name to it. */}
      {!answer.covered && answer.token && (
        <div className="rounded-lg border border-line bg-[#F7F9FC] px-2.5 py-2">
          {sent ? (
            <p className="text-[12px] text-grey">
              Sent to HR. They can see the question and reply. Your name goes with it so they can.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-grey">Not in the handbook. Would you like HR to answer it?</p>
              <button
                type="button"
                onClick={onSend}
                className="mt-1.5 rounded-lg bg-orange-grad px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-cta transition hover:-translate-y-0.5"
              >
                Send this question to HR
              </button>
            </>
          )}
        </div>
      )}

      {answer.token && (
        <div className="flex items-center gap-1 pt-0.5">
          <span className="text-[11px] text-grey-2">{rated ? "Thank you." : "Was this helpful?"}</span>
          {!rated && (
            <>
              <button
                type="button"
                onClick={() => onRate(1)}
                aria-label="Helpful"
                className="ml-1 w-6 rounded p-1 text-grey-2 transition hover:bg-orange-soft hover:text-orange"
              >
                {Icon.up}
              </button>
              <button
                type="button"
                onClick={() => onRate(-1)}
                aria-label="Not helpful"
                className="w-6 rounded p-1 text-grey-2 transition hover:bg-orange-soft hover:text-orange"
              >
                {Icon.down}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- the widget ------------------------------ */

export default function AskHrBubble() {
  const { user, isExternal, hasModule } = useSession();
  const [mode, setMode] = useState<Mode>("closed");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, 1 | -1>>({});
  const [sent, setSent] = useState<Record<string, boolean>>({});

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (mode !== "closed") endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending, mode]);

  useEffect(() => {
    if (mode === "chat") inputRef.current?.focus();
  }, [mode]);

  // Escape steps back one level rather than closing everything: from the handbook to the
  // conversation, and only then shut. Losing a thread to a stray key press is infuriating.
  useEffect(() => {
    if (mode === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode((m) => (m === "wide" ? "chat" : "closed"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  // Staff only, signed in, AND holding the module. `user` is null before sign-in, despite
  // the type.
  //
  // ⚠ The grant is what gates this since 01-10-2026, while HR trials it. It was open to all
  // staff before (KB-1 §0), and will be again: granting everyone VIEW reopens it with no
  // code change. This check is a courtesy on top of the database, which refuses the rows
  // and the Edge Function to anyone without the grant either way.
  if (!user || isExternal || !hasModule("knowledge-base")) return null;

  const submit = async (raw: string) => {
    const question = raw.trim();
    if (!question || pending) return;
    const history = turns;
    setDraft("");
    setTurns([...history, { role: "user", content: question }]);
    setPending(true);
    try {
      const a = await askHandbook(question, history);
      setTurns((t) => [...t, { role: "assistant", content: a.answer, answer: a }]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        { role: "assistant", content: e instanceof Error ? e.message : String(e), failed: true },
      ]);
    } finally {
      setPending(false);
    }
  };

  /**
   * Clear the thread and put the cursor back in the box.
   *
   * ⚠ IT MUST NOT TOUCH `mode`. It used to call setMode("chat"), which collapsed the wide
   * two-pane view back to the little corner panel: somebody reading the handbook full
   * width, who asked a question and then wanted to ask another, had the manual yanked shut
   * on them. Starting a new topic says nothing about how much room the reader wants.
   * Whatever view they are in, they stay in it.
   *
   * ⚠ THE FOCUS CALL IS NOT OPTIONAL. The focus effect keys off `[mode]`, and `mode` does
   * not change here (by design, above), so nothing else will move the cursor. Without this
   * line the conversation clears and the cursor goes nowhere.
   *
   * `anchor` IS cleared: it marks where the last answer came from, and that answer is gone.
   * The handbook stays exactly where the reader had scrolled it; only the orange ring goes.
   *
   * `rated` and `sent` are deliberately left alone: they are keyed by client_token, so the
   * entries simply become unreachable rather than wrong.
   */
  const startOver = () => {
    setTurns([]);
    setAnchor(null);
    inputRef.current?.focus();
  };

  const openSection = (a: string) => {
    setAnchor(a);
    setMode("wide");
  };

  const rate = async (token: string, r: 1 | -1) => {
    setRated((m) => ({ ...m, [token]: r }));
    try {
      await rateAnswer(token, r);
    } catch {
      /* feedback, not a transaction: a failure must not interrupt the reader */
    }
  };

  const hand = async (token: string) => {
    setSent((m) => ({ ...m, [token]: true }));
    try {
      await sendToHr(token);
    } catch {
      setSent((m) => ({ ...m, [token]: false }));
    }
  };

  /* ------------------------------- the bubble ------------------------------ */

  if (mode === "closed") {
    return (
      <button
        type="button"
        onClick={() => setMode("chat")}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-orange-grad py-3 pl-4 pr-5 text-[13px] font-semibold text-white shadow-cta transition hover:-translate-y-0.5"
      >
        <span className="w-5">{Icon.chat}</span>
        Ask HR
      </button>
    );
  }

  const conversation = (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[13px] leading-relaxed text-grey">
              Ask anything from the HR handbook in your own words. Leave, travel, notice period,
              reimbursements. You will get a short answer and the exact place it came from.
            </p>
            <div className="space-y-1.5 pt-1">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submit(q)}
                  className="block w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-left text-[12.5px] text-navy transition hover:border-orange hover:text-orange"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-navy px-3 py-2 text-[13px] text-white">
                {t.content}
              </p>
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2.5",
                t.failed ? "bg-[#FFF4F4] text-[#9B2C2C]" : "bg-[#F7F9FC]"
              )}
            >
              {t.failed ? (
                <p className="text-[13px] leading-relaxed">{t.content}</p>
              ) : t.answer ? (
                <AnswerBlock
                  answer={t.answer}
                  rated={t.answer.token ? rated[t.answer.token] : undefined}
                  sent={!!(t.answer.token && sent[t.answer.token])}
                  onOpen={openSection}
                  onRate={(r) => t.answer?.token && rate(t.answer.token, r)}
                  onSend={() => t.answer?.token && hand(t.answer.token)}
                />
              ) : (
                <p className="text-[13px] leading-relaxed text-navy">{t.content}</p>
              )}

              {/* The way to start again, under the LAST answer, where the reader's eye
                  already is. It used to be a "New question" button in the header, which sat
                  at the top and read as the only way to continue, so people pressed it and
                  lost a thread they could have carried. Typing in the box below is the
                  normal way on; this is only for changing the subject.
                  Not shown while an answer is on its way. */}
              {i === turns.length - 1 && !pending && (
                <button
                  type="button"
                  onClick={startOver}
                  className="mt-2 text-[11.5px] font-semibold text-grey-2 underline-offset-2 transition hover:text-navy hover:underline"
                >
                  Start a new topic
                </button>
              )}
            </div>
          )
        )}

        {pending && (
          <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-[#F7F9FC] px-3 py-2.5">
            <p className="text-[13px] text-grey-2">Reading the handbook…</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
        className="flex items-end gap-2 border-t border-line p-2.5"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line. A question is one line far more often
            // than it is a paragraph.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(draft);
            }
          }}
          rows={1}
          placeholder="Ask anything…"
          className="max-h-28 min-h-[38px] min-w-0 flex-1 resize-none rounded-xl border border-line px-3 py-2 text-[13px] text-navy outline-none placeholder:text-grey-2 focus:border-orange"
        />
        <button
          type="submit"
          disabled={!draft.trim() || pending}
          aria-label="Send"
          className="h-[38px] w-[38px] shrink-0 rounded-xl bg-orange-grad p-2.5 text-white shadow-cta transition hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {Icon.send}
        </button>
      </form>
    </>
  );

  const header = (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
      {mode === "wide" && (
        <button
          type="button"
          onClick={() => setMode("chat")}
          aria-label="Back to the conversation"
          className="w-5 shrink-0 text-grey-2 transition hover:text-navy lg:hidden"
        >
          {Icon.back}
        </button>
      )}
      <span className="w-4 shrink-0 text-orange">{Icon.chat}</span>
      <p className="flex-1 truncate text-[13px] font-semibold text-navy">Ask HR</p>
      {/* The way to BROWSE the whole manual, from wherever the reader happens to be.
          ⚠ Guarded to chat mode because `header` is rendered by the wide overlay too, and
          offering to open the handbook on top of the open handbook is nonsense.
          This slot used to hold a "New question" button. It sat at the TOP, far from the
          answer people had just finished reading, so it read as the only way to continue
          and they pressed it, throwing away a thread they could have carried. The reset
          now lives under the last answer instead. */}
      {mode === "chat" && (
        <button
          type="button"
          onClick={() => {
            setAnchor(null);
            setMode("wide");
          }}
          className="shrink-0 text-[11.5px] font-semibold text-grey-2 transition hover:text-navy"
        >
          Open the handbook
        </button>
      )}
      <button
        type="button"
        onClick={() => setMode("closed")}
        aria-label="Close"
        className="w-4 shrink-0 text-grey-2 transition hover:text-navy"
      >
        {Icon.close}
      </button>
    </div>
  );

  /* -------------------------------- the panel ------------------------------ */

  if (mode === "chat") {
    return (
      <div className="fixed bottom-3 right-3 left-3 z-40 flex max-h-[min(78vh,40rem)] flex-col overflow-hidden rounded-card border border-line bg-white shadow-2xl sm:left-auto sm:w-[23rem]">
        {header}
        {conversation}
      </div>
    );
  }

  /* --------------------------- the two-pane overlay ------------------------ */

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/25 p-0 sm:p-4 lg:p-8">
      <div className="flex min-h-0 w-full overflow-hidden rounded-none border-line bg-white shadow-2xl sm:rounded-card sm:border">
        {/* The conversation keeps the left. Below lg there is not room for two panes, so
            the handbook takes over and the header's back arrow returns here. */}
        <div className="hidden w-[23rem] shrink-0 flex-col border-r border-line lg:flex">
          {header}
          {conversation}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="lg:hidden">{header}</div>
          <div className="hidden items-center gap-2 border-b border-line px-3 py-2.5 lg:flex">
            <span className="w-4 shrink-0 text-orange">{Icon.book}</span>
            <p className="flex-1 truncate text-[13px] font-semibold text-navy">HR Handbook</p>
            <button
              type="button"
              onClick={() => setMode("chat")}
              className="shrink-0 text-[11.5px] font-semibold text-grey-2 transition hover:text-navy"
            >
              Close the handbook
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <HandbookPane anchor={anchor} onAnchorChange={setAnchor} dense />
          </div>
        </div>
      </div>
    </div>
  );
}
