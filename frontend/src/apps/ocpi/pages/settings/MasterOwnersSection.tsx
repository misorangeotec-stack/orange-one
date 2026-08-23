import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";
import { setMasterManagers } from "../../data/ocpiMasterWrites";
import { OCPI_MASTER_TYPES, type OcpiMasterType } from "../../types";

/**
 * Who owns each list.
 *
 * ⚠ AN OWNER CAN EDIT THAT MASTER DIRECTLY, and can approve requests against it
 *   — that is one grant, not two, and the copy says so. It is deliberately
 *   narrow: owning the ink list gives no power over machines, over deals, or
 *   over anything else in the module.
 *
 * ⚠ EMPTY MEANS ADMINS ONLY, which is the safe default rather than a gap. It is
 *   worth stating on screen, because "nobody assigned" reads like a broken
 *   setting when it is in fact the strictest one.
 *
 * ⚠ MACHINE OWNERSHIP ALSO COVERS THE TEMPLATE SECTIONS. A machine's boilerplate
 *   is part of the machine; a second ownership list for it would be a second
 *   thing to keep in step, and the two would disagree.
 */
export default function MasterOwnersSection() {
  const s = useOcpiStore();
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      OCPI_MASTER_TYPES.map((m) => [
        m.value,
        s.masterManagers.filter((x) => x.masterType === m.value).map((x) => x.managerUserId),
      ]),
    ),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data: people } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const options: MultiOption[] = useMemo(
    () =>
      [...(people ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          value: p.id,
          label: p.designation ? `${p.name} · ${p.designation}` : p.name,
        })),
    [people],
  );

  async function save(type: OcpiMasterType) {
    setBusy(type);
    setErr(null);
    setSaved(null);
    try {
      await setMasterManagers(type, picked[type] ?? []);
      await s.refresh();
      setSaved(type);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Master owners</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          An owner can edit that list directly and can approve requests against it &mdash; and
          nothing else. Machines also covers each machine&rsquo;s order-confirmation template.
        </p>
      </div>

      <div className="space-y-4">
        {OCPI_MASTER_TYPES.map((m) => (
          <div key={m.value} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] font-medium text-navy">{m.plural}</span>
              {(picked[m.value] ?? []).length === 0 && (
                <span className="text-[11.5px] text-grey-2">Nobody assigned — admins only</span>
              )}
            </div>
            <MultiSelect
              values={picked[m.value] ?? []}
              onChange={(v) => {
                setPicked((p) => ({ ...p, [m.value]: v }));
                setSaved(null);
              }}
              options={options}
              placeholder="Select owners"
              disabled={!s.isAdmin || busy === m.value}
            />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => void save(m.value)}
                disabled={!s.isAdmin || busy === m.value}
              >
                {busy === m.value ? "Saving…" : "Save"}
              </Button>
              {saved === m.value && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
            </div>
          </div>
        ))}
      </div>

      {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
      {err && <p className="text-[13px] text-ryg-red">{err}</p>}
    </Card>
  );
}
