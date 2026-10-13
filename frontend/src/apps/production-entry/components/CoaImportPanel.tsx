import { useRef, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import Button from "@/shared/components/ui/Button";
import { parseQcWorkbook, rowsForLot, type CoaKey, type QcRow } from "../lib/coaImport";

/**
 * FILL THIS CERTIFICATE FROM THE LAB'S DAY SHEET.
 *
 * The analyst picks "Daily Quality Monitoring Sheet OOT QC FMT 002", this finds
 * the line written up for THIS lot, and the readings drop into the form below,
 * still editable. See lib/coaImport.ts for how the workbook is read.
 *
 * ⚠ IT NEVER PICKS BETWEEN TWO ROWS. A re-tested lot is written up more than once
 *   and the rows differ exactly in the readings, so choosing silently is how Test
 *   2's figures end up on Test 1's certificate. Two matches are listed with their
 *   date, shift and analyst and the person chooses.
 *
 * ⚠ NOR DOES IT SAVE. Filling the boxes is the whole of the job; the certificate
 *   is still issued by the analyst pressing the button, having looked at it.
 */

const LABEL: Record<CoaKey, string> = {
  ph: "pH",
  conductivity: "Conductivity",
  surfaceTension: "Surface Tension",
  viscosity: "Viscosity",
  concentration: "Concentration",
  density: "Density",
  foamVolume: "Foam Volume",
  settleFoam: "Settle Foam time",
  spreadTime: "Drop spreading time",
};

/** What the last import did, quoted back so it can be checked against the sheet. */
export interface CoaImportOutcome {
  filled: number;
  total: number;
  skipped: string[];
  row: QcRow;
}

export default function CoaImportPanel({
  lot,
  disabled = false,
  onApply,
}: {
  /** The job card's lot, punctuation and all — matched loosely (`2608-1344` finds
   *  the sheet's `26081344`). */
  lot: string;
  disabled?: boolean;
  /** Push one sheet row into the form. Returns what it managed to fill. */
  onApply: (row: QcRow) => CoaImportOutcome;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Several rows for this lot — shown for the analyst to choose between. */
  const [choices, setChoices] = useState<QcRow[] | null>(null);
  const [outcome, setOutcome] = useState<CoaImportOutcome | null>(null);
  const [missing, setMissing] = useState<CoaKey[]>([]);

  const clear = () => {
    setErr(null);
    setNote(null);
    setChoices(null);
    setOutcome(null);
    setMissing([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const apply = (row: QcRow) => {
    setChoices(null);
    setOutcome(onApply(row));
  };

  const pick = async (file: File) => {
    setBusy(true);
    clear();
    try {
      const parsed = await parseQcWorkbook(file);
      setMissing(parsed.missingColumns);

      const matches = rowsForLot(parsed.rows, lot);
      if (matches.length === 0) {
        const lots = new Set(parsed.rows.map((r) => r.lot));
        setErr(
          parsed.rows.length === 0
            ? `That sheet has no lot numbers filled in yet — the ${parsed.sheetsRead.join(" and ")} ` +
                `tab${parsed.sheetsRead.length > 1 ? "s were" : " was"} read but every line is blank.`
            : `Lot ${lot} is not on that sheet. It holds ${lots.size} lot${lots.size === 1 ? "" : "s"} ` +
                `(${[...lots].slice(0, 6).join(", ")}${lots.size > 6 ? ", …" : ""}). ` +
                `The dash does not matter — 2608-1344 finds 26081344 — so this is a different lot or a different day's file.`,
        );
        return;
      }
      if (matches.length > 1) {
        setChoices(matches);
        setNote(
          `Lot ${lot} is written up ${matches.length} times on that sheet. Pick the line this certificate is for.`,
        );
        return;
      }
      apply(matches[0]!);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  };

  const rowLine = (r: QcRow) =>
    [r.date, r.shift && `Shift ${r.shift}`, r.analyst, `${r.sheetName} row ${r.excelRow}`]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="rounded-xl border border-line px-3.5 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-grey-2">
            Fill from the QC day sheet
          </div>
          <div className="text-[12px] text-grey-2 mt-0.5">
            Upload “Daily Quality Monitoring Sheet OOT QC FMT 002”. The readings for lot{" "}
            <span className="font-semibold text-navy">{lot || "—"}</span> drop into the boxes below,
            and stay editable.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(outcome || err || choices) && (
            <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>
              <X size={15} /> Clear
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || busy || !lot}
            onClick={() => fileRef.current?.click()}
          >
            <FileSpreadsheet size={15} />
            {busy ? "Reading…" : outcome ? "Choose another file" : "Choose Excel file"}
          </Button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />

      {err && (
        <div className="rounded-xl border border-ryg-red/40 bg-[#FDECEC] px-3 py-2 text-[12.5px] text-ryg-red">
          {err}
        </div>
      )}

      {note && !err && (
        <div className="rounded-xl bg-orange-soft px-3 py-2 text-[12.5px] text-orange font-medium">
          {note}
        </div>
      )}

      {choices && (
        <div className="space-y-1.5">
          {choices.map((r, i) => (
            <button
              key={`${r.sheetName}-${r.excelRow}`}
              type="button"
              onClick={() => apply(r)}
              className="w-full text-left rounded-xl border border-line px-3 py-2 hover:border-orange hover:bg-orange-soft/40 transition-colors"
            >
              <div className="text-[13px] font-semibold text-navy">
                {r.productName || "—"} · {Object.keys(r.readings).length} reading
                {Object.keys(r.readings).length === 1 ? "" : "s"}
              </div>
              <div className="text-[11.5px] text-grey-2">{rowLine(r) || `Entry ${i + 1}`}</div>
            </button>
          ))}
        </div>
      )}

      {outcome && (
        <div className="rounded-xl border border-ryg-green/40 bg-[#ECF7EF] px-3 py-2 text-[12.5px] text-navy space-y-1">
          <div>
            <span className="font-semibold">
              Filled {outcome.filled} of {outcome.total}
            </span>{" "}
            from {outcome.row.sheetName}, row {outcome.row.excelRow}
            {outcome.row.date ? ` · ${outcome.row.date}` : ""}
            {outcome.row.analyst ? ` · ${outcome.row.analyst}` : ""}.
          </div>
          {outcome.skipped.length > 0 && (
            <div className="text-grey-2">
              Not on that sheet, so still to type: {outcome.skipped.join(", ")}.
            </div>
          )}
          {/* Only worth saying once something was imported — before that it is a
              column list about a file nobody has looked at. */}
          {missing.length > 0 && (
            <div className="text-grey-2">
              The sheet has no column for {missing.map((k) => LABEL[k]).join(", ")}
              {outcome.row.sheetName.toLowerCase().includes("qc")
                ? " — the Daily QA tab carries those."
                : "."}
            </div>
          )}
          <div className="text-grey-2">
            Check every figure against the sheet before issuing — nothing has been saved yet.
          </div>
        </div>
      )}
    </div>
  );
}
