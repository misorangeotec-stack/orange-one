import { useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useHrStore } from "../../store";
import type { HrMasterTable } from "../../data/hrWrites";
import type { HrMaster, OnboardingItem } from "../../types";

/**
 * HR masters (admin). Everything HR needs to change themselves — the platforms a
 * job is posted on, the employment types, the offices, why a candidate was dropped,
 * and THE ONBOARDING CHECKLIST.
 *
 * The checklist being editable here is the whole point: adding a 7th item must
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
  singular,
  rows,
  hint,
}: {
  table: HrMasterTable;
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
        canManage={s.canConfigure}
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
      render: (r) => (r.allowsLink ? <span className="text-navy">Allowed</span> : <span className="text-grey-2">—</span>),
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
        the next onboarding with no code change. Deactivating an item leaves past onboardings untouched.
      </p>
      <MasterCrud<OnboardingItem>
        singular="Checklist item"
        rows={s.onboardingItems}
        columns={columns}
        fields={fields}
        searchText={(r) => `${r.name} ${r.description ?? ""}`}
        canManage={s.canConfigure}
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

export default function MastersSection() {
  const s = useHrStore();
  const [tab, setTab] = useState("checklist");

  const tabs = [
    { key: "checklist", label: "Onboarding Checklist" },
    { key: "platforms", label: "Job Platforms" },
    { key: "types", label: "Job Types" },
    { key: "locations", label: "Locations" },
    { key: "reasons", label: "Disqualification Reasons" },
  ];

  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "checklist" && <OnboardingItemsMaster />}
      {tab === "platforms" && (
        <SimpleMaster
          table="fms_hr_job_platforms"
          singular="Platform"
          rows={s.jobPlatforms}
          hint="Where a vacancy gets advertised. HR ticks these at the Job Posting step, and the Dashboard reports which one actually produces hires."
        />
      )}
      {tab === "types" && (
        <SimpleMaster
          table="fms_hr_job_types"
          singular="Job type"
          rows={s.jobTypes}
          hint="The employment type a requisition is raised for."
        />
      )}
      {tab === "locations" && (
        <SimpleMaster
          table="fms_hr_locations"
          singular="Location"
          rows={s.locations}
          hint="Offices and sites a vacancy can be raised for. Deliberately separate from the Task Management location list, so adding one here never changes task checklists."
        />
      )}
      {tab === "reasons" && (
        <SimpleMaster
          table="fms_hr_disqualification_reasons"
          singular="Reason"
          rows={s.disqualificationReasons}
          hint="Why a candidate was dropped. Chosen when a card moves to Disqualified, and it is what tells you where the pipeline leaks."
        />
      )}
    </div>
  );
}
