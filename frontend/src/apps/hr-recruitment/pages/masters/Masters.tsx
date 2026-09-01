import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import RequestMasterModal from "../../components/RequestMasterModal";
import { useHrStore } from "../../store";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import { qualificationOptions, skillOptions, skillsInCategory } from "../../lib/jd";
import type { HrMasterTable } from "../../data/hrWrites";
import {
  SKILL_CATEGORIES,
  hasJdTemplate,
  skillCategoryLabel,
  type HrMaster,
  type HrMasterType,
  type HrSkill,
  type JobTitle,
  type OnboardingItem,
  type SkillCategory,
} from "../../types";

/**
 * HR masters — the platforms a job is posted on, the employment types, the
 * offices, why a candidate was dropped, and THE ONBOARDING CHECKLIST.
 *
 * Each tab is editable by an admin or by that master's assigned owner (Setup →
 * Master Owners); to everyone else it is a read-only list. Missing an entry?
 * Anyone can raise a request — from the form they were filling in, or from here.
 *
 * The checklist being editable at all is the whole point: adding a 7th item must
 * never require a migration or a developer. A new item shows up automatically on
 * the next onboarding (existing ones are already seeded and are left alone).
 */

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** The four plain {name, active, sort} masters. */
function SimpleMaster({
  table,
  masterType,
  singular,
  rows,
  hint,
}: {
  table: HrMasterTable;
  masterType: HrMasterType;
  singular: string;
  rows: HrMaster[];
  hint: string;
}) {
  const s = useHrStore();

  const columns: MasterColumn<HrMaster>[] = [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">{hint}</p>
      <MasterCrud<HrMaster>
        singular={singular}
        rows={rows}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage(masterType)}
        emptyValues={{ name: "", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await s.updateMaster(table, id, input);
          else await s.insertMaster(table, input);
        }}
        onToggleActive={async (row, active) => {
          await s.updateMaster(table, row.id, { name: row.name, active, sortOrder: row.sortOrder });
        }}
      />
    </div>
  );
}

/**
 * Job titles — the master the requisition form opens on, and the only one that
 * carries a JD TEMPLATE.
 *
 * The template is the reason the rebuilt requisition form is short: filling it in
 * once here means every HOD who later picks this title gets the job description
 * already written. It is entirely optional — a title with just a name and a
 * department works fine, the JD step simply starts empty.
 */
