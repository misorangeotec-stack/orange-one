import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { SURAT_GUID, fetchInkLots, type InkLot } from "./schedule";
import { categoryFor, fetchItemCategories, NOT_CATEGORISED } from "./categories";
import { useClosingStock } from "./closingStock";

// The new tables are not in the generated Database type yet — same escape hatch every FMS uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * THE RETEST FLOW — Plant submits, Management reviews and closes.
 *
 * Lots and due dates come live from ConnectWave (schedule.ts). The Orange One tables from
 * 20261217120000 hold only what people did: one `ink_stab_tests` row per test the Plant has
 * submitted. No row = pending. Every write is an RPC, so a status can only move along the
 * path the database allows.
 *
 * Since 20270113120000 (asked 08-10-2026):
 *   - the lab APPROVES → the test closes itself at submit; only a REJECTED test reaches Management;
 *   - Management CLOSES it or REASSIGNS it to someone to audit — there is no send-back any more;
 *   - a test may be Otec Surat's (the Closing stock pages). Records are keyed by company, and an
 *     Enterprises Surat lot's record is SHARED by both groups — one lot, one test (user's choice).
 */

export type FlowStatus = "pending" | "submitted" | "returned" | "closed";
export type StepKey = "plant" | "review";
export type LabResult = "approved" | "rejected";

export const RESULT_LABEL: Record<LabResult, string> = { approved: "Approved", rejected: "Rejected" };
export const RESULT_TONE: Record<LabResult, string> = {
  approved: "bg-ryg-green/10 text-ryg-green",
  rejected: "bg-ryg-red/10 text-ryg-red",
};

export const STATUS_LABEL: Record<FlowStatus, string> = {
  pending: "Pending",
  submitted: "Awaiting review",
  returned: "Sent back",
  closed: "Closed",
};

export const STATUS_TONE: Record<FlowStatus, string> = {
  pending: "bg-grey/10 text-grey",
  submitted: "bg-blue/10 text-blue",
  returned: "bg-ryg-red/10 text-ryg-red",
  closed: "bg-ryg-green/10 text-ryg-green",
};

/** The month the flow went live. Earlier tests were never going to be submitted here. */
export const FLOW_START = "2026-09";

export interface TestRecord {
  id: string;
  stockItem: string;
  lotNo: string;
  testNo: 1 | 2 | 3;
  dueDate: string;
  productionDate: string;
  status: Exclude<FlowStatus, "pending">;
  /** The lab's verdict (20261217120100). Null only on rows submitted before it existed. */
  result: LabResult | null;
  labPerson: string | null;
  plantRemarks: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewRemarks: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  companyGuid: string;
  /** Who Management handed this rejected test to for audit (20270113120000). */
  assignedTo: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  assignNote: string | null;
}

