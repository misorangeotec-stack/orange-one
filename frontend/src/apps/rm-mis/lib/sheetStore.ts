/**
 * RM IMS — the planner's sheet, shared instead of trapped in one browser.
 *
 * ─── WHAT WENT WRONG BEFORE ──────────────────────────────────────────────────────────────
 *
 * The sheet was built browser-local on purpose, and for one person proving it out that was
 * right. It stopped being right the moment a second person opened it: the stock figures were
 * live and identical everywhere, because they come from ConnectWave, while the NUMBERING never
 * left the machine it was typed on. So a second PC showed "Inks 0" — the dashboard lists only
 * items the planner has numbered — and the same desktop logged in as Admin showed everything,
 * because localStorage belongs to the browser profile and not to the app login. It read like a
 * permission bug and was not.
 *
 * ─── HOW IT WORKS NOW ────────────────────────────────────────────────────────────────────
 *
 * `public.ink_mis_state` holds one row per document, and the browser keeps a copy of each. The
 * copy is not a second source of truth — it is a cache and a cushion:
 *
 *   ON OPEN   every shared document is pulled and written into localStorage BEFORE any screen
 *             reads it, so the existing synchronous `loadX()` calls keep working untouched.
 *   ON SAVE   the value is written locally at once, so typing never waits on the network, and
 *             pushed to the server debounced.
 *   ON FAILURE the local copy still holds, the screen keeps working, and `sheetStatus` carries
 *             the error so a banner can say the sheet is not being shared right now. Silent
 *             failure is the one outcome worth avoiding: the planner would keep typing into a
 *             sheet nobody else can see, which is the bug we just fixed.
 *
 * WHAT IS NOT SHARED, deliberately: column widths, row heights, the chart label width and the
 * "already seen" marker behind the new-arrival prompt. Those are one person's view of the sheet
 * rather than the sheet, and sharing them would let one user's column drag resize everyone's
 * screen.
 *
 * WHO MAY WRITE is the ordinary module grant — `view` reads, `edit` writes, admins are edit.
 * The database enforces it through RLS, so a view-only user is refused by Postgres and not
 * merely by a hidden button. This module also declines to push at all for such a user, to keep
 * the console free of failures that are the correct answer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/core/platform/supabase";

/**
 * The generated `Database` type knows nothing about `ink_mis_state` or `ink_mis_save` until
 * types are regenerated from the live schema, and regenerating is a separate chore against a
 * database this branch has not yet migrated. One untyped handle here is honest about that and
 * keeps the escape hatch in a single place rather than scattering casts through the file.
 */
const db = supabase as unknown as SupabaseClient;

/** The documents that belong to everyone. Keys match the browser keys they replace. */
/**
 * EMPTY in RM IMS: nothing is shared yet, so `pushDocument` ignores every key and
 * `hydrateSharedSheet` returns at once. Ink IMS's list, for when RM gets a table of its own:
 * rm-mis:items, order, plans, lines, groups, shipments, thresholds, holidays, godowns (all :v1).
 */
export const SHARED_KEYS: readonly string[] = [];

const SHARED = new Set<string>(SHARED_KEYS);
export const isSharedKey = (key: string): boolean => SHARED.has(key);

/* ------------------------------------------------------------------ status, for the screens */

export interface SheetStatus {
  /** "local" until the first pull succeeds. */
  mode: "local" | "shared";
  /** A push is in flight. */
  saving: boolean;
  /** The last thing that went wrong, or null. Shown, never swallowed. */
  error: string | null;
  /** False for a view-only grant: the screens hide their editing affordances. */
  canEdit: boolean;
}

let status: SheetStatus = { mode: "local", saving: false, error: null, canEdit: false };
const listeners = new Set<(s: SheetStatus) => void>();

const setStatus = (patch: Partial<SheetStatus>) => {
  status = { ...status, ...patch };
  for (const fn of listeners) fn(status);
};