function JobTitlesMaster() {
  const s = useHrStore();
  const ctx = useMasterFieldCtx();

  const deptName = (id: string | null) =>
    (id && s.departments.find((d) => d.id === id)?.name) || null;

  const columns: MasterColumn<JobTitle>[] = [
    { header: "Job title", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "Department",
      render: (r) => <span className="text-grey-2">{deptName(r.departmentId) ?? "—"}</span>,
      className: "w-56",
    },
    {
      header: "JD template",
      render: (r) =>
        hasJdTemplate(r) ? (
          <span className="text-teal font-medium">Ready</span>
        ) : (
          <span className="text-grey-2">Not set</span>
        ),
      className: "w-32",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  /** Comma-joined ids in, comma-joined ids out — MasterCrud's value bag is all strings. */
  const idsField = (
    key: string,
    label: string,
    hint: string,
    options: (selected: string[]) => MultiOption[]
  ): MasterFieldDef => ({
    key,
    label,
    type: "custom",
    hint,
    render: (value, onChange) => {
      const ids = value ? value.split(",").filter(Boolean) : [];
      return (
        <MultiSelect
          values={ids}
          onChange={(next) => onChange(next.join(","))}
          options={options(ids)}
          placeholder="None"
          searchable
        />
      );
    },
  });

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Job title", type: "text", required: true, placeholder: "e.g. Ink Lab Chemist" },
    { key: "departmentId", label: "Department", type: "select", options: ctx.departmentOptions },
    {
      key: "defaultJobTypeId",
      label: "Employment type",
      type: "select",
      options: s.jobTypes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name })),
      hint: "pre-fills the form",
    },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
    {
      key: "defaultRoleSummary",
      label: "Role summary",
      type: "textarea",
      hint: "template",
      placeholder: "Two or three lines on the purpose of the role and the impact expected.",
    },
    {
      key: "defaultResponsibilities",
      label: "Key responsibilities",
      type: "textarea",
      hint: "one per line",
      placeholder: "Attend breakdown calls at customer sites…\nCarry out preventive maintenance…",
    },
    { key: "expMin", label: "Experience from (years)", type: "text", placeholder: "2" },
    { key: "expMax", label: "Experience to (years)", type: "text", placeholder: "5" },
    idsField("qualificationIds", "Education", "template", (sel) =>
      qualificationOptions(s.qualifications, sel)
    ),
    idsField("skillIds", "Must-have skills", "template", (sel) => skillOptions(s.skills, sel)),
    idsField("preferredSkillIds", "Good to have", "template", (sel) => skillOptions(s.skills, sel)),
  ];

  const numOrNull = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const idList = (v: string): string[] => (v ? v.split(",").filter(Boolean) : []);

  /** Everything but name/active/sortOrder, already snake_cased for the DB. */
  const extraFrom = (v: Record<string, string>) => ({
    department_id: v.departmentId || null,
    default_job_type_id: v.defaultJobTypeId || null,
    default_role_summary: v.defaultRoleSummary.trim() || null,
    default_responsibilities: v.defaultResponsibilities.trim() || null,
    default_experience_min_years: numOrNull(v.expMin),
    default_experience_max_years: numOrNull(v.expMax),
    default_qualification_ids: idList(v.qualificationIds),
    default_skill_ids: idList(v.skillIds),
    default_preferred_skill_ids: idList(v.preferredSkillIds),
  });

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        The positions a requisition can be raised for. Everything below the sort order is the{" "}
        <span className="font-semibold text-navy">JD template</span> — fill it in once and every HOD who picks this title
        gets the job description already written, ready to tweak. It's optional; a title with no template just leaves
        that step blank. This list is HR's own and is separate from the employee designations on a person's profile.
      </p>
      <MasterCrud<JobTitle>
        singular="Job title"
        rows={s.jobTitles}
        columns={columns}
        fields={fields}
        searchText={(r) => `${r.name} ${deptName(r.departmentId) ?? ""}`}
        canManage={s.canManage("job_title")}
        emptyValues={{
          name: "",
          departmentId: "",
          defaultJobTypeId: "",
          sortOrder: "0",
          defaultRoleSummary: "",
          defaultResponsibilities: "",
          expMin: "",
          expMax: "",
          qualificationIds: "",
          skillIds: "",
          preferredSkillIds: "",
        }}
        toValues={(r) => ({
          name: r.name,
          departmentId: r.departmentId ?? "",
          defaultJobTypeId: r.defaultJobTypeId ?? "",
          sortOrder: String(r.sortOrder),
          defaultRoleSummary: r.defaultRoleSummary ?? "",
          defaultResponsibilities: r.defaultResponsibilities ?? "",
          expMin: r.defaultExperienceMinYears === null ? "" : String(r.defaultExperienceMinYears),
          expMax: r.defaultExperienceMaxYears === null ? "" : String(r.defaultExperienceMaxYears),
          qualificationIds: r.defaultQualificationIds.join(","),
          skillIds: r.defaultSkillIds.join(","),
          preferredSkillIds: r.defaultPreferredSkillIds.join(","),
        })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            extra: extraFrom(v),
          };
          if (id) await s.updateMaster("fms_hr_job_titles", id, input);
          else await s.insertMaster("fms_hr_job_titles", input);
        }}
        onToggleActive={async (row, active) => {
          // Name/sort only — deactivating must not touch the template it carries.
          await s.updateMaster("fms_hr_job_titles", row.id, {
            name: row.name,
            active,
            sortOrder: row.sortOrder,
          });
        }}
      />
    </div>
  );
}

