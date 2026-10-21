/**
 * Append PDFs to the end of another PDF, in the browser.
 *
 * Used to put the machine's service checklist at the END of the Summary, PI or
 * OC, so a single Download or Print hands over one file with the checklist in
 * it — nobody has to remember the second document.
 *
 * pdf-lib is loaded on demand: it is only needed when a paper is shown with an
 * attachment, and it should not weigh on every page of the app.
 */
export async function appendPdfs(base: Blob, extras: Blob[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.load(await base.arrayBuffer(), { ignoreEncryption: true });
  for (const extra of extras) {
    const src = await PDFDocument.load(await extra.arrayBuffer(), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}
