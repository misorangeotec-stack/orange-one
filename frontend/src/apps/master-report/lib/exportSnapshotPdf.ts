/**
 * The Master Report one-pager.
 *
 * ONE PAGE IS THE SPEC, NOT AN ACCIDENT. This is meant to be glanced at over
 * morning tea and forwarded. Thirteen modules fit on a single A4 with room for
 * the stat cards; if the module list ever outgrows that, the table paginates
 * rather than shrinking to unreadable type — but the FIRST page must still carry
 * the headline numbers and the dormant list, because that is all most readers
 * will look at.
 *
 * Drawn vectorially through the shared pdfBrand primitives (not html2canvas), so
 * the text stays selectable and the type stays crisp when zoomed. See
 * shared/lib/pdfBrand.ts for why the font is embedded.
 */

import jsPDF from "jspdf";
import {
  BRAND, CONTENT_W, MARGIN, PAGE_H,
  drawTable, footer, headerBand, loadBrandAssets, pageWash,
  registerBrandFonts, sectionHeading, statCard, text,
  type Ctx, type PdfColumn,
} from "@/shared/lib/pdfBrand";
import { formatDateTime } from "@/shared/lib/time";
import { sinceLabel, totalsOf, STATE_LABEL } from "../data/snapshot";
import type { MasterSnapshot, ModuleSnapshot } from "../data/snapshot";
import { drawAccessSection } from "./exportAccessPdf";
import type { AccessMatrix } from "./accessMatrix";

const STATE_COLOR: Record<string, string> = {
  active: BRAND.green,
  quiet: "#B7791F",
  dormant: BRAND.red,
  // Neutral on purpose: "tracking" is an absence of evidence about a view-only
  // module, not a verdict, and red would read as the verdict it isn't.
  tracking: BRAND.grey,
  error: BRAND.grey,
};

/** A number that is structurally absent (no workflow status) prints as a dash. */
const numOrDash = (n: number, applicable = true) => (applicable && n > 0 ? String(n) : applicable ? "0" : "—");

