import { getPortalClient, removeMedia } from "./client";
import type { InquirySource, MachineStatus, MasterKind, SpecPair, VideoState } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Every write to the portal. Row rules on the portal allow writes only to a pass
 * with level `edit`; the screens hide write controls from view-only users too, but
 * the database is what actually refuses.
 *
 * The portal stamps created_by / updated_by and note authors from the pass itself,
 * so nothing here sends them. It does NOT fill the snapshots: a machine's seller
 * and salesperson, and a hand-added inquiry's machine and salesperson, are sent
 * from here.
 */

const db = () => getPortalClient();

/** Database refusals in words a salesperson can act on. */
export function plainError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("mr_machines_complete_when_listed")) {
    return new Error(
      "To list a machine as Active or Sold it needs a printer brand, condition, city, state, seller and salesperson.",
    );
  }
  if (msg.includes("mr_machines_slug_key")) return new Error("Another machine already uses that web address.");
  if (msg.includes("mr_categories_slug_key")) return new Error("Another category already uses that web address name.");
  if (msg.includes("mr_subcategories_category_id_slug_key")) {
    return new Error("That category already has a print head with this web address name.");
  }
  if (msg.includes("mr_master_values_master_value_key")) return new Error("That value is already in this list.");
  if (msg.includes("mr_inquiries_machine_id_fkey")) {
    return new Error("This machine has inquiries, so it cannot be deleted. Mark it Inactive or Sold instead.");
  }
  if (msg.includes("mr_machines_subcategory_id_category_id_fkey")) {
    return new Error("Machines are listed under this print head, so it cannot move to another category.");
  }
  if (msg.includes("violates foreign key constraint")) {
    return new Error("Something still uses this, so it cannot be removed.");
  }
  if (msg.includes("row-level security") || msg.includes("permission denied")) {
    return new Error("You can view Machine Resale but not change it.");
  }
  return e instanceof Error ? e : new Error(msg);
}

async function run<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw plainError(new Error(error.message));
  return data;
}

/** Same rule as the portal's `mr_slugify()`, so a slug made here matches one made there. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export interface MachineInput {
  title: string;
  categoryId: string;
  subcategoryId: string;
  printerBrandId: string | null;
  model: string | null;
  year: number | null;
  printWidthM: number | null;
  headCount: number | null;
  headModel: string | null;
  inkTypeId: string | null;
  conditionId: string | null;
  hoursRun: string | null;
  specs: SpecPair[];
  description: string | null;
  city: string | null;
  state: string | null;
  quantity: number;
  status: MachineStatus;
  featured: boolean;
  sellerCode: string | null;
  sellerName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salespersonEmail: string | null;
  internalNotes: string | null;
  visibilityOverrides: Record<string, boolean>;
}

export interface MediaInput {
  storagePath: string;
  fileName: string | null;
}

const machineRow = (m: MachineInput) => ({
  title: m.title.trim(),
  category_id: m.categoryId,
  subcategory_id: m.subcategoryId,
  printer_brand_id: m.printerBrandId,
  model: m.model,
  year: m.year,
  print_width_m: m.printWidthM,
  head_count: m.headCount,
  head_model: m.headModel,
  ink_type_id: m.inkTypeId,
  condition_id: m.conditionId,
  hours_run: m.hoursRun,
  specs: m.specs,
  description: m.description,
  city: m.city,
  state: m.state,
  quantity: m.quantity,
  status: m.status,
  featured: m.featured,
  seller_code: m.sellerCode,
  seller_name: m.sellerName,
  salesperson_id: m.salespersonId,
  salesperson_name: m.salespersonName,
  salesperson_email: m.salespersonEmail,
  internal_notes: m.internalNotes,
  visibility_overrides: m.visibilityOverrides,
});

/** Thrown when the machine changed under the form since it was opened. */
export class StaleMachineError extends Error {
  constructor() {
    super("Someone else changed this machine while you were editing. Reload to see their changes; what you typed is still here.");
    this.name = "StaleMachineError";
  }
}

/**
 * Create a machine with a known id (the form gives a new machine its id up front
 * so its photos have a folder before the first save). The portal fills the
 * listing number and the web address.
 */
export async function insertMachine(id: string, m: MachineInput): Promise<{ listingNo: string; updatedAt: string }> {
  const rows = await run(
    db()
      .from("mr_machines")
      .insert({ id, slug: "", ...machineRow(m) })
      .select("listing_no, updated_at"),
  );
  const r = (rows as any[])[0];
  return { listingNo: r.listing_no, updatedAt: r.updated_at };
}

/**
 * Update a machine, but only if nobody has saved it since `loadedUpdatedAt`.
 * Two people on one machine is rare here, but the second save would otherwise
 * silently undo the first.
 */
export async function updateMachine(id: string, m: MachineInput, loadedUpdatedAt: string): Promise<string> {
  const rows = (await run(
    db()
      .from("mr_machines")
      .update(machineRow(m))
      .eq("id", id)
      .eq("updated_at", loadedUpdatedAt)
      .select("updated_at"),
  )) as any[];
  if (!rows.length) throw new StaleMachineError();
  return rows[0].updated_at;
}

/**
 * Make the machine's media rows match the form: photos in order (first is the
 * cover), then documents. Rows are replaced as a set; the FILES of anything the
 * form dropped are removed from storage afterwards.
 */
