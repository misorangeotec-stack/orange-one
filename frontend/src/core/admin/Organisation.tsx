import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import { useDirectory } from "@/core/platform/store";
import { useSession } from "@/core/platform/session";
import { DEPARTMENT_SOURCE_LABEL } from "@/core/platform/types";
import type { Band, Department, Designation, SubDepartment } from "@/core/platform/types";

/**
 * ORGANISATION MASTERS — where a person sits in the company.
 *
 * Four lists that used to be one free-text box each: Department (which was a
 * table already, but with no way to retire a row), Sub-department, Designation
 * and Band. The user form reads all four; nothing else in the portal owns them.
 *
 * ⚠ A DEPARTMENT IS SWITCHED OFF, NEVER DELETED — and MasterCrud has no delete
 *   button precisely because that is the house rule for every master. It matters
 *   more here than anywhere else: `departments` is the parent of 5,213 tasks,
 *   195 recurring tasks, 45 HR job titles, 12 requisitions and the
 *   `department_ids uuid[]` on nine FMS step-owner tables. Switching a row off
 *   removes it from the pickers that create NEW references and leaves every
 *   existing one resolvable. The old Departments screen had a delete button with
 *   no FK guard at all; this replaces it.
 *
 * ⚠ BAND IS NOT DERIVED FROM DESIGNATION. Several designations may share a band
 *   and nothing about a designation restricts which band sits beside it — band
 *   is picked per user on the user form. The `description` here is the example
 *   designations from HR's band sheet, and it is guidance text, nothing more.
 *
 * ⚠ COUNT COLUMNS DECLARE `sortValue` AND `filter` EXPLICITLY. MasterCrud infers
 *   both from the text a cell renders, so "12 users" would sort as a STRING —
 *   putting 9 after 12 — and offer a filter listing every distinct count. The
 *   numbers sort numerically and the filter is suppressed where it would only
 *   restate the table.
 */

type TabKey = "department" | "sub_department" | "designation" | "band";

const TABS: { value: TabKey; label: string }[] = [
  { value: "department", label: "Departments" },
  { value: "sub_department", label: "Sub-departments" },
  { value: "designation", label: "Designations" },
  { value: "band", label: "Bands" },
];

/** Departments predate the `active` column, so the type has it optional. */
type DeptRow = Department & { active: boolean };

const dash = <span className="text-grey-2">—</span>;

const sourceLabel = (d: Department) => DEPARTMENT_SOURCE_LABEL[d.source ?? "existing"];

/** A count cell: sorts as a number, and offers no filter (every value is a restatement). */
const countCol = <T extends { id: string }>(header: string, count: (row: T) => number): MasterColumn<T> => ({
  header,
  render: (r) => <span className="text-grey">{count(r)}</span>,
  sortValue: (r) => count(r),
  filter: false,
  className: "w-28",
});

