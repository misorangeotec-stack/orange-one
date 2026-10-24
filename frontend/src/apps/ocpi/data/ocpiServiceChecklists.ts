import { supabase } from "@/core/platform/supabase";
import type { OcpiServiceChecklist } from "../types";

const db = supabase as any;

/**
 * Masters → Service checklists (PDF): one checklist PDF per machine.
 *
 * ⚠ ITS OWN BUCKET, not fms-ocpi-docs. That bucket is per DEAL and is hidden
 *   from service-only users — the people who need this file most. Read is open
 *   to every signed-in user; write is admins + the Machine master owner, in the
 *   table policy and the storage policy alike (migration 20270131120000).
 */
export const OCPI_CHECKLIST_BUCKET = "fms-ocpi-service-checklists";

const MAX_BYTES = 25 * 1024 * 1024;

/** A storage-safe file name: keeps letters, digits, dot, dash, underscore. */
function safeName(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "service-checklist"}.pdf`;
}

/**
 * Upload (or replace) a machine's checklist PDF, with the check points read from it.
 *
 * Writes a NEW path every time and removes the old object only after the row
 * points at the new one, so a failed upload never leaves a deal pointing at
 * nothing.
 */
export async function uploadServiceChecklist(
  machineId: string,
  file: File,
  existing: OcpiServiceChecklist | undefined,
  /** The check points read from the PDF (lib/checklistPdf.ts). */
  items: string[],
): Promise<void> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) throw new Error("Only a PDF can be uploaded as the service checklist.");
  if (file.size > MAX_BYTES) throw new Error("The PDF is larger than 25 MB.");

  const path = `${machineId}/${Date.now()}-${safeName(file.name)}`;
  const up = await supabase.storage
    .from(OCPI_CHECKLIST_BUCKET)
    .upload(path, file, { contentType: "application/pdf", upsert: false });
  if (up.error) {
    throw new Error(
      /bucket not found/i.test(up.error.message)
        ? "Service checklists are not switched on in the database yet. Ask the admin to apply the Service checklist update."
        : up.error.message,
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  const { error } = await db.from("fms_ocpi_service_checklists").upsert(
    {
      machine_id: machineId,
      file_path: path,
      file_name: file.name,
      items,
      uploaded_by: auth.user?.id ?? null,
    },
    { onConflict: "machine_id" },
  );
  if (error) {
    await supabase.storage.from(OCPI_CHECKLIST_BUCKET).remove([path]);
    throw new Error(error.message);
  }

  if (existing && existing.filePath !== path) {
    // Best effort: an orphaned old PDF is harmless, a failed replace is not.
    await supabase.storage.from(OCPI_CHECKLIST_BUCKET).remove([existing.filePath]);
  }
}

/** Remove a machine's checklist PDF: the row first, then the file. */
export async function removeServiceChecklist(row: OcpiServiceChecklist): Promise<void> {
  const { error } = await db.from("fms_ocpi_service_checklists").delete().eq("id", row.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(OCPI_CHECKLIST_BUCKET).remove([row.filePath]);
}

/**
 * The PDF itself, as a blob — so it can sit in the deal's paper set beside the
 * Summary, PI and OC (tab, Download all, Print). Null when it cannot be read.
 */
export async function fetchServiceChecklistPdf(row: OcpiServiceChecklist | undefined): Promise<Blob | null> {
  if (!row) return null;
  const { data, error } = await supabase.storage.from(OCPI_CHECKLIST_BUCKET).download(row.filePath);
  if (error || !data) return null;
  return data.type === "application/pdf" ? data : new Blob([data], { type: "application/pdf" });
}

/**
 * A short-lived link to the PDF. `download: true` makes the browser save it
 * under its original name instead of opening it.
 */
export async function serviceChecklistUrl(
  row: OcpiServiceChecklist,
  opts: { download?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(OCPI_CHECKLIST_BUCKET)
    .createSignedUrl(row.filePath, 60 * 10, opts.download ? { download: row.fileName } : undefined);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not open the checklist");
  return data.signedUrl;
}
