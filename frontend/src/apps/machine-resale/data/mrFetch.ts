import { supabase } from "@/core/platform/supabase";
import { getPortalClient, check } from "./client";
import type {
  Category,
  FieldDef,
  Inquiry,
  InquiryNote,
  Machine,
  MachineMedia,
  MasterValue,
  MrData,
  PrintHead,
  Salesperson,
  SellerOption,
  Setting,
} from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const MR_QK = ["mr"] as const;
export const MR_DATA_QK = ["mr", "all"] as const;
export const MR_SALESPEOPLE_QK = ["mrSalespeople"] as const;
export const MR_SELLERS_QK = ["mrSellers"] as const;

const PAGE = 1000;

/**
 * Every row of a portal table, a page at a time. The volumes are small (10 to 20
 * machines a month) but PostgREST caps a response at 1,000 rows, and an inquiry
 * table that quietly stopped at 1,000 would under-count the dashboard.
 * Ordered by a unique key so the pages cannot overlap or skip.
 */
async function all(table: string, cols: string, orderBy: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(
      await getPortalClient()
        .from(table)
        .select(cols)
        .order(orderBy, { ascending: true })
        .range(from, from + PAGE - 1),
    ) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const audit = (r: Row) => ({
  createdAt: r.created_at,
  createdByName: r.created_by_name ?? null,
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name ?? null,
});

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

export function mapMachine(r: Row, media: MachineMedia[]): Machine {
  const mine = media.filter((m) => m.machineId === r.id).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: r.id,
    listingNo: r.listing_no,
    slug: r.slug,
    title: r.title,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id,
    printerBrandId: r.printer_brand_id ?? null,
    model: r.model ?? null,
    year: num(r.year),
    printWidthM: num(r.print_width_m),
    headCount: num(r.head_count),
    headModel: r.head_model ?? null,
    inkTypeId: r.ink_type_id ?? null,
    conditionId: r.condition_id ?? null,
    hoursRun: r.hours_run ?? null,
    specs: Array.isArray(r.specs)
      ? r.specs
          .filter((s: unknown) => s && typeof s === "object")
          .map((s: Row) => ({ label: String(s.label ?? ""), value: String(s.value ?? "") }))
      : [],
    description: r.description ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    quantity: Number(r.quantity ?? 1),
    bunnyVideoId: r.bunny_video_id ?? null,
    bunnyVideoStatus: r.bunny_video_status ?? null,
    youtubeUrl: r.youtube_url ?? null,
    status: r.status,
    featured: Boolean(r.featured),
    listedAt: r.listed_at ?? null,
    sellerCode: r.seller_code ?? null,
    sellerName: r.seller_name ?? null,
    salespersonId: r.salesperson_id ?? null,
    salespersonName: r.salesperson_name ?? null,
    salespersonEmail: r.salesperson_email ?? null,
    internalNotes: r.internal_notes ?? null,
    visibilityOverrides: r.visibility_overrides && typeof r.visibility_overrides === "object" ? r.visibility_overrides : {},
    photos: mine.filter((m) => m.kind === "photo"),
    documents: mine.filter((m) => m.kind === "document"),
    ...audit(r),
  };
}

export async function fetchMrData(): Promise<MrData> {
  const [cats, heads, masters, fields, settings, machines, media, inquiries, notes] = await Promise.all([
    all("mr_categories", "*", "id"),
    all("mr_subcategories", "*", "id"),
    all("mr_master_values", "*", "id"),
    all("mr_fields", "*", "key"),
    all("mr_settings", "*", "key"),
    all("mr_machines", "*", "id"),
    all("mr_machine_media", "*", "id"),
    all("mr_inquiries", "*", "id"),
    all("mr_inquiry_notes", "*", "id"),
  ]);

  const mediaRows: MachineMedia[] = media.map((m) => ({
    id: m.id,
    machineId: m.machine_id,
    kind: m.kind,
    storagePath: m.storage_path,
    fileName: m.file_name ?? null,
    sortOrder: Number(m.sort_order ?? 0),
  }));

  const noteRows: InquiryNote[] = notes
    .map((n) => ({
      id: n.id,
      inquiryId: n.inquiry_id,
      note: n.note,
      authorName: n.author_name ?? null,
      createdAt: n.created_at,
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    categories: cats.map(
      (r): Category => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        intro: r.intro ?? null,
        imagePath: r.image_path ?? null,
        sortOrder: Number(r.sort_order ?? 0),
        active: Boolean(r.active),
        ...audit(r),
      }),
    ),
    printHeads: heads.map(
      (r): PrintHead => ({
        id: r.id,
        categoryId: r.category_id,
        name: r.name,
        slug: r.slug,
        sortOrder: Number(r.sort_order ?? 0),
        active: Boolean(r.active),
        ...audit(r),
      }),
    ),
    masters: masters.map(
      (r): MasterValue => ({
        id: r.id,
        master: r.master,
        value: r.value,
        sortOrder: Number(r.sort_order ?? 0),
        active: Boolean(r.active),
        ...audit(r),
      }),
    ),
    fields: fields
      .map(
        (r): FieldDef => ({
          key: r.key,
          label: r.label,
          defaultVisible: Boolean(r.default_visible),
          locked: Boolean(r.locked),
          sortOrder: Number(r.sort_order ?? 0),
          ...audit(r),
        }),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder),
    settings: settings.map(
      (r): Setting => ({
        key: r.key,
        value: r.value,
        isPublic: Boolean(r.is_public),
        description: r.description ?? null,
      }),
    ),
    machines: machines.map((r) => mapMachine(r, mediaRows)),
    inquiries: inquiries.map(
      (r): Inquiry => ({
        id: r.id,
        inquiryNo: r.inquiry_no,
        machineId: r.machine_id ?? null,
        listingNoSnapshot: r.listing_no_snapshot ?? null,
        machineTitleSnapshot: r.machine_title_snapshot ?? null,
        source: r.source,
        buyerName: r.buyer_name,
        company: r.company ?? null,
        phone: r.phone,
        email: r.email ?? null,
        city: r.city ?? null,
        message: r.message ?? null,
        statusId: r.status_id ?? null,
        salespersonId: r.salesperson_id ?? null,
        salespersonName: r.salesperson_name ?? null,
        salespersonEmail: r.salesperson_email ?? null,
        notes: noteRows.filter((n) => n.inquiryId === r.id),
        ...audit(r),
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// From the HUB (read-only): the two pickers whose people and customers live there.
// Saved into the portal as snapshots, never as live references.
// ---------------------------------------------------------------------------

const hub = supabase as any;

/**
 * People who can open Machine Resale, with the email the inquiry alert goes to.
 * The hub's people directory strips email on purpose, so this comes from the
 * `mr_salesperson_options()` function (hub migration 20270127120000), which
 * answers only callers who can edit Machine Resale.
 */
export async function fetchSalespeople(): Promise<Salesperson[]> {
  const { data, error } = await hub.rpc("mr_salesperson_options");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.user_id,
    name: r.name,
    email: r.email ?? null,
    designation: r.designation ?? null,
  }));
}

/** Orange's customer list (the hub's central party master), for the seller picker. */
export async function fetchSellers(): Promise<SellerOption[]> {
  const out: SellerOption[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await hub
      .from("mst_parties")
      .select("id,code,name")
      .eq("is_customer", true)
      .eq("active", true)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows.map((r) => ({ id: r.id, code: r.code ?? null, name: r.name })));
    if (rows.length < PAGE) break;
  }
  return out;
}
