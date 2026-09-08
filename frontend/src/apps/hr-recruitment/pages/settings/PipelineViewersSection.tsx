import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";

/**
 * Pipeline Access (admin) — who may read EVERY position's pipeline.
 *
 * ⚠ THIS IS A PII GRANT, NOT A DISPLAY TOGGLE, and the screen has to say so.
 *
 * The list saved here is the same `fms_hr_config` key that
 * `fms_hr_is_pipeline_viewer()` reads in SQL, and that predicate is OR'd into
 * `fms_hr_can_read_requisition()` (migration 20260908120000). So adding somebody here
 * does not merely reveal a screen — it opens eight relations to them (candidates,
 * scores, interviews, onboardings, onboarding checks, probations, probation reviews,
 * and the requisitions themselves via the `can_view` sibling) plus every CV in the
 * private `fms-hr-docs` bucket. Names, phones, emails, expected salary, resumes.
 *
 * That the frontend list and the RLS arm read ONE key is the point: they cannot
 * disagree about who is on it, and removing somebody here genuinely withdraws the
 * rows rather than just hiding a link.
 *
 * TWO GRANTS ARE REQUIRED, and only one of them is here. This list grants the
 * candidate READ. Opening the app at all — and pressing any button on the dashboard,
 * since `fms_hr_can_act()` ANDs `module_can_edit()` — needs `hr-recruitment` at
 * **Edit** in the core admin Users form. Somebody on this list with no module grant
 * sees nothing; somebody at View-only sees the vacancies but not the candidates.
 * The picker marks anyone in that position rather than letting it be discovered.
 *
 * Modelled on CoordinatorsSection, which this sits beside. Like that screen it does
 * not test `canEdit` itself — the whole `settings` route is already RequireAdmin.
 */
export default function PipelineViewersSection() {
  const s = useHrStore();

  /**
   * `null` means "still following the saved list"; an array means the admin has
   * edited it.
   *
   * ⚠ NOT `useState(s.pipelineViewerIds)`, which is the obvious spelling and is
   *   WRONG HERE — and dangerously so. useState captures its argument ONCE, on
   *   mount, and the store loads asynchronously. Open Setup and click this tab
   *   before the fetch lands and the picker initialises EMPTY while the saved list
   *   has people on it; pressing Save then writes `[]` and silently revokes
   *   everybody's access to every candidate. Following the store until the first
   *   edit means the control cannot show a list the database does not have.
   */
  const [edited, setEdited] = useState<string[] | null>(null);
  const picked = edited ?? s.pipelineViewerIds;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * Sourced from the ORG-WIDE roster, not `s.profiles`.
   *
   * `profiles` is RLS-scoped to self + downline + same-department peers (see the note
   * in lib/interviewers.ts), so a Director in another department would simply not be
   * offered — and this is precisely a list of Directors. `orgPeople` is the same
   * roster the interview pickers use.
   */
  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.orgPeople]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => {
          const base = p.designation ? `${p.name} · ${p.designation}` : p.name;
          // Same wording the interviewer pickers use, so "no access" reads the same
          // way wherever this module says it.
          return {
            value: p.id,
            label: s.moduleUserIds.has(p.id) ? base : `${base} · no access to this module`,
          };
        }),
    [s.orgPeople, s.moduleUserIds],
  );

  /** Anyone picked who cannot open New Recruitment at all — named, so we can warn. */
  const cannotOpen = useMemo(
    () =>
      s.orgPeople
        .filter((p) => picked.includes(p.id) && !s.moduleUserIds.has(p.id))
        .map((p) => p.name),
    [picked, s.orgPeople, s.moduleUserIds],
  );

  const dirty = useMemo(() => {
    const a = [...picked].sort().join(",");
    const b = [...s.pipelineViewerIds].sort().join(",");
    return a !== b;
  }, [picked, s.pipelineViewerIds]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      if (dirty) await s.setPipelineViewers(picked);
      // Fall back in behind the store, so the refetched list is what is shown.
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
        <FieldLabel
          label="Pipeline dashboard access"
          hint="read every position's pipeline — and every candidate on it"
        >
          <MultiSelect
            values={picked}
            onChange={(v) => {
              setEdited(v);
              setSaved(false);
            }}
            options={peopleOptions}
            placeholder="Select who may see every pipeline"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            This is a <strong className="font-semibold text-navy">data grant, not a display setting</strong>.
            Everyone listed here can read every candidate on every vacancy — name, phone, email, expected
            salary and CV — whether or not they work on that vacancy. It is enforced in the database, so
            removing somebody here genuinely takes the access away.
          </span>
          <span className="mt-1.5 block text-[11px] leading-snug text-grey-2">
            They also need <strong className="font-semibold text-navy">New Recruitment at “Edit”</strong> in
            the Users screen. Without it they cannot open the app; with “View only” they see the vacancies
            but not the candidates, and can press nothing.
          </span>
        </FieldLabel>

        {cannotOpen.length > 0 && (
          <p className="rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
            <strong className="font-semibold">
              {cannotOpen.length === 1 ? "This person cannot" : "These people cannot"} open New Recruitment:
            </strong>{" "}
            {cannotOpen.join(", ")}. Saving grants the candidate data, but they will still land on Access
            Denied until someone gives them the module in the Users screen.
          </p>
        )}

        <div className="flex items-center gap-3">
          {/* Disabled while the store is still loading: nothing may be saved from a
              control that has not yet seen what is saved. */}
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
