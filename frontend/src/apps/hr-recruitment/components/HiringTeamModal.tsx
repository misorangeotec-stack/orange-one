import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { personOptions } from "../lib/people";
import { useHrStore } from "../store";
import type { HiringManagerPreviewRow } from "../data/hrWrites";
import type { Requisition } from "../types";

/**
 * Change who acts as the HOD on a position — NR-3's "after the fact" path.
 *
 * ⚠ THIS IS A PII GRANT, NOT AN ASSIGNMENT. Whoever is named here can read every
 * candidate on this vacancy: names, phone numbers, expected salary and CVs. The panel
 * below says so, and says who loses it.
 *
 * Rendered from BOTH the position header and the MRF page, and both go through
 * `s.setHiringManagers` → `fms_hr_set_hiring_managers`. Nothing writes the column
 * directly; two writers of one column is how they drift.
 *
 * The preview is computed SERVER-SIDE and is not guessable here. Dropping somebody
 * from the array does not necessarily revoke their read — they may still be a process
 * coordinator, recruitment staff, a pipeline viewer, named on reporting-to, holding a
 * step, or booked on an interview — and the CV bucket answers to a different policy
 * again. A dialog that guessed would confidently tell somebody their access was safe
 * while the write took it away.
 */
export default function HiringTeamModal({
  requisition,
  open,
  onClose,
}: {
  requisition: Requisition;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();

  const [ids, setIds] = useState<string[]>(requisition.hiringManagerIds);
  const [reportingTo, setReportingTo] = useState<string[]>(requisition.reportingToIds);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [preview, setPreview] = useState<HiringManagerPreviewRow[]>([]);
  const [previewing, setPreviewing] = useState(false);

  const people: MultiOption[] = useMemo(
    () => personOptions(s.orgPeople, s.moduleUserIds, s.moduleEditUserIds),
    [s.orgPeople, s.moduleUserIds, s.moduleEditUserIds],
  );

  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const dirty =
    !sameSet(ids, requisition.hiringManagerIds) || !sameSet(reportingTo, requisition.reportingToIds);

  /**
   * Ask the server who gains and who loses, on every change of the two pickers.
   *
   * `cancelled` guards against an out-of-order reply overwriting a newer one — the
   * lists are small, so a stale answer would land rarely and be wrong loudly.
   */
  useEffect(() => {
    if (!open || ids.length === 0) {
      setPreview([]);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    s.previewHiringManagers(requisition.id, ids, reportingTo)
      .then((rows) => {
        if (!cancelled) setPreview(rows);
      })
      .catch(() => {
        if (!cancelled) setPreview([]);
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requisition.id, ids.join(","), reportingTo.join(",")]);

  const added = preview.filter((p) => p.direction === "added");
  const removed = preview.filter((p) => p.direction === "removed");
  /** Losing the array AND every other route in — the only people who really lose the pipeline. */
  const losesRead = removed.filter((p) => !p.retainsRead);
  /** Gaining the candidates but landing on a blank CV panel, which nothing else would say. */
  const blankCvs = added.filter((p) => !p.seesCvs);
  const cannotOpen = added.filter((p) => !p.hasModule);
  const viewOnly = added.filter((p) => p.hasModule && !p.canEditModule);
  const clearedSteps = removed.flatMap((p) =>
    p.losesStepAssignees.map((k) => `${k} (${p.name})`),
  );

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.setHiringManagers({
        requisition,
        ids,
        note: note.trim() || null,
        reportingTo,
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hiring team"
      subtitle={`${requisition.mrfNo} · ${requisition.jobTitle}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !dirty || ids.length === 0}>
            {busy ? "Saving…" : "Save the hiring team"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <FieldLabel label="Which HOD owns this vacancy?" required hint="can be more than one">
          <MultiSelect
            values={ids}
            onChange={setIds}
            options={people}
            placeholder="Search anyone in the company"
          />
          <span className="mt-1 block text-[11px] leading-snug text-grey-2">
            They shortlist this requisition's CVs, take Interview Round 2 and do the new hire's monthly
            reviews. Naming somebody here <strong className="font-semibold text-navy">lets them read every
            candidate on this vacancy</strong> — name, phone, email, expected salary and CV. It is enforced
            in the database, so removing them genuinely takes it away.
          </span>
        </FieldLabel>

        {ids.length === 0 && (
          <p className="rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
            <strong className="font-semibold">Pick at least one person.</strong> With nobody named, HOD
            shortlist, Round 2 and all four probation reviews on this vacancy would be owned by nobody but
            admins and process coordinators.
          </p>
        )}

        <FieldLabel label="Who will they report to?" hint="the day-to-day manager — optional">
          <MultiSelect
            values={reportingTo}
            onChange={setReportingTo}
            options={people}
            placeholder="Select people"
          />
        </FieldLabel>

        <FieldLabel label="Why is it changing?" hint="optional — it goes on the position's history">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Handing Supply Chain hiring to Gorakh"
          />
        </FieldLabel>

        {/* ---- What this write will actually do, before it does it ---- */}
        {dirty && ids.length > 0 && (
          <div className="rounded-xl border border-line bg-page/60 p-3">
            <p className="text-[12px] font-semibold text-navy">
              {previewing ? "Working out what changes…" : "What this changes"}
            </p>

            {!previewing && (
              <ul className="mt-1.5 space-y-1 text-[12px] leading-snug text-grey-2">
                {added.map((p) => (
                  <li key={`a-${p.id}`}>
                    <strong className="font-semibold text-ryg-green">Gains access</strong> · {p.name}
                    {p.department ? ` · ${p.department}` : ""}
                  </li>
                ))}
                {removed.map((p) => (
                  <li key={`r-${p.id}`}>
                    <strong className="font-semibold text-navy">
                      {p.retainsRead ? "Steps back" : "Loses access"}
                    </strong>{" "}
                    · {p.name}
                    {p.retainsRead && " — but keeps the candidates through another route, so nothing is withdrawn"}
                  </li>
                ))}
                {added.length === 0 && removed.length === 0 && <li>Nobody gains or loses access.</li>}
              </ul>
            )}

            {!previewing && losesRead.length > 0 && (
              <p className="mt-2 rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
                <strong className="font-semibold">
                  {losesRead.length === 1 ? "This person loses" : "These people lose"} the candidates on this
                  vacancy:
                </strong>{" "}
                {losesRead.map((p) => p.name).join(", ")}. If they are mid-review, the pipeline they were
                looking at will be gone when they refresh.
              </p>
            )}

            {!previewing && cannotOpen.length > 0 && (
              <p className="mt-2 rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
                <strong className="font-semibold">
                  {cannotOpen.length === 1 ? "This person cannot" : "These people cannot"} open New
                  Recruitment:
                </strong>{" "}
                {cannotOpen.map((p) => p.name).join(", ")}. The mapping still saves and is still correct, but
                they will land on Access Denied until someone gives them the module in the Users screen.
              </p>
            )}

            {!previewing && viewOnly.length > 0 && (
              <p className="mt-2 rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
                <strong className="font-semibold">Read-only:</strong> {viewOnly.map((p) => p.name).join(", ")}{" "}
                {viewOnly.length === 1 ? "holds" : "hold"} New Recruitment at “View only”, so they will see
                this vacancy and be able to press nothing. It needs to be “Edit” in the Users screen.
              </p>
            )}

            {/* The CV bucket has its own policy and does NOT consult the read gate, so
                this cannot be inferred from "gains access" — the candidate rows arrive
                and the resume panel is simply blank, with no error. */}
            {!previewing && blankCvs.length > 0 && (
              <p className="mt-2 rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
                <strong className="font-semibold">No CVs:</strong> {blankCvs.map((p) => p.name).join(", ")}{" "}
                {blankCvs.length === 1 ? "gets" : "get"} the candidates but an empty resume panel — the CV
                store answers to a separate rule, and they own no step anywhere. Give them a step in Setup →
                Step Owners if they need to read CVs.
              </p>
            )}

            {!previewing && clearedSteps.length > 0 && (
              <p className="mt-2 rounded-lg bg-orange-soft px-3 py-2 text-[12px] leading-snug text-navy">
                <strong className="font-semibold">Handed-over steps that will be cleared:</strong>{" "}
                {clearedSteps.join(", ")}. They point at a head who is leaving this vacancy. Steps handed to
                anyone else are left exactly as they are.
              </p>
            )}
          </div>
        )}

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      </div>
    </Modal>
  );
}