/** Skills — one flat list of ~113 rows, so it gets a category filter above the table. */
function SkillsMaster() {
  const s = useHrStore();
  const [category, setCategory] = useState<SkillCategory | "">("");

  const rows = category ? skillsInCategory(s.skills, category) : s.skills;

  const columns: MasterColumn<HrSkill>[] = [
    { header: "Skill", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "Category",
      render: (r) => <span className="text-grey-2">{skillCategoryLabel(r.category)}</span>,
      className: "w-52",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Skill", type: "text", required: true, placeholder: "e.g. Printhead handling - Ricoh" },
    {
      key: "category",
      label: "Category",
      type: "select",
      required: true,
      options: SKILL_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
      hint: "its heading in the picker",
    },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        Everything a requisition can ask for, from Kyocera printhead handling to GST compliance. The category is only a
        heading — the form shows one <span className="font-semibold text-navy">Must-have skills</span> picker and one{" "}
        <span className="font-semibold text-navy">Good to have</span> picker, with these as the sections inside.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-grey-2">Show</span>
        <Combobox
          className="w-56"
          value={category}
          onChange={(v) => setCategory(v as SkillCategory | "")}
          options={[
            { value: "", label: `All categories (${s.skills.length})` },
            ...SKILL_CATEGORIES.map((c) => ({
              value: c.value,
              label: `${c.label} (${skillsInCategory(s.skills, c.value).length})`,
            })),
          ]}
        />
      </div>
      <MasterCrud<HrSkill>
        singular="Skill"
        rows={rows}
        columns={columns}
        fields={fields}
        searchText={(r) => `${r.name} ${skillCategoryLabel(r.category)}`}
        canManage={s.canManage("skill")}
        // A new skill added while a filter is on lands in that category — which is
        // what someone filtering to "Tools & software" then hitting Add means.
        emptyValues={{ name: "", category: category || "technical", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, category: r.category, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            extra: { category: v.category },
          };
          if (id) await s.updateMaster("fms_hr_skills", id, input);
          else await s.insertMaster("fms_hr_skills", input);
        }}
        onToggleActive={async (row, active) => {
          await s.updateMaster("fms_hr_skills", row.id, {
            name: row.name,
            active,
            sortOrder: row.sortOrder,
            extra: { category: row.category },
          });
        }}
      />
    </div>
  );
}

