import { useEffect, useState, type ReactNode } from "react";
import { Check, LayoutTemplate, Loader2 } from "lucide-react";
import { useSession } from "@/core/platform/session";
import { applySharedLayout, loadSharedLayout, saveSharedLayout, type SharedLayout } from "./sharedLayout";

/**
 * Puts the admin's saved layout in place BEFORE a screen mounts (screens read their sizes from
 * localStorage once, on mount). Wraps every app, the home screen and Admin (App.tsx), so it covers
 * every FMS and every report. The admin's Save button is SaveLayoutButton, below.
 *
 * Applied ONCE PER PAGE LOAD, not once per screen: after that, a drag holds while the reader moves
 * between apps, and the next refresh puts the saved layout back (see sharedLayout.ts for who keeps
 * what). Module-level state for that reason — this component remounts with every app.
 *
 * The wait is short and bounded: if the layout has not arrived in 2.5 s, or cannot be read, the page
 * opens on whatever this browser holds — a size is a convenience, never a reason to block a screen.
 */
let boot: Promise<void> | null = null;
let booted = false;
let saved: SharedLayout | null = null;
const onBoot = new Set<() => void>();

function startBoot(isAdmin: boolean): Promise<void> {
  boot ??= loadSharedLayout()
    .then((l) => { saved = l; applySharedLayout(l, isAdmin); })
    // Unreadable (offline): this browser's own sizes stand, and an admin may still try to save.
    .catch(() => { saved = { entries: {}, updatedAt: "", ready: true }; })
    .finally(() => { booted = true; onBoot.forEach((cb) => cb()); });
  return boot;
}

export default function SharedLayoutGate({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useSession();
  const [open, setOpen] = useState(booted);
  // The profile decides admin-or-viewer, so nothing is applied until it has resolved.
  const known = !!user;

  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(t);
  }, [open]);
  // Started even after the timeout opened the page: the layout then lands for the next screen.
  useEffect(() => {
    if (known) void startBoot(isAdmin).then(() => setOpen(true));
  }, [known, isAdmin]);

  return (
    <>
      {open ? children : <div className="p-6 text-[12px] text-muted-foreground">Loading…</div>}
    </>
  );
}

/**
 * Admins only: save this browser's sizes, on every screen, as everyone's. Mounted ONCE, in App.tsx
 * beside the Ask HR bubble — the gate itself renders twice while the work panel is open.
 */
export function SaveLayoutButton() {
  const { user, isAdmin } = useSession();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(booted);
  useEffect(() => {
    const cb = () => setLoaded(true);
    onBoot.add(cb);
    return () => { onBoot.delete(cb); };
  }, []);
  if (!isAdmin || !user || !loaded) return null;
  const ready = saved?.ready ?? false;

  const save = async () => {
    setState("saving");
    try {
      const r = await saveSharedLayout(user.id);
      saved = { entries: r.entries, updatedAt: r.updatedAt, ready: true };
      setState("saved");
      setMsg(`Saved ${r.keys} size settings — everyone opens on this layout now.`);
      setTimeout(() => setState("idle"), 4000);
    } catch (e) {
      setState("error");
      setMsg((e as Error).message);
    }
  };
  const when = saved?.updatedAt ? new Date(saved.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";

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
                ? `Saves the column widths, heights, bar sizes, picked columns and open sections of every screen as you have them in this browser, for everyone. Others keep a drag only until they refresh.${when ? ` Last saved ${when}.` : ""}`
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
