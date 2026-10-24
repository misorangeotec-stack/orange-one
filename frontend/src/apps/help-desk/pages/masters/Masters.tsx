import { useMemo } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Card from "@/shared/components/ui/Card";
import { appName } from "@/apps/appInfo";
import { useHelpStore } from "../../store";
import { saveCategory, setCategoryActive } from "../../data/helpWrites";
import { ConfidentialPill } from "../../components/StatusPill";
import type { TicketCategory } from "../../types";

/**
 * The ticket-category master — THE ROUTER.
 *
 * Each row decides who answers a ticket, how long they have, who a reopen
 * escalates to, whether it is confidential and whether the work belongs to
 * another module. Editing one changes the behaviour of every ticket raised under
 * it from that moment on.
 *
 * ⚠ THE `code` IS NOT EDITABLE, and that is deliberate. Every report matches on
 *   it — the SLA breakdown, the trend, the confidential register — so renaming a
 *   code would silently re-partition months of history. The NAME is what people
 *   read and can be changed freely; the code is what the code reads.
 *
 * ⚠ `confidential` IS NOT EDITABLE EITHER, from this screen or any other. Turning
 *   it ON would not un-read a ticket somebody has already seen; turning it OFF
 *   would hand a grievance's whole history to the HR pool in one click. The three
 *   confidential categories are fixed in the schema and the row says so.
 *
 * ⚠ CHANGING A TAT DOES NOT MOVE EXISTING TICKETS' HISTORY, but it does move
 *   their DUE DATES — nothing is stored, so every open ticket in that category
 *   re-derives against the new number the instant it is saved. A ticket can
 *   become overdue because somebody edited a master. The hint on the field says
 *   so.
 */
