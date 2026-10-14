import JSZip from "jszip";
import { saveAs } from "file-saver";
import { supabase } from "@/core/platform/supabase";
import { TRAVEL_DOCS_BUCKET } from "../data/travelBookingWrites";
import type { ClaimLine, Trip, TripCancellation, TripLeg } from "../types";

const db = supabase as any;

/**
 * Export all attachments — every file on a trip, or on many trips, as one ZIP.
 *
 * ⚠ ONLY FILES A ROW POINTS AT. Listing the storage folder would also sweep up
 *   a ticket that was replaced by a re-upload, and the export would then hold
 *   two tickets for one booking with nothing to say which one counts. So the
 *   paths come from the legs, the credit notes, the claim lines and the comments.
 *
 * ⚠ THE DOWNLOAD RUNS AS THE VIEWER. Storage's read policy is "can see the
 *   trip", so the export can never hand anyone a file they could not already
 *   open one at a time.
 */

interface DocRef {
  path: string;
  folder: string;
}

export interface TripDocSource {
  trip: Trip;
  legs: TripLeg[];
  cancellations: TripCancellation[];
  claimLines: ClaimLine[];
}

/** The rows' own files, without comments (those need a read). */
function rowDocs(src: TripDocSource): DocRef[] {
  const out: DocRef[] = [];
  for (const l of src.legs) {
    if (l.docPath) out.push({ path: l.docPath, folder: l.kind === "hotel" ? "Hotel" : "Tickets" });
  }
  for (const c of src.cancellations) {
    if (c.creditNotePath) out.push({ path: c.creditNotePath, folder: "Credit notes" });
  }
  for (const cl of src.claimLines) {
    if (cl.docPath) out.push({ path: cl.docPath, folder: "Receipts" });
  }
  return out;
}

/**
 * Files attached to comments, for many trips at once.
 *
 * ⚠ CHUNKED. A long `in (…)` list of uuids makes a GET URL past the gateway's
 *   limit and comes back as a bare "Bad Request".
 */
async function commentDocs(tripIds: string[]): Promise<Map<string, DocRef[]>> {
  const out = new Map<string, DocRef[]>();
  for (let i = 0; i < tripIds.length; i += 100) {
    const { data, error } = await db
      .from("fms_travel_activity")
      .select("entity_id, meta")
      .eq("entity_type", "trip")
      .in("entity_id", tripIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const atts = (r.meta?.attachments ?? []) as { path?: string }[];
      for (const a of atts) {
        if (!a?.path) continue;
        const list = out.get(r.entity_id) ?? [];
        list.push({ path: a.path, folder: "Comments" });
        out.set(r.entity_id, list);
      }
    }
  }
  return out;
}

const safe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "file";

/** `<epoch>-name.pdf` → `name.pdf`, the name the person uploaded. */
const baseName = (path: string): string =>
  safe((path.split("/").pop() ?? "file").replace(/^\d{10,}-/, ""));

const tripFolder = (t: Trip): string =>
  safe(`${t.tripNo ?? "Draft"} - ${t.travellerName ?? ""}`.replace(/ - $/, ""));

/** True when a trip has at least one file on its rows (comments not counted). */
export const hasRowDocs = (src: TripDocSource): boolean => rowDocs(src).length > 0;

/**
 * Build and save the ZIP. One trip → its sub-folders at the top; several →
 * one folder per trip. Returns how many files went in. A file that cannot be
 * read is listed in `_not-included.txt` rather than failing the whole export.
 */
export async function exportTripAttachments(
  sources: TripDocSource[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (sources.length === 0) throw new Error("No trips to export");

  const comments = await commentDocs(sources.map((x) => x.trip.id));
  const single = sources.length === 1;

  const jobs: { path: string; zipPath: string }[] = [];
  const used = new Set<string>();
  for (const src of sources) {
    const refs = [...rowDocs(src), ...(comments.get(src.trip.id) ?? [])];
    const seen = new Set<string>();
    for (const r of refs) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      const dir = single ? r.folder : `${tripFolder(src.trip)}/${r.folder}`;
      let name = `${dir}/${baseName(r.path)}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) {
        const b = baseName(r.path);
        const dot = b.lastIndexOf(".");
        name = `${dir}/${dot > 0 ? `${b.slice(0, dot)} (${n})${b.slice(dot)}` : `${b} (${n})`}`;
      }
      used.add(name.toLowerCase());
      jobs.push({ path: r.path, zipPath: name });
    }
  }

  if (jobs.length === 0) {
    throw new Error(single ? "This trip has no attachments yet" : "None of these trips has an attachment");
  }

  const zip = new JSZip();
  const missing: string[] = [];
  let done = 0;
  onProgress?.(0, jobs.length);

  // A few at a time: fast enough, and polite to the storage API.
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { data, error } = await supabase.storage.from(TRAVEL_DOCS_BUCKET).download(job.path);
      if (error || !data) missing.push(`${job.zipPath} — ${error?.message ?? "not found"}`);
      else zip.file(job.zipPath, data);
      onProgress?.(++done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));

  if (missing.length) {
    zip.file("_not-included.txt", `These files could not be read:\r\n\r\n${missing.join("\r\n")}\r\n`);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const stamp = new Date().toISOString().slice(0, 10);
  saveAs(
    blob,
    single
      ? `${safe(sources[0].trip.tripNo ?? "Trip")} attachments.zip`
      : `Travel attachments ${stamp} (${sources.length} trips).zip`,
  );
  return jobs.length - missing.length;
}
