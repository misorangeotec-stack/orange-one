import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LayoutTemplate, Loader2 } from "lucide-react";
import { useSession } from "@/core/platform/session";
import { applySharedLayout, loadSharedLayout, saveSharedLayout } from "@hub/lib/sharedLayout";

/**
 * Puts the admin's saved layout in place BEFORE the Reports pages mount (they read their sizes from
 * localStorage once, on mount), and gives an admin on a Bushra page the button that saves it.
 *
 * The wait is short and bounded: if the layout has not arrived in 2.5 s, or cannot be read, the page
 * opens on whatever this browser holds — a size is a convenience, never a reason to block a report.
 * Once applied for this session the gate never waits again.
 */
export default function SharedLayoutGate({ children }: { children: ReactNode }) {
  const { data, isFetched } = useQuery({
    queryKey: ["hubSharedLayout", "bushra"],
    queryFn: loadSharedLayout,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const [timedOut, setTimedOut] = useState(false);
  const applied = useRef(false);
  useEffect(() => { const t = setTimeout(() => setTimedOut(true), 2500); return () => clearTimeout(t); }, []);
  if (data && !applied.current) {
    applied.current = true;
    applySharedLayout(data);
  }
  const open = isFetched || timedOut;
  return (
    <>
      {open ? children : <div className="p-6 text-[12px] text-muted-foreground">Loading…</div>}
      {open && <SaveLayoutButton ready={!!data?.ready} savedAt={data?.updatedAt ?? ""} />}
    </>
  );
}

/** Admins only, on the Bushra pages: save this screen's sizes as everyone's. */
function SaveLayoutButton({ ready, savedAt }: { ready: boolean; savedAt: string }) {
  const { isAdmin, user } = useSession();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  if (!isAdmin || !/bushra/i.test(pathname)) return null;

  const save = async () => {
    setState("saving");
    try {
      const r = await saveSharedLayout(user.id);
      setState("saved");
      setMsg(`Saved ${r.keys} size settings — everyone opens on this layout now.`);
      qc.setQueryData(["hubSharedLayout", "bushra"], (old: unknown) => ({ ...(old as object), updatedAt: r.updatedAt, ready: true }));
      setTimeout(() => setState("idle"), 4000);
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  };
  const when = savedAt ? new Date(savedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <div className="fixed bottom-4 left-4 z-40 flex max-w-[420px] flex-col items-start gap-1">
      {(state === "saved" || state === "error") && (
        <div className={`rounded-md border px-2.5 py-1.5 text-[11.5px] shadow-md ${state === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-green-300 bg-green-50 text-green-800"}`}>
          {msg}
        </div>
      )}
      <button type="button" onClick={save} disabled={state === "saving" || !ready}
              title={ready
                ? `Saves the column widths, heights, bar sizes, picked columns and open sections of every Bushra page as you have them in this browser, for everyone.${when ? ` Last saved ${when}.` : ""}`
                : "Run migration 20270118120000 in Supabase first — the shared-layout table is not there yet."}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-surface px-3 py-1.5 text-[12px] font-medium text-primary shadow-md hover:bg-primary/5 disabled:opacity-50">
        {state === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : state === "saved" ? <Check className="h-3.5 w-3.5" /> : <LayoutTemplate className="h-3.5 w-3.5" />}
        Save layout for everyone
        {!ready && <span className="text-[10.5px] text-muted-foreground">(needs migration)</span>}
      </button>
    </div>
  );
}
