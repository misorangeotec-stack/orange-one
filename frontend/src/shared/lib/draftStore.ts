/**
 * Where an in-progress FMS step form parks itself while the user is away.
 *
 * Deliberately a one-file interface with a localStorage implementation behind
 * it. A half-typed step entry is personal and worthless to anyone else, so it
 * does not earn a Postgres row, an RLS policy and a write every 800ms from
 * every user on the floor. If drafts ever need to follow a person between
 * machines, ONLY this file changes — no form knows where its draft lives.
 *
 * Everything here is best-effort. Losing a draft is a nuisance; throwing inside
 * a keystroke handler is a broken form. Nothing in this module throws.
 */

/** Key prefix for everything this module owns. Sweeps match on it. */
export const DRAFT_PREFIX = "o1:draft:v1:";

/** Drafts older than this are ignored on read and swept on write. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DraftRecord<T> {
  /** Payload version. Bumping it invalidates every stored draft at once. */
  v: 1;
  /** When it was written, epoch ms — what the restore bar shows. */
  at: number;
  values: T;
}

export interface DraftStore {
  read<T>(key: string): DraftRecord<T> | null;
  write<T>(key: string, values: T): void;
  remove(key: string): void;
}

/**
 * Build a namespaced key.
 *
 * The user id is LOAD-BEARING: FMS machines are shared on the shop floor, and
 * one person's half-typed requisition must never surface under the next
 * person's login. Pass the EFFECTIVE identity (`useEffectiveIdentity`), not the
 * raw session, so a draft typed under a demo persona stays with that persona.
 */
export const draftKey = (userId: string, scope: string) => `${DRAFT_PREFIX}${userId}:${scope}`;

let swept = false;

/** Drop every expired draft once per session, so stale keys can't accumulate. */
function sweepExpired() {
  if (swept) return;
  swept = true;
  try {
    const now = Date.now();
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      try {
        const rec = JSON.parse(localStorage.getItem(k) ?? "") as DraftRecord<unknown> | null;
        if (rec?.v !== 1 || now - rec.at > TTL_MS) doomed.push(k);
      } catch {
        doomed.push(k); // unreadable is as good as expired
      }
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage unavailable — nothing to sweep */
  }
}

export const localDraftStore: DraftStore = {
  read<T>(key: string): DraftRecord<T> | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const rec = JSON.parse(raw) as DraftRecord<T> | null;
      // A record from an older payload shape, or one nobody came back for, is
      // not worth offering — drop it rather than restore something confusing.
      if (rec?.v !== 1 || Date.now() - rec.at > TTL_MS) {
        localStorage.removeItem(key);
        return null;
      }
      return rec;
    } catch {
      return null;
    }
  },

  write<T>(key: string, values: T): void {
    sweepExpired();
    const rec: DraftRecord<T> = { v: 1, at: Date.now(), values };
    try {
      localStorage.setItem(key, JSON.stringify(rec));
    } catch {
      // Almost certainly the quota. Force a sweep and try once more; if it
      // still fails, the draft is simply not saved.
      swept = false;
      sweepExpired();
      try {
        localStorage.setItem(key, JSON.stringify(rec));
      } catch {
        /* give up quietly */
      }
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do */
    }
  },
};