export async function syncMachineMedia(
  machineId: string,
  photos: MediaInput[],
  documents: MediaInput[],
  removedPaths: string[],
): Promise<void> {
  await run(db().from("mr_machine_media").delete().eq("machine_id", machineId));
  const rows = [
    ...photos.map((p, i) => ({ machine_id: machineId, kind: "photo", storage_path: p.storagePath, file_name: p.fileName, sort_order: i + 1 })),
    ...documents.map((d, i) => ({ machine_id: machineId, kind: "document", storage_path: d.storagePath, file_name: d.fileName, sort_order: i + 1 })),
  ];
  if (rows.length) await run(db().from("mr_machine_media").insert(rows));
  if (removedPaths.length) {
    // A file left behind costs a little storage; failing the save over it would
    // cost the user their edit. So a cleanup failure is not raised.
    await removeMedia(removedPaths).catch(() => undefined);
  }
}

export async function setMachineStatus(id: string, status: MachineStatus): Promise<void> {
  await run(db().from("mr_machines").update({ status }).eq("id", id));
}

/** Record the Bunny video on the machine. Returns the row's new updated_at. */
export async function setMachineVideo(id: string, videoId: string | null, state: VideoState | null): Promise<string> {
  const rows = (await run(
    db()
      .from("mr_machines")
      .update({ bunny_video_id: videoId, bunny_video_status: state })
      .eq("id", id)
      .select("updated_at"),
  )) as any[];
  return rows[0]?.updated_at;
}

/** Delete a machine and its files. The portal refuses when inquiries point at it. */
export async function deleteMachine(id: string, paths: string[]): Promise<void> {
  await run(db().from("mr_machines").delete().eq("id", id));
  await removeMedia(paths).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Inquiries
// ---------------------------------------------------------------------------

export interface InquiryInput {
  machineId: string | null;
  listingNoSnapshot: string | null;
  machineTitleSnapshot: string | null;
  source: InquirySource;
  buyerName: string;
  company: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  message: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salespersonEmail: string | null;
}

/** A phone or WhatsApp lead typed in by staff. Status starts at New (the portal sets it). */
export async function insertInquiry(i: InquiryInput): Promise<{ id: string; inquiryNo: string }> {
  const rows = (await run(
    db()
      .from("mr_inquiries")
      .insert({
        machine_id: i.machineId,
        listing_no_snapshot: i.listingNoSnapshot,
        machine_title_snapshot: i.machineTitleSnapshot,
        source: i.source,
        buyer_name: i.buyerName.trim(),
        company: i.company,
        phone: i.phone.trim(),
        email: i.email ? i.email.trim().toLowerCase() : null,
        city: i.city,
        message: i.message,
        salesperson_id: i.salespersonId,
        salesperson_name: i.salespersonName,
        salesperson_email: i.salespersonEmail,
      })
      .select("id, inquiry_no"),
  )) as any[];
  return { id: rows[0].id, inquiryNo: rows[0].inquiry_no };
}

export async function setInquiryStatus(id: string, statusId: string): Promise<void> {
  await run(db().from("mr_inquiries").update({ status_id: statusId }).eq("id", id));
}

export async function addInquiryNote(inquiryId: string, note: string): Promise<void> {
  await run(db().from("mr_inquiry_notes").insert({ inquiry_id: inquiryId, note: note.trim() }));
}

// ---------------------------------------------------------------------------
// Categories, print heads, masters, fields, settings
// ---------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  slug: string;
  intro: string | null;
  imagePath: string | null;
  sortOrder: number;
  active: boolean;
}

export async function saveCategory(id: string | null, c: CategoryInput): Promise<void> {
  const row = {
    name: c.name.trim(),
    slug: c.slug,
    intro: c.intro,
    image_path: c.imagePath,
    sort_order: c.sortOrder,
    active: c.active,
  };
  if (id) await run(db().from("mr_categories").update(row).eq("id", id));
  else await run(db().from("mr_categories").insert(row));
}

export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  await run(db().from("mr_categories").update({ active }).eq("id", id));
}

export interface PrintHeadInput {
  categoryId: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
}

export async function savePrintHead(id: string | null, h: PrintHeadInput): Promise<void> {
  const row = { category_id: h.categoryId, name: h.name.trim(), slug: h.slug, sort_order: h.sortOrder, active: h.active };
  if (id) await run(db().from("mr_subcategories").update(row).eq("id", id));
  else await run(db().from("mr_subcategories").insert(row));
}

export async function setPrintHeadActive(id: string, active: boolean): Promise<void> {
  await run(db().from("mr_subcategories").update({ active }).eq("id", id));
}

export async function saveMasterValue(
  id: string | null,
  master: MasterKind,
  v: { value: string; sortOrder: number; active: boolean },
): Promise<void> {
  const row = { master, value: v.value.trim(), sort_order: v.sortOrder, active: v.active };
  if (id) await run(db().from("mr_master_values").update(row).eq("id", id));
  else await run(db().from("mr_master_values").insert(row));
}

export async function setMasterValueActive(id: string, active: boolean): Promise<void> {
  await run(db().from("mr_master_values").update({ active }).eq("id", id));
}

/** The website default for one field. The portal refuses a locked field. */
export async function setFieldDefault(key: string, defaultVisible: boolean): Promise<void> {
  await run(db().from("mr_fields").update({ default_visible: defaultVisible }).eq("key", key));
}

/** Save several settings; each is an existing row keyed by name, its value JSON. */
export async function saveSettings(values: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await run(db().from("mr_settings").update({ value }).eq("key", key));
  }
}