/** The onboarding checklist — richer than the others (needs a file? a link? due when?). */
function OnboardingItemsMaster() {
  const s = useHrStore();

  const columns: MasterColumn<OnboardingItem>[] = [
    { header: "Item", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "Needs a file",
      render: (r) => (r.requiresFile ? <span className="text-navy">Yes</span> : <span className="text-grey-2">No</span>),
      className: "w-28",
    },
    {
      header: "Drive link",
      // "No", not "—": this is a real answer, not a missing one. The dash read as
      // a blank to the filter row (and to anyone scanning the column), while the
      // "Needs a file" column directly above already renders a plain Yes / No.
      render: (r) => (r.allowsLink ? <span className="text-navy">Allowed</span> : <span className="text-grey-2">No</span>),
      className: "w-28",
    },
    {
      header: "Due",
      render: (r) => (
        <span className="text-grey-2">
          {r.dueDays === 0 ? "Same day" : `+${r.dueDays} working day${r.dueDays === 1 ? "" : "s"}`}
        </span>
      ),
      className: "w-40",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Item", type: "text", required: true, placeholder: "e.g. Medical check-up done" },
    { key: "description", label: "Description", type: "textarea", placeholder: "Optional — what HR must actually do" },
    { key: "requiresFile", label: "Must a file be uploaded?", type: "select", required: true, options: YES_NO },
    { key: "allowsLink", label: "Can a Drive link be pasted?", type: "select", required: true, options: YES_NO },
    { key: "dueDays", label: "Due (working days after the onboarding date)", type: "text", placeholder: "0" },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  /** Stable key for a new item, derived from its name. Existing keys never change. */
  const keyFor = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "item";

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        The checklist HR works through once a candidate is finalised. Add, rename or reorder items here — they appear on
        the next onboarding with no code change. Deactivating an item leaves past onboardings untouched. This is the one
        master that isn't requestable: it feeds no dropdown, so it's edited here directly.
      </p>
      <MasterCrud<OnboardingItem>
        singular="Checklist item"
        rows={s.onboardingItems}
        columns={columns}
        fields={fields}
        searchText={(r) => `${r.name} ${r.description ?? ""}`}
        canManage={s.canManage("onboarding_item")}
        emptyValues={{ name: "", description: "", requiresFile: "no", allowsLink: "yes", dueDays: "0", sortOrder: "0" }}
        toValues={(r) => ({
          name: r.name,
          description: r.description ?? "",
          requiresFile: r.requiresFile ? "yes" : "no",
          allowsLink: r.allowsLink ? "yes" : "no",
          dueDays: String(r.dueDays),
          sortOrder: String(r.sortOrder),
        })}
        onSubmit={async (id, v, active) => {
          const existing = id ? s.onboardingItems.find((i) => i.id === id) : undefined;
          const input = {
            // Keep an existing item's key stable — code and past rows reference it.
            key: existing?.key ?? keyFor(v.name),
            name: v.name.trim(),
            description: v.description.trim() || null,
            requiresFile: v.requiresFile === "yes",
            allowsLink: v.allowsLink === "yes",
            dueDays: Math.max(0, Math.floor(Number(v.dueDays) || 0)),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await s.updateOnboardingItem(id, input);
          else await s.insertOnboardingItem(input);
        }}
        onToggleActive={async (row, active) => {
          await s.updateOnboardingItem(row.id, {
            key: row.key,
            name: row.name,
            description: row.description,
            requiresFile: row.requiresFile,
            allowsLink: row.allowsLink,
            dueDays: row.dueDays,
            active,
            sortOrder: row.sortOrder,
          });
        }}
      />
    </div>
  );
}

export default function Masters() {
  const s = useHrStore();
  // Job Titles first, and the default tab: it is the one the requisition form
  // opens on, and the only one that carries a JD template worth maintaining.
  const [tab, setTab] = useState("titles");
  const [raising, setRaising] = useState(false);

  const tabs = [
    { key: "titles", label: "Job Titles", count: s.jobTitles.length },
    { key: "skills", label: "Skills", count: s.skills.length },
    { key: "qualifications", label: "Qualifications", count: s.qualifications.length },
    { key: "types", label: "Employment Types", count: s.jobTypes.length },
    { key: "locations", label: "Locations", count: s.locations.length },
    { key: "platforms", label: "Job Platforms", count: s.jobPlatforms.length },
    { key: "reasons", label: "Disqualification Reasons", count: s.disqualificationReasons.length },
    { key: "checklist", label: "Onboarding Checklist", count: s.onboardingItems.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Masters</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            The controlled lists that drive recruitment. Each is managed by the admins and its assigned owner — set that
            in Setup → Master Owners.
          </p>
        </div>
        <Button size="sm" onClick={() => setRaising(true)}>
          Request new entry
        </Button>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "titles" && <JobTitlesMaster />}
      {tab === "skills" && <SkillsMaster />}
      {tab === "qualifications" && (
        <SimpleMaster
          table="fms_hr_qualifications"
          masterType="qualification"
          singular="Qualification"
          rows={s.qualifications}
          hint="Educational requirements a requisition can ask for. Keep them broad — 'Diploma - Mechanical' rather than a specific institute — so one entry serves every vacancy that needs it."
        />
      )}
      {tab === "checklist" && <OnboardingItemsMaster />}
      {tab === "platforms" && (
        <SimpleMaster
          table="fms_hr_job_platforms"
          masterType="job_platform"
          singular="Platform"
          rows={s.jobPlatforms}
          hint="Where a vacancy gets advertised. HR ticks these at the Job Posting step, and the Dashboard reports which one actually produces hires."
        />
      )}
      {tab === "types" && (
        <SimpleMaster
          table="fms_hr_job_types"
          masterType="job_type"
          singular="Employment type"
          rows={s.jobTypes}
          hint="Full-time, part-time, contract, internship — what the requisition is offering. A job title can default to one of these, so the form fills it in."
        />
      )}
      {tab === "locations" && (
        <SimpleMaster
          table="fms_hr_locations"
          masterType="location"
          singular="Location"
          rows={s.locations}
          hint="Offices and sites a vacancy can be raised for. Deliberately separate from the Task Management location list, so adding one here never changes task checklists."
        />
      )}
      {tab === "reasons" && (
        <SimpleMaster
          table="fms_hr_disqualification_reasons"
          masterType="disqualification_reason"
          singular="Reason"
          rows={s.disqualificationReasons}
          hint="Why a candidate was dropped. Chosen when a card moves to Disqualified, and it is what tells you where the pipeline leaks."
        />
      )}

      <RequestMasterModal open={raising} onClose={() => setRaising(false)} masterType={null} />
    </div>
  );
}
