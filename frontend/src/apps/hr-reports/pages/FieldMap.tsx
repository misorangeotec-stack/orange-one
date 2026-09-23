/**
 * The Weekly Review Report as a gap list (KPI-3, read-only).
 *
 * ⚠ IT SAVES NOTHING. Every figure it can read is live; every box a reader fills in
 *   themselves lives in that one browser (localStorage) and reaches no table, no
 *   colleague and no report. The banner on the page says so in those words, because
 *   somebody WILL fill it in and expect it kept. Gated to admins and HODs
 *   (RequireReports in HrApp.tsx).
 *
 * One row per box on the form, with where the figure comes from and what is missing.
 * The rendered report next door shows what the week LOOKS like; this shows what it would
 * take to produce it every week without anybody typing — which is the decision the
 * client actually has to make, and the thing they can export and price.
 *
 * It reads nothing from the database at all: the whole page is the transcription plus
 * what reading the tables on 23-09-2026 established. That is deliberate — the gap list
 * must be readable by somebody who has no HR permissions.
 */
import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { cn } from "@/shared/lib/cn";
import { weeklyReviewForm } from "../report/weeklyReview";
import { checkForm, coverageSplit, type FieldCoverage, type FieldDef } from "../report/types";
import FieldMeter, { BAND_BADGE, bandLabel } from "../components/FieldMeter";

const KIND_WORD: Record<FieldDef["kind"], string> = {
  count: "A count",
  percent: "A percentage",
  rating: "A rating out of 5",
  days: "A number of days",
  money: "An amount",
  date: "A date",
  text: "Text",
};

