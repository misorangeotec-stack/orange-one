import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import { exportSheetsToXlsx } from "@/shared/lib/exportXlsx";
import { useAssetStore } from "../../store";
import { buildImportPlan, type ImportPlan } from "../../lib/importAssets";
import { TEMPLATE_NOTES, buildTemplateSheets } from "../../lib/importTemplate";

/**
 * Bulk-load the existing asset register from Excel.
 *
 * Adoption depends on this page: a company with 300 assets is not going to type
 * them in one at a time, and a register that is only half-entered reminds about
 * half the company's obligations, which is arguably worse than none.
 *
 * Deliberately a PREVIEW-then-commit flow, never a straight upload. The plan shows
 * exactly what will be created and every reason a row was rejected, because the
 * commonest failure by far is a master name that does not match — and silently
 * dropping those rows would look like a successful import.
 */
export default function ImportAssets() {
  const s = useAssetStore();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ assets: number; tracks: number; failed: number } | null>(null);

  const ctx = useMemo(
    () => ({
      categories: s.categories,
      makes: s.makes,
      companies: s.companies,
      locations: s.locations,
      vendors: s.vendors,
      conditions: s.conditions,
      usageUnits: s.usageUnits,
      scheduleTypes: s.scheduleTypes.map((t) => ({ id: t.id, name: t.name, defaultLeadDays: t.defaultLeadDays })),
      departments: s.departments,
      people: s.people,
      existingAssets: s.assets.map((a) => ({ id: a.id, serialNo: a.serialNo, schedules: a.schedules })),
    }),
    [s],
  );

  const downloadTemplate = () => {
    exportSheetsToXlsx({
      fileName: "Asset_Import_Template",
      title: "Asset import template",
      // Data Entry is deliberately the FIRST sheet: parseXlsxRows reads the first
      // sheet that is not "About this export", so any other order would have the
      // importer parsing the instructions.
      sheets: buildTemplateSheets({
        categories: s.categories,
        makes: s.makes,
        companies: s.companies,
        locations: s.locations,
        vendors: s.vendors,
        conditions: s.conditions,
        usageUnits: s.usageUnits,
        scheduleTypes: s.scheduleTypes,
        departments: s.departments,
        activeOf: s.activeOf,
      }),
      notes: TEMPLATE_NOTES,
    });
  };

  const onFile = async (file: File) => {
    setBusy(true); setError(null); setResult(null);
    try {
      const records = await parseXlsxRows(file);
      if (!records.length) { setError("That file has no rows."); setPlan(null); return; }
      setPlan(buildImportPlan(records, ctx));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
      setPlan(null);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const commit = async () => {
    if (!plan || busy) return;
    const good = plan.rows.filter((r) => !r.problems.length);
    setBusy(true); setError(null);
    setProgress({ done: 0, total: good.length });

    let assetsMade = 0;
    let tracksMade = 0;
    let failed = 0;
    // Serial → id for assets created during THIS run, so a follow-up row can hang
    // its track on the asset a previous row just created.
    const created = new Map<string, string>();

    for (let i = 0; i < good.length; i += 1) {
      const row = good[i];
      try {
        let assetId = row.matchedAssetId ?? null;
        if (!assetId && row.serial) assetId = created.get(row.serial.toLowerCase()) ?? null;

        if (row.asset && !assetId) {
          assetId = await s.submitAsset(row.asset);
          assetsMade += 1;
          if (row.serial) created.set(row.serial.toLowerCase(), assetId);
        }

        if (row.track && assetId) {
          await s.upsertSchedule(assetId, row.track);
          tracksMade += 1;
        }
      } catch {
        // One bad row must never abort the batch — a half-loaded register with an
        // unexplained stopping point is the worst outcome here.
        failed += 1;
      }
      setProgress({ done: i + 1, total: good.length });
    }

    setBusy(false);
    setProgress(null);
    setPlan(null);
    setResult({ assets: assetsMade, tracks: tracksMade, failed });
  };

  if (!s.canRaise) {
    return <p className="text-[13.5px] text-grey-2">You do not have permission to add assets.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Bulk import assets</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Load the existing register from Excel, with its service and renewal dates.
          </p>
        </div>
        <Link to="/asset-maintenance/assets"><Button variant="ghost" size="sm">Back to register</Button></Link>
      </div>

      <Card className="space-y-3 p-5">
        <SectionHeading>1 · Get the template</SectionHeading>
        <p className="text-[13px] text-grey">
          Four tabs: fill in <strong>Data Entry</strong>, follow <strong>Sample (filled)</strong>, and
          keep to the values on <strong>Picklists</strong> — those are read live from the masters, and a
          name that is not on them is rejected. One row is one asset; repeat the row with the same
          serial number to add a second track.
        </p>
        <div><Button variant="ghost" size="sm" onClick={downloadTemplate}>Download template</Button></div>
      </Card>

      <Card className="space-y-3 p-5">
        <SectionHeading>2 · Upload and preview</SectionHeading>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-[#F1F4F9] file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy"
        />
        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </Card>

      {result && (
        <Card className="space-y-2 p-5">
          <SectionHeading>Done</SectionHeading>
          <p className="text-[13.5px] text-navy">
            Created <strong>{result.assets}</strong> {result.assets === 1 ? "asset" : "assets"} and{" "}
            <strong>{result.tracks}</strong> {result.tracks === 1 ? "track" : "tracks"}.
            {result.failed > 0 && (
              <> <span className="text-ryg-red">{result.failed} row(s) failed on save</span> — re-upload just those.</>
            )}
          </p>
          <p className="text-[12.5px] text-grey-2">
            Anything whose next due date is already inside its reminder window will open a service
            job on the next nightly run.
          </p>
          <div><Button size="sm" onClick={() => nav("/asset-maintenance/assets")}>Open the register</Button></div>
        </Card>
      )}

      {plan && (
        <Card className="space-y-4 p-5">
          <SectionHeading>3 · Review, then commit</SectionHeading>
          <div className="flex flex-wrap gap-4 text-[13.5px]">
            <span className="text-navy"><strong>{plan.newAssets}</strong> new assets</span>
            <span className="text-navy"><strong>{plan.newTracks}</strong> new tracks</span>
            <span className={plan.invalid ? "font-semibold text-ryg-red" : "text-grey-2"}>
              <strong>{plan.invalid}</strong> rejected
            </span>
          </div>

          {plan.invalid > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="bg-page">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-grey">
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Asset</th>
                    <th className="px-3 py-2">Why it was rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.filter((r) => r.problems.length).map((r) => (
                    <tr key={r.rowNo} className="border-t border-line">
                      <td className="px-3 py-1.5 text-grey-2">{r.rowNo}</td>
                      <td className="px-3 py-1.5 text-navy">{r.name}</td>
                      <td className="px-3 py-1.5 text-ryg-red">{r.problems.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {progress && (
            <p className="text-[13px] text-grey">Saving {progress.done} of {progress.total}…</p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={commit} disabled={busy || plan.newAssets + plan.newTracks === 0}>
              {busy ? "Importing…" : `Import ${plan.newAssets} assets and ${plan.newTracks} tracks`}
            </Button>
            <Button variant="ghost" onClick={() => setPlan(null)} disabled={busy}>Discard</Button>
          </div>
          {plan.invalid > 0 && (
            <p className="text-[12.5px] text-grey-2">
              Rejected rows are skipped, not guessed at. Fix them in the sheet and upload again — the
              importer matches on serial number, so re-uploading will not duplicate what already went in.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
