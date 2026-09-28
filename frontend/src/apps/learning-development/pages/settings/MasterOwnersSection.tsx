import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { useLdStore } from "../../store";
import { LD_MASTER_TYPES } from "../../types";

/**
 * Master Owners (admin) — who may edit each master, and so who resolves its
 * "request a new entry" submissions.
 *
 * ⚠ AN UNOWNED MASTER IS ADMIN-ONLY, not open. The RLS policy on each master
 *   table reads `is_admin(...) OR fms_ld_is_master_manager(...)`, so leaving a
 *   row empty here does not make it editable by everyone — it makes it editable
 *   by nobody except admins, and any request against it waits for one.
 */
/*
 * ⚠ ONE LIST, IN `types.ts` — not a second copy here. It is checked by a CHECK
 *   constraint on `fms_ld_master_managers.master_type`, by another on
 *   `fms_ld_master_requests.master_type`, and dispatched on by name inside
 *   `fms_ld_resolve_master_request`. A row offered here that those do not know
 *   fails on save with "violates check constraint", which reads as a broken
 *   screen. The Masters page renders its tabs from the same constant.
 *
 * ⚠ POSH / SAFETY PROGRAMMES ARE NOT ON THIS SCREEN and must not be added to it.
 *   `fms_ld_mandatory_programs` is governed by `is_admin OR fms_ld_is_coordinator`
 *   — set in the Coordinators tab — and is absent from the CHECK above, so an
 *   owner assigned here would be refused by the database and, if it were not,
 *   would still give them nothing.
 */
const MASTERS = LD_MASTER_TYPES.map((m) => ({ type: m.value as string, label: m.plural }));

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