export interface TestDoc {
  id: string;
  testId: string;
  path: string;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface TestActivity {
  id: number;
  testId: string;
  action: "submitted" | "returned" | "closed" | "reassigned";
  remarks: string | null;
  /** Null on a close the system did itself (lab approved). */
  actor: string | null;
  /** Reassigned to whom — null = handed back to the review owners. */
  toUser: string | null;
  createdAt: string;
}

export interface FlowData {
  tests: Map<string, TestRecord>;
  docs: Map<string, TestDoc[]>;
  activity: Map<string, TestActivity[]>;
  owners: Record<StepKey, string[]>;
}

/** One test of one lot: the ConnectWave side and, once submitted, the flow side. */
export interface FlowTest {
  key: string;
  lot: InkLot;
  no: 1 | 2 | 3;
  due: string;
  month: string;
  record: TestRecord | null;
  status: FlowStatus;
}

export const testKey = (item: string, lot: string, no: number) => `${item}\u0000${lot}\u0000${no}`;

/**
 * The flow-map key for a test. Enterprises Surat keeps the plain key (so both groups share its
 * records, and older callers keep working); any other company's key is prefixed with its guid.
 */
export const flowKey = (companyGuid: string | null | undefined, item: string, lot: string, no: number) =>
  !companyGuid || companyGuid === SURAT_GUID ? testKey(item, lot, no) : `${companyGuid}\u0000${testKey(item, lot, no)}`;

/** Postgres "relation does not exist" / PostgREST "table not in schema cache". */
const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");

export class FlowNotInstalled extends Error {
  constructor() {
    super("The retest flow's database tables are not installed yet (migration 20261217120000).");
  }
}

async function readAll<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from(table).select("*").order(order).range(off, off + 999);
    if (error) {
      if (isMissingTable(error)) throw new FlowNotInstalled();
      throw new Error(error.message);
    }
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export async function fetchFlow(): Promise<FlowData> {
  const [tests, docs, acts, owners] = await Promise.all([
    readAll<Record<string, unknown>>("ink_stab_tests", "id"),
    readAll<Record<string, unknown>>("ink_stab_docs", "id"),
    readAll<Record<string, unknown>>("ink_stab_activity", "id"),
    readAll<Record<string, unknown>>("ink_stab_step_owners", "step_key"),
  ]);

  const out: FlowData = { tests: new Map(), docs: new Map(), activity: new Map(), owners: { plant: [], review: [] } };
  const byId = new Map<string, TestRecord>();
  for (const r of tests) {
    const t: TestRecord = {
      id: r.id as string, stockItem: r.stock_item as string, lotNo: r.lot_no as string,
      testNo: Number(r.test_no) as 1 | 2 | 3, dueDate: r.due_date as string, productionDate: r.production_date as string,
      status: r.status as TestRecord["status"],
      result: (r.result as LabResult | null) ?? null, labPerson: (r.lab_person as string | null) ?? null,
      plantRemarks: r.plant_remarks as string | null,
      submittedBy: r.submitted_by as string | null, submittedAt: r.submitted_at as string | null,
      reviewRemarks: r.review_remarks as string | null, reviewedBy: r.reviewed_by as string | null,
      reviewedAt: r.reviewed_at as string | null,
      companyGuid: r.company_guid as string,
      assignedTo: (r.assigned_to as string | null) ?? null, assignedBy: (r.assigned_by as string | null) ?? null,
      assignedAt: (r.assigned_at as string | null) ?? null, assignNote: (r.assign_note as string | null) ?? null,
    };
    byId.set(t.id, t);
    out.tests.set(flowKey(t.companyGuid, t.stockItem, t.lotNo, t.testNo), t);
  }
  for (const r of docs) {
    const d: TestDoc = {
      id: r.id as string, testId: r.test_id as string, path: r.path as string, name: r.name as string,
      mime: r.mime as string | null, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      uploadedBy: r.uploaded_by as string | null, createdAt: r.created_at as string,
    };
    out.docs.set(d.testId, [...(out.docs.get(d.testId) ?? []), d]);
  }
  for (const r of acts) {
    const a: TestActivity = {
      id: Number(r.id), testId: r.test_id as string, action: r.action as TestActivity["action"],
      remarks: r.remarks as string | null, actor: r.actor as string | null, createdAt: r.created_at as string,
      toUser: (r.to_user as string | null) ?? null,
    };
    out.activity.set(a.testId, [...(out.activity.get(a.testId) ?? []), a]);
  }
  for (const r of owners) {
    const k = r.step_key as StepKey;
    if (k === "plant" || k === "review") out.owners[k] = (r.employee_ids as string[]) ?? [];
  }
  return out;
}

/* ------------------------------------------------------------------ hooks -- */

export const LOTS_QUERY = ["ink-stabilisation", "lots"] as const;
export const FLOW_QUERY = ["ink-stabilisation", "flow"] as const;

/**
 * Lots from ConnectWave, each tagged with its category from Bushra Central Master. Both
 * reads run together; the lots are the slow one, so this costs nothing extra.
 */
async function fetchCategorisedLots(): Promise<InkLot[]> {
  const [lots, cats] = await Promise.all([fetchInkLots(), fetchItemCategories()]);
  for (const L of lots) {
    const c = categoryFor(cats, L.item);
    L.category = c.inkType ?? NOT_CATEGORISED;
    L.categoryGroup = c.category;
    L.categorySource = c.source;
    L.inMaster = c.inMaster;
  }
  return lots;
}

/** `enabled` lets My Control Center skip the slow ConnectWave read for people with no plant work. */
export function useInkLots(enabled = true) {
  return useQuery({ queryKey: LOTS_QUERY, queryFn: fetchCategorisedLots, staleTime: 10 * 60_000, enabled });
}

/** Which group a page belongs to: the live production flow, or the Closing stock mirror. */
export type StabMode = "production" | "stock";

/**
 * The lots for a group — Enterprises Surat's production, or both Surat companies' closing
 * stock (only lots with stock today). Only the group's own read runs.
 */
export function useStabLots(mode: StabMode) {
  const stock = mode === "stock";
  const prod = useInkLots(!stock);
  const cs = useClosingStock(stock);
  const q = stock ? cs.q : prod;
  return {
    lots: (stock ? cs.q.data?.lots : prod.data) ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    isFetching: q.isFetching,
    refetch: q.refetch,
    progress: cs.progress,
    closing: stock ? cs.q.data ?? null : null,
    asOf: cs.asOf,
  };
}

export function useFlow() {
  return useQuery({
    queryKey: FLOW_QUERY,
    queryFn: fetchFlow,
    staleTime: 30_000,
    retry: (n, e) => !(e instanceof FlowNotInstalled) && n < 2,
  });
}

/**
 * Is this test on the Plant's list for `month`? Due that month — or, with `carry`, due in an
 * earlier month since the flow went live and still not submitted (or sent back). Main data's
 * pending table uses the same rule, so its numbers match the Plant page's.
 */
export function inPlantScope(t: FlowTest, month: string, carry: boolean): boolean {
  return t.month === month ||
    (carry && t.month >= FLOW_START && t.month < month && t.status !== "closed" && t.status !== "submitted");
}

/** Every test of every lot, joined to its flow record. */
export function joinTests(lots: InkLot[], flow: FlowData | undefined): FlowTest[] {
  const out: FlowTest[] = [];
  for (const lot of lots) {
    // Keyed by company: an Otec lot never borrows an Enterprises Surat record of the same name.
    lot.tests.forEach((due, i) => {
      const no = (i + 1) as 1 | 2 | 3;
      const key = flowKey(lot.companyGuid, lot.item, lot.lot, no);
      const record = flow?.tests.get(key) ?? null;
      out.push({ key, lot, no, due, month: due.slice(0, 7), record, status: record?.status ?? "pending" });
    });
  }
  return out;
}

/**
 * May this user act on this step? The SAME rule as public.ink_stab_can: edit grant, and
 * admin / listed / nobody listed. The database re-checks on every write; this only
 * decides which buttons to draw.
 */
/**
 * May this user close / reassign THIS test? The same rule as public.ink_stab_may_review: an
 * assigned test is its assignee's (and admins'); otherwise the review step's.
 */
export function canReview(t: FlowTest, userId: string, isAdmin: boolean, canEdit: boolean, flow: FlowData | undefined): boolean {
  if (!canEdit) return false;
  if (isAdmin) return true;
  if (t.record?.assignedTo) return t.record.assignedTo === userId;
  return canAct("review", userId, isAdmin, canEdit, flow);
}

export function canAct(step: StepKey, userId: string, isAdmin: boolean, canEdit: boolean, flow: FlowData | undefined): boolean {
  if (!canEdit) return false;
  if (isAdmin) return true;
  const owners = flow?.owners[step] ?? [];
  return owners.length === 0 || owners.includes(userId);
}

/* ----------------------------------------------------------------- writes -- */

const DOCS_BUCKET = "ink-stab-docs";

/**
 * Submit one test, then upload its new attachments under the test's id.
 *
 * Attachments are optional (asked 26-09-2026); the result, lab person and remarks are not.
 *
 * ⚠ THE ROW COMES FIRST because the storage policy only accepts a file whose folder is an
 *   existing, not-closed test. If an upload then fails, the test stays submitted with the
 *   remarks saved; the error names the file so the Plant can reopen it and add it again.
 */
export interface SubmitInput {
  result: LabResult;
  labPerson: string;
  remarks: string;
}

export async function submitTest(t: FlowTest, input: SubmitInput, files: File[]): Promise<void> {
  const { data, error } = await db.rpc("ink_stab_submit", {
    p: {
      company_guid: t.lot.companyGuid ?? SURAT_GUID, stock_item: t.lot.item, lot_no: t.lot.lot, test_no: t.no,
      due_date: t.due, production_date: t.lot.prod, ink_family: t.lot.family,
      qty: t.lot.qty, uom: t.lot.uom,
      result: input.result, lab_person: input.labPerson, remarks: input.remarks,
    },
  });
  if (error) throw new Error(error.message);
  const testId = data as string;
  for (const file of files) await uploadDoc(testId, file);
}

export async function uploadDoc(testId: string, file: File): Promise<void> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${testId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (upErr) throw new Error(`${file.name}: ${upErr.message}`);
  const { error } = await db.rpc("ink_stab_add_doc", {
    p_test: testId,
    p: { path, name: file.name, mime: file.type || "", size_bytes: file.size },
  });
  if (error) throw new Error(`${file.name}: ${error.message}`);
}

export async function deleteDoc(docId: string): Promise<void> {
  const { data, error } = await db.rpc("ink_stab_delete_doc", { p_doc: docId });
  if (error) throw new Error(error.message);
  // The row is gone either way; an orphaned object is harmless and unreadable by path.
  await supabase.storage.from(DOCS_BUCKET).remove([data as string]);
}

/** A 10-minute signed link — mint it on click, never on render. */
export async function docUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/** Management closes a rejected test (send-back was removed in 20270113120000). */
export async function closeTest(id: string, remarks: string): Promise<void> {
  const { error } = await db.rpc("ink_stab_review", { p_id: id, p_action: "close", p_remarks: remarks });
  if (error) throw new Error(error.message);
}

/** Hand a rejected test to someone to audit; `to` null hands it back to the review owners. */
export async function reassignTest(id: string, to: string | null, note: string | null): Promise<void> {
  const { error } = await db.rpc("ink_stab_reassign", { p_id: id, p_to: to, p_note: note });
  if (error) throw new Error(error.message);
}

export async function saveOwners(step: StepKey, ids: string[], userId: string): Promise<void> {
  const { error } = await db.from("ink_stab_step_owners")
    .upsert({ step_key: step, employee_ids: ids, updated_by: userId, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