export const getSheetStatus = (): SheetStatus => status;
export const subscribeSheetStatus = (fn: (s: SheetStatus) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Set once, from the session, before anything is pushed. */
export const setSheetCanEdit = (canEdit: boolean) => setStatus({ canEdit });

/* ------------------------------------------------------------------ pushing */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, unknown>();
let inFlight = 0;

/** How long to let an edit settle. Long enough to swallow a burst of typing, short enough
 *  that someone switching machines does not beat the save there. */
const SETTLE_MS = 800;

async function flush(key: string): Promise<void> {
  const value = pending.get(key);
  pending.delete(key);
  timers.delete(key);
  if (value === undefined) return;

  inFlight += 1;
  setStatus({ saving: true });
  try {
    const { error } = await db.rpc("ink_mis_save", { p_key: key, p_value: value });
    if (error) throw new Error(error.message);
    setStatus({ error: null });
  } catch (e) {
    setStatus({
      error: `Could not share "${key.replace("rm-mis:", "").replace(":v1", "")}": ${
        e instanceof Error ? e.message : "unknown error"
      }`,
    });
  } finally {
    inFlight -= 1;
    if (inFlight === 0) setStatus({ saving: false });
  }
}

/**
 * Queue one document for the server. Returns immediately — the local copy is already written
 * by the caller, so nothing the planner sees depends on this finishing.
 */
export function pushDocument(key: string, value: unknown): void {
  if (!isSharedKey(key) || status.mode !== "shared" || !status.canEdit) return;
  pending.set(key, value);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(() => void flush(key), SETTLE_MS));
}

/** Send anything still waiting, now. Used when the tab is closing. */
export async function flushPendingDocuments(): Promise<void> {
  const keys = [...timers.keys()];
  for (const k of keys) {
    const t = timers.get(k);
    if (t) clearTimeout(t);
  }
  await Promise.all(keys.map((k) => flush(k)));
}

/* ------------------------------------------------------------------ pulling */

const readLocal = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
};

const writeLocal = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or quota: the screen still works on what it has */
  }
};

const isEmptyDoc = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) ? v.length === 0 : typeof v === "object" && !Object.keys(v as object).length);

export interface HydrateResult {
  /** Documents taken from the server into this browser. */
  pulled: number;
  /** Documents sent up because the shared sheet was completely empty. */
  seeded: number;
}

/**
 * Bring this browser in line with the shared sheet. Must finish before any screen reads a
 * document, which is why the app shell waits on it.
 *
 * THE FIRST RUN IS THE DELICATE ONE. The shared sheet starts empty while one browser holds
 * months of numbering, and the wrong move is to let the empty server win and wipe it. So: if
 * the server has NO shared document at all and this browser has something, this browser seeds
 * it. Once even one document exists on the server, the server is the truth and a stale browser
 * can never overwrite it wholesale — only an ordinary edit can change a document after that.
 */
export async function hydrateSharedSheet(): Promise<HydrateResult> {
  // RM IMS: BROWSER-ONLY for now. Ink IMS shares through `ink_mis_state` on live; RM gets its
  // own table only once the sheet is signed off, so nothing here reads or writes the database.
  if (!SHARED_KEYS.length) {
    setStatus({ mode: "local", error: null });
    return { pulled: 0, seeded: 0 };
  }
  const { data, error } = await db
    .from("ink_mis_state")
    .select("key,value")
    .in("key", [...SHARED_KEYS]);

  if (error) {
    setStatus({
      mode: "local",
      error:
        `The shared sheet could not be read (${error.message}). ` +
        `You are working on this browser's own copy, and changes are not being shared.`,
    });
    return { pulled: 0, seeded: 0 };
  }

  const rows = (data ?? []) as { key: string; value: unknown }[];
  const server = new Map(rows.map((r) => [r.key, r.value]));
  setStatus({ mode: "shared", error: null });

  if (!server.size) {
    // Nothing shared yet. Seed from this browser if it has anything worth keeping.
    const mine = SHARED_KEYS.map((k) => [k, readLocal(k)] as const).filter(
      ([, v]) => !isEmptyDoc(v),
    );
    if (!mine.length || !status.canEdit) return { pulled: 0, seeded: 0 };
    let seeded = 0;
    for (const [key, value] of mine) {
      const { error: e } = await db.rpc("ink_mis_save", { p_key: key, p_value: value });
      if (e) {
        setStatus({ error: `Could not upload "${key}": ${e.message}` });
        break;
      }
      seeded += 1;
    }
    return { pulled: 0, seeded };
  }

  let pulled = 0;
  for (const key of SHARED_KEYS) {
    if (!server.has(key)) continue;
    writeLocal(key, server.get(key));
    pulled += 1;
  }
  return { pulled, seeded: 0 };
}
