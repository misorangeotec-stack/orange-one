import { useEffect, useMemo, useRef, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import DraftBar from "@/shared/components/ui/DraftBar";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useStepDraft } from "@/shared/lib/useStepDraft";
import { cn } from "@/shared/lib/cn";
import BulletList, { bulletsFromText, bulletsToText } from "./BulletList";
import JdProgress from "./JdProgress";
import RequestMasterModal from "./RequestMasterModal";
import { masterTypeLabel, type MasterValues } from "../lib/masterFields";
import { jobTitleOptions, qualificationOptions, skillOptions } from "../lib/jd";
import { parseJd, type ParsedJd } from "../data/parseJd";
import { useHrStore } from "../store";
import type { MrfInput } from "../data/hrWrites";
import {
  hasJdTemplate,
  type HrMasterType,
  type Requisition,
  type SalaryPeriod,
  type SalaryStructure,
} from "../types";

/**
 * The Manpower Requisition form — step 1 of the FMS, and a full job description.
 *
 * WHO FILLS THIS IN, AND WHAT THAT COSTS
 * A HOD, a few times a year. Not an HR specialist, not someone who will learn the
 * form. So the JD had to get richer without the form getting longer, and every
 * decision below serves that:
 *
 *  • THE JD YOU ALREADY HAVE FILLS THE FORM. The attach box is the FIRST thing on
 *    step 1, not a step-3 afterthought, because auto-fill only saves work if it
 *    happens before the work. A JD spans all three steps (title and department,
 *    salary, responsibilities and skills), so there is no step it belongs to — it
 *    belongs before all of them. One action, two effects: it prefills the form and
 *    becomes the requisition's attached JD.
 *
 *  • THE JOB TITLE WRITES THE REST. Titles come from a master that can carry a
 *    template (summary, responsibilities, experience, skills, qualifications,
 *    employment type, department). Pick "Service Engineer - Digital Printer" and
 *    step 3 arrives already written — review and tweak, not author.
 *
 *    PRECEDENCE, and it composes rather than fights: anything the HOD typed wins,
 *    then the JD (specific to this vacancy), then the title's template (generic,
 *    fills only what the JD didn't yield). `touched` and `jdFilled` are what
 *    enforce that — see `isTouched`.
 *
 *  • TWO SKILL PICKERS, NOT FIVE. Technical / tools / soft / language /
 *    certification are GROUPS INSIDE one "must-have" list and one "good to have"
 *    list. The taxonomy survives in the data; the screen shows two dropdowns.
 *
 *  • FOUR REQUIRED FIELDS in the whole form (title, department, headcount, and
 *    the replacement's name when it is one). Step 3 is optional in its entirety
 *    and says so.
 *
 *  • NOTHING IS LOST. The whole form drafts to localStorage; close the tab and it
 *    comes back with a restore bar.
 *
 * Two fields are deliberately not what the sheet columns suggest, and both
 * predate this rebuild:
 *
 *  • Hiring Manager / Reporting To are MULTI-SELECTS with a free-text fallback.
 *    Real sheet rows say "Ritesh Tulsyan & Dimple". A single-person picker would
 *    silently drop someone.
 *
 *  • Salary is a MIN and a MAX. A "fixed" salary writes both to the same number,
 *    which is what keeps the over-range warning on an offer working unchanged.
 *
 * Whoever raises this becomes the requisition's hiring manager by default, and
 * that is what routes every later HOD step (shortlisting, Round 2, the monthly
 * reviews) back to them.
 */

const STEPS = [
  { n: 1, label: "The role" },
  { n: 2, label: "Why, who & pay" },
  { n: 3, label: "The job description" },
] as const;