export default function FieldMap() {
  const form = weeklyReviewForm;
  const counts = useMemo(() => coverageSplit(form), [form]);
  // No test runner in this repo: the transcription checks itself on every render and
  // says so loudly rather than quietly dropping a row.
  const problems = useMemo(() => checkForm(form), [form]);

  const [band, setBand] = useState<FieldCoverage | null>(null);
  const visible = useMemo(() => (band ? form.fields.filter((f) => f.coverage === band) : form.fields), [form, band]);

  // The form's own order, so "sort by box" means what the reader sees on the paper
  // rather than an alphabetical jumble of A1.10 before A1.2.
  const order = useMemo(() => new Map(form.fields.map((f, i) => [f.code, i])), [form]);
  const sectionTitle = (code: string) => form.sections.find((s) => s.code === code)?.title ?? code;

  const columns: QueueColumn<FieldDef>[] = [
    {
      key: "section",
      header: "Section",
      cell: (f) => <span className="block truncate text-grey">{sectionTitle(f.section)}</span>,
      resize: { width: 190, min: 110, max: 380 },
      sortValue: (f) => order.get(f.code) ?? 0,
      filter: { kind: "select", get: (f) => sectionTitle(f.section) },
    },
    {
      key: "block",
      header: "Block on the form",
      cell: (f) => <span className="block truncate text-grey">{f.block}</span>,
      resize: { width: 230, min: 120, max: 460 },
      sortValue: (f) => order.get(f.code) ?? 0,
      filter: { kind: "select", get: (f) => f.block },
    },
    {
      key: "box",
      header: "Box",
      alwaysVisible: true,
      cell: (f) => (
        <span className="block truncate font-medium text-navy" title={f.label}>
          <span className="mr-1.5 text-[10.5px] font-normal text-grey-2">{f.code}</span>
          {f.label}
        </span>
      ),
      resize: { width: 300, min: 160, max: 700 },
      sortValue: (f) => order.get(f.code) ?? 0,
      filter: { kind: "select", get: (f) => f.label },
    },
    {
      key: "coverage",
      header: "Where it comes from",
      cell: (f) => {
        const b = BAND_BADGE[f.coverage];
        return (
          <span className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-[1px] text-[11px] font-medium", b.cls)}>
            {b.label}
          </span>
        );
      },
      sortValue: (f) => BAND_BADGE[f.coverage].label,
      filter: { kind: "select", get: (f) => bandLabel(f.coverage) },
      exportValue: (f) => bandLabel(f.coverage),
    },
    {
      key: "target",
      header: "Target, as the form words it",
      cell: (f) => (
        <span className={cn("block truncate text-[11.5px]", f.targetText ? "text-grey" : "text-grey-2")} title={f.targetText}>
          {f.targetText || "— the form states none —"}
        </span>
      ),
      resize: { width: 260, min: 140, max: 700 },
      sortValue: (f) => f.targetText,
      // Two readings of one column, because "which boxes have no stated target?" is a
      // question about the DOCUMENT and the wordings themselves are all unique.
      filter: { kind: "select", get: (f) => (f.targetText ? "Stated" : "Not stated") },
      exportValue: (f) => f.targetText,
    },
    {
      key: "kind",
      header: "Holds",
      cell: (f) => <span className="whitespace-nowrap text-grey">{KIND_WORD[f.kind]}</span>,
      sortValue: (f) => KIND_WORD[f.kind],
      filter: { kind: "select", get: (f) => KIND_WORD[f.kind] },
    },
    {
      key: "source",
      header: "Table and column",
      cell: (f) => (
        <span className="block truncate font-mono text-[11px] text-grey" title={f.source}>
          {f.source}
        </span>
      ),
      resize: { width: 300, min: 140, max: 800 },
      sortValue: (f) => f.source,
      filter: { kind: "select", get: (f) => (f.source === "—" ? "Nothing to read" : "Has a source") },
      exportValue: (f) => f.source,
    },
    {
      key: "gap",
      header: "What is missing",
      cell: (f) => (
        <span className="block truncate text-[11.5px] text-grey" title={f.gap ?? ""}>
          {f.gap ?? "—"}
        </span>
      ),
      resize: { width: 420, min: 160, max: 1000 },
      sortValue: (f) => f.gap ?? "",
      filter: { kind: "select", get: (f) => (f.gap ? "Has a gap" : "Nothing missing") },
      exportValue: (f) => f.gap ?? "",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-orange/35 bg-orange/[0.05] px-4 py-2.5 text-[12px] leading-relaxed text-navy">
        <span className="font-semibold">A reading of the form against the hub, not a record.</span> It writes nothing and holds
        no figures of its own. Form: <span className="font-medium">{form.role}</span> ·{" "}
        {form.source}
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-[#c0392b]/40 bg-[#c0392b]/[0.06] px-4 py-2.5 text-[12px] text-[#c0392b]">
          <span className="font-semibold">The transcription does not check out.</span> Every row below is suspect until this is
          fixed: {problems.join(" · ")}
        </div>
      )}

      <FieldMeter counts={counts} total={form.fields.length} selected={band} onSelect={setBand} typed={0} />

      <Card className="overflow-hidden p-0">
        <div className="px-4 pb-2 pt-3 text-[11.5px] leading-relaxed text-grey">
          Every box on the form, in the form&apos;s own order. The two bands worth keeping apart are{" "}
          <span className="font-semibold text-navy">Built · unused</span> — a live screen nobody has used, which costs nothing
          — and <span className="font-semibold text-navy">Nothing records this</span>, the only one that is a build. Sort or
          filter on any column; the export carries the rows as you have left them.
        </div>
        {band && (
          // The band came from OUTSIDE the table, so the table's own "Clear filters" cannot
          // undo it. It gets its own way out, right where the narrowing is visible.
          <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-orange/40 bg-orange/[0.06] px-3 py-1.5 text-[12px] text-navy">
            <span>
              Showing the <span className="font-semibold">{visible.length}</span> box
              {visible.length === 1 ? "" : "es"} in <span className="font-semibold">{bandLabel(band)}</span>.
            </span>
            <button
              type="button"
              onClick={() => setBand(null)}
              className="rounded border border-orange/50 px-2 py-[1px] text-[11.5px] font-medium text-orange hover:bg-orange hover:text-white"
            >
              Show all {form.fields.length}
            </button>
          </div>
        )}
        <div className="px-2 pb-2 sm:px-3">
          <QueueTable
            rows={visible}
            rowKey={(f) => f.code}
            columns={columns}
            rowsLabel="boxes"
            emptyTitle="This form has no boxes"
            emptyMessage="Nothing was transcribed for this report."
            initialSort={{ key: "box", dir: "asc" }}
            columnPicker={{ storageKey: "kpi-lab.fieldmap" }}
            resizeKey="kpi-lab.fieldmap"
            exportName="Weekly_Review_Field_Map"
            exportTitle={`${form.role} — Weekly Review Report · what the hub can fill in`}
            exportNotes={[
              `Source: ${form.source}`,
              ...(band ? [`Narrowed to "${bandLabel(band)}" — ${visible.length} of ${form.fields.length} boxes.`] : []),
              "TEST OUTPUT. Coverage was re-read from the live database on 23-09-2026; it is not from the document. Re-read it before quoting — a third of these bands moved in the two days after the form was first transcribed.",
              `Of ${form.fields.length} boxes: ${counts.live} live, ${counts["live-partial"]} live with a caveat, ${counts["empty-table"]} built and not used yet, ${counts.narrative} prose by design, ${counts["no-table"]} with nothing recording them.`,
              '"Built · unused" needs somebody to use a screen that is already live. Only "Nothing records this" is a build.',
            ]}
          />
        </div>
      </Card>

      <div className="space-y-1.5 px-1 text-[11.5px] leading-relaxed text-grey-2">
        <p>
          <span className="font-semibold text-grey">Almost nothing on this page is a build.</span> Mark a requisition closed
          when it is filled, tick the joining when someone starts, allocate the buddy, record the induction and set the BGV
          result. That alone turns {counts["empty-table"]} boxes live, on screens that are already in front of HR today.
        </p>
        <p>
          <span className="font-semibold text-grey">Learning &amp; Development is live, not missing.</span> Section C stopped
          being the largest build on 23-09-2026, the day the module merged and deployed: sessions, nominations, attendance,
          assignments, feedback and the annual plan all have screens. Every box in it waits on somebody running a session.
        </p>
        <p>
          <span className="font-semibold text-grey">Recruitment figures are not scoped to one person.</span> The recruitment
          tables record the requisition, not who chased it. Today one HR executive works them all, so for her the figures are
          hers — the moment a second recruiter exists they are the team&apos;s, and it needs an owner on the requisition.
        </p>
      </div>
    </div>
  );
}
