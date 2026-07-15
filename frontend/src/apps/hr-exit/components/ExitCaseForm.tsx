import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import RequestMasterModal from "./RequestMasterModal";
import { useExitStore } from "../store";
import { CASE_TYPE_LABEL } from "../lib/format";
import type { CaseInput } from "../data/exitWrites";
import type { CaseType, ExitCase } from "../types";

/**
 * The exit case form — "who is leaving, and why".
 *
 * ── THE EMPLOYEE IS A **SNAPSHOT**, NOT A FOREIGN KEY ────────────────────────
 * There is no employee master in this portal (and `departments` has no HOD column),
 * so the case CAPTURES the person: code, name, department, designation, joining date.
 * The link to a `profiles` row is OPTIONAL, because plenty of staff have no login —
 * and those are exactly the people HR most often has to raise an exit for. They get
 * no notifications; HR mails them out-of-band.
 *
 * ── WHO MAY RAISE FOR WHOM (mirrors fms_exit_raise_case) ─────────────────────
 * Everyone may raise their OWN. Raising for SOMEONE ELSE is allowed only if you are
 * HR / a coordinator / an admin — or if you name YOURSELF among the reporting
 * managers, i.e. you actually manage them (the absconding / termination path). The
 * RPC re-checks both; this form just refuses to offer a button the database rejects.
 *
 * `reportingManagerIds` is the single most load-bearing field here: it is what routes
 * every MANAGER step (the review, the asset sign-off, the handover) to a real person.
 * Self-raising prefills it from the portal's own reporting links (`user_hods`).
 */
