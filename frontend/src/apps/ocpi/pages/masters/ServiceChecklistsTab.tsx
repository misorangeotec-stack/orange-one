import { useMemo, useRef, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";
import {
  removeServiceChecklist, serviceChecklistUrl, uploadServiceChecklist,
} from "../../data/ocpiServiceChecklists";
import { dmy } from "../../lib/format";
import { readChecklistPdf } from "../../lib/checklistPdf";
import type { OcpiMachine, OcpiServiceChecklist } from "../../types";

const btn =
  "rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-navy transition " +
  "hover:border-orange hover:text-orange disabled:opacity-50";

/**
 * Masters → Service checklists (PDF): one checklist PDF per machine.
 *
 * ⚠ THE PDF IS THE CHECKLIST. On upload the app reads the PDF's text and every
 *   Sr. No row (or line) becomes a check point the service team marks Ready / Not Ready on the
 *   Service Check — nothing is typed by hand. The uploader sees the points
 *   before saving and can untick a line that is not a check point (a title, a
 *   column heading).
 *
 * Every deal for a machine offers its PDF for download at Customer Sign and at
 * the Service Check. Editable by admins and the Machine master owner (the same
 * owner as Service check points); everyone else sees the list read-only and
 * can still open the PDFs.
 */
export default function ServiceChecklistsTab({ canManage }: { canManage: boolean }) {
  const s = useOcpiStore();
  const personById = useOrgPersonById();
  const fileInput = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<OcpiMachine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  /** A PDF read and waiting for the uploader to confirm its points. */
  const [preview, setPreview] = useState<
    { machine: OcpiMachine; file: File; points: { text: string; keep: boolean }[] } | null
  >(null);
  const [viewing, setViewing] = useState<{ machine: OcpiMachine; row: OcpiServiceChecklist } | null>(null);

  const machines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return s.machines
      .filter((m) => showInactive || m.active || s.serviceChecklistFor(m.id))
      .filter((m) =>
        !q || [m.name, m.salesName, m.billingName].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [s, search, showInactive]);

  const uploaded = s.machines.filter((m) => s.serviceChecklistFor(m.id)).length;

  function pick(m: OcpiMachine) {
    setTarget(m);
    setError(null);
    if (fileInput.current) {
      fileInput.current.value = "";
      fileInput.current.click();
    }
  }

  /** Step 1 — read the PDF's lines and show them for confirmation. */
  async function onFile(file: File | undefined) {
    const m = target;
    setTarget(null);
    if (!file || !m) return;
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      setError(`${m.name}: only a PDF can be uploaded as the service checklist.`);
      return;
    }
    setBusyId(m.id);
    setError(null);
    try {
      const lines = await readChecklistPdf(file);
      setPreview({ machine: m, file, points: lines.map((text) => ({ text, keep: true })) });
    } catch (e) {
      setError(`${m.name}: could not read the PDF — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  /** Step 2 — upload the PDF with the points the uploader kept. */
  async function save() {
    if (!preview) return;
    const { machine: m, file, points } = preview;
    setBusyId(m.id);
    setError(null);
    try {
      await uploadServiceChecklist(
        m.id, file, s.serviceChecklistFor(m.id), points.filter((p) => p.keep).map((p) => p.text),
      );
      setPreview(null);
      await s.refresh();
    } catch (e) {
      setError(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: OcpiMachine) {
    const row = s.serviceChecklistFor(m.id);
    if (!row) return;
    if (!window.confirm(`Remove the service checklist PDF for ${m.name}?`)) return;
    setBusyId(m.id);
    setError(null);
    try {
      await removeServiceChecklist(row);
      await s.refresh();
    } catch (e) {
      setError(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function view(m: OcpiMachine) {
    const row = s.serviceChecklistFor(m.id);
    if (!row) return;
    const win = window.open("", "_blank");
    try {
      const url = await serviceChecklistUrl(row);
      if (win) win.location.href = url;
    } catch (e) {
      win?.close();
      setError(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <p className="text-[13.5px] font-semibold text-navy">One service checklist PDF per machine</p>
        <p className="mt-0.5 text-[12.5px] text-grey-2">
          Upload it once here. Each Sr. No row of the PDF becomes a point the service team marks
          Ready or Not Ready on the Service Check. Every deal for that machine also offers the PDF for
          download at the Customer Sign step &mdash; so the customer gets it before installation.{" "}
          {uploaded} of {s.machines.length} machines have one.
          {!canManage && " Only admins and the Machine master owner can upload."}
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search machine…"
          className="w-64 rounded-xl border border-line px-3 py-2 text-[13px] text-navy outline-none focus:border-orange"
        />
        <label className="flex items-center gap-2 text-[12.5px] text-grey-2">
          <input
            type="checkbox"
            className="accent-orange"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show inactive machines
        </label>
      </div>

      {error && <p className="text-[13px] text-ryg-red">{error}</p>}

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-grey-2">
              <th className="px-4 py-2.5">Machine</th>
              <th className="px-4 py-2.5">Service checklist</th>
              <th className="px-4 py-2.5">Check points</th>
              <th className="px-4 py-2.5">Uploaded</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {machines.map((m) => {
              const row = s.serviceChecklistFor(m.id);
              const busy = busyId === m.id;
              return (
                <tr key={m.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-navy">{m.name}</span>
                    {m.salesName && m.salesName !== m.name && (
                      <span className="block text-[12px] text-grey-2">{m.salesName}</span>
                    )}
                    {!m.active && <span className="block text-[11.5px] text-grey-2">Inactive</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {row ? (
                      <button type="button" onClick={() => void view(m)} className="text-left font-medium text-blue hover:underline">
                        {row.fileName}
                      </button>
                    ) : (
                      <span className="text-grey-2">Not uploaded</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row ? (
                      <button
                        type="button"
                        onClick={() => setViewing({ machine: m, row })}
                        className="font-medium text-blue hover:underline"
                      >
                        {row.items.length} point{row.items.length === 1 ? "" : "s"}
                      </button>
                    ) : <span className="text-grey-2">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-grey-2">
                    {row ? (
                      <>
                        {dmy(row.updatedAt)}
                        {row.uploadedBy && (
                          <span className="block text-[12px]">{personById(row.uploadedBy)?.name ?? ""}</span>
                        )}
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && (
                      <div className="inline-flex gap-2">
                        <button type="button" className={btn} disabled={busy} onClick={() => pick(m)}>
                          {busy ? "Working…" : row ? "Replace PDF" : "Upload PDF"}
                        </button>
                        {row && (
                          <button type="button" className={btn} disabled={busy} onClick={() => void remove(m)}>
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {machines.length === 0 && (
              <tr>
                <td colSpan={5}className="px-4 py-6 text-center text-grey-2">No machines match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {preview && (
        <Modal
          open
          onClose={() => busyId === null && setPreview(null)}
          title={`Check points — ${preview.machine.name}`}
          subtitle={`Read from ${preview.file.name}. Untick any line that is not a check point (a title or heading).`}
          size="lg"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={busyId !== null}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={busyId !== null}>
                {busyId !== null
                  ? "Saving…"
                  : `Save PDF with ${preview.points.filter((p) => p.keep).length} points`}
              </Button>
            </div>
          }
        >
          {preview.points.length === 0 ? (
            <p className="text-[13px] text-grey">
              No text could be read from this PDF &mdash; it is probably a scanned image. It can still
              be saved for download, but the Service Check will have no check points for this machine
              until a PDF with text is uploaded.
            </p>
          ) : (
            <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
              {preview.points.map((p, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 text-[13px]">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-orange"
                      checked={p.keep}
                      onChange={(e) =>
                        setPreview((v) => v && {
                          ...v,
                          points: v.points.map((q, j) => (j === i ? { ...q, keep: e.target.checked } : q)),
                        })}
                    />
                    <span className={p.keep ? "text-navy" : "text-grey-2 line-through"}>{p.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          title={`Check points — ${viewing.machine.name}`}
          subtitle={`From ${viewing.row.fileName}. To change them, upload the PDF again.`}
          size="lg"
        >
          {viewing.row.items.length === 0 ? (
            <p className="text-[13px] text-grey">No check points were read from this PDF.</p>
          ) : (
            <ol className="max-h-[60vh] list-decimal space-y-1.5 overflow-y-auto pl-6 text-[13px] text-navy">
              {viewing.row.items.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          )}
        </Modal>
      )}
    </div>
  );
}