/** Everything the draft carries. Files are not serialisable, so `jdFile` is out. */
interface DraftShape {
  step: number;
  jobTitleId: string;
  jobTitleText: string;
  departmentId: string;
  locationId: string;
  jobTypeId: string;
  positionsRequired: string;
  expectedStartDate: string;
  positionKind: "new" | "replacement";
  previousEmployeeName: string;
  whyNeeded: string;
  hiringManagerIds: string[];
  reportingToIds: string[];
  reportingToNote: string;
  salaryStructure: SalaryStructure;
  salaryPeriod: SalaryPeriod;
  salaryFixed: string;
  salaryMin: string;
  salaryMax: string;
  incentiveNote: string;
  roleSummary: string;
  responsibilities: string[];
  expMin: string;
  expMax: string;
  freshersOk: boolean;
  qualificationIds: string[];
  skillIds: string[];
  preferredSkillIds: string[];
  skillsNote: string;
  touched: string[];
  jdFilled: string[];
}

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
  /** `jdFile` is the newly-picked JD, if any — the parent uploads it (a new MRF has no id yet). */
  onSubmit: (input: MrfInput, jdFile: File | null) => void;
  onCancel: () => void;
}) {
  const s = useHrStore();

  /** Missing from a dropdown? Raise it as a master request without losing the form. */
  const [raise, setRaise] = useState<{ mt: HrMasterType; prefill: MasterValues } | null>(null);
  const [requested, setRequested] = useState<string | null>(null);

  const [step, setStep] = useState(1);

  const [jobTitleId, setJobTitleId] = useState(existing?.jobTitleId ?? "");
  /** The typed/stored name. Kept for rows raised before the master existed. */
  const [jobTitleText, setJobTitleText] = useState(existing?.jobTitle ?? "");
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? "");
  const [locationId, setLocationId] = useState(existing?.locationId ?? "");
  const [jobTypeId, setJobTypeId] = useState(existing?.jobTypeId ?? "");
  const [positionsRequired, setPositionsRequired] = useState(String(existing?.positionsRequired ?? 1));
  const [expectedStartDate, setExpectedStartDate] = useState(existing?.expectedStartDate ?? "");

  const [positionKind, setPositionKind] = useState<"new" | "replacement">(existing?.positionKind ?? "new");
  const [previousEmployeeName, setPreviousEmployeeName] = useState(existing?.previousEmployeeName ?? "");
  const [whyNeeded, setWhyNeeded] = useState(existing?.whyNeeded ?? "");
  const [hiringManagerIds, setHiringManagerIds] = useState<string[]>(existing?.hiringManagerIds ?? []);
  const [reportingToIds, setReportingToIds] = useState<string[]>(existing?.reportingToIds ?? []);
  const [reportingToNote, setReportingToNote] = useState(existing?.reportingToNote ?? "");

  const [salaryStructure, setSalaryStructure] = useState<SalaryStructure>(existing?.salaryStructure ?? "range");
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>(existing?.salaryPeriod ?? "month");
  const numStr = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  // A fixed salary was stored as min = max, so either bound reconstitutes it.
  const [salaryFixed, setSalaryFixed] = useState(
    existing?.salaryStructure === "fixed" ? numStr(existing?.salaryMin ?? existing?.salaryMax) : ""
  );
  const [salaryMin, setSalaryMin] = useState(existing?.salaryStructure === "fixed" ? "" : numStr(existing?.salaryMin));
  const [salaryMax, setSalaryMax] = useState(existing?.salaryStructure === "fixed" ? "" : numStr(existing?.salaryMax));
  const [incentiveNote, setIncentiveNote] = useState(existing?.incentiveNote ?? "");

  const [roleSummary, setRoleSummary] = useState(existing?.roleSummary ?? "");
  const [responsibilities, setResponsibilities] = useState<string[]>(
    bulletsFromText(existing?.keyResponsibilities ?? null)
  );
  const [expMin, setExpMin] = useState(numStr(existing?.experienceMinYears));
  const [expMax, setExpMax] = useState(numStr(existing?.experienceMaxYears));
  const [freshersOk, setFreshersOk] = useState(existing?.freshersOk ?? false);
  const [qualificationIds, setQualificationIds] = useState<string[]>(existing?.qualificationIds ?? []);
  const [skillIds, setSkillIds] = useState<string[]>(existing?.skillIds ?? []);
  const [preferredSkillIds, setPreferredSkillIds] = useState<string[]>(existing?.preferredSkillIds ?? []);
  const [skillsNote, setSkillsNote] = useState(existing?.skillsNote ?? "");

  /** A newly-picked JD file. Left null keeps whatever the requisition already has. */
  const [jdFile, setJdFile] = useState<File | null>(null);

  /**
   * Which fields the user has edited by hand. Applying a job title's template
   * skips every one of them — so picking a different title after writing your own
   * responsibilities re-fills only what you left alone. Editing an EXISTING
   * requisition starts fully touched: its content is already someone's work.
   */
  const [touched, setTouched] = useState<Set<string>>(
    () => new Set(existing ? ["*"] : [])
  );
  /**
   * Which fields the attached JD filled. Two jobs: it labels them ("from the JD")
   * so nothing appears to have changed on its own, and it counts as touched for
   * the template, which is what makes the JD outrank a job title's generic
   * defaults. Editing one by hand moves it out of here and into `touched` — it's
   * the HOD's now, so the label goes.
   */
  const [jdFilled, setJdFilled] = useState<Set<string>>(new Set());

  const isTouched = (k: string) => touched.has("*") || touched.has(k) || jdFilled.has(k);
  const markTouched = (k: string) => {
    setTouched((p) => (p.has(k) ? p : new Set(p).add(k)));
    setJdFilled((p) => {
      if (!p.has(k)) return p;
      const next = new Set(p);
      next.delete(k);
      return next;
    });
  };

  /** "from the JD" replaces a field's usual hint once the JD supplied it. */
  const hintFor = (k: string, fallback?: string) => (jdFilled.has(k) ? "from the JD" : fallback);

  /* ------------------------------- options -------------------------------- */

  const people: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles]
  );
  const titleOptions: ComboOption[] = useMemo(
    () => jobTitleOptions(s.jobTitles, s.departments, existing?.jobTitleId ?? null),
    [s.jobTitles, s.departments, existing?.jobTitleId]
  );
  const deptOptions: ComboOption[] = useMemo(
    () => [...s.departments].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ value: d.id, label: d.name })),
    [s.departments]
  );
  const locOptions: ComboOption[] = useMemo(
    () => s.locations.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
    [s.locations]
  );
  const typeOptions: ComboOption[] = useMemo(
    () => s.jobTypes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })),
    [s.jobTypes]
  );
  const mustHaveOptions = useMemo(() => skillOptions(s.skills, skillIds), [s.skills, skillIds]);
  const preferredOptions = useMemo(() => skillOptions(s.skills, preferredSkillIds), [s.skills, preferredSkillIds]);
  const qualOptions = useMemo(
    () => qualificationOptions(s.qualifications, qualificationIds),
    [s.qualifications, qualificationIds]
  );

  const chosenTitle = s.jobTitleById(jobTitleId || null);
  const prefilled = !!chosenTitle && hasJdTemplate(chosenTitle);

  /**
   * Apply a job title's template to every field nobody has claimed yet.
   *
   * `isTouched` is the whole precedence rule: it covers both hand-edits and
   * JD-filled fields, so this only ever writes into genuine blanks. Called when a
   * title is picked AND after a JD parse — a JD that named a title still gets the
   * template's help for whatever the JD didn't mention.
   */
  const applyJobTitleTemplate = (id: string, claimed: (k: string) => boolean) => {
    const t = s.jobTitleById(id || null);
    if (!t) return;

    if (t.departmentId && !claimed("departmentId")) setDepartmentId(t.departmentId);
    if (t.defaultJobTypeId && !claimed("jobTypeId")) setJobTypeId(t.defaultJobTypeId);
    if (t.defaultRoleSummary && !claimed("roleSummary")) setRoleSummary(t.defaultRoleSummary);
    if (t.defaultResponsibilities && !claimed("responsibilities"))
      setResponsibilities(bulletsFromText(t.defaultResponsibilities));
    if (t.defaultExperienceMinYears !== null && !claimed("expMin")) setExpMin(String(t.defaultExperienceMinYears));
    if (t.defaultExperienceMaxYears !== null && !claimed("expMax")) setExpMax(String(t.defaultExperienceMaxYears));
    if (t.defaultQualificationIds.length && !claimed("qualificationIds"))
      setQualificationIds(t.defaultQualificationIds);
    if (t.defaultSkillIds.length && !claimed("skillIds")) setSkillIds(t.defaultSkillIds);
    if (t.defaultPreferredSkillIds.length && !claimed("preferredSkillIds"))
      setPreferredSkillIds(t.defaultPreferredSkillIds);
  };

  /** Picking a job title by hand. */
  const pickJobTitle = (id: string) => {
    setJobTitleId(id);
    const t = s.jobTitleById(id || null);
    if (!t) return;
    setJobTitleText(t.name);
    applyJobTitleTemplate(id, isTouched);
  };

  /* --------------------------- the attached JD ---------------------------- */

  const [jdBusy, setJdBusy] = useState(false);
  /** Seconds spent reading, so the wait can prove it is still moving. */
  const [jdSecs, setJdSecs] = useState(0);
  /** Live while a JD is in flight — "Stop waiting" aborts through this. */
  const jdAbort = useRef<AbortController | null>(null);
  /** What to say above the form once a JD has been read (or failed to read). */
  const [jdNote, setJdNote] = useState<
    { kind: "ok"; file: string; count: number } | { kind: "warn"; text: string } | null
  >(null);
  /** Everything the JD overwrote, so Undo is a real undo and not a reset. */
  const [preJd, setPreJd] = useState<DraftShape | null>(null);

  /**
   * The seconds counter. It lives here rather than inside JdProgress so the
   * interval is torn down by the same effect that owns it — a component that
   * unmounts mid-read (Cancel, or a route change) can't leave a timer behind.
   */
  useEffect(() => {
    if (!jdBusy) return;
    const started = Date.now();
    const id = window.setInterval(() => setJdSecs(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [jdBusy]);

  /** Abort on unmount, so a half-read JD can never resolve into a dead component. */
  useEffect(() => () => jdAbort.current?.abort(), []);

  /**
   * Attaching a JD does two things at once: it becomes the requisition's JD file
   * (that part never fails), and it is read to prefill the form (that part is
   * allowed to fail — `parseJd` never throws, and a failure leaves an ordinary
   * empty form behind rather than an error state).
   */
  const onPickJd = async (file: File | null) => {
    setJdFile(file);
    setJdNote(null);
    if (!file) return;

    const controller = new AbortController();
    jdAbort.current = controller;
    setJdSecs(0);
    setJdBusy(true);

    const before = snapshot();
    const result = await parseJd(
      file,
      {
        jobTitles: s.jobTitles.filter((t) => t.active),
        departments: s.departments,
        employmentTypes: s.jobTypes.filter((t) => t.active),
        locations: s.locations.filter((l) => l.active),
        skills: s.skills.filter((k) => k.active),
        qualifications: s.qualifications.filter((q) => q.active),
      },
      { signal: controller.signal },
    ).finally(() => {
      jdAbort.current = null;
      setJdBusy(false);
    });

    if (!result.ok) {
      setJdNote({
        kind: "warn",
        text:
          result.reason === "unsupported"
            ? `${file.name} is attached, but it can't be read automatically — save it as .docx or PDF next time. Fill the form in below.`
            : result.reason === "unreadable"
              ? `${file.name} is attached, but there was nothing readable in it. Fill the form in below.`
              : result.reason === "cancelled"
                ? `Stopped reading ${file.name}. It's still attached — fill the form in below, or pick it again to retry.`
                : result.reason === "timeout"
                  ? `${file.name} is attached, but reading it took too long. Fill the form in below, or pick it again to retry.`
                  : `${file.name} is attached, but reading it didn't work just now. Fill the form in below.`,
      });
      return;
    }

    setPreJd(before);
    setJdNote({ kind: "ok", file: file.name, count: applyJd(result.data) });
  };

  /**
   * Write the parsed JD into every unclaimed field. Returns how many it filled.
   *
   * "Claimed" here means HAND-EDITED only — deliberately not `isTouched`, which
   * also counts the previous JD's fields. Attaching a second JD should replace the
   * first one's answers while still leaving the HOD's own edits alone, and reading
   * `jdFilled` would block that (and would read a stale value anyway, since the
   * state this function queues isn't visible until the next render).
   */
  const applyJd = (jd: ParsedJd): number => {
    const claimed = (k: string) => touched.has("*") || touched.has(k);
    const filled = new Set<string>();

    /** Set `k` only if nobody has claimed it and the JD actually has a value. */
    const put = <T,>(k: string, value: T, set: (v: T) => void, has: boolean) => {
      if (!has || claimed(k)) return;
      set(value);
      filled.add(k);
    };

    // A title the JD names but the master doesn't have is still carried as text —
    // job_title is NOT NULL, so this keeps the requisition raisable either way.
    if (jd.jobTitleId && !claimed("jobTitleId")) {
      setJobTitleId(jd.jobTitleId);
      setJobTitleText(s.jobTitleById(jd.jobTitleId)?.name ?? jd.jobTitleText);
      filled.add("jobTitleId");
    } else if (jd.jobTitleText && !jobTitleId && !claimed("jobTitleId")) {
      setJobTitleText(jd.jobTitleText);
    }

    put("departmentId", jd.departmentId, setDepartmentId, !!jd.departmentId);
    put("jobTypeId", jd.jobTypeId, setJobTypeId, !!jd.jobTypeId);
    put("locationId", jd.locationId, setLocationId, !!jd.locationId);
    put("roleSummary", jd.roleSummary, setRoleSummary, !!jd.roleSummary);
    put("responsibilities", jd.responsibilities, setResponsibilities, jd.responsibilities.length > 0);
    put("expMin", jd.experienceMinYears, setExpMin, !!jd.experienceMinYears);
    put("expMax", jd.experienceMaxYears, setExpMax, !!jd.experienceMaxYears);
    put("qualificationIds", jd.qualificationIds, setQualificationIds, jd.qualificationIds.length > 0);
    put("skillIds", jd.skillIds, setSkillIds, jd.skillIds.length > 0);
    put("preferredSkillIds", jd.preferredSkillIds, setPreferredSkillIds, jd.preferredSkillIds.length > 0);
    put("incentiveNote", jd.incentives, setIncentiveNote, !!jd.incentives);
    if (jd.freshersOk && !claimed("expMin")) setFreshersOk(true);

    // Salary: a JD that states one figure is a fixed salary, not a one-ended band.
    if (!claimed("salary") && (jd.salaryMin || jd.salaryMax)) {
      const fixed = !!jd.salaryMin && jd.salaryMin === jd.salaryMax;
      setSalaryStructure(fixed ? "fixed" : "range");
      if (fixed) setSalaryFixed(jd.salaryMin);
      else {
        setSalaryMin(jd.salaryMin);
        setSalaryMax(jd.salaryMax);
      }
      if (jd.salaryPeriod) setSalaryPeriod(jd.salaryPeriod);
      filled.add("salary");
    }

    // Requirements with no master entry go into the free-text note rather than
    // being dropped — the HOD sees them and can request the master.
    const leftovers = [...jd.otherSkills, ...jd.otherQualifications];
    if (leftovers.length && !claimed("skillsNote")) {
      setSkillsNote(`From the JD, not in the lists: ${leftovers.join(", ")}`);
      filled.add("skillsNote");
    }

    setJdFilled(filled);

    // The JD outranks the template, but the template still fills what the JD left
    // blank. Passing the predicate explicitly (rather than relying on `isTouched`
    // reading the `jdFilled` we just queued) is what makes this deterministic.
    const titleId = jd.jobTitleId || jobTitleId;
    if (titleId) applyJobTitleTemplate(titleId, (k) => claimed(k) || filled.has(k));

    return filled.size;
  };

  /** Put everything back the way it was before the JD was read. */
  const undoJd = () => {
    if (preJd) applyDraft(preJd);
    setJdFilled(new Set());
    setPreJd(null);
    setJdNote(null);
  };

  /* --------------------------------- draft -------------------------------- */

  /**
   * The whole form as one serialisable object. Two callers: the localStorage
   * draft, and the JD's Undo — which is why this is a function and not an inline
   * literal. Sharing one definition is what stops Undo from quietly forgetting a
   * field the next time one is added.
   */
  const snapshot = (): DraftShape => ({
    step,
    jobTitleId,
    jobTitleText,
    departmentId,
    locationId,
    jobTypeId,
    positionsRequired,
    expectedStartDate,
    positionKind,
    previousEmployeeName,
    whyNeeded,
    hiringManagerIds,
    reportingToIds,
    reportingToNote,
    salaryStructure,
    salaryPeriod,
    salaryFixed,
    salaryMin,
    salaryMax,
    incentiveNote,
    roleSummary,
    responsibilities,
    expMin,
    expMax,
    freshersOk,
    qualificationIds,
    skillIds,
    preferredSkillIds,
    skillsNote,
    touched: [...touched],
    jdFilled: [...jdFilled],
  });

  const applyDraft = (v: DraftShape) => {
    setStep(v.step ?? 1);
    setJobTitleId(v.jobTitleId);
    setJobTitleText(v.jobTitleText);
    setDepartmentId(v.departmentId);
    setLocationId(v.locationId);
    setJobTypeId(v.jobTypeId);
    setPositionsRequired(v.positionsRequired);
    setExpectedStartDate(v.expectedStartDate);
    setPositionKind(v.positionKind);
    setPreviousEmployeeName(v.previousEmployeeName);
    setWhyNeeded(v.whyNeeded);
    setHiringManagerIds(v.hiringManagerIds);
    setReportingToIds(v.reportingToIds);
    setReportingToNote(v.reportingToNote);
    setSalaryStructure(v.salaryStructure);
    setSalaryPeriod(v.salaryPeriod);
    setSalaryFixed(v.salaryFixed);
    setSalaryMin(v.salaryMin);
    setSalaryMax(v.salaryMax);
    setIncentiveNote(v.incentiveNote);
    setRoleSummary(v.roleSummary);
    setResponsibilities(v.responsibilities ?? []);
    setExpMin(v.expMin);
    setExpMax(v.expMax);
    setFreshersOk(v.freshersOk);
    setQualificationIds(v.qualificationIds);
    setSkillIds(v.skillIds);
    setPreferredSkillIds(v.preferredSkillIds);
    setSkillsNote(v.skillsNote);
    setTouched(new Set(v.touched ?? []));
    setJdFilled(new Set(v.jdFilled ?? []));
  };

  const draft = useStepDraft<DraftShape>({
    key: existing ? `hr:mrf:${existing.id}` : "hr:mrf:new",
    values: snapshot(),
    apply: applyDraft,
    // `step`, `touched` and `jdFilled` are bookkeeping — moving between steps is
    // not an edit, and without this the draft bar would arm the moment someone
    // clicked Next.
    comparable: ({ step: _s, touched: _t, jdFilled: _j, ...rest }) => rest,
  });

  /* ------------------------------- validation ------------------------------ */

  const replacement = positionKind === "replacement";
  const titleName = (chosenTitle?.name ?? jobTitleText).trim();

  const step1Error = !titleName
    ? "Pick a job title."
    : !departmentId
      ? "Pick a department."
      : Number(positionsRequired) < 1
        ? "At least one position is needed."
        : null;
  const step2Error = replacement && !previousEmployeeName.trim() ? "Name the employee being replaced." : null;
  const blocking = step === 1 ? step1Error : step === 2 ? step2Error : null;
  const invalid = !!step1Error || !!step2Error;

  const num = (v: string): number | null => {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return v.trim() === "" || !Number.isFinite(n) ? null : n;
  };

  const submit = () => {
    const fixed = salaryStructure === "fixed";
    const min = fixed ? num(salaryFixed) : num(salaryMin);
    const max = fixed ? num(salaryFixed) : num(salaryMax);

    onSubmit(
      {
        jobTitle: titleName,
        jobTitleId: jobTitleId || null,
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
        salaryMin: min,
        salaryMax: max,
        salaryStructure,
        salaryPeriod,
        incentiveNote: incentiveNote.trim() || null,
        whyNeeded: whyNeeded.trim() || null,
        roleSummary: roleSummary.trim() || null,
        keyResponsibilities: bulletsToText(responsibilities),
        experienceMinYears: num(expMin),
        experienceMaxYears: num(expMax),
        freshersOk,
        qualificationIds,
        skillIds,
        preferredSkillIds,
        skillsNote: skillsNote.trim() || null,
        // Denormalised so the pre-existing text-only readers (detail Field,
        // exports) still show something without resolving ids themselves.
        requiredSkills: s.skillNames(skillIds).join(", ") || null,
        jdPath: existing?.jdPath ?? null,
        jdName: existing?.jdName ?? null,
      },
      jdFile
    );
    draft.clear();
  };

  const goNext = () => {
    if (blocking) return;
    setStep((p) => Math.min(3, p + 1));
  };

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="space-y-5 max-w-4xl">
      <DraftBar draft={draft} fileHint />

      {/* ---- Step rail. Completed steps click back; ahead of you does not. ---- */}
      <div className="flex items-center gap-1.5">
        {STEPS.map((st, i) => {
          const done = st.n < step;
          const here = st.n === step;
          return (
            <div key={st.n} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <span className={cn("h-px w-5 sm:w-8 shrink-0", done || here ? "bg-orange/50" : "bg-line")} />}
              <button
                type="button"
                disabled={st.n > step}
                onClick={() => setStep(st.n)}
                className={cn(
                  "flex items-center gap-2 rounded-pill px-2.5 py-1.5 text-[12.5px] font-medium transition min-w-0",
                  here && "bg-orange/10 text-navy",
                  done && "text-grey hover:bg-line",
                  st.n > step && "text-grey-2 cursor-default"
                )}
              >
                <span
                  className={cn(
                    "shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold",
                    here ? "bg-orange text-white" : done ? "bg-teal/15 text-teal" : "bg-line text-grey-2"
                  )}
                >
                  {done ? "✓" : st.n}
                </span>
                <span className="truncate">{st.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ================================ STEP 1 =============================== */}
      {step === 1 && (
        <>
          {/*
            The JD comes FIRST — before a single field. It reframes the opening
            question from "start filling this in" to "do you already have one?",
            which is the largest single reduction in perceived effort available
            here. Attaching also stores it as the requisition's JD file, so this
            is one action rather than two.
          */}
          <Card className="p-5 space-y-3">
            <div>
              <h2 className="text-[15px] font-semibold text-navy">Already have a JD?</h2>
              <p className="mt-0.5 text-[12.5px] text-grey">
                Attach it and we'll fill in what we can — you just check it. PDF, Word (.docx), or a photo.
              </p>
            </div>

            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,image/*"
              disabled={jdBusy}
              onChange={(e) => void onPickJd(e.target.files?.[0] ?? null)}
              className="block w-full text-[13px] text-grey file:mr-3 file:rounded-lg file:border-0 file:bg-page file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:text-navy hover:file:bg-line/50 disabled:opacity-50"
            />

            {jdBusy && (
              <JdProgress
                secs={jdSecs}
                fileName={jdFile?.name ?? "the file"}
                onCancel={() => jdAbort.current?.abort()}
              />
            )}

            {!jdBusy && jdNote?.kind === "ok" && (
              <div className="flex items-start gap-3 rounded-xl border border-teal/30 bg-teal/5 px-3.5 py-2.5">
                <p className="grow text-[12.5px] leading-relaxed text-navy">
                  <span className="font-semibold">
                    Read {jdNote.file} — filled {jdNote.count} {jdNote.count === 1 ? "field" : "fields"}.
                  </span>{" "}
                  <span className="text-grey">Check them as you go; anything marked “from the JD” came from it.</span>
                </p>
                <button
                  type="button"
                  onClick={undoJd}
                  className="shrink-0 text-[12.5px] font-semibold text-grey hover:text-navy underline underline-offset-2"
                >
                  Undo
                </button>
              </div>
            )}

            {!jdBusy && jdNote?.kind === "warn" && (
              <p className="rounded-xl border border-line bg-page px-3.5 py-2.5 text-[12.5px] leading-relaxed text-grey">
                {jdNote.text}
              </p>
            )}

            {existing?.jdName && !jdFile && (
              <span className="block text-[11.5px] leading-snug text-grey-2">
                Current: {existing.jdName} — pick a file to replace it.
              </span>
            )}
          </Card>

          <Card className="p-5 space-y-4">
          <h2 className="text-[15px] font-semibold text-navy">The role</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="Job title / position" required hint={hintFor("jobTitleId")}>
              <Combobox
                value={jobTitleId}
                onChange={pickJobTitle}
                options={titleOptions}
                placeholder="Search job titles"
                searchable
                onCreate={(name) => setRaise({ mt: "job_title", prefill: { name } })}
                createLabel={(q) => `Request new job title “${q}”`}
              />
              {!jobTitleId && jobTitleText && (
                <span className="mt-1 block text-[11.5px] leading-snug text-grey-2">
                  The JD calls it “{jobTitleText}”, which isn't in the list yet — pick the closest match, or request it.
                </span>
              )}
            </FieldLabel>

            <FieldLabel
              label="Department"
              required
              hint={hintFor("departmentId", chosenTitle?.departmentId ? "from the job title" : undefined)}
            >
              <Combobox
                value={departmentId}
                onChange={(v) => {
                  setDepartmentId(v);
                  markTouched("departmentId");
                }}
                options={deptOptions}
                placeholder="Select department"
                searchable
              />
            </FieldLabel>

            <FieldLabel label="Where is this role based?" hint={hintFor("locationId", "optional")}>
              <Combobox
                value={locationId}
                onChange={(v) => {
                  setLocationId(v);
                  markTouched("locationId");
                }}
                options={locOptions}
                placeholder="Select location"
                onCreate={(name) => setRaise({ mt: "location", prefill: { name } })}
                createLabel={(q) => `Request new location “${q}”`}
              />
            </FieldLabel>

            <FieldLabel label="Employment type" hint={hintFor("jobTypeId", "optional")}>
              <Combobox
                value={jobTypeId}
                onChange={(v) => {
                  setJobTypeId(v);
                  markTouched("jobTypeId");
                }}
                options={typeOptions}
                placeholder="Full-time, contract, intern…"
                onCreate={(name) => setRaise({ mt: "job_type", prefill: { name } })}
                createLabel={(q) => `Request new employment type “${q}”`}
              />
            </FieldLabel>

            <FieldLabel label="How many people?" required>
              <TextInput
                type="number"
                min={1}
                value={positionsRequired}
                onChange={(e) => setPositionsRequired(e.target.value)}
              />
            </FieldLabel>

            <FieldLabel label="How soon do you need them?" hint="optional">
              <TextInput type="date" value={expectedStartDate} onChange={(e) => setExpectedStartDate(e.target.value)} />
            </FieldLabel>
          </div>
          </Card>
        </>
      )}

      {/* ================================ STEP 2 =============================== */}
      {step === 2 && (
        <>
          <Card className="p-5 space-y-4">
            <h2 className="text-[15px] font-semibold text-navy">Why this role, and who owns it</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Is this a new position or a replacement?" required>
                <div className="flex gap-2">
                  {(["new", "replacement"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setPositionKind(k)}
                      className={cn(
                        "flex-1 rounded-xl border px-3 py-2.5 text-[13.5px] font-medium transition",
                        positionKind === k
                          ? "border-orange bg-orange/5 text-navy"
                          : "border-line text-grey-2 hover:border-grey-2/40"
                      )}
                    >
                      {k === "new" ? "New position" : "Replacement"}
                    </button>
                  ))}
                </div>
              </FieldLabel>
              {replacement && (
                <FieldLabel label="Who is being replaced?" required>
                  <TextInput
                    value={previousEmployeeName}
                    onChange={(e) => setPreviousEmployeeName(e.target.value)}
                    placeholder="Name of the employee leaving"
                  />
                </FieldLabel>
              )}
            </div>

            <FieldLabel label="Why is this position needed?" hint="optional — one or two lines is plenty">
              <TextArea
                rows={3}
                value={whyNeeded}
                onChange={(e) => setWhyNeeded(e.target.value)}
                placeholder="e.g. Two engineers cover all of Gujarat and SLA breaches are rising."
              />
            </FieldLabel>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Who will manage this hire?" hint="optional — can be more than one">
                <MultiSelect
                  values={hiringManagerIds}
                  onChange={setHiringManagerIds}
                  options={people}
                  placeholder="Defaults to you"
                />
                <span className="mt-1 block text-[11px] leading-snug text-grey-2">
                  Leave empty and it's you. The hiring manager shortlists this requisition's CVs, takes Interview Round
                  2, and does the new hire's monthly reviews.
                </span>
              </FieldLabel>
              <FieldLabel label="Who will they report to?" hint="optional — can be more than one">
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

          <Card className="p-5 space-y-4">
            <h2 className="text-[15px] font-semibold text-navy">
              Salary{" "}
              <span className="text-[12px] font-normal text-grey-2">
                — {jdFilled.has("salary") ? "from the JD" : "optional"}
              </span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Is it a fixed figure or a range?">
                <div className="flex gap-2">
                  {(
                    [
                      { v: "range", label: "A range" },
                      { v: "fixed", label: "Fixed amount" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setSalaryStructure(o.v)}
                      className={cn(
                        "flex-1 rounded-xl border px-3 py-2.5 text-[13.5px] font-medium transition",
                        salaryStructure === o.v
                          ? "border-orange bg-orange/5 text-navy"
                          : "border-line text-grey-2 hover:border-grey-2/40"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </FieldLabel>
              <FieldLabel label="Per">
                <div className="flex gap-2">
                  {(
                    [
                      { v: "month", label: "₹ / month" },
                      { v: "annum", label: "₹ / year" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setSalaryPeriod(o.v)}
                      className={cn(
                        "flex-1 rounded-xl border px-3 py-2.5 text-[13.5px] font-medium transition",
                        salaryPeriod === o.v
                          ? "border-orange bg-orange/5 text-navy"
                          : "border-line text-grey-2 hover:border-grey-2/40"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </FieldLabel>
            </div>

            {salaryStructure === "fixed" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldLabel label={`Amount (₹ / ${salaryPeriod === "month" ? "month" : "year"})`} hint="optional">
                  <TextInput
                    inputMode="decimal"
                    value={salaryFixed}
                    onChange={(e) => setSalaryFixed(e.target.value)}
                    placeholder="25000"
                  />
                </FieldLabel>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldLabel label={`From (₹ / ${salaryPeriod === "month" ? "month" : "year"})`} hint="optional">
                  <TextInput
                    inputMode="decimal"
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                    placeholder="15000"
                  />
                </FieldLabel>
                <FieldLabel label={`To (₹ / ${salaryPeriod === "month" ? "month" : "year"})`} hint="optional">
                  <TextInput
                    inputMode="decimal"
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                    placeholder="25000"
                  />
                </FieldLabel>
              </div>
            )}

            <FieldLabel label="Performance incentives" hint={hintFor("incentiveNote", "optional")}>
              <TextArea
                rows={2}
                value={incentiveNote}
                onChange={(e) => setIncentiveNote(e.target.value)}
                placeholder="e.g. Travel allowance + 1% on collections."
              />
            </FieldLabel>
            <p className="text-[11.5px] text-grey-2">
              Whatever you put here is what everyone reads on the requisition — and what flags an offer that lands above
              the maximum.
            </p>
          </Card>
        </>
      )}

      {/* ================================ STEP 3 =============================== */}
      {step === 3 && (
        <>
          <Card className="p-5 space-y-4">
            {jdFilled.size > 0 ? (
              <div className="rounded-xl border border-teal/30 bg-teal/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-navy">
                <span className="font-semibold">Filled in from the JD you attached.</span>{" "}
                <span className="text-grey">Read it through and change anything that doesn't fit this vacancy.</span>
              </div>
            ) : prefilled ? (
              <div className="rounded-xl border border-teal/30 bg-teal/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-navy">
                <span className="font-semibold">Pre-filled from “{chosenTitle?.name}”.</span>{" "}
                <span className="text-grey">Read it through and change anything that doesn't fit this vacancy.</span>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-page px-3.5 py-2.5 text-[12.5px] leading-relaxed text-grey">
                <span className="font-semibold text-navy">Everything on this step is optional.</span> Fill in what you
                know and submit — HR can finish it off. (Had a JD? Attaching it on step 1 fills this in for you.)
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="text-[15px] font-semibold text-navy">
              The job description <span className="text-[12px] font-normal text-grey-2">— all optional</span>
            </h2>

            <FieldLabel label="In one line, what is this role for?" hint={hintFor("roleSummary", "optional")}>
              <TextArea
                rows={3}
                value={roleSummary}
                onChange={(e) => {
                  setRoleSummary(e.target.value);
                  markTouched("roleSummary");
                }}
                placeholder="The purpose of the role and the impact expected."
              />
            </FieldLabel>

            <FieldLabel
              label="What will this person do?"
              hint={hintFor(
                "responsibilities",
                responsibilities.filter(Boolean).length > 0
                  ? `${responsibilities.filter(Boolean).length} points`
                  : "aim for 6–10"
              )}
            >
              <BulletList
                values={responsibilities}
                onChange={(next) => {
                  setResponsibilities(next);
                  markTouched("responsibilities");
                }}
                placeholder="Attend breakdown calls at customer sites…"
              />
            </FieldLabel>
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="text-[15px] font-semibold text-navy">
              Who you're looking for <span className="text-[12px] font-normal text-grey-2">— all optional</span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* The unit is on the label AND after the boxes: "6 to 9" on its own
                  reads as months to some people and years to others, and the JD
                  prefills it, so nobody types the number and learns the unit. */}
              <FieldLabel label="How much experience? (in years)" hint={hintFor("expMin", "optional")}>
                <div className="flex items-center gap-2">
                  <TextInput
                    inputMode="decimal"
                    value={expMin}
                    onChange={(e) => {
                      setExpMin(e.target.value);
                      markTouched("expMin");
                    }}
                    placeholder="From"
                  />
                  <span className="shrink-0 text-[13px] text-grey-2">to</span>
                  <TextInput
                    inputMode="decimal"
                    value={expMax}
                    onChange={(e) => {
                      setExpMax(e.target.value);
                      markTouched("expMax");
                    }}
                    placeholder="To"
                  />
                  <span className="shrink-0 text-[13px] text-grey">years</span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-[12.5px] text-grey cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={freshersOk}
                    onChange={(e) => setFreshersOk(e.target.checked)}
                    className="w-4 h-4 rounded border-line accent-orange"
                  />
                  Freshers welcome
                </label>
              </FieldLabel>

              <FieldLabel label="Education" hint={hintFor("qualificationIds", "optional")}>
                <MultiSelect
                  values={qualificationIds}
                  onChange={(next) => {
                    setQualificationIds(next);
                    markTouched("qualificationIds");
                  }}
                  options={qualOptions}
                  placeholder="Any"
                  searchable
                  chips
                  onCreate={(name) => setRaise({ mt: "qualification", prefill: { name } })}
                  createLabel={(q) => `Request new qualification “${q}”`}
                />
              </FieldLabel>
            </div>

            <FieldLabel label="Must-have skills" hint={hintFor("skillIds", "optional")}>
              <MultiSelect
                values={skillIds}
                onChange={(next) => {
                  setSkillIds(next);
                  markTouched("skillIds");
                }}
                options={mustHaveOptions}
                placeholder="Search skills, tools, languages…"
                searchable
                chips
                onCreate={(name) => setRaise({ mt: "skill", prefill: { name } })}
                createLabel={(q) => `Request new skill “${q}”`}
              />
            </FieldLabel>

            <FieldLabel label="Good to have" hint={hintFor("preferredSkillIds", "optional — nice, but not a dealbreaker")}>
              <MultiSelect
                values={preferredSkillIds}
                onChange={(next) => {
                  setPreferredSkillIds(next);
                  markTouched("preferredSkillIds");
                }}
                options={preferredOptions}
                placeholder="Search skills, tools, languages…"
                searchable
                chips
                onCreate={(name) => setRaise({ mt: "skill", prefill: { name } })}
                createLabel={(q) => `Request new skill “${q}”`}
              />
            </FieldLabel>

            <FieldLabel label="Anything else?" hint={hintFor("skillsNote", "optional")}>
              <TextArea
                rows={2}
                value={skillsNote}
                onChange={(e) => setSkillsNote(e.target.value)}
                placeholder="Anything the lists above don't cover."
              />
            </FieldLabel>
          </Card>
        </>
      )}

      {/* -------------------------------- actions ------------------------------- */}
      <div className="flex items-center gap-3">
        {step > 1 && (
          <Button variant="ghost" onClick={() => setStep((p) => p - 1)} disabled={busy}>
            Back
          </Button>
        )}
        {step < 3 ? (
          <Button onClick={goNext} disabled={!!blocking}>
            Next
          </Button>
        ) : (
          <Button onClick={submit} disabled={busy || invalid}>
            {busy ? "Saving…" : submitLabel}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {blocking && <span className="text-[12.5px] text-grey-2">{blocking}</span>}
        {step === 3 && invalid && (
          <span className="text-[12.5px] text-grey-2">{step1Error ?? step2Error}</span>
        )}
        {error && <span className="text-[12.5px] text-ryg-red">{error}</span>}
      </div>

      <p className="text-[11.5px] text-grey-2">
        Step {step} of 3 ·{" "}
        {step === 3
          ? "Everything on this step is optional — submit whenever you're ready."
          : "Only the starred fields are required."}
      </p>

      {requested && (
        <p className="text-[12px] text-teal">Requested {requested} — selectable once the master's owner approves it.</p>
      )}

      <RequestMasterModal
        open={raise !== null}
        onClose={() => setRaise(null)}
        masterType={raise?.mt ?? null}
        lockType
        prefill={raise?.prefill}
        onRequested={(_id, mt, name) => setRequested(`${masterTypeLabel(mt).toLowerCase()} “${name}”`)}
      />
    </div>
  );
}