export default function Masters() {
  const s = useHelpStore();

  const peopleOptions = useMemo(
    () => s.orgPeople.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.orgPeople],
  );

  const names = (ids: string[]) =>
    ids.map((i) => s.personName(i)).filter((n) => n !== "—").join(", ");

  /** A people picker that serialises into the form's flat string bag. */
  const people = (label: string, hint: string): MasterFieldDef["render"] =>
    (value, onChange) => (
      <MultiSelect
        options={peopleOptions}
        values={value ? value.split(",").filter(Boolean) : []}
        onChange={(v) => onChange(v.join(","))}
        placeholder={label}
        searchable
      />
    );

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Category", type: "text", required: true, placeholder: "e.g. Payroll Queries" },
    {
      key: "owner_ids",
      label: "Who answers it",
      type: "custom",
      required: true,
      hint: "The process owner. Tickets raised under this category go straight to them.",
      render: people("Search everyone", ""),
    },
    {
      key: "tat_days",
      label: "Turnaround (working days)",
      type: "text",
      hint:
        "Working days from when the ticket is raised. 0 means the same working day. " +
        "LEAVE IT EMPTY for a category governed by policy rather than a number of days. " +
        "those tickets show no due date and are never counted as late. " +
        "⚠ Changing this moves the due date of every OPEN ticket in the category, immediately.",
    },
    {
      key: "tat_text",
      label: "Turnaround, in words",
      type: "text",
      hint: 'Shown instead of a date when there is no number, e.g. "As per Exit Policy". Required if the number is empty.',
    },
    {
      key: "escalation_l1_ids",
      label: "Escalation level 1",
      type: "custom",
      hint: "Told when a ticket is reopened once, and able to work on it from then on.",
      render: people("Search everyone", ""),
    },
    {
      key: "escalation_l1_label",
      label: "Level 1, in words",
      type: "text",
      hint: 'What the sheet promises, e.g. "HR Head". Printed even when nobody is named, but then nobody is actually told.',
    },
    {
      key: "escalation_l2_ids",
      label: "Escalation level 2",
      type: "custom",
      hint: "Told when a ticket is reopened a second time.",
      render: people("Search everyone", ""),
    },
    {
      key: "escalation_l2_label",
      label: "Level 2, in words",
      type: "text",
      hint: 'e.g. "Management". ⚠ Every level 2 is a label with nobody behind it today. Until real people are named here, a second reopen tells only the fallback in Settings.',
    },
    {
      key: "handoff_app_id",
      label: "Really handled in",
      type: "select",
      options: [
        { value: "", label: "Answered here" },
        { value: "travel-desk", label: appName("travel-desk") },
        { value: "hr-recruitment", label: appName("hr-recruitment") },
        { value: "office-supplies", label: appName("office-supplies") },
        { value: "learning-development", label: appName("learning-development") },
        { value: "hr-exit", label: appName("hr-exit") },
      ],
      hint: "The employee still raises it here; the owner starts the real work in that module and records the reference.",
    },
    {
      key: "requires_note",
      // ⚠ `select`, NOT `choice`. MasterCrud wraps every field in FieldLabel,
      //   which is a <label>, and a click on the question text over a
      //   ChoiceButtons strip silently picks the FIRST option. The bug is shared
      //   by every masters page in the hub; until it is fixed there, nothing new
      //   declares `choice`.
      label: "Force a description",
      type: "select",
      options: [
        { value: "no", label: "No" },
        { value: "yes", label: "Yes, the employee must describe it" },
      ],
      hint: 'On for "Others", where the category name alone tells the owner nothing.',
    },
    { key: "sort_order", label: "Order in the list", type: "text" },
  ];

  const columns: MasterColumn<TicketCategory>[] = [
    {
      header: "Category",
      render: (c) => (
        <span className="flex items-center gap-2">
          <span>{c.name}</span>
          {c.confidential && <ConfidentialPill />}
        </span>
      ),
    },
    { header: "Code", render: (c) => <span className="font-mono text-[12px]">{c.code}</span> },
    { header: "Who answers it", render: (c) => names(c.ownerIds) || "Nobody, tickets go nowhere" },
    {
      header: "Turnaround",
      render: (c) =>
        c.tatDays === null
          ? (c.tatText ?? "—")
          : c.tatDays === 0
            ? (c.tatText ?? "Same working day")
            : `${c.tatDays} working day${c.tatDays === 1 ? "" : "s"}`,
      // Untimed sorts to the END, not to the front as a 0 would.
      sortValue: (c) => (c.tatDays === null ? 9999 : c.tatDays),
    },
    {
      header: "Escalates to",
      render: (c) => {
        const l1 = names(c.escalationL1Ids) || c.escalationL1Label || "—";
        const l2 = names(c.escalationL2Ids) || c.escalationL2Label || "—";
        return `${l1} → ${l2}`;
      },
    },
    {
      header: "Handled in",
      render: (c) => (c.handoffAppId ? appName(c.handoffAppId) : "Here"),
    },
  ];

  const toValues = (c: TicketCategory): Record<string, string> => ({
    name: c.name,
    owner_ids: c.ownerIds.join(","),
    tat_days: c.tatDays === null ? "" : String(c.tatDays),
    tat_text: c.tatText ?? "",
    escalation_l1_ids: c.escalationL1Ids.join(","),
    escalation_l1_label: c.escalationL1Label ?? "",
    escalation_l2_ids: c.escalationL2Ids.join(","),
    escalation_l2_label: c.escalationL2Label ?? "",
    handoff_app_id: c.handoffAppId ?? "",
    requires_note: c.requiresNote ? "yes" : "no",
    sort_order: String(c.sortOrder),
  });

  return (
    <div>
      <h1 className="text-[20px] font-bold text-navy">Ticket categories</h1>
      <p className="mt-1 max-w-3xl text-[13.5px] text-grey-2">
        What an employee picks when they raise a ticket, and what happens next. The category decides
        who answers it and by when, so a change here changes every ticket raised under it from now
        on, and moves the due date of the ones already open.
      </p>

      {/* ⚠ SAID ON THE SCREEN, not only in a migration comment. This is the one
          thing that stops the escalation ladder working, and it is HR's to fix. */}
      <Card className="mt-4 border-[#FEDF89] bg-[#FFFAEB] p-4">
        <p className="text-[13px] font-semibold text-[#B54708]">
          No level-2 escalation has a real person behind it
        </p>
        <p className="mt-0.5 text-[12.5px] text-[#B54708]">
          Every category's level 2 is a label (Management, Finance Head, Admin Vendor, ICC
          Committee) because none of them is an Orange One account. Until somebody is named, a
          second reopen tells only the fallback set in Settings.
        </p>
      </Card>

      <div className="mt-4">
        <MasterCrud<TicketCategory>
          singular="ticket category"
          rows={s.categories}
          columns={columns}
          fields={fields}
          searchText={(c) => `${c.name} ${c.code} ${names(c.ownerIds)}`}
          defaultOrder={(c) => c.sortOrder}
          canManage={s.canManageMasters}
          statusNote="A category switched off stays on its old tickets and stops being offered on the raise form."
          emptyValues={{
            name: "", owner_ids: "", tat_days: "", tat_text: "",
            escalation_l1_ids: "", escalation_l1_label: "", escalation_l2_ids: "",
            escalation_l2_label: "", handoff_app_id: "", requires_note: "no", sort_order: "999",
          }}
          toValues={toValues}
          onSubmit={async (id, values, active) => {
            await saveCategory(id, values, active);
            await s.refresh();
          }}
          onToggleActive={async (row, active) => {
            await setCategoryActive(row.id, active);
            await s.refresh();
          }}
        />
      </div>
    </div>
  );
}
