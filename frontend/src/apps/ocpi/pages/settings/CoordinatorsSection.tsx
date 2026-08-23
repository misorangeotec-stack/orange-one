import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useOcpiStore } from "../../store";

/**
 * Process coordinators.
 *
 * ⚠ THIS IS THE WIDEST GRANT IN THE MODULE, and the copy says so plainly. A
 *   coordinator satisfies `fms_ocpi_is_coordinator`, which short-circuits every
 *   ownership test in `fms_ocpi_can_act` — so they can approve a quotation,
 *   confirm an order confirmation, countersign a contract, hold, cancel, and
 *   replace a filed signature. It is not a "sees everything" role; it is an
 *   "is allowed to do everything" role, and a settings screen that described it
 *   as oversight would get it handed out too freely.
 *
 * ⚠ THE ONE THING IT DOES NOT DO is exempt somebody from the module grant.
 *   `fms_ocpi_can_act` still requires `module_can_edit`, so a coordinator on a
 *   view-only grant can act on nothing. That is deliberate: the view-only
 *   ceiling is a ceiling, and no role punches through it.
 */
export default function CoordinatorsSection() {
  const s = useOcpiStore();
  const [picked, setPicked] = useState<string[]>(s.config.processCoordinatorIds);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
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

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await s.setCoordinators(picked);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4 p-5">
      <div>
        <h3 className="text-[15px] font-bold text-navy">Process coordinators</h3>
        <p className="mt-1 text-[12.5px] text-grey">
          A coordinator can act on <b>every</b> step regardless of who owns it &mdash; approve a
          quotation, confirm an order confirmation, countersign, hold, cancel, or replace a filed
          signature. Give it to the person who runs this process, not to everyone who watches it.
        </p>
      </div>

      <MultiSelect
        values={picked}
        onChange={(v) => {
          setPicked(v);
          setSaved(false);
        }}
        options={options}
        placeholder="Select coordinators"
        disabled={!s.isAdmin}
      />

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={busy || !s.isAdmin}>
          {busy ? "Saving…" : "Save"}
        </Button>
        {!s.isAdmin && <span className="text-[12.5px] text-grey-2">Admins only.</span>}
        {saved && <span className="text-[12.5px] text-ryg-green">Saved.</span>}
        {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
      </div>
    </Card>
  );
}
