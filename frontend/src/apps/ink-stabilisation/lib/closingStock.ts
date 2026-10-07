import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { fetchExpiryStatus, type NoLotStock } from "../../ink-expiry/lib/expiry";
import { categoryFor, fetchItemCategories, NOT_CATEGORISED } from "./categories";
import { OTEC_SURAT_GUID, SURAT_GUID } from "./constants";
import { addMonths, TEST_MONTHS, type InkLot } from "./schedule";

/**
 * CLOSING STOCK — the ink lots Enterprises Surat AND Otec Surat hold in Tally today, each with
 * its three retest dates. Asked 07-10-2026: "a mirror page of Main data with only the closing
 * stock as on today, both companies".
 *
 * The stock comes from Ink Expiry's reader (ink-expiry/lib/expiry.ts) — lots netted from
 * rpt_batch_line and tied to Tally's closing qty per item — so the two apps never disagree
 * on what is in stock. Two differences from Ink Expiry's own page:
 *   - only these two companies are read (keeps it to ~half the requests);
 *   - Lab / LOOSE INK godown stock is KEPT, so every item ties to Tally's closing exactly.
 *
 * ⚠ THE TEST CLOCK STARTS AT THE LOT'S ORIGIN: its production (in any company — an Otec lot
 *   made at Enterprises Surat counts from that production), else its purchase. A lot whose
 *   date cannot be found has no tests and is counted in `undated`, never guessed.
 *
 * ⚠ A FULL READ TAKES ~30–60 s. The last result is kept in this browser's localStorage and shown
 *   at once next time while a fresh read runs behind it — a per-browser convenience only.
 */

export const STOCK_COMPANIES: { guid: string; name: string }[] = [
  { guid: SURAT_GUID, name: "Enterprises Surat" },
  { guid: OTEC_SURAT_GUID, name: "Otec Surat" },
];

export interface ClosingStock {
  lots: InkLot[];
  /** In stock, but no production / purchase date found — so no test dates. */
  undated: InkLot[];
  /** Tally holds more than the lots add up to: stock with no lot, which cannot be scheduled. */
  noLot: NoLotStock[];
  builtAt: string | null;
}

const CACHE_KEY = "ink-stabilisation:closing-stock:v1";
const FRESH_MS = 15 * 60_000;

interface Saved { savedAt: number; today: string; data: ClosingStock }

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s?.data?.lots ? s : null;
  } catch {
    return null;
  }
}

function writeSaved(today: string, data: ClosingStock) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), today, data } satisfies Saved));
  } catch {
    // Storage blocked or full — the page still works, just without the instant start.
  }
}

async function fetchClosingStock(today: string, onProgress: (d: number, n: number) => void): Promise<ClosingStock> {
  if (!hasConnectwave()) throw new Error("The live Tally mirror (ConnectWave) is not configured for this site.");
  const guidOf = Object.fromEntries(STOCK_COMPANIES.map((c) => [c.name, c.guid]));
  const [stock, ent, otec] = await Promise.all([
    fetchExpiryStatus(getConnectwave(), today, onProgress, { companies: STOCK_COMPANIES.map((c) => c.guid), keepHeld: true }),
    fetchItemCategories(SURAT_GUID),
    fetchItemCategories(OTEC_SURAT_GUID),
  ]);

  const lots: InkLot[] = [];
  const undated: InkLot[] = [];
  for (const s of stock.lots) {
    const guid = guidOf[s.company];
    if (!guid) continue;
    // The company's own Bushra Central Master entry first; an Otec item with no ink type there
    // borrows Enterprises Surat's, where the same ink usually carries the same name.
    let c = categoryFor(guid === OTEC_SURAT_GUID ? otec : ent, s.item);
    if (!c.inkType && guid === OTEC_SURAT_GUID) {
      const e = categoryFor(ent, s.item);
      if (e.inkType) c = e;
    }
    const L: InkLot = {
      item: s.item, family: s.category || "(No stock group in Tally)",
      category: c.inkType ?? NOT_CATEGORISED, categoryGroup: c.category, categorySource: c.source, inMaster: c.inMaster,
      lot: s.lot, prod: s.inward ?? "", mfd: s.mfd, expiry: s.expiry, qty: s.qty, uom: s.uom || null,
      tests: ["", "", ""], vouchers: s.inwardType ? [s.inwardType] : [],
      companyGuid: guid, company: s.company, godown: s.godown, dateFrom: s.inwardType,
    };
    if (!s.inward) { undated.push(L); continue; }
    L.tests = TEST_MONTHS.map((m) => addMonths(L.prod, m)) as InkLot["tests"];
    lots.push(L);
  }
  return { lots, undated, noLot: stock.noLot, builtAt: stock.builtAt };
}

/** `enabled` false = no read (Main data shares the page component and skips it). */
export function useClosingStock(enabled = true) {
  const today = todayLocalIso();
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [saved] = useState(readSaved);
  const q = useQuery({
    queryKey: ["ink-stabilisation", "closing-stock", today],
    queryFn: async () => {
      const data = await fetchClosingStock(today, (d, n) => setProgress([d, n]));
      writeSaved(today, data);
      return data;
    },
    initialData: saved?.data,
    // A copy from another day counts as time 0, so it is re-read at once.
    initialDataUpdatedAt: saved ? (saved.today === today ? saved.savedAt : 0) : undefined,
    staleTime: FRESH_MS,
    enabled,
  });
  return {
    q,
    progress,
    /** When the figures on screen were read from Tally. */
    asOf: q.data ? new Date(q.dataUpdatedAt > 0 ? q.dataUpdatedAt : saved?.savedAt ?? Date.now()) : null,
  };
}
