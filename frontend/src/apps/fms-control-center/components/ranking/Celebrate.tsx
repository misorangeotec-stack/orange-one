import { useEffect, useState } from "react";
import type { Board } from "./data";

/**
 * A small moment, once per month: the first time the viewer finds themselves in the
 * top five, or on a perfect score. Paper strips in the portal's two colours, for a
 * second and a half — and under `prefers-reduced-motion`, only the banner.
 *
 * "Once" is remembered in this browser only. It is a courtesy; nothing depends on it,
 * and a private window that forgets it simply celebrates again.
 */
type Kind = "perfect" | "top5";

const seenKey = (month: string, kind: Kind) => `cc1-celebrated:${month}:${kind}`;
const readSeen = (k: string) => {
  try {
    return window.localStorage.getItem(k) === "1";
  } catch {
    return false;
  }
};
const markSeen = (k: string) => {
  try {
    window.localStorage.setItem(k, "1");
  } catch {
    /* storage blocked: celebrate again next time, which is harmless */
  }
};

export default function Celebrate({ board }: { board: Board }) {
  const me = board.me;
  const kind: Kind | null =
    !board.is_current || !me?.ranked ? null : me.score >= 100 ? "perfect" : me.rank! <= 5 ? "top5" : null;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!kind) return;
    const k = seenKey(board.month, kind);
    if (readSeen(k)) return;
    markSeen(k);
    setShow(true);
  }, [kind, board.month]);

  if (!show || !kind) return null;

  const text =
    kind === "perfect"
      ? "Every step on time this month. A perfect score, so far."
      : `You are #${me!.rank} in the company this month. That is the top five.`;

  return (
    <div className="relative" role="status">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-orange/40 bg-orange-soft px-4 py-3 text-[14px] font-semibold text-ink">
        <span>{text}</span>
        <button
          type="button"
          onClick={() => setShow(false)}
          className="text-[13px] text-grey hover:text-ink underline underline-offset-4"
        >
          Close
        </button>
      </div>
      <div aria-hidden="true" className="cc1-confetti pointer-events-none absolute inset-x-0 -top-2 h-40 overflow-visible">
        {Array.from({ length: 28 }, (_, i) => (
          <span
            key={i}
            style={{
              left: `${(i * 37) % 100}%`,
              background: i % 3 === 0 ? "#0B1B40" : i % 3 === 1 ? "#FF6A1F" : "#FF8A3D",
              animationDelay: `${(i % 7) * 60}ms`,
              transform: `rotate(${(i * 47) % 360}deg)`,
            }}
          />
        ))}
      </div>
      <style>{`
        .cc1-confetti span { position: absolute; top: 0; width: 7px; height: 12px; border-radius: 2px; opacity: 0;
          animation: cc1-fall 1500ms cubic-bezier(.2,.7,.3,1) forwards; }
        @keyframes cc1-fall {
          0% { opacity: 0; transform: translateY(-10px) rotate(0deg); }
          12% { opacity: 1; }
          100% { opacity: 0; transform: translateY(150px) rotate(320deg); }
        }
        @media (prefers-reduced-motion: reduce) { .cc1-confetti { display: none; } }
      `}</style>
    </div>
  );
}
