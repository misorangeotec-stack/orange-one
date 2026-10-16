import { useMemo, useRef, useState } from "react";
import Card from "@/shared/components/ui/Card";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";
import {
  removeServiceChecklist, serviceChecklistUrl, uploadServiceChecklist,
} from "../../data/ocpiServiceChecklists";
import { dmy } from "../../lib/format";
import type { OcpiMachine } from "../../types";

const btn =
  "rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-navy transition " +
  "hover:border-orange hover:text-orange disabled:opacity-50";

/**
 * Masters → Service checklists (PDF): one checklist PDF per machine.
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

  async function onFile(file: File | undefined) {
    const m = target;
    if (!file || !m) return;
    setBusyId(m.id);
    setError(null);
    try {
      await uploadServiceChecklist(m.id, file, s.serviceChecklistFor(m.id));
      await s.refresh();
    } catch (e) {
      setError(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
      setTarget(null);
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
          Upload it once here. Every deal for that machine then offers it for download at the
          Customer Sign step &mdash; so the customer gets it before installation &mdash; and on the
          Service Check. {uploaded} of {s.machines.length} machines have one.
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
                          {busy ? "Saving…" : row ? "Replace PDF" : "Upload PDF"}
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
                <td colSpan={4} className="px-4 py-6 text-center text-grey-2">No machines match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