export async function buildSnapshotPdf(
  snap: MasterSnapshot,
  /** Section 2. Omitted for a modules-only document (e.g. a future email attach). */
  access?: AccessMatrix,
): Promise<jsPDF> {
  const assets = await loadBrandAssets();
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  registerBrandFonts(pdf, assets);

  const ctx: Ctx = { pdf, assets, totalPagesToken: "{tp}" };
  const generatedAt = snap.generatedAt ? formatDateTime(snap.generatedAt) : formatDateTime(new Date().toISOString());
  const totals = totalsOf(snap.modules);

  pageWash(pdf);
  let y = headerBand(ctx, { tag: "Master Report" });

  y += 20;
  y = sectionHeading(pdf, MARGIN, y, "Daily snapshot", "Module activity across Orange One");

  y += 6;
  text(
    pdf,
    `Generated ${generatedAt}. "Dormant" means no activity in ${snap.dormantAfterDays} days. `
      + `${totals.openedToday} of ${snap.modules.length} modules were opened by someone today.`,
    MARGIN,
    y,
    { size: 7.6, color: BRAND.grey },
  );
  y += 18;

  // ── Headline cards ────────────────────────────────────────────────────────
  const gap = 10;
  const cardW = (CONTENT_W - gap * 3) / 4;
  const cardH = 54;
  const cards = [
    {
      label: "New today",
      value: String(totals.newToday),
      sub: totals.newTodaySystem ? `by people, +${totals.newTodaySystem} auto` : "entered by people",
    },
    { label: "Open items", value: String(totals.open), sub: "still in progress" },
    {
      label: "Overdue",
      value: String(totals.overdue),
      sub: "past a stored due date",
      alarm: totals.overdue > 0,
    },
    {
      label: "Dormant",
      value: `${totals.dormant} of ${snap.modules.length}`,
      sub: totals.dormant > 0 ? "not being used" : "none",
      alarm: totals.dormant > 0,
    },
  ];
  cards.forEach((c, i) => statCard(pdf, MARGIN + i * (cardW + gap), y, cardW, cardH, c));
  y += cardH + 22;

  // ── The table ─────────────────────────────────────────────────────────────
  const columns: PdfColumn<ModuleSnapshot>[] = [
    // A view-only module holds no entries at all, so its zeros are a property of
    // the module and not a finding. The tag says so on the one line the reader
    // has, since a printed page cannot carry the tooltip the screen does.
    { header: "Module", width: 2.5, value: (r) => (r.usageFromVisits ? `${r.label}  (view-only)` : r.label) },
    {
      header: "Created today",
      width: 1.15,
      align: "right",
      // "1 +65" reads at a glance as "one person, sixty-five generated" — the
      // distinction the flat 66 was hiding.
      value: (r) =>
        r.newTodaySystem > 0
          ? `${r.newToday} +${r.newTodaySystem}`
          : numOrDash(r.newToday),
    },
    { header: "Created 7d", width: 0.95, align: "right", value: (r) => numOrDash(r.new7d) },
    {
      header: "Open now",
      width: 0.95,
      align: "right",
      value: (r) => numOrDash(r.open, r.tracksStatus),
    },
    {
      header: "Overdue",
      width: 1,
      align: "right",
      value: (r) => (r.tracksDue ? String(r.overdue) : "—"),
      color: (r) => (r.tracksDue && r.overdue > 0 ? BRAND.red : undefined),
    },
    { header: "Entered 7d", width: 1.05, align: "right", value: (r) => numOrDash(r.activeUsers7d) },
    // Distinct people, not raw opens — one person refreshing all day is not
    // adoption. This is the ONLY usage signal a view-only module can produce.
    { header: "Opened 7d", width: 1.05, align: "right", value: (r) => numOrDash(r.visitors7d) },
    {
      header: "Last activity",
      width: 1.5,
      align: "right",
      // Relative label plus the real date: the first makes a stale module jump
      // out, the second is what a reader can quote and file against. Uses the
      // COMBINED signal, so a view-only module in daily use is not reported by
      // whatever was last typed into it months ago.
      value: (r) => {
        const at = r.lastSignalAt;
        const rel = sinceLabel(at);
        if (!at) return rel;
        const d = new Date(at);
        if (!Number.isFinite(d.getTime())) return rel;
        return `${rel} · ${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
      },
    },
    {
      header: "State",
      width: 1.05,
      align: "right",
      value: (r) => STATE_LABEL[r.state],
      color: (r) => STATE_COLOR[r.state],
    },
  ];

  y = drawTable(pdf, {
    x: MARGIN,
    y,
    width: CONTENT_W,
    columns,
    rows: snap.modules,
    // Dormant rows read as muted so the eye lands on what is alive; the State
    // column still carries the word, so the meaning is not colour-only.
    rowKind: (r) => (r.state === "dormant" ? "muted" : "normal"),
    rowH: 16,
    bodySize: 7.6,
    onNewPage: () => {
      footer(ctx, pdf.getCurrentPageInfo().pageNumber, generatedAt);
      pdf.addPage();
      pageWash(pdf);
      return headerBand(ctx, { tag: "Master Report", compact: true }) + 18;
    },
  });

  // A printed page cannot show a tooltip, so the two columns that are easy to
  // misread say what they mean directly under the table.
  y += 10;
  text(
    pdf,
    "Created today = entered by a person (+N = generated automatically).  "
      + "Overdue = past a stored due date; a dash means the module has no stored due date.  "
      + "Entered 7d = people who created or changed something; Opened 7d = people who opened the module. "
      + "A view-only module holds no entries — its data is produced elsewhere — so it is judged on Opened.",
    MARGIN,
    y,
    { size: 6.8, color: BRAND.grey2, maxWidth: CONTENT_W },
  );
  y += 12;

  // ── The one thing a director is meant to act on ───────────────────────────
  const dormant = snap.modules.filter((m) => m.state === "dormant");
  if (dormant.length && y < PAGE_H - 150) {
    y += 22;
    y = sectionHeading(pdf, MARGIN, y, "Needs a decision");
    y += 4;
    text(
      pdf,
      `${dormant.length} module${dormant.length > 1 ? "s have" : " has"} seen no activity in ${snap.dormantAfterDays} days:`,
      MARGIN,
      y,
      { size: 8, color: BRAND.navy },
    );
    y += 14;
    for (const m of dormant) {
      const detail = m.usageFromVisits
        ? `view-only — nobody has opened it (last open ${sinceLabel(m.lastVisitAt)})`
        : m.total === 0
          ? "never used"
          : `${m.total} entries, last touched ${sinceLabel(m.lastSignalAt)}`;
      text(pdf, `•  ${m.label} — ${detail}`, MARGIN + 4, y, { size: 7.8, color: BRAND.grey });
      y += 12;
    }
  }

  footer(ctx, pdf.getCurrentPageInfo().pageNumber, generatedAt);

  // ── Section 2: user access, in landscape ──────────────────────────────────
  // ⚠ Must come LAST. jsPDF's orientation is sticky: once this switches to
  //   landscape every later bare addPage() stays landscape, so nothing portrait
  //   may follow without passing an explicit "p".
  if (access && access.rows.length) {
    drawAccessSection(ctx, access, generatedAt);
    footer(ctx, pdf.getCurrentPageInfo().pageNumber, generatedAt);
  }

  // Replaces the {tp} placeholder stamped into every footer with the real count.
  if (typeof pdf.putTotalPages === "function") pdf.putTotalPages(ctx.totalPagesToken);

  return pdf;
}

/** File name stem: dated, so a folder of these sorts chronologically. */
export function snapshotFileName(snap: MasterSnapshot): string {
  const d = snap.generatedAt ? new Date(snap.generatedAt) : new Date();
  const iso = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "today";
  return `Orange_One_Snapshot_${iso}.pdf`;
}

export async function downloadSnapshotPdf(snap: MasterSnapshot, access?: AccessMatrix): Promise<void> {
  const pdf = await buildSnapshotPdf(snap, access);
  pdf.save(snapshotFileName(snap));
}

/** The same document as a Blob, for the upload-and-attach email path. */
export async function snapshotPdfBlob(snap: MasterSnapshot, access?: AccessMatrix): Promise<Blob> {
  const pdf = await buildSnapshotPdf(snap, access);
  return pdf.output("blob");
}
