/**
 * PF-20 — the widths a reader drags table columns to, remembered per browser and per screen,
 * plus the "show the whole text on hover" behaviour of a cut cell.
 *
 * Storage is `orangeone.table.widths.<key>` in localStorage — the same prefix the KRA / KPI
 * prototype used, so the widths people already set there carry over. Every access is wrapped:
 * private mode and a full quota must never take a table down; a width is a convenience.
 *
 * ── Why a store and not useState ──
 *
 * 1. A table whose key changes while it stays mounted (the same order page opened for another
 *    order, a column set that changes with the role) must read the NEW key's widths. State seeded
 *    once from the first key would keep the old ones.
 * 2. Two tables can resolve to one key (the same screen, the same columns). Each commit re-reads
 *    storage and changes ONLY its own column, and both tables update together, so neither can
 *    overwrite the other's widths with a stale copy.
 * 3. Another tab dragging the same table is picked up through the `storage` event.
 *
 * ⚠ Imported only by table components — never by a pure `shared/lib` file an Edge bundle pulls in.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useLocation } from "react-router-dom";
import { tableLookOn, widthsKey } from "./tableLook";

type Widths = Readonly<Record<string, number>>;
const EMPTY: Widths = Object.freeze({});
const PREFIX = "orangeone.table.widths.";

/* ------------------------------- the store -------------------------------- */

const cache = new Map<string, Widths>();
const listeners = new Map<string, Set<() => void>>();
let storageListening = false;

/** The stored map, or null when storage cannot be read at all (so the session copy is kept). */
function readStored(key: string): Widths | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

/** A STABLE object per key — useSyncExternalStore re-renders forever on a fresh one. */
function getWidths(key: string): Widths {
  let w = cache.get(key);
  if (!w) {
    w = readStored(key) ?? EMPTY;
    cache.set(key, w);
  }
  return w;
}

