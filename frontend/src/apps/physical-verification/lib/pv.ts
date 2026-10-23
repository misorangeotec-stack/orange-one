import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { COMPANY_GUIDS, fetchStock, itemKey, type StockItem } from "./stock";

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
  companyGuid: string;
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
  /** The verifier's count split by lot (20270203120000). Adds up to physicalQty at submit. */
  lotCounts: LotLine[];
  /** Tally's lot-wise closing frozen at the last count save — for the review only. */
  lotClosing: LotClosing[];
  /** Step 4 — closed in Tally under this voucher, with its attachment. */
  tallyVoucherNo: string | null;
  tallyVoucherDate: string | null;
  tallyAttachment: string | null;
  tallyAttachmentName: string | null;
  tallyPostedBy: string | null;
  tallyPostedAt: string | null;
}

/** One lot line the verifier counted. */
export interface LotLine { lot: string; qty: number | null }
/** One lot's closing in Tally (ConnectWave lot balance) when the count was saved. */
export interface LotClosing { lot: string; qty: number; godown: string }

export interface PvData {
  counts: CountRow[];
  /** The one open round per item (anything not accepted), keyed by itemKey(company, item). */
  open: Map<string, CountRow>;
  /** The latest accepted round per item, keyed by itemKey(company, item). */
  lastAccepted: Map<string, CountRow>;
  /** Step 1 — who sets verification dates and reviews counts (admins always may). */
  schedulers: string[];
  /** Step 2 — who may be given items to count. */
  verifiers: string[];
  /** Step 3 — who reviews submitted counts (20270128120000). Empty = step 1 reviews. */
  reviewers: string[];
  /** Step 4 — who posts accepted differences to Tally (20270203120000). Empty = step 3 posts. */
  tallyPeople: string[];
  /** Items step 1 chose to show on the Master, per company GUID. Missing / empty = show all. */
  masterLines: Map<string, Set<string>>;
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
  const [rows, settings, lines] = await Promise.all([
    readAll<Record<string, unknown>>("pv_counts", "id"),
    readAll<Record<string, unknown>>("pv_settings", "id"),
    // Chosen lines came with 20270203120000; without it the Master simply shows every item.
    readAll<Record<string, unknown>>("pv_master_lines", "stock_item").catch(() => []),
  ]);
  const masterLines = new Map<string, Set<string>>();
  for (const l of lines) {
    const g = l.company_guid as string;
    if (!masterLines.has(g)) masterLines.set(g, new Set());
    masterLines.get(g)!.add(l.stock_item as string);
  }
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const counts: CountRow[] = rows
    .filter((r) => COMPANY_GUIDS.includes(r.company_guid as string))
    .map((r) => ({
      id: r.id as string,
      companyGuid: r.company_guid as string,
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
      lotCounts: arr(r.lot_counts).map((l) => ({ lot: String(l.lot ?? ""), qty: num(l.qty) })),
      lotClosing: arr(r.lot_closing).map((l) => ({ lot: String(l.lot ?? ""), qty: Number(l.qty) || 0, godown: String(l.godown ?? "") })),
      tallyVoucherNo: (r.tally_voucher_no as string | null) ?? null,
      tallyVoucherDate: (r.tally_voucher_date as string | null) ?? null,
      tallyAttachment: (r.tally_attachment as string | null) ?? null,
      tallyAttachmentName: (r.tally_attachment_name as string | null) ?? null,
      tallyPostedBy: (r.tally_posted_by as string | null) ?? null,
      tallyPostedAt: (r.tally_posted_at as string | null) ?? null,
    }));
  const open = new Map<string, CountRow>();
  const lastAccepted = new Map<string, CountRow>();
  for (const c of counts) {
    const k = itemKey(c.companyGuid, c.item);
    if (c.status !== "accepted") open.set(k, c);
    else {
      const prev = lastAccepted.get(k);
      if (!prev || (c.reviewedAt ?? "") > (prev.reviewedAt ?? "")) lastAccepted.set(k, c);
    }
  }
  return {
    counts, open, lastAccepted,
    schedulers: (settings[0]?.scheduler_ids as string[]) ?? [],
    verifiers: (settings[0]?.verifier_ids as string[]) ?? [],
    reviewers: (settings[0]?.reviewer_ids as string[]) ?? [],
    tallyPeople: (settings[0]?.tally_ids as string[]) ?? [],
    masterLines,
  };
}

/* ------------------------------------------------------------------ hooks -- */

export const stockQuery = (companyGuid: string) => ["physical-verification", "stock", companyGuid] as const;
export const PV_QUERY = ["physical-verification", "counts"] as const;

/** One company's closing stock (the Master). */
export function useStock(companyGuid: string) {
  return useQuery({ queryKey: stockQuery(companyGuid), queryFn: () => fetchStock(companyGuid), staleTime: 5 * 60_000 });
}

/**
 * Closing stock of several companies at once (the Count page: a verifier's rows can come from
 * any of the four). `by` is keyed by itemKey; `refetch` re-reads all of them and returns the
 * fresh map — the figure a save freezes on the row.
 */
export function useStocks(companyGuids: string[]) {
  const guids = [...new Set(companyGuids)].sort();
  return useQueries({
    queries: guids.map((g) => ({ queryKey: stockQuery(g), queryFn: () => fetchStock(g), staleTime: 5 * 60_000 })),
    combine: combineStocks,
  });
}

