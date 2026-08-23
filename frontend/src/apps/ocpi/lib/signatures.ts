import type { OcpiDeal, OcpiDoc } from "../types";

/**
 * The signed documents, read as one list each.
 *
 * ⚠ THE DATABASE STORES A SIGNED DOCUMENT IN TWO PLACES — page one in
 *   `cs_doc_path` / `ms_doc_path`, every page after it in `cs_doc_pages` /
 *   `ms_doc_pages`. That split is deliberate (it is what order-to-dispatch
 *   settled on in 20260831120000, and it keeps the single-page case a single
 *   column), but it is a storage detail. Nothing on screen should re-derive it,
 *   or one caller will forget the tail and show a five-page contract as one
 *   page. Every reader goes through here.
 */

/** Which of the two signatures. Also the storage folder name. */
export type SignatureSlot = "customer-signed" | "management-signed";

export const SLOT_LABEL: Record<SignatureSlot, string> = {
  "customer-signed": "Customer-signed copy",
  "management-signed": "Countersigned copy",
};

/** Every page of one signed document, in order, page one first. */
export function signedPages(deal: OcpiDeal, slot: SignatureSlot): OcpiDoc[] {
  const primary = slot === "customer-signed" ? deal.csDocPath : deal.msDocPath;
  const rest = slot === "customer-signed" ? deal.csDocPages : deal.msDocPages;
  if (!primary) return [];
  return [{ path: primary, name: fileNameOf(primary) }, ...rest];
}

/** The last segment of an object path, which is what a person named the file. */
export function fileNameOf(path: string): string {
  const tail = path.split("/").pop() ?? path;
  // Uploads are prefixed with an epoch to keep two same-named photos apart;
  // showing it helps nobody.
  return tail.replace(/^\d{10,}-/, "");
}

/** "Page 1", "Page 2" … The pages of a contract have no front and back. */
export const pageLabel = (i: number): string => `Page ${i + 1}`;

/** Enough for a seven-page order confirmation plus a covering sheet or two. */
export const MAX_SIGNED_PAGES = 12;

export const isImagePath = (p: string): boolean =>
  /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(p);
