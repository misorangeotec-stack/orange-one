import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useLdStore } from "../../store";

/**
 * Master Owners (admin) — who may edit each master, and so who resolves its
 * "request a new entry" submissions.
 *
 * ⚠ AN UNOWNED MASTER IS ADMIN-ONLY, not open. The RLS policy on each master
 *   table reads `is_admin(...) OR fms_ld_is_master_manager(...)`, so leaving a
 *   row empty here does not make it editable by everyone — it makes it editable
 *   by nobody except admins, and any request against it waits for one.
 */
const MASTERS: { type: string; label: string }[] = [
  { type: "session_type", label: "Session types" },
  { type: "competency", label: "Competencies" },
  { type: "need_source", label: "Need sources" },
  { type: "venue", label: "Venues" },
  { type: "trainer", label: "Trainers & agencies" },
  { type: "delay_reason", label: "Delay reasons" },
  { type: "followup_action", label: "Follow-up actions" },
];

export default function MasterOwnersSection() {
  const s = useLdStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const options: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const ownersOf = (type: string) =>
    (s.data?.masterManagers ?? []).filter((m) => m.masterType === type).map((m) => m.managerUserId);

  const save = async (type: string, ids: string[]) => {
    setBusy(type);
    setErr(null);
    try {
      await s.writes.setMasterManagers(type, ids);
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <p className="text-[13px] text-grey-2">
        An owner may edit that master and approve requests for new entries. With nobody set, only admins can.
      </p>
      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      <div className="space-y-2">
        {MASTERS.map((m) => (
          <div key={m.type} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
            <span className="min-w-[12rem] flex-1 text-[13.5px] font-semibold text-navy">{m.label}</span>
            <div className="min-w-[18rem] flex-1">
              <MultiSelect
                values={ownersOf(m.type)}
                onChange={(ids) => void save(m.type, ids)}
                options={options}
                placeholder="Admins only"
                chips
                disabled={busy === m.type}
              />
            </div>
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={() => void s.refresh()}>Refresh</Button>
    </Card>
  );
}
