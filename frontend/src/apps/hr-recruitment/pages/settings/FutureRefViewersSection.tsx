import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";

/**
 * Future Reference access (admin) — the HR people who work the Future Reference bucket.
 *
 * The list saved here is the `fms_hr_config` key `future_ref_viewers`, which
 * `fms_hr_is_future_ref_viewer()` reads in SQL. It grants READ over SAVED candidates
 * only — their row, their discussion trail, the vacancy they came from and their CV —
 * and lets the viewer take a candidate back out of the bucket. It opens nothing else:
 * not the boards, not other candidates.
 *
 * Modelled on PipelineViewersSection, including its `edited ?? saved` pattern: the
 * store loads asynchronously, and a picker seeded once on mount would save `[]` over a
 * real list if the admin pressed Save before the fetch landed.
 */
export default function FutureRefViewersSection() {
  const s = useHrStore();

  const [edited, setEdited] = useState<string[] | null>(null);
  const picked = edited ?? s.futureRefViewerIds;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The org-wide roster, not `s.profiles` (RLS-scoped to your own department).
  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.orgPeople]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => {
          const base = p.designation ? `${p.name} · ${p.designation}` : p.name;
          return {
            value: p.id,
            label: s.moduleUserIds.has(p.id) ? base : `${base} · no access to this module`,
          };
        }),
    [s.orgPeople, s.moduleUserIds],
  );

  const cannotOpen = useMemo(
    () =>
      s.orgPeople
        .filter((p) => picked.includes(p.id) && !s.moduleUserIds.has(p.id))
        .map((p) => p.name),
    [picked, s.orgPeople, s.moduleUserIds],
  );

  const dirty = useMemo(() => {
    const a = [...picked].sort().join(",");
    const b = [...s.futureRefViewerIds].sort().join(",");
    return a !== b;
  }, [picked, s.futureRefViewerIds]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      if (dirty) await s.setFutureRefViewers(picked);
      setEdited(null);
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 max-w-xl">
      <div className="space-y-4">
        <FieldLabel label="Future Reference bucket" hint="who sees every candidate saved for future reference">
          <MultiSelect
            values={picked}
            onChange={(v) => {
              setEdited(v);
              setSaved(false);
            }}
            options={peopleOptions}
            placeholder="Select the HR people who work the bucket"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            Everyone listed here gets <strong className="font-semibold text-navy">Future Reference</strong> in
            their sidebar and can read every saved candidate — name, phone, email and CV — from any vacancy, and
            take a candidate back out of the bucket. It opens nothing else. Admins always see the bucket.
          </span>
          <span className="mt-1.5 block text-[11px] leading-snug text-grey-2">
            They also need <strong className="font-semibold text-navy">New Recruitment</strong> in the Users
            screen to open the app at all.
          </span>
        </FieldLabel>

        {cannotOpen.length > 0 && (
          <p className="rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
            <strong className="font-semibold">
              {cannotOpen.length === 1 ? "This person cannot" : "These people cannot"} open New Recruitment:
            </strong>{" "}
            {cannotOpen.join(", ")}. They will land on Access Denied until someone gives them the module in the
            Users screen.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={busy || !dirty || s.isLoading}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {saved && !dirty && <span className="text-[12.5px] text-ryg-green font-medium">Saved</span>}
          {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
        </div>
      </div>
    </Card>
  );
}