const toStockMap = (lists: (StockItem[] | undefined)[]) =>
  new Map(lists.flatMap((l) => l ?? []).map((s) => [itemKey(s.companyGuid, s.item), s] as const));

// Module-level so react-query only rebuilds the map when a company's stock actually changes.
function combineStocks(qs: UseQueryResult<StockItem[]>[]) {
  return {
    by: toStockMap(qs.map((q) => q.data)),
    /** Every company asked for has loaded — an item missing from `by` really has no stock now. */
    loaded: qs.every((q) => q.isSuccess),
    error: (qs.find((q) => q.isError)?.error as Error | undefined) ?? null,
    refetch: async () => toStockMap((await Promise.all(qs.map((q) => q.refetch()))).map((r) => r.data)),
  };
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

/**
 * Step 3 rights — the SAME rule as public.pv_can_review: admin, or listed with an edit grant;
 * while nobody is listed, the step 1 people review.
 */
export function canReview(userId: string, isAdmin: boolean, canEdit: boolean, pv: PvData | undefined): boolean {
  if (isAdmin) return true;
  if (!canEdit || !pv) return false;
  return pv.reviewers.length ? pv.reviewers.includes(userId) : pv.schedulers.includes(userId);
}

/**
 * Step 4 rights — the SAME rule as public.pv_can_post: admin, or listed with an edit grant;
 * while nobody is listed, the step 3 people post.
 */
export function canPost(userId: string, isAdmin: boolean, canEdit: boolean, pv: PvData | undefined): boolean {
  if (isAdmin) return true;
  if (!pv) return false;
  if (pv.tallyPeople.length) return canEdit && pv.tallyPeople.includes(userId);
  return canReview(userId, isAdmin, canEdit, pv);
}

/** Sum of the lot lines typed so far. */
export const lotTotal = (lots: LotLine[]) => lots.reduce((s, l) => s + (l.qty ?? 0), 0);

/** An accepted count whose difference still has to go into Tally. */
export const toPost = (c: CountRow) => c.status === "accepted" && (c.difference ?? 0) !== 0 && !c.tallyPostedAt;

/** Difference value in ₹ — the difference at the rate Tally held when it was counted. */
export const diffValue = (diff: number | null, rate: number | null) =>
  diff === null || rate === null ? null : diff * rate;

/* ----------------------------------------------------------------- writes -- */

export async function scheduleItems(items: StockItem[], date: string, assignee: string): Promise<number> {
  const { data, error } = await db.rpc("pv_schedule", {
    p_items: items.map((s) => ({
      company_guid: s.companyGuid, stock_item: s.item, primary_group: s.primaryGroup, sub_group: s.subGroup,
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
  /** The count split by lot. */
  lots: LotLine[];
  /** Tally's lot balances at this moment (frozen; the verifier never sees them). Null = keep. */
  lotClosing: LotClosing[] | null;
}

export async function saveCounts(rows: CountInput[], submit: boolean): Promise<number> {
  const { data, error } = await db.rpc("pv_save_counts", {
    p_rows: rows.map((r) => ({
      id: r.id,
      physical_qty: r.physicalQty,
      remarks: r.remarks,
      lots: r.lots,
      lot_closing: r.lotClosing,
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

/** Accept or send back, each item with its own remark (required either way). */
export async function reviewRows(rows: { id: string; remarks: string }[], action: "accept" | "recount"): Promise<number> {
  const { data, error } = await db.rpc("pv_review_rows", { p_rows: rows, p_action: action });
  if (error) throw new Error(error.message);
  return data as number;
}

/** Step 1: the items the Master shows for one company. Empty = every item. */
export async function setMasterLines(companyGuid: string, items: string[]): Promise<number> {
  const { data, error } = await db.rpc("pv_set_lines", { p_company: companyGuid, p_items: items });
  if (error) throw new Error(error.message);
  return data as number;
}

const TALLY_BUCKET = "pv-tally-docs";

/**
 * Step 4: upload the Tally voucher, then close the lines under it. The file goes into the first
 * line's folder — the storage policy only lets it in while that line is still waiting.
 */
export async function closeInTally(ids: string[], voucherNo: string, voucherDate: string, file: File): Promise<number> {
  const path = `${ids[0]}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const { error: upErr } = await supabase.storage.from(TALLY_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (upErr) throw new Error(`${file.name}: ${upErr.message}`);
  const { data, error } = await db.rpc("pv_tally_post", {
    p_ids: ids, p_voucher_no: voucherNo, p_voucher_date: voucherDate, p_attachment: path, p_attachment_name: file.name,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/** A 10-minute link to a Tally attachment — made on click, never on render. */
export async function tallyDocUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(TALLY_BUCKET).createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function unpost(ids: string[], reason: string): Promise<number> {
  const { data, error } = await db.rpc("pv_tally_unpost", { p_ids: ids, p_reason: reason });
  if (error) throw new Error(error.message);
  return data as number;
}

export interface Rights { schedulers: string[]; verifiers: string[]; reviewers: string[]; tallyPeople: string[] }

export async function saveRights(r: Rights, userId: string): Promise<void> {
  const { error } = await db.from("pv_settings")
    .update({
      scheduler_ids: r.schedulers, verifier_ids: r.verifiers, reviewer_ids: r.reviewers, tally_ids: r.tallyPeople,
      updated_by: userId, updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}