export default function Organisation() {
  const {
    departments, subDepartments, designations, bands, profiles,
    departmentById,
    addDepartment, updateDepartment, setDepartmentActive,
    addSubDepartment, updateSubDepartment,
    addDesignation, updateDesignation,
    addBand, updateBand,
  } = useDirectory();
  const { isAdmin } = useSession();
  const [tab, setTab] = useState<TabKey>("department");

  const deptRows: DeptRow[] = useMemo(
    () => departments.map((d) => ({ ...d, active: d.active ?? true })),
    [departments],
  );

  /** Active departments only — a retired one must not be pickable as a new parent. */
  const departmentOptions = useMemo(
    () => deptRows.filter((d) => d.active).map((d) => ({ value: d.id, label: d.name })),
    [deptRows],
  );

  const usersInDept = (id: string) => profiles.filter((p) => p.departmentId === id).length;
  const usersInSubDept = (id: string) => profiles.filter((p) => p.subDepartmentId === id).length;
  const usersWithDesignation = (id: string) => profiles.filter((p) => p.designationId === id).length;
  const usersInBand = (id: string) => profiles.filter((p) => p.bandId === id).length;
  const subDeptsOf = (id: string) => subDepartments.filter((s) => s.departmentId === id).length;

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-[17px] font-semibold text-navy">Organisation</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-grey">
          Where a person sits in the company. Every user's department, sub-department, designation
          and band are picked from these lists. A list entry is switched <strong>off</strong> when it
          is no longer in use — it then disappears from the pickers but stays readable on the records
          that already reference it, so nothing in history changes.
        </p>
        {/* TEMPORARY, for the department reconciliation. Delete this note once the
            two lists have been merged and the tags stop being interesting. */}
        <p className="mt-2 max-w-2xl text-[12.5px] text-grey-2">
          <strong className="text-navy">Departments are mid-merge.</strong> “In which list” shows
          whether a department came from the portal, from HR’s employee sheet, or sits in both.
          Where the two lists name one team differently it stays a <em>single</em> row, with HR’s
          name shown underneath. The two departments only HR had — Ink Manufacturing and
          M/C Manufacturing — are here but switched <strong>off</strong>, so nobody can be assigned
          to them until you turn them on.
        </p>
      </Card>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.value, label: t.label }))}
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {/* ------------------------------------------------------ departments -- */}
      {tab === "department" && (
        <MasterCrud<DeptRow>
          singular="Department"
          rows={deptRows}
          canManage={isAdmin}
          searchText={(r) => `${r.name} ${r.description ?? ""} ${r.hrSheetName ?? ""}`}
          columns={[
            {
              header: "Name",
              render: (r) => (
                <>
                  <span className="font-medium text-navy">{r.name}</span>
                  {/* Only where HR calls it something else — repeating an
                      identical name on every row would be noise. */}
                  {r.hrSheetName && r.hrSheetName !== r.name && (
                    <span className="block text-[11px] text-grey-2">HR sheet: {r.hrSheetName}</span>
                  )}
                </>
              ),
              sortValue: (r) => r.name,
            },
            {
              header: "In which list",
              render: (r) => <span className="text-grey">{sourceLabel(r)}</span>,
              sortValue: (r) => sourceLabel(r),
              filter: { get: (r) => sourceLabel(r), placeholder: "Any list" },
              className: "w-36",
            },
            { header: "Description", render: (r) => r.description || dash },
            countCol<DeptRow>("Sub-depts", (r) => subDeptsOf(r.id)),
            countCol<DeptRow>("Users", (r) => usersInDept(r.id)),
          ]}
          fields={[
            { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Supply Chain" },
            { key: "description", label: "Description", type: "textarea", placeholder: "What this department does…" },
          ]}
          emptyValues={{ name: "", description: "" }}
          toValues={(r) => ({ name: r.name, description: r.description ?? "" })}
          onSubmit={async (id, v, active) => {
            const name = v.name.trim();
            const description = v.description.trim() || null;
            if (id) {
              await updateDepartment(id, { name, description: description ?? undefined });
              const was = deptRows.find((d) => d.id === id)?.active ?? true;
              if (was !== active) await setDepartmentActive(id, active);
            } else {
              const newId = await addDepartment({ name, description: description ?? undefined });
              if (!active) await setDepartmentActive(newId, false);
            }
          }}
          onToggleActive={async (r, active) => setDepartmentActive(r.id, active)}
        />
      )}

      {/* -------------------------------------------------- sub-departments -- */}
      {tab === "sub_department" && (
        <MasterCrud<SubDepartment>
          singular="Sub-department"
          rows={subDepartments}
          canManage={isAdmin}
          searchText={(r) => `${r.name} ${departmentById(r.departmentId)?.name ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Department", render: (r) => departmentById(r.departmentId)?.name ?? dash },
            countCol<SubDepartment>("Users", (r) => usersInSubDept(r.id)),
          ]}
          fields={[
            { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Spare Warehouse" },
            {
              key: "department_id", label: "Department", type: "select", required: true,
              options: departmentOptions, placeholder: "Select department",
              hint: "Sub-department names only need to be unique WITHIN a department, so two departments may each have a Procurement.",
            },
          ]}
          emptyValues={{ name: "", department_id: "" }}
          toValues={(r) => ({ name: r.name, department_id: r.departmentId })}
          onSubmit={async (id, v, active) => {
            const input = { departmentId: v.department_id, name: v.name.trim(), active };
            if (id) await updateSubDepartment(id, input);
            else await addSubDepartment(input);
          }}
          onToggleActive={async (r, active) => updateSubDepartment(r.id, { active })}
        />
      )}

      {/* --------------------------------------------------- designations --- */}
      {tab === "designation" && (
        <MasterCrud<Designation>
          singular="Designation"
          rows={designations}
          canManage={isAdmin}
          // Junior to senior, the way the ladder was seeded.
          defaultOrder={(r) => r.sortOrder}
          searchText={(r) => r.name}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            {
              header: "Ladder position",
              render: (r) => <span className="text-grey">{r.sortOrder || dash}</span>,
              sortValue: (r) => r.sortOrder,
              filter: false,
              className: "w-32",
            },
            countCol<Designation>("Users", (r) => usersWithDesignation(r.id)),
          ]}
          fields={[
            { key: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Senior Service Engineer" },
            {
              key: "sort_order", label: "Ladder position", type: "text",
              placeholder: "e.g. 120",
              hint: "Low to high seniority — it orders the picker on the user form. It carries no band meaning; band is chosen separately per user.",
            },
          ]}
          emptyValues={{ name: "", sort_order: "" }}
          toValues={(r) => ({ name: r.name, sort_order: String(r.sortOrder || "") })}
          onSubmit={async (id, v, active) => {
            const input = { name: v.name.trim(), active, sortOrder: Number(v.sort_order) || 0 };
            if (id) await updateDesignation(id, input);
            else await addDesignation(input);
          }}
          onToggleActive={async (r, active) => updateDesignation(r.id, { active })}
        />
      )}

      {/* --------------------------------------------------------- bands ---- */}
      {tab === "band" && (
        <MasterCrud<Band>
          singular="Band"
          rows={bands}
          canManage={isAdmin}
          // A ladder reads 1..9, never alphabetically by category.
          defaultOrder={(r) => r.bandNo}
          searchText={(r) => `${r.bandNo} ${r.name} ${r.description ?? ""}`}
          columns={[
            {
              header: "Band",
              render: (r) => <span className="font-medium text-navy">Band {r.bandNo}</span>,
              sortValue: (r) => r.bandNo,
              className: "w-24",
            },
            { header: "Category", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            {
              header: "Typically includes",
              render: (r) => <span className="text-grey">{r.description || "—"}</span>,
              // Free prose, distinct on every row — a dropdown of it would just
              // repeat the column.
              filter: false,
            },
            countCol<Band>("Users", (r) => usersInBand(r.id)),
          ]}
          fields={[
            { key: "band_no", label: "Band number", type: "text", required: true, placeholder: "e.g. 3" },
            { key: "name", label: "Category", type: "text", required: true, placeholder: "e.g. Executive Level" },
            {
              key: "description", label: "Typically includes", type: "textarea",
              placeholder: "HR Executive, Accounts Executive, Sales Executive…",
              hint: "Guidance only. It does not restrict which designations may be given this band.",
            },
          ]}
          emptyValues={{ band_no: "", name: "", description: "" }}
          toValues={(r) => ({ band_no: String(r.bandNo), name: r.name, description: r.description ?? "" })}
          onSubmit={async (id, v, active) => {
            const bandNo = Number(v.band_no) || 0;
            const input = { bandNo, name: v.name.trim(), description: v.description.trim() || null, active, sortOrder: bandNo * 10 };
            if (id) await updateBand(id, input);
            else await addBand(input);
          }}
          onToggleActive={async (r, active) => updateBand(r.id, { active })}
        />
      )}
    </div>
  );
}
