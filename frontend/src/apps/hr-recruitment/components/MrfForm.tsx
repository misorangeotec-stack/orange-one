import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useHrStore } from "../store";
import type { MrfInput } from "../data/hrWrites";
import type { Requisition } from "../types";

/**
 * The Manpower Requisition form — sheet columns A–V, plus an optional JD file.
 *
 * Two fields here are deliberately not what you'd guess from the column headers,
 * because the live sheet rows break the obvious model:
 *
 *  • Hiring Manager / Reporting To are MULTI-SELECTS with a free-text fallback.
 *    Real rows say "Ritesh Tulsyan & Dimple" and "Rakesh, Vikas and manmohan ji".
 *    A single-person picker would silently drop someone.
 *
 *  • Salary is a free-text note PLUS an optional numeric range. Real rows say
 *    "If fresh (Zero to two years) 15000/-" and "20 to 25K", which no number field
 *    can hold. The note is what HR reads; the numbers exist only so an offer can be
 *    flagged as over-range later, and are optional.
 *
 * Whoever raises this becomes the requisition's hiring manager by default, and
 * that is what routes every later HOD step (shortlisting, Round 2, the monthly
 * reviews) back to them.
 */
export default function MrfForm({
  existing,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  existing?: Requisition;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (input: MrfInput) => void;
  onCancel: () => void;
}) {
  const s = useHrStore();

  const [jobTitle, setJobTitle] = useState(existing?.jobTitle ?? "");
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? "");
  const [locationId, setLocationId] = useState(existing?.locationId ?? "");
  const [jobTypeId, setJobTypeId] = useState(existing?.jobTypeId ?? "");
  const [hiringManagerIds, setHiringManagerIds] = useState<string[]>(existing?.hiringManagerIds ?? []);
  const [reportingToIds, setReportingToIds] = useState<string[]>(existing?.reportingToIds ?? []);
  const [reportingToNote, setReportingToNote] = useState(existing?.reportingToNote ?? "");
  const [positionKind, setPositionKind] = useState<"new" | "replacement">(existing?.positionKind ?? "new");
  const [previousEmployeeName, setPreviousEmployeeName] = useState(existing?.previousEmployeeName ?? "");
  const [expectedStartDate, setExpectedStartDate] = useState(existing?.expectedStartDate ?? "");
  const [positionsRequired, setPositionsRequired] = useState(String(existing?.positionsRequired ?? 1));
  const [salaryNote, setSalaryNote] = useState(existing?.salaryNote ?? "");
  const [salaryMin, setSalaryMin] = useState(existing?.salaryMin !== null && existing?.salaryMin !== undefined ? String(existing.salaryMin) : "");
  const [salaryMax, setSalaryMax] = useState(existing?.salaryMax !== null && existing?.salaryMax !== undefined ? String(existing.salaryMax) : "");
  const [whyNeeded, setWhyNeeded] = useState(existing?.whyNeeded ?? "");
  const [businessContribution, setBusinessContribution] = useState(existing?.businessContribution ?? "");
  const [impactIfUnfilled, setImpactIfUnfilled] = useState(existing?.impactIfUnfilled ?? "");
  const [keyResponsibilities, setKeyResponsibilities] = useState(existing?.keyResponsibilities ?? "");
  const [requiredSkills, setRequiredSkills] = useState(existing?.requiredSkills ?? "");
  const [preferredExperience, setPreferredExperience] = useState(existing?.preferredExperience ?? "");

  const people: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );
  const deptOptions: ComboOption[] = useMemo(
    () => s.departments.map((d) => ({ value: d.id, label: d.name })),
    [s.departments],
  );
  const locOptions: ComboOption[] = useMemo(
    () => s.locations.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
    [s.locations],
  );
  const typeOptions: ComboOption[] = useMemo(
    () => s.jobTypes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })),
    [s.jobTypes],
  );

  const replacement = positionKind === "replacement";

  const invalid =
    !jobTitle.trim() || !departmentId || (replacement && !previousEmployeeName.trim());

  const num = (v: string): number | null => {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return v.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  const submit = () => {
    onSubmit({
      jobTitle: jobTitle.trim(),
      departmentId,
      locationId: locationId || null,
      jobTypeId: jobTypeId || null,
      hiringManagerIds,
      reportingToIds,
      reportingToNote: reportingToNote.trim() || null,
      positionKind,
      previousEmployeeName: replacement ? previousEmployeeName.trim() : null,
      expectedStartDate: expectedStartDate || null,
      positionsRequired: Math.max(1, Math.floor(Number(positionsRequired) || 1)),
      salaryMin: num(salaryMin),
      salaryMax: num(salaryMax),
      salaryNote: salaryNote.trim() || null,
      whyNeeded: whyNeeded.trim() || null,
      businessContribution: businessContribution.trim() || null,
      impactIfUnfilled: impactIfUnfilled.trim() || null,
      keyResponsibilities: keyResponsibilities.trim() || null,
      requiredSkills: requiredSkills.trim() || null,
      preferredExperience: preferredExperience.trim() || null,
      jdPath: existing?.jdPath ?? null,
      jdName: existing?.jdName ?? null,
    });
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {/* ---- The role ---- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-navy">The role</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Job title / position open" required>
            <TextInput value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Chemist" />
          </FieldLabel>
          <FieldLabel label="Department" required>
            <Combobox value={departmentId} onChange={setDepartmentId} options={deptOptions} placeholder="Select department" searchable />
          </FieldLabel>
          <FieldLabel label="Location">
            <Combobox value={locationId} onChange={setLocationId} options={locOptions} placeholder="Select location" />
          </FieldLabel>
          <FieldLabel label="Job type">
            <Combobox value={jobTypeId} onChange={setJobTypeId} options={typeOptions} placeholder="Select job type" />
          </FieldLabel>
          <FieldLabel label="Number of positions required" required>
            <TextInput
              type="number"
              min={1}
              value={positionsRequired}
              onChange={(e) => setPositionsRequired(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label="Expected start date">
            <TextInput type="date" value={expectedStartDate} onChange={(e) => setExpectedStartDate(e.target.value)} />
          </FieldLabel>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Is this a new position or a replacement?" required>
            <div className="flex gap-2">
              {(["new", "replacement"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPositionKind(k)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-[13.5px] font-medium transition ${
                    positionKind === k
                      ? "border-orange bg-orange/5 text-navy"
                      : "border-line text-grey-2 hover:border-grey-2/40"
                  }`}
                >
                  {k === "new" ? "New position" : "Replacement"}
                </button>
              ))}
            </div>
          </FieldLabel>
          {replacement && (
            <FieldLabel label="Name of the previous employee" required>
              <TextInput
                value={previousEmployeeName}
                onChange={(e) => setPreviousEmployeeName(e.target.value)}
                placeholder="Who is being replaced?"
              />
            </FieldLabel>
          )}
        </div>
      </Card>

      {/* ---- People ---- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-navy">People</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Hiring manager" hint="can be more than one">
            <MultiSelect
              values={hiringManagerIds}
              onChange={setHiringManagerIds}
              options={people}
              placeholder="Defaults to you"
            />
            <span className="mt-1 block text-[11px] leading-snug text-grey-2">
              Leave empty and it's you. The hiring manager shortlists this requisition's CVs, takes Interview Round 2,
              and does the new hire's monthly reviews.
            </span>
          </FieldLabel>
          <FieldLabel label="Reporting to" hint="can be more than one">
            <MultiSelect
              values={reportingToIds}
              onChange={setReportingToIds}
              options={people}
              placeholder="Select people"
            />
            <TextInput
              className="mt-2"
              value={reportingToNote}
              onChange={(e) => setReportingToNote(e.target.value)}
              placeholder="Or type it, if they're not in the portal"
            />
          </FieldLabel>
        </div>
      </Card>

      {/* ---- Salary ---- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-navy">Salary</h2>
        <FieldLabel label="Salary range" hint="write it however you like">
          <TextInput
            value={salaryNote}
            onChange={(e) => setSalaryNote(e.target.value)}
            placeholder="e.g. 20 to 25K, or: If fresh (Zero to two years) 15000/-"
          />
        </FieldLabel>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Minimum (₹/month)" hint="optional">
            <TextInput inputMode="decimal" value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} placeholder="15000" />
          </FieldLabel>
          <FieldLabel label="Maximum (₹/month)" hint="optional">
            <TextInput inputMode="decimal" value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} placeholder="25000" />
          </FieldLabel>
        </div>
        <p className="text-[11.5px] text-grey-2">
          The numbers are optional and are used only to flag an offer that lands above the range. What you type above is
          what everyone reads.
        </p>
      </Card>

      {/* ---- Justification ---- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-navy">Why this position is needed</h2>
        <FieldLabel label="Why is this position needed?">
          <TextArea rows={2} value={whyNeeded} onChange={(e) => setWhyNeeded(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="How will this role contribute to business objectives?">
          <TextArea rows={2} value={businessContribution} onChange={(e) => setBusinessContribution(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="What will be the impact if the position is not filled?">
          <TextArea rows={2} value={impactIfUnfilled} onChange={(e) => setImpactIfUnfilled(e.target.value)} />
        </FieldLabel>
      </Card>

      {/* ---- The person ---- */}
      <Card className="p-5 space-y-4">
        <h2 className="text-[15px] font-semibold text-navy">Who you're looking for</h2>
        <FieldLabel label="Key responsibilities">
          <TextArea rows={3} value={keyResponsibilities} onChange={(e) => setKeyResponsibilities(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Required skills and qualifications">
          <TextArea rows={2} value={requiredSkills} onChange={(e) => setRequiredSkills(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Preferred experience">
          <TextArea rows={2} value={preferredExperience} onChange={(e) => setPreferredExperience(e.target.value)} />
        </FieldLabel>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={busy || invalid}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {invalid && (
          <span className="text-[12.5px] text-grey-2">
            {!jobTitle.trim()
              ? "A job title is required."
              : !departmentId
                ? "Pick a department."
                : "Name the employee being replaced."}
          </span>
        )}
        {error && <span className="text-[12.5px] text-ryg-red">{error}</span>}
      </div>
    </div>
  );
}
