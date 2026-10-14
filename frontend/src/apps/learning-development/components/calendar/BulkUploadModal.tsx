import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { exportSheetsToXlsx } from "@/shared/lib/exportXlsx";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { CATEGORY_LABEL, isTeamsLink, parseSheetDate, parseSheetTime } from "../../lib/training";
import type { CalendarTrainingInput, DirectoryPerson } from "../../data/ldWrites";
import type { TrainingCategory } from "../../types";

/**
 * Upload the year's training calendar from Excel (requirement 1, "in bulk").
 *
 * ⚠ ALL ROWS OR NONE. Every row is checked here first and shown with its
 *   problems; Upload is offered only when every row is clean, and the server
 *   (`fms_ld_bulk_save_calendar`) saves them in one transaction — a calendar
 *   half-uploaded is worse than one not uploaded, because the second attempt
 *   duplicates the first half.
 *
 * Attendees are matched by EMAIL or EMPLOYEE CODE (exact name also works), and
 * "ALL" / "DEPT: <department>" add groups — the People and Departments tabs of
 * the template list exactly what matches, so nothing has to be guessed.
 */

const COLS = {
  title: "Title",
  category: "Category (Internal / External)",
  date: "Date (DD-MM-YYYY)",
  start: "Start (HH:MM)",
  end: "End (HH:MM)",
  link: "Teams meeting link",
  trainer: "Trainer",
  description: "Agenda / description",
  attendees: "Attendees",
} as const;

interface ParsedRow {
  rowNo: number;
  input: CalendarTrainingInput | null;
  title: string;
  category: string;
  date: string | null;
  time: string;
  trainer: string;
  attendeeCount: number;
  errors: string[];
}

const norm = (v: unknown) => String(v ?? "").trim();
const low = (v: unknown) => norm(v).toLowerCase();

