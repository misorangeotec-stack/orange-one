import JSZip from "jszip";
import { saveAs } from "file-saver";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { ldDocUrl } from "../data/ldWrites";
import { dmy } from "./format";
import { CATEGORY_LABEL, hm, sessionHours, trainerLabel } from "./training";
import type { TrainingSession } from "../types";
import type { useLdStore } from "../store";

/**
 * Bulk downloads of what was recorded when trainings were completed:
 *   - MOM of many trainings → one Excel (one row per training)
 *   - files of one or many trainings → one ZIP (a folder per training, its MOM as MOM.txt)
 */

type Ctx = Pick<ReturnType<typeof useLdStore>, "data" | "personName">;

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);

/** "evidence/<id>/1729580000000-Slides.pdf" → "Slides.pdf" */
const fileNameOf = (path: string) => (path.split("/").pop() ?? path).replace(/^\d+-/, "");

function attendanceOf(ctx: Ctx, x: TrainingSession) {
  const att = (ctx.data?.attendance ?? []).filter((a) => a.sessionId === x.id);
  const names = (st: string[]) =>
    att.filter((a) => st.includes(a.status)).map((a) => ctx.personName(a.employeeId)).sort().join(", ");
  const invited = (ctx.data?.nominations ?? []).filter((n) => n.sessionId === x.id && n.status === "approved").length;
  return {
    invited,
    present: att.filter((a) => a.status === "present" || a.status === "partial").length,
    absent: att.filter((a) => a.status === "absent").length,
    presentNames: names(["present", "partial"]),
    absentNames: names(["absent"]),
  };
}

const byDate = (a: TrainingSession, b: TrainingSession) =>
  (a.sessionDate + (a.startTime ?? "")).localeCompare(b.sessionDate + (b.startTime ?? ""));

export function exportMomExcel(ctx: Ctx, sessions: TrainingSession[], period: string, filters: string[] = []) {
  const trainers = ctx.data?.trainers ?? [];
  const rows = [...sessions].sort(byDate).map((x) => ({ x, a: attendanceOf(ctx, x) }));
  return exportRowsToXlsx({
    fileName: `LD_MOM_${safe(period).replace(/ /g, "_")}`,
    sheetName: "MOM",
    title: `Learning & Development — MOM of completed trainings, ${period}`,
    filters: [`Period: ${period}`, ...filters],
    notes: ["Only completed trainings are listed.", "Files attached to a training are in the ZIP download, not in this sheet."],
    rows,
    columns: [
      { header: "Code", width: 15, value: (r) => r.x.code ?? "" },
      { header: "Training", width: 32, value: (r) => r.x.title },
      { header: "Date", width: 12, value: (r) => dmy(r.x.sessionDate) },
      { header: "Time", width: 13, value: (r) => `${hm(r.x.startTime)}–${hm(r.x.endTime)}` },
      { header: "Hours", width: 8, value: (r) => sessionHours(r.x) },
      { header: "Internal / External", width: 12, value: (r) => (r.x.category ? CATEGORY_LABEL[r.x.category] : "") },
      { header: "Trainer", width: 20, value: (r) => trainerLabel(r.x, trainers, ctx.personName) },
      { header: "Attendees", width: 10, value: (r) => r.a.invited },
      { header: "Present", width: 9, value: (r) => r.a.present },
      { header: "Absent", width: 9, value: (r) => r.a.absent },
      { header: "Present — names", width: 36, value: (r) => r.a.presentNames },
      { header: "Absent — names", width: 30, value: (r) => r.a.absentNames },
      { header: "MOM", width: 60, value: (r) => r.x.mom ?? "" },
      { header: "Files", width: 7, value: (r) => r.x.evidencePaths.length },
      { header: "Completed on", width: 13, value: (r) => (r.x.completedAt ? dmy(r.x.completedAt) : "") },
      { header: "Completed by", width: 20, value: (r) => (r.x.completedBy ? ctx.personName(r.x.completedBy) : "") },
    ],
  });
}

/**
 * One ZIP. With a single training the files sit at the top; with several, each
 * training gets its own folder. A file that can no longer be fetched is listed in
 * MISSING.txt rather than failing the whole download.
 */
export async function downloadTrainingFiles(ctx: Ctx, sessions: TrainingSession[], zipName: string): Promise<number> {
  const zip = new JSZip();
  const missing: string[] = [];
  let count = 0;
  const single = sessions.length === 1;
  for (const x of [...sessions].sort(byDate)) {
    const folder = single ? zip : zip.folder(safe(`${x.sessionDate} ${x.code ?? ""} ${x.title}`))!;
    if (x.mom) folder.file("MOM.txt", `${x.title} — ${dmy(x.sessionDate)} ${hm(x.startTime)}–${hm(x.endTime)}\r\n\r\n${x.mom.replace(/\r?\n/g, "\r\n")}`);
    const used = new Set<string>();
    for (const path of x.evidencePaths) {
      let name = safe(fileNameOf(path)) || "file";
      for (let i = 2; used.has(name.toLowerCase()); i++) name = name.replace(/(\.[^.]*)?$/, ` (${i})$1`);
      used.add(name.toLowerCase());
      try {
        const url = await ldDocUrl(path);
        const res = url ? await fetch(url) : null;
        if (!res?.ok) throw new Error("not found");
        folder.file(name, await res.blob());
        count++;
      } catch {
        missing.push(`${x.code ?? x.title} — ${name}`);
      }
    }
  }
  if (missing.length) zip.file("MISSING.txt", `These files could not be downloaded:\r\n${missing.join("\r\n")}`);
  saveAs(await zip.generateAsync({ type: "blob" }), `${safe(zipName)}.zip`);
  return count;
}
