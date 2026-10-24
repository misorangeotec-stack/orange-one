import type { LineCache } from "./expiry";

/**
 * This browser's copy of the ink voucher lines, one entry per company × financial year, each
 * stamped with the ConnectWave build it came from (see `fetchExpiryStatus`). IndexedDB, not
 * localStorage: one closed year of Otec Surat alone is ~55k lines, far past localStorage's ~5 MB.
 *
 * A per-browser convenience only. If IndexedDB is blocked (private window, cleared site data),
 * every call quietly misses and the page reads everything from ConnectWave, as it used to.
 */
const DB = "ink-expiry";
const STORE = "lines";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

interface Entry { sig: string; rows: unknown[] }

export const browserLineCache: LineCache = {
  async get(window, sig) {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(window);
        req.onsuccess = () => {
          const e = req.result as Entry | undefined;
          resolve(e && e.sig === sig ? (e.rows as never) : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  },
  async put(window, sig, rows) {
    const db = await open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put({ sig, rows } satisfies Entry, window);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  },
};
