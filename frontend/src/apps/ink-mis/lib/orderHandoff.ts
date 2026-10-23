/**
 * INK IMS → PURCHASE FMS hand-off.
 *
 * The dashboard's "Place order" panel ends with the planner raising the order in Purchase RM
 * Import (import inks) or Purchase RM Domestic (domestic inks). The two raise forms live on their
 * own routes and open in a new tab, so the order travels through localStorage — same origin, so
 * the new tab can read it — under a one-off id carried in the URL (`?ink=<id>`).
 *
 * The purchase apps keep their own item and company masters, so nothing here is an id: an ink is
 * described by its Tally names, description and code, and the company by its Tally company GUID
 * and label. The receiving form matches those to its own masters and LISTS anything it could not
 * match, so an ink is never dropped silently.
 */

export type HandoffTarget = "import" | "domestic";

export interface HandoffLine {
  itemCode: string;
  description: string;
  /** Tally item names, the landing book's first — the most reliable thing to match on. */
  names: string[];
  supplier: string;
  qty: number;
}

export interface OrderHandoff {
  id: string;
  /**
   * The IMS sheet the order was placed on. Absent = Ink IMS (every hand-off before RM IMS got
   * Place order). RM IMS uses this same hand-off, so the purchase forms serve both sheets.
   */
  sheet?: "ink" | "rm";
  target: HandoffTarget;
  createdAt: string;
  /** The Ink IMS book the order is for: `InkCompany.key`, Tally company GUID and label. */
  companyKey: string;
  companyGuid: string;
  companyLabel: string;
  lines: HandoffLine[];
}

const keyOf = (id: string) => `ink-mis:order-handoff:${id}`;
/** Hand-offs older than this are cleared the next time one is written. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** "Ink IMS" / "RM IMS" — where the order came from, for the purchase form's banner and note. */
export const handoffSheetLabel = (h: Pick<OrderHandoff, "sheet">) => (h.sheet === "rm" ? "RM IMS" : "Ink IMS");
/** What the sheet calls one line: "ink(s)" on Ink IMS, "item(s)" on RM IMS. */
export const handoffNoun = (h: Pick<OrderHandoff, "sheet">, n: number) =>
  `${h.sheet === "rm" ? "item" : "ink"}${n === 1 ? "" : "s"}`;

export function writeHandoff(h: OrderHandoff): void {
  try {
    const now = Date.now();
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith("ink-mis:order-handoff:")) continue;
      try {
        const old = JSON.parse(window.localStorage.getItem(k) ?? "null") as OrderHandoff | null;
        if (!old || now - Date.parse(old.createdAt) > MAX_AGE_MS) window.localStorage.removeItem(k);
      } catch {
        window.localStorage.removeItem(k);
      }
    }
    window.localStorage.setItem(keyOf(h.id), JSON.stringify(h));
  } catch {
    /* storage blocked: the form simply opens empty */
  }
}

export function readHandoff(id: string | null): OrderHandoff | null {
  if (!id) return null;
  try {
    const h = JSON.parse(window.localStorage.getItem(keyOf(id)) ?? "null") as OrderHandoff | null;
    return h && Array.isArray(h.lines) ? h : null;
  } catch {
    return null;
  }
}

/**
 * After a request is raised, keep only the inks it did NOT cover. Opening the same link again
 * then offers just those, which is how an import order split across vendors gets finished.
 */
export function keepRemaining(id: string, remaining: HandoffLine[]): void {
  try {
    const h = readHandoff(id);
    if (!h) return;
    if (remaining.length === 0) window.localStorage.removeItem(keyOf(id));
    else window.localStorage.setItem(keyOf(id), JSON.stringify({ ...h, lines: remaining }));
  } catch {
    /* nothing to do */
  }
}

/** The URL of the raise form for a hand-off. */
export const handoffUrl = (target: HandoffTarget, id: string) =>
  `${target === "import" ? "/import" : "/procurement"}/requests/new?ink=${encodeURIComponent(id)}`;

/* -------------------------------------------------------------------- matching */

/** Case, spacing and punctuation never decide a match. */
export const normName = (s: string | null | undefined) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * The first item whose name equals one of the ink's names (Tally names, then description, then
 * code). Exact after normalising — a fuzzy match could put the wrong ink on a purchase order.
 */
export function matchItem<T extends { name: string }>(line: HandoffLine, items: T[]): T | undefined {
  const byName = new Map<string, T>();
  for (const it of items) {
    const k = normName(it.name);
    if (k && !byName.has(k)) byName.set(k, it);
  }
  for (const n of [...line.names, line.description, line.itemCode]) {
    const hit = byName.get(normName(n));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The purchase company for the ink book. Tally GUID first, where the master carries it; else the
 * site (Surat / Noida) plus Enterprises vs O Tec read from the name. Only a single clear hit
 * counts — otherwise the form leaves Company for the person to pick.
 */
export function matchCompany<C extends { id: string; name: string; location?: string | null; tallyGuid?: string | null }>(
  h: Pick<OrderHandoff, "companyGuid" | "companyKey">,
  companies: C[],
): C | undefined {
  const byGuid = companies.find((c) => c.tallyGuid && c.tallyGuid === h.companyGuid);
  if (byGuid) return byGuid;
  const site = h.companyKey.endsWith("noida") ? "NOIDA" : "SURAT";
  const enterprises = h.companyKey.startsWith("ent");
  const hits = companies.filter((c) => {
    const text = normName(`${c.name} ${c.location ?? ""}`);
    return text.includes(site) && /ENTERPRISE/.test(text) === enterprises;
  });
  return hits.length === 1 ? hits[0] : undefined;
}
