import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { CATEGORY_LABEL, fyList, isCancelled, isCompleted } from "../../lib/training";
import { downloadTrainingFiles, exportMomExcel } from "../../lib/momExport";
import type { TrainingCategory } from "../../types";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/**
 * Bulk download for HR: MOM of every completed training in a period as one Excel,
 * or all their files as one ZIP (a folder per training). Follows the Internal /
 * External filter already chosen on the calendar.
 */
export default function DownloadModal({
  open,
  onClose,
  year,
  month,
  category,
}: {
  open: boolean;
  onClose: () => void;
  /** The month on screen — offered as the first period. */
  year: number;
  month: number;
  category: "all" | TrainingCategory;
}) {
  const s = useLdStore();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const periods = useMemo(
    () => [
      { key: `m:${monthKey}`, label: `${MONTHS[month]} ${year}`, from: `${monthKey}-01`, to: `${monthKey}-31` },
      ...fyList(s.sessions).map((f) => ({ key: `fy:${f.label}`, label: `FY ${f.label}`, from: f.from, to: f.to })),
    ],
    [s.sessions, monthKey, month, year],
  );
  const [periodKey, setPeriodKey] = useState(periods[0].key);
  const period = periods.find((p) => p.key === periodKey) ?? periods[0];
  const [busy, setBusy] = useState<"" | "excel" | "zip">("");
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      s.sessions.filter(
        (x) =>
          isCompleted(x) && !isCancelled(x) &&
          x.sessionDate >= period.from && x.sessionDate <= period.to &&
          (category === "all" || x.category === category),
      ),
    [s.sessions, period, category],
  );
  const withMom = rows.filter((x) => x.mom).length;
  const files = rows.reduce((n, x) => n + x.evidencePaths.length, 0);
  const catFilter = category === "all" ? [] : [`${CATEGORY_LABEL[category]} trainings only`];

  const run = async (what: "excel" | "zip") => {
    setBusy(what);
    setErr(null);
    try {
      if (what === "excel") await exportMomExcel(s, rows, period.label, catFilter);
      else await downloadTrainingFiles(s, rows.filter((x) => x.mom || x.evidencePaths.length > 0), `LD files ${period.label}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Download MOM & files"
      subtitle={category === "all" ? "Completed trainings" : `Completed ${CATEGORY_LABEL[category]} trainings`}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Close</Button>
          <Button variant="ghost" onClick={() => void run("zip")} disabled={!!busy || files + withMom === 0}>
            {busy === "zip" ? "Preparing…" : "Files — ZIP"}
          </Button>
          <Button onClick={() => void run("excel")} disabled={!!busy || rows.length === 0}>
            {busy === "excel" ? "Preparing…" : "MOM — Excel"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="text-[12.5px] font-semibold text-navy">Period</span>
          <select
            className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-[13.5px] text-navy"
            value={periodKey}
            onChange={(e) => setPeriodKey(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </label>
        <p className="rounded-lg bg-[#F1F4F9] px-3 py-2 text-[13px] text-navy">
          {rows.length === 0
            ? `No completed trainings in ${period.label}.`
            : `${rows.length} completed training${rows.length === 1 ? "" : "s"} · ${withMom} with MOM · ${files} file${files === 1 ? "" : "s"}`}
        </p>
        <p className="text-[12px] text-grey-2">
          Excel: one row per training — date, trainer, present / absent names, hours and the MOM.
          ZIP: a folder per training with its files and its MOM.
        </p>
        {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      </div>
    </Modal>
  );
}