function emit(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

function subscribe(key: string, cb: () => void): () => void {
  if (!storageListening && typeof window !== "undefined") {
    storageListening = true;
    window.addEventListener("storage", (e) => {
      if (e.key === null) {
        const keys = [...cache.keys()];
        cache.clear();
        keys.forEach(emit);
      } else if (e.key.startsWith(PREFIX)) {
        const k = e.key.slice(PREFIX.length);
        cache.delete(k);
        emit(k);
      }
    });
  }
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/** Set (or with null, forget) ONE column's width, merged into whatever is stored now. */
function commitWidth(key: string, col: string, px: number | null) {
  const next: Record<string, number> = { ...(readStored(key) ?? getWidths(key)) };
  if (px === null) delete next[col];
  else next[col] = px;
  try {
    if (Object.keys(next).length) localStorage.setItem(PREFIX + key, JSON.stringify(next));
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* private mode / quota — the width still holds until the page is left */
  }
  cache.set(key, Object.keys(next).length ? next : EMPTY);
  emit(key);
}

function clearWidths(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* as above */
  }
  cache.set(key, EMPTY);
  emit(key);
}

/** DEV only: automatic keys currently mounted, to catch two tables sharing one. */
const mounted = new Map<string, number>();

/* -------------------------------- the hook -------------------------------- */

export interface FitTable {
  /** This screen's module has the look (see tableLook.ts). When false, render exactly as before. */
  on: boolean;
  key: string;
  /** The dragged width in content px, or undefined while the column keeps its natural width. */
  width: (col: string) => number | undefined;
  /** Whether any of these columns has a dragged width — what shows the "Reset widths" button. */
  anyCustom: (cols: readonly string[]) => boolean;
  /** A drag has begun: hold the column at its measured width while the handle moves it. */
  start: (col: string, px: number) => void;
  commit: (col: string, px: number) => void;
  cancel: () => void;
  reset: (col: string) => void;
  resetAll: () => void;
  /** Spread on the <tbody>: shows a cut cell's whole text on hover. Empty when off. */
  tbodyProps: { onMouseOver?: (e: MouseEvent<HTMLElement>) => void };
}

/**
 * Column widths for one table.
 *
 * `ids` are ALL the table's column keys (not only the ones shown), so putting a column away
 * does not reset the rest. `explicitKey` — a table's `resizeKey` — replaces the automatic key.
 */
export function useColumnWidths(kind: "qt" | "mc" | "tb", ids: readonly string[], explicitKey?: string): FitTable {
  const { pathname } = useLocation();
  const on = tableLookOn(pathname);
  const idsSig = ids.join("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => explicitKey ?? widthsKey(kind, pathname, ids), [explicitKey, kind, pathname, idsSig]);

  const sub = useCallback((cb: () => void) => subscribe(key, cb), [key]);
  const stored = useSyncExternalStore(sub, () => (on ? getWidths(key) : EMPTY));

  // The column being dragged, held at the width it started from until the drag commits.
  const [drag, setDrag] = useState<{ key: string; col: string; px: number } | null>(null);

  useEffect(() => {
    if (!on || explicitKey || !import.meta.env.DEV) return;
    const n = (mounted.get(key) ?? 0) + 1;
    mounted.set(key, n);
    if (n > 1) console.warn(`PF-20: two tables on this screen share the width key "${key}" — give one a resizeKey.`);
    return () => {
      mounted.set(key, (mounted.get(key) ?? 1) - 1);
    };
  }, [on, key, explicitKey]);

  return useMemo<FitTable>(() => {
    if (!on) {
      return {
        on: false,
        key,
        width: () => undefined,
        anyCustom: () => false,
        start: () => {},
        commit: () => {},
        cancel: () => {},
        reset: () => {},
        resetAll: () => {},
        tbodyProps: {},
      };
    }
    return {
      on: true,
      key,
      width: (col) => (drag && drag.key === key && drag.col === col ? drag.px : stored[col]),
      anyCustom: (cols) => cols.some((c) => stored[c] !== undefined),
      start: (col, px) => setDrag({ key, col, px }),
      commit: (col, px) => {
        commitWidth(key, col, px);
        setDrag(null);
      },
      cancel: () => setDrag(null),
      reset: (col) => commitWidth(key, col, null),
      resetAll: () => clearWidths(key),
      tbodyProps: { onMouseOver: showWholeTextIfCut },
    };
  }, [on, key, stored, drag]);
}

/* ---------------------------- hover on a cut cell --------------------------- */

/**
 * Is the cell's text cut? The wrapper, or a child that truncates on its own (`span.block.truncate`).
 * Only an element that CLIPS counts — content spilling out of a never-cut cell is still visible.
 */
function isCut(wrap: HTMLElement): boolean {
  for (const el of [wrap, ...wrap.querySelectorAll<HTMLElement>("*")]) {
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== "visible") return true;
  }
  return false;
}

/**
 * The text a cell shows, as one line — what the reader is asking to see whole.
 *
 * Not `textContent`, which runs a pill into the text beside it ("On holdCustomer…"). Not
 * `innerText` either: it puts line breaks around flex items and none between two inline-blocks
 * ("12-09-20263D OVERDUE"). So: the visible text nodes, with a space around anything that is not
 * plain inline.
 */
function renderedText(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node instanceof SVGElement || !(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      out += " ";
      return;
    }
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const inline = cs.display === "inline";
    if (!inline) out += " ";
    node.childNodes.forEach(walk);
    if (!inline) out += " ";
  };
  root.childNodes.forEach(walk);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * One handler on the <tbody>. The `title` goes on the <td>, so the cell's padding shows it too,
 * and ONLY when the text is actually cut. A title an author put on the cell, or on anything in
 * it, is never touched: ours are marked `data-fit-title`, and only ours are ever removed.
 */
function showWholeTextIfCut(e: MouseEvent<HTMLElement>) {
  const td = (e.target as HTMLElement).closest?.("td");
  if (!td || !e.currentTarget.contains(td)) return;
  const from = e.relatedTarget as Node | null;
  if (from && td.contains(from)) return; // still inside the same cell
  const ours = td.hasAttribute("data-fit-title");
  if (td.hasAttribute("title") && !ours) return;
  const wrap = td.querySelector<HTMLElement>(":scope > [data-fit-cell]");
  if (wrap && isCut(wrap) && !wrap.querySelector("[title]")) {
    td.setAttribute("title", renderedText(wrap));
    td.setAttribute("data-fit-title", "");
  } else if (ours) {
    td.removeAttribute("title");
    td.removeAttribute("data-fit-title");
  }
}
