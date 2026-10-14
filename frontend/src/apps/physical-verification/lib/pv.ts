import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { fetchSuratStock, OTEC_SURAT_GUID, type StockItem } from "./stock";

// The new tables are not in the generated Database type yet — same escape hatch every FMS uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * PHYSICAL VERIFICATION — the rounds people have scheduled and counted.
 *
 * Items and their live closing stock come from ConnectWave (stock.ts). The Orange One tables
 * from 20270126120000 hold one `pv_counts` row per item per round. Every write is an RPC, so a
 * status can only move along the path the database allows.
 */

export type CountStatus = "scheduled" | "submitted" | "returned" | "accepted";

export const STATUS_LABEL: Record<CountStatus, string> = {
  scheduled: "To count",
  submitted: "Awaiting review",
  returned: "Recount",
  accepted: "Accepted",
};

export const STATUS_TONE: Record<CountStatus, string> = {
  scheduled: "bg-blue/10 text-blue",
  submitted: "bg-yellow/20 text-ink",
  returned: "bg-ryg-red/10 text-ryg-red",
  accepted: "bg-ryg-green/10 text-ryg-green",
};

export interface CountRow {
  id: string;
  item: string;
  primaryGroup: string | null;
  subGroup: string | null;
  group: string | null;
  unit: string | null;
  verifyDate: string;
  /** Null once the verifier's user account is deleted — step 1 gives it to someone else. */
  assignedTo: string | null;
  status: CountStatus;
  closingQty: number | null;
  closingRate: number | null;
  tallyAsAt: string | null;
  physicalQty: number | null;
  difference: number | null;
  verifierRemarks: string | null;
  countedBy: string | null;
  countedAt: string | null;
  submittedAt: string | null;
  reviewRemarks: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface PvData {
  counts: CountRow[];
  /** The one open round per item (anything not accepted), keyed by item name. */
  open: Map<string, CountRow>;
  /** The latest accepted round per item. */
  lastAccepted: Map<string, CountRow>;
  /** Step 1 — who sets verification dates and reviews counts (admins always may). */
  schedulers: string[];
  /** Step 2 — who may be given items to count. */
  verifiers: string[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");

export class PvNotInstalled extends Error {
  constructor() {
    super("Physical Verification's database tables are not installed yet (migration 20270126120000).");
  }
}

async function readAll<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from(table).select("*").order(order).range(off, off + 999);
    if (error) {
      if (isMissingTable(error)) throw new PvNotInstalled();
      throw new Error(error.message);
    }
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export async function fetchPv(): Promise<PvData> {
  const [rows, settings] = await Promise.all([
    readAll<Record<string, unknown>>("pv_counts", "id"),
    readAll<Record<string, unknown>>("pv_settings", "id"),
  ]);
  const counts: CountRow[] = rows
    .filter((r) => r.company_guid === OTEC_SURAT_GUID)
    .map((r) => ({
      id: r.id as string,
      item: r.stock_item as string,
      primaryGroup: r.primary_group as string | null,
      subGroup: r.sub_group as string | null,
      group: r.stock_group as string | null,
      unit: r.unit as string | null,
      verifyDate: r.verify_date as string,
      assignedTo: r.assigned_to as string | null,
      status: r.status as CountStatus,
      closingQty: num(r.closing_qty),
      closingRate: num(r.closing_rate),
      tallyAsAt: r.tally_as_at as string | null,
      physicalQty: num(r.physical_qty),
      difference: num(r.difference),
      verifierRemarks: r.verifier_remarks as string | null,
      countedBy: r.counted_by as string | null,
      countedAt: r.counted_at as string | null,
      submittedAt: r.submitted_at as string | null,
      reviewRemarks: r.review_remarks as string | null,
      reviewedBy: r.reviewed_by as string | null,
      reviewedAt: r.reviewed_at as string | null,
    }));
  const open = new Map<string, CountRow>();
  const lastAccepted = new Map<string, CountRow>();
  for (const c of counts) {
    if (c.status !== "accepted") open.set(c.item, c);
    else {
      const prev = lastAccepted.get(c.item);
      if (!prev || (c.reviewedAt ?? "") > (prev.reviewedAt ?? "")) lastAccepted.set(c.item, c);
    }
  }
  return {
    counts, open, lastAccepted,
    schedulers: (settings[0]?.scheduler_ids as string[]) ?? [],
    verifiers: (settings[0]?.verifier_ids as string[]) ?? [],
  };
}

/* ------------------------------------------------------------------ hooks -- */

export const STOCK_QUERY = ["physical-verification", "stock"] as const;
export const PV_QUERY = ["physical-verification", "counts"] as const;

export function useStock() {
  return useQuery({ queryKey: STOCK_QUERY, queryFn: fetchSuratStock, staleTime: 5 * 60_000 });
}

export function usePv() {
  return useQuery({
    queryKey: PV_QUERY,
    queryFn: fetchPv,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof PvNotInstalled) && n < 2,
  });
}

/**
 * Step 1 rights — the SAME rule as public.pv_can_schedule: admin, or listed with an edit grant.
 * The database re-checks on every write; this only decides which menus and buttons to draw.
 */
export const canSchedule = (userId: string, isAdmin: boolean, canEdit: boolean, pv: PvData | undefined) =>
  isAdmin || (canEdit && (pv?.schedulers ?? []).includes(userId));

/** Difference value in ₹ — the difference at the rate Tally held when it was counted. */
export const diffValue = (diff: number | null, rate: number | null) =>
  diff === null || rate === null ? null : diff * rate;

/* ----------------------------------------------------------------- writes -- */

export async function scheduleItems(items: StockItem[], date: string, assignee: string): Promise<number> {
  const { data, error } = await db.rpc("pv_schedule", {
    p_items: items.map((s) => ({
      company_guid: OTEC_SURAT_GUID, stock_item: s.item, primary_group: s.primaryGroup, sub_group: s.subGroup,
      stock_group: s.group, unit: s.unit,
      closing_qty: s.closingQty, closing_rate: s.closingRate, tally_as_at: s.builtAt,
    })),
    p_date: date,
    p_assignee: assignee,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function unscheduleItems(ids: string[]): Promise<number> {
  const { data, error } = await db.rpc("pv_unschedule", { p_ids: ids });
  if (error) throw new Error(error.message);
  return data as number;
}

export interface CountInput {
  id: string;
  physicalQty: number | null;
  remarks: string;
  /** Tally's closing at this moment — frozen on the row by the save. */
  stock: StockItem | undefined;
}

export async function saveCounts(rows: CountInput[], submit: boolean): Promise<number> {
  const { data, error } = await db.rpc("pv_save_counts", {
    p_rows: rows.map((r) => ({
      id: r.id,
      physical_qty: r.physicalQty,
      remarks: r.remarks,
      // An item that has dropped out of stock since scheduling is closing 0 now.
      closing_qty: r.stock ? r.stock.closingQty : 0,
      closing_rate: r.stock?.closingRate ?? null,
      tally_as_at: r.stock?.builtAt ?? null,
    })),
    p_submit: submit,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function reviewCounts(ids: string[], action: "accept" | "recount", remarks: string): Promise<number> {
  const { data, error } = await db.rpc("pv_review", { p_ids: ids, p_action: action, p_remarks: remarks });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function saveRights(schedulers: string[], verifiers: string[], userId: string): Promise<void> {
  const { error } = await db.from("pv_settings")
    .update({ scheduler_ids: schedulers, verifier_ids: verifiers, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}
