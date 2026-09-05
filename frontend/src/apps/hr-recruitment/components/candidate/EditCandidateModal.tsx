import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useHrStore } from "../../store";
import type { Candidate } from "../../types";

/**
 * Correct the details we hold on a person.
 *
 * Until NR-5 there was no way to. Names were taken from whatever the CV parser
 * returned, and where it failed the filename was used — which is how the live
 * data ended up holding "Purvi Upadhyay   EA" and "CV   CA Vandit Mehta" as
 * people's names, and how 30 of 119 rows have neither an email nor a phone. Those
 * are the same missing signals that let FIX-5's duplicates through, so this form
 * is also how the duplicate check gets something to work with.
 *
 * ⚠ THE CV IS NOT ON THIS FORM, and that is the point.
 *
 *   `fms_hr_update_candidate` rewrites every column from the payload, and
 *   `candidatePayload` maps `resumePath ?? ""`. Since NR-5 an empty string CLEARS
 *   — so had the resume columns stayed in that statement, every save of this form
 *   would have deleted the person's CV. The RPC no longer writes them at all; the
 *   document has its own Replace/Remove on the Documents tab, through
 *   `fms_hr_set_candidate_resume`.
 *
 *   `resumeSha256` is still SENT, because the duplicate guard reads it — it just
 *   is not stored from here.
 *
 * Every field is submitted, not just the changed ones: the RPC writes the whole
 * row, so an omitted `experienceYears` or `sourcePlatformId` would be nulled.
 */
export default function EditCandidateModal({
  candidate: c,
  open,
  onClose,
}: {
  candidate: Candidate;
  open: boolean;
  onClose: () => void;
}) {
  const s = useHrStore();

  const [name, setName] = useState(c.name);
  const [phone, setPhone] = useState(c.phone ?? "");
  const [email, setEmail] = useState(c.email ?? "");
  const [company, setCompany] = useState(c.currentCompany ?? "");
  const [years, setYears] = useState(c.experienceYears === null ? "" : String(c.experienceYears));
  // ONE PER LINE, not comma-separated. A skill routinely contains a comma —
  // "Payroll, PF & ESIC" is a real value on live data — so splitting on "," turned
  // one skill into two on the first save. Newlines cannot appear inside a value.
  const [skills, setSkills] = useState(c.skills.join("\n"));
  const [notes, setNotes] = useState(c.notes ?? "");
  const [platform, setPlatform] = useState(c.sourcePlatformId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const platformOptions: ComboOption[] = s.jobPlatforms.map((p) => ({ value: p.id, label: p.name }));

  const trimmedName = name.trim();
  const yearsNum = years.trim() === "" ? null : Number(years);
  const yearsBad = yearsNum !== null && (Number.isNaN(yearsNum) || yearsNum < 0);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.updateCandidate(c.id, {
        name: trimmedName,
        phone: phone.trim() || null,
        email: email.trim() || null,
        currentCompany: company.trim() || null,
        experienceYears: yearsNum,
        skills: skills
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
        notes: notes.trim() || null,
        sourcePlatformId: platform || null,
        // Carried, not edited. The RPC ignores the first two entirely and reads the
        // hash only to run the duplicate check on the same signals it would at
        // upload time — leaving it out would quietly weaken that check.
        resumePath: c.resumePath,
        resumeName: c.resumeName,
        resumeSha256: c.resumeSha256,
        duplicateAck: null,
        parseStatus: c.parseStatus,
        parsedJson: c.parsedJson,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save those details");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Edit candidate details"
      subtitle={c.candidateNo ?? undefined}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || !trimmedName || yearsBad}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            {err}
          </p>
        )}

        <FieldLabel label="Name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </FieldLabel>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel
            label="Phone"
            hint="one of the five signals the duplicate check reads"
          >
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Email" hint="likewise">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FieldLabel>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Current company">
            <TextInput value={company} onChange={(e) => setCompany(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Experience (years)">
            <TextInput
              inputMode="decimal"
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
            {yearsBad && <p className="mt-1 text-[12px] text-red-600">That is not a number of years.</p>}
          </FieldLabel>
        </div>

        <FieldLabel label="Where they came from">
          <Combobox
            options={platformOptions}
            value={platform}
            onChange={setPlatform}
            placeholder="Job platform"
            clearable
          />
        </FieldLabel>

        <FieldLabel label="Skills" hint="one per line">
          <TextArea rows={4} value={skills} onChange={(e) => setSkills(e.target.value)} />
        </FieldLabel>

        <FieldLabel label="Notes">
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FieldLabel>

        <p className="rounded-lg border border-line bg-paper px-3 py-2 text-[12px] text-grey-2">
          The CV is not edited here — it has its own Replace and Remove on the Documents tab, so
          correcting a typo can never disturb the document.
        </p>
      </div>
    </Modal>
  );
}