export default function BulkUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useLdStore();
  const d = s.data;
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const dirQ = useQuery({
    queryKey: ["ldPeopleDirectory"],
    queryFn: s.writes.peopleDirectory,
    enabled: open && s.canManageCalendar,
    staleTime: 5 * 60_000,
  });
  const people: DirectoryPerson[] = dirQ.data ?? [];

  useEffect(() => {
    if (open) {
      setRows(null);
      setFileName("");
      setErr(null);
      setDone(null);
    }
  }, [open]);

  const deptName = s.departmentName;
  const externalTrainers = (d?.trainers ?? []).filter((t) => t.trainerType === "external" && t.active);

  /** email / code / exact name → person. */
  const index = useMemo(() => {
    const m = new Map<string, DirectoryPerson>();
    for (const p of people) {
      if (p.email) m.set(p.email.toLowerCase(), p);
      if (p.employeeCode) m.set(p.employeeCode.toLowerCase(), p);
    }
    // Names last and only when unique, so a shared name never picks the wrong person.
    const byName = new Map<string, DirectoryPerson[]>();
    for (const p of people) byName.set(p.name.toLowerCase(), [...(byName.get(p.name.toLowerCase()) ?? []), p]);
    for (const [k, v] of byName) if (v.length === 1 && !m.has(k)) m.set(k, v[0]);
    return m;
  }, [people]);

  const downloadTemplate = async () => {
    const example = [
      {
        [COLS.title]: "Advanced Excel for Accounts",
        [COLS.category]: "Internal",
        [COLS.date]: "28-10-2026",
        [COLS.start]: "10:00",
        [COLS.end]: "12:30",
        [COLS.link]: "https://teams.microsoft.com/l/meetup-join/…",
        [COLS.trainer]: people[0]?.email ?? "trainer@orangeotec.com",
        [COLS.description]: "Pivot tables, lookups and charts",
        [COLS.attendees]: "DEPT: Accounts; someone@orangeotec.com; EMP042",
      },
      {
        [COLS.title]: "Fire Safety Refresher",
        [COLS.category]: "External",
        [COLS.date]: "15-11-2026",
        [COLS.start]: "15:00",
        [COLS.end]: "17:00",
        [COLS.link]: "https://teams.microsoft.com/l/meetup-join/…",
        [COLS.trainer]: externalTrainers[0]?.name ?? "ABC Safety Consultants",
        [COLS.description]: "",
        [COLS.attendees]: "ALL",
      },
    ];
    const col = (key: keyof typeof COLS, width: number) => ({
      header: COLS[key],
      width,
      value: (r: Record<string, string>) => r[COLS[key]] ?? "",
    });
    const cols = [
      col("title", 34), col("category", 16), col("date", 14), col("start", 10), col("end", 10),
      col("link", 46), col("trainer", 28), col("description", 36), col("attendees", 60),
    ];
    await exportSheetsToXlsx({
      fileName: "LD_Training_Calendar_Template",
      title: "Training calendar upload template",
      notes: [
        "Fill the FIRST tab (Trainings) — one row per training. Do not rename or reorder its columns.",
        "Category: Internal (our own team) or External (outside trainer).",
        "Date as DD-MM-YYYY; Start and End as HH:MM (24-hour). Hours are worked out from them.",
        "Teams meeting link: must start with https://teams.microsoft.com/ — create the meeting in Teams first.",
        "Trainer: for Internal, the person's email / employee code / name; for External, a name from the 'External trainers' tab or any name.",
        "Attendees: emails or employee codes separated by ; or , — or 'ALL' for everyone, or 'DEPT: <department>' (see the Departments tab). Mix them freely.",
        "Attendees get the Teams-style invitation mail 3 days before the training.",
        "The upload is all-or-nothing: fix any row shown in red and upload again.",
      ],
      sheets: [
        { sheetName: "Trainings", columns: cols, rows: [] },
        { sheetName: "Example", columns: cols, rows: example },
        {
          sheetName: "People",
          columns: [
            { header: "Name", width: 30, value: (p: DirectoryPerson) => p.name },
            { header: "Email", width: 34, value: (p: DirectoryPerson) => p.email ?? "" },
            { header: "Employee code", width: 16, value: (p: DirectoryPerson) => p.employeeCode ?? "" },
            { header: "Department", width: 24, value: (p: DirectoryPerson) => deptName(p.departmentId) },
          ],
          rows: people,
        },
        {
          sheetName: "Departments",
          columns: [
            { header: "Write as", width: 34, value: (x: { name: string }) => `DEPT: ${x.name}` },
            { header: "People", width: 10, value: (x: { n: number }) => x.n },
          ],
          rows: s.orgDepartments
            .map((x) => ({ name: x.name, n: people.filter((p) => p.departmentId === x.id).length }))
            .filter((x) => x.n > 0),
        },
        {
          sheetName: "External trainers",
          columns: [
            { header: "Name", width: 30, value: (t: { name: string }) => t.name },
            { header: "Agency", width: 30, value: (t: { agency: string | null }) => t.agency ?? "" },
          ],
          rows: externalTrainers,
        },
      ],
    });
  };

  const resolveAttendees = (cell: string): { ids: string[]; errors: string[] } => {
    const ids = new Set<string>();
    const errors: string[] = [];
    for (const raw of cell.split(/[;,\n]+/)) {
      const tok = raw.trim();
      if (!tok) continue;
      if (tok.toLowerCase() === "all") {
        people.forEach((p) => ids.add(p.id));
        continue;
      }
      const dm = tok.match(/^dept\s*:\s*(.+)$/i);
      if (dm) {
        const dep = s.orgDepartments.find((x) => x.name.toLowerCase() === dm[1].trim().toLowerCase());
        if (!dep) errors.push(`no department “${dm[1].trim()}”`);
        else people.filter((p) => p.departmentId === dep.id).forEach((p) => ids.add(p.id));
        continue;
      }
      const p = index.get(tok.toLowerCase());
      if (p) ids.add(p.id);
      else errors.push(`attendee “${tok}” not found`);
    }
    return { ids: [...ids], errors };
  };

  const parse = async (file: File) => {
    setErr(null);
    setDone(null);
    setFileName(file.name);
    try {
      const raw = await parseXlsxRows(file);
      const out: ParsedRow[] = [];
      raw.forEach((r, i) => {
        const rowNo = i + 2; // header is row 1
        const title = norm(r[COLS.title]);
        if (!title && !norm(r[COLS.date]) && !norm(r[COLS.attendees])) return; // blank line
        const errors: string[] = [];
        if (!title) errors.push("title missing");

        const catRaw = low(r[COLS.category]);
        const category: TrainingCategory | null =
          catRaw.startsWith("int") ? "internal" : catRaw.startsWith("ext") ? "external" : null;
        if (!category) errors.push("category must be Internal or External");

        const date = parseSheetDate(r[COLS.date]);
        if (!date) errors.push("date not readable (use DD-MM-YYYY)");
        const start = parseSheetTime(r[COLS.start]);
        const end = parseSheetTime(r[COLS.end]);
        if (!start || !end) errors.push("start / end time not readable (use HH:MM)");
        else if (end <= start) errors.push("end time must be after start");

        const link = norm(r[COLS.link]);
        if (!isTeamsLink(link)) errors.push("not a Microsoft Teams link");

        const trainerCell = norm(r[COLS.trainer]);
        let trainerUserId: string | null = null;
        let trainerId: string | null = null;
        let externalTrainerName: string | null = null;
        if (trainerCell) {
          if (category === "internal") {
            const p = index.get(trainerCell.toLowerCase());
            if (p) trainerUserId = p.id;
            else errors.push(`internal trainer “${trainerCell}” not found`);
          } else if (category === "external") {
            const t = externalTrainers.find((x) => x.name.toLowerCase() === trainerCell.toLowerCase());
            if (t) trainerId = t.id;
            else externalTrainerName = trainerCell;
          }
        }

        const att = resolveAttendees(norm(r[COLS.attendees]));
        errors.push(...att.errors);
        if (att.ids.length === 0 && att.errors.length === 0) errors.push("no attendees");

        out.push({
          rowNo,
          title,
          category: category ? CATEGORY_LABEL[category] : norm(r[COLS.category]) || "—",
          date,
          time: start && end ? `${start}–${end}` : "—",
          trainer: trainerCell || "—",
          attendeeCount: att.ids.length,
          errors,
          input:
            errors.length === 0 && category && date && start && end
              ? {
                  rowNo,
                  title,
                  category,
                  sessionDate: date,
                  startTime: start,
                  endTime: end,
                  teamsLink: link,
                  description: norm(r[COLS.description]) || null,
                  trainerUserId,
                  trainerId,
                  externalTrainerName,
                  attendeeIds: att.ids,
                }
              : null,
        });
      });
      if (out.length === 0) throw new Error("No trainings found. Fill the first tab (Trainings) of the template.");
      if (!(COLS.title in (raw[0] ?? {}))) {
        throw new Error("This does not look like the training calendar template — download it again and use its first tab.");
      }
      setRows(out);
    } catch (e) {
      setRows(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const bad = rows?.filter((r) => r.errors.length > 0).length ?? 0;
  const good = rows?.filter((r) => r.input).length ?? 0;

  const upload = async () => {
    if (!rows || bad > 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await s.writes.bulkSaveCalendar(rows.map((r) => r.input!));
      await s.refresh();
      setDone(res.created);
      setRows(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title="Upload training calendar"
      subtitle="Many trainings at once from Excel — each with its category, Teams link and attendees."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          {rows && (
            <Button onClick={() => void upload()} disabled={busy || bad > 0 || good === 0}>
              {busy ? "Uploading…" : `Upload ${good} training${good === 1 ? "" : "s"}`}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-4">
            <div className="text-[13px] font-semibold text-navy">1 · Download the template</div>
            <p className="mt-1 text-[12.5px] text-grey-2">
              It lists everybody's email and employee code, the departments and the external trainers, so attendees
              match first time.
            </p>
            <Button size="sm" variant="ghost" className="mt-3" disabled={dirQ.isLoading} onClick={() => void downloadTemplate()}>
              {dirQ.isLoading ? "Loading people…" : "Download template"}
            </Button>
          </div>
          <div className="rounded-xl border border-line p-4">
            <div className="text-[13px] font-semibold text-navy">2 · Upload the filled file</div>
            <p className="mt-1 text-[12.5px] text-grey-2">Every row is checked before anything is saved.</p>
            <Button size="sm" variant="outline" className="mt-3" disabled={dirQ.isLoading || busy} onClick={() => fileRef.current?.click()}>
              Choose Excel file
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void parse(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            {fileName && <div className="mt-2 truncate text-[12px] text-grey-2">{fileName}</div>}
          </div>
        </div>

        {dirQ.error && (
          <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">
            Could not load the people list: {(dirQ.error as Error).message}
          </p>
        )}
        {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
        {done != null && (
          <p className="rounded-lg bg-[#E8F7EE] px-3 py-2 text-[13px] text-ryg-green">
            {done} training{done === 1 ? "" : "s"} added to the calendar.
          </p>
        )}

        {rows && (
          <div>
            <div className="mb-2 text-[13px] text-navy">
              <b>{rows.length}</b> row{rows.length === 1 ? "" : "s"} read ·{" "}
              <span className="text-ryg-green">{good} ready</span>
              {bad > 0 && <span className="text-[#B42318]"> · {bad} with problems — fix them in Excel and choose the file again</span>}
            </div>
            <div className="max-h-[48vh] overflow-auto rounded-xl border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-[#F6F9FD] text-left text-grey-2">
                  <tr>
                    <th className="px-2.5 py-2">Row</th>
                    <th className="px-2.5 py-2">Title</th>
                    <th className="px-2.5 py-2">Category</th>
                    <th className="px-2.5 py-2">Date</th>
                    <th className="px-2.5 py-2">Time</th>
                    <th className="px-2.5 py-2">Trainer</th>
                    <th className="px-2.5 py-2 text-right">Attendees</th>
                    <th className="px-2.5 py-2">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNo} className={"border-t border-line " + (r.errors.length ? "bg-[#FEF6F6]" : "")}>
                      <td className="px-2.5 py-1.5 text-grey-2">{r.rowNo}</td>
                      <td className="px-2.5 py-1.5 text-navy">{r.title || "—"}</td>
                      <td className="px-2.5 py-1.5">{r.category}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">{r.date ? dmy(r.date) : "—"}</td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap">{r.time}</td>
                      <td className="px-2.5 py-1.5">{r.trainer}</td>
                      <td className="px-2.5 py-1.5 text-right">{r.attendeeCount}</td>
                      <td className="px-2.5 py-1.5">
                        {r.errors.length === 0 ? (
                          <span className="text-ryg-green">OK</span>
                        ) : (
                          <span className="text-[#B42318]">{r.errors.join("; ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