export default function ExitCaseForm({
  existing,
  busy,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  existing?: ExitCase;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  /** `letter` is uploaded AFTER the case exists — the storage policy keys on its id. */
  onSubmit: (input: CaseInput, letter: File | null) => void;
  onCancel: () => void;
}) {
  const s = useExitStore();
  const { user } = useEffectiveIdentity();
  const me = s.profileById(user.id);

  /** HR / coordinator / admin may raise for anyone. Everyone else needs to manage them. */
  const canRaiseOnBehalf = s.isAdmin || s.isProcessCoordinator || s.isExitStaff;

  const [forSelf, setForSelf] = useState(existing ? existing.employeeUserId === user.id : true);

  const [caseType, setCaseType] = useState<CaseType>(existing?.caseType ?? "resignation");
  const [employeeUserId, setEmployeeUserId] = useState(existing?.employeeUserId ?? user.id);
  const [employeeCode, setEmployeeCode] = useState(existing?.employeeCode ?? "");
  const [employeeName, setEmployeeName] = useState(existing?.employeeName ?? user.name);
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? me?.departmentId ?? "");
  const [designation, setDesignation] = useState(existing?.designation ?? me?.designation ?? "");
  const [dateOfJoining, setDateOfJoining] = useState(existing?.dateOfJoining ?? "");
  const [reportingManagerIds, setReportingManagerIds] = useState<string[]>(
    existing?.reportingManagerIds ?? me?.hodIds ?? [],
  );
  const [reportingManagerNote, setReportingManagerNote] = useState(existing?.reportingManagerNote ?? "");
  const [reasonId, setReasonId] = useState(existing?.reasonId ?? "");
  const [reasonNote, setReasonNote] = useState(existing?.reasonNote ?? "");
  const [letter, setLetter] = useState<File | null>(null);

  // "My reason isn't on the list." Opened from the Reason dropdown's own create row,
  // prefilled with whatever they typed. It cannot select the new reason immediately —
  // there IS no reason yet, only a request for one — so the modal says who it went to.
  const [requestingReason, setRequestingReason] = useState<string | null>(null);

  const people: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );
  const peopleCombo: ComboOption[] = useMemo(() => people.map((p) => ({ value: p.value, label: p.label })), [people]);
  const deptOptions: ComboOption[] = useMemo(
    () => s.departments.map((d) => ({ value: d.id, label: d.name })),
    [s.departments],
  );
  const reasonOptions: ComboOption[] = useMemo(
    () => s.reasons.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name })),
    [s.reasons],
  );

  /** Switching the subject re-seeds the snapshot from whoever is now named. */
  const pickEmployee = (uid: string) => {
    setEmployeeUserId(uid);
    const p = s.profileById(uid);
    if (!p) return;
    setEmployeeName(p.name);
    setDesignation(p.designation ?? "");
    if (p.departmentId) setDepartmentId(p.departmentId);
    if (p.hodIds.length) setReportingManagerIds(p.hodIds);
  };

  const setMode = (self: boolean) => {
    setForSelf(self);
    if (self) {
      pickEmployee(user.id);
      setEmployeeName(user.name);
    } else {
      setEmployeeUserId("");
      setEmployeeName("");
      setDesignation("");
      setReportingManagerIds([]);
    }
  };

  // Exactly the rule fms_exit_raise_case enforces — no more, no less.
  const notAllowedForOther =
    !forSelf && !canRaiseOnBehalf && !reportingManagerIds.includes(user.id);
  const selfServiceOff = forSelf && !s.policy.allowSelfService && !canRaiseOnBehalf;

  const invalid =
    !employeeCode.trim() ||
    !employeeName.trim() ||
    !departmentId ||
    reportingManagerIds.length === 0 ||
    notAllowedForOther ||
    selfServiceOff;

  const submit = () => {
    onSubmit(
      {
        caseType,
        employeeUserId: employeeUserId || null,
        employeeCode: employeeCode.trim(),
        employeeName: employeeName.trim(),
        departmentId,
        designation: designation.trim() || null,
        dateOfJoining: dateOfJoining || null,
        reportingManagerIds,
        reportingManagerNote: reportingManagerNote.trim() || null,
        reasonId: reasonId || null,
        reasonNote: reasonNote.trim() || null,
        resignationLetterPath: null,
        resignationLetterName: null,
      },
      letter,
    );
  };

  const types: CaseType[] = ["resignation", "termination", "retirement", "absconding", "end_of_contract"];

  return (
    <div className="max-w-4xl space-y-5">
      {/* ---- Who is leaving ---- */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">Who is leaving</h2>

        {!existing && (
          <div className="flex gap-2">
            {[
              { self: true, label: "It's me" },
              { self: false, label: "Someone else" },
            ].map((o) => (
              <button
                key={String(o.self)}
                type="button"
                onClick={() => setMode(o.self)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-[13.5px] font-medium transition ${
                  forSelf === o.self
                    ? "border-orange bg-orange/5 text-navy"
                    : "border-line text-grey-2 hover:border-grey-2/40"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {!forSelf && (
          <FieldLabel label="The employee" hint="leave blank if they have no portal login">
            <Combobox
              value={employeeUserId}
              onChange={pickEmployee}
              options={peopleCombo}
              placeholder="Search for the person"
              searchable
            />
            <span className="mt-1 block text-[11px] leading-snug text-grey-2">
              Plenty of staff have no login. Leave this empty and type their details below — they simply get
              no portal notifications, and HR contacts them directly.
            </span>
          </FieldLabel>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Employee code" required>
            <TextInput
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="e.g. OOT-0412"
            />
          </FieldLabel>
          <FieldLabel label="Employee name" required>
            <TextInput
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              disabled={forSelf}
            />
          </FieldLabel>
          <FieldLabel label="Department" required>
            <Combobox
              value={departmentId}
              onChange={setDepartmentId}
              options={deptOptions}
              placeholder="Select department"
              searchable
            />
          </FieldLabel>
          <FieldLabel label="Designation">
            <TextInput value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Date of joining">
            <TextInput type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Type of exit" required>
            <Combobox
              value={caseType}
              onChange={(v) => setCaseType(v as CaseType)}
              options={types.map((t) => ({ value: t, label: CASE_TYPE_LABEL[t] }))}
              placeholder="Resignation"
            />
          </FieldLabel>
        </div>
      </Card>

      {/* ---- Reporting manager ---- */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">Reporting manager</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Reporting manager(s)" required hint="can be more than one">
            <MultiSelect
              values={reportingManagerIds}
              onChange={setReportingManagerIds}
              options={people}
              placeholder="Select the manager"
              searchable
            />
            <span className="mt-1 block text-[11px] leading-snug text-grey-2">
              This is what routes the review, the asset sign-off and the handover to a real person. Without it,
              nobody is asked for anything.
            </span>
          </FieldLabel>
          <FieldLabel label="Or type it" hint="if they're not in the portal">
            <TextInput
              value={reportingManagerNote}
              onChange={(e) => setReportingManagerNote(e.target.value)}
              placeholder="A name we can put on the record"
            />
          </FieldLabel>
        </div>
      </Card>

      {/* ---- Why ---- */}
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-navy">Why</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Reason">
            <Combobox
              value={reasonId}
              onChange={setReasonId}
              options={reasonOptions}
              placeholder="Select a reason"
              // The requester cannot create a master — they can ASK for one. `onCreate`
              // returns nothing, so nothing is selected: the reason does not exist yet.
              onCreate={(label) => {
                setRequestingReason(label);
              }}
              createLabel={(q) => `Request “${q}” as a new reason`}
            />
          </FieldLabel>
          <FieldLabel label="Resignation letter" hint="optional · pdf, image or doc">
            <input
              type="file"
              onChange={(e) => setLetter(e.target.files?.[0] ?? null)}
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-navy"
            />
          </FieldLabel>
        </div>
        <FieldLabel label="Anything worth recording">
          <TextArea rows={3} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
        </FieldLabel>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={busy || invalid}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {invalid && (
          <span className="text-[12.5px] text-grey-2">
            {selfServiceOff
              ? "Self-service resignations are switched off. Speak to HR."
              : notAllowedForOther
                ? "You can only raise an exit for someone you manage — add yourself to Reporting manager(s)."
                : !employeeCode.trim()
                  ? "An employee code is required."
                  : !employeeName.trim()
                    ? "An employee name is required."
                    : !departmentId
                      ? "Pick a department."
                      : "Name at least one reporting manager."}
          </span>
        )}
        {error && <span className="text-[12.5px] text-ryg-red">{error}</span>}
      </div>

      {/* The reason they could not find, sent to the Exit Reasons owner for review.
          The case can still be raised meanwhile — `reasonId` is nullable, and
          `reasonNote` is free text, so nobody is blocked on a master. */}
      <RequestMasterModal
        open={requestingReason !== null}
        onClose={() => setRequestingReason(null)}
        masterType="reason"
        lockType
        prefill={{ name: requestingReason ?? "" }}
      />
    </div>
  );
}
