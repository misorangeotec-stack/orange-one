/**
 * Export / print buttons for the Issue Slip, Additional Issue Slip and Log Book.
 *
 * Each button is enabled only when its handler prop is supplied; without a
 * handler it stays a disabled placeholder (the format for that document is not
 * wired yet). Today only the Issue Slip passes `onDownloadExcel`.
 */
export type ExportFormat = "pdf" | "excel" | "print";

export default function ExportButtons({
  label = "this document",
  formats,
  onDownloadPdf,
  onDownloadExcel,
  onPrint,
}: {
  label?: string;
  /**
   * Which buttons exist AT ALL. Omit and all three render, so every existing
   * caller is unchanged.
   *
   * ⚠ THIS IS NOT THE SAME AS PASSING NO HANDLER. A missing handler greys the
   *   button out and adds "format coming soon" — the right thing to say about a
   *   document whose Excel layout has not been written yet. It is the wrong thing
   *   to say about a COA when an admin has deliberately set Setup to PDF only:
   *   there the format is not missing, it is not wanted, and a permanently dead
   *   button reads as a defect somebody should fix.
   */
  formats?: ExportFormat[];
  onDownloadPdf?: () => void;
  onDownloadExcel?: () => void;
  onPrint?: () => void;
}) {
  const shows = (f: ExportFormat) => !formats || formats.includes(f);
  const base =
    "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold";
  const on = `${base} text-navy hover:bg-page transition-colors`;
  const off = `${base} text-grey-2 opacity-50 cursor-not-allowed`;
  const stop = (e: React.MouseEvent) => e.preventDefault();
  const anyWired = Boolean(
    (shows("pdf") && onDownloadPdf) || (shows("excel") && onDownloadExcel) || (shows("print") && onPrint),
  );

  return (
    <div className="flex flex-wrap items-center gap-2" title={`Export ${label}`}>
      {shows("pdf") && (
      <button
        type="button"
        disabled={!onDownloadPdf}
        onClick={onDownloadPdf ?? stop}
        className={onDownloadPdf ? on : off}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
        Download PDF
      </button>
      )}
      {shows("excel") && (
      <button
        type="button"
        disabled={!onDownloadExcel}
        onClick={onDownloadExcel ?? stop}
        className={onDownloadExcel ? on : off}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
        Download Excel
      </button>
      )}
      {shows("print") && (
      <button
        type="button"
        disabled={!onPrint}
        onClick={onPrint ?? stop}
        className={onPrint ? on : off}
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>
        Print
      </button>
      )}
      {!anyWired && <span className="text-[11px] text-grey-2 italic">format coming soon</span>}
    </div>
  );
}
