/**
 * Machine Resale types, mirroring the portal project's `mr_` tables
 * (portal repo `supabase/migrations/20261014120100_mr_foundation.sql`).
 * Field names are the app's camelCase; `data/mrFetch.ts` maps the rows.
 */

export type MachineStatus = "active" | "inactive" | "sold";
export type VideoState = "created" | "uploading" | "processing" | "ready" | "failed";
export type InquirySource = "website" | "phone" | "whatsapp" | "manual";
export type MasterKind = "printer_brand" | "ink_type" | "condition" | "location" | "inquiry_status";

export interface Audit {
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface Category extends Audit {
  id: string;
  name: string;
  slug: string;
  intro: string | null;
  imagePath: string | null;
  sortOrder: number;
  active: boolean;
}

export interface PrintHead extends Audit {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
}

export interface MasterValue extends Audit {
  id: string;
  master: MasterKind;
  value: string;
  sortOrder: number;
  active: boolean;
}

export interface FieldDef extends Audit {
  key: string;
  label: string;
  defaultVisible: boolean;
  locked: boolean;
  sortOrder: number;
}

export interface SpecPair {
  label: string;
  value: string;
}

export interface MachineMedia {
  id: string;
  machineId: string;
  kind: "photo" | "document";
  storagePath: string;
  fileName: string | null;
  sortOrder: number;
}

export interface Machine extends Audit {
  id: string;
  listingNo: string;
  slug: string;
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
  bunnyVideoId: string | null;
  bunnyVideoStatus: VideoState | null;
  status: MachineStatus;
  featured: boolean;
  listedAt: string | null;
  sellerCode: string | null;
  sellerName: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salespersonEmail: string | null;
  internalNotes: string | null;
  visibilityOverrides: Record<string, boolean>;
  photos: MachineMedia[];
  documents: MachineMedia[];
}

export interface InquiryNote {
  id: string;
  inquiryId: string;
  note: string;
  authorName: string | null;
  createdAt: string;
}

export interface Inquiry extends Audit {
  id: string;
  inquiryNo: string;
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
  statusId: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  salespersonEmail: string | null;
  notes: InquiryNote[];
}

export interface Setting {
  key: string;
  value: unknown;
  isPublic: boolean;
  description: string | null;
}

export interface MrData {
  categories: Category[];
  printHeads: PrintHead[];
  masters: MasterValue[];
  fields: FieldDef[];
  settings: Setting[];
  machines: Machine[];
  inquiries: Inquiry[];
}

/** A hub user who can be a machine's salesperson (has Machine Resale access). */
export interface Salesperson {
  id: string;
  name: string;
  email: string | null;
  designation: string | null;
}

/** A customer from the hub's party master, offered as a machine's seller. */
export interface SellerOption {
  id: string;
  code: string | null;
  name: string;
}

export const MASTER_LABEL: Record<MasterKind, { plural: string; singular: string }> = {
  printer_brand: { plural: "Printer brands", singular: "Printer brand" },
  ink_type: { plural: "Ink types", singular: "Ink type" },
  condition: { plural: "Conditions", singular: "Condition" },
  location: { plural: "Locations", singular: "Location" },
  inquiry_status: { plural: "Inquiry statuses", singular: "Inquiry status" },
};

export const STATUS_LABEL: Record<MachineStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  sold: "Sold",
};

export const SOURCE_LABEL: Record<InquirySource, string> = {
  website: "Website",
  phone: "Phone",
  whatsapp: "WhatsApp",
  manual: "Manual",
};

export const VIDEO_LABEL: Record<VideoState, string> = {
  created: "Waiting for upload",
  uploading: "Uploading",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};
