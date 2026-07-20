import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useSamplingStore } from "../../store";
import type { Company } from "../../types";

/**
 * Sampling Masters — Company is the ONLY master, and it is structural (rarely
 * added). There is no "request a new master" flow: an admin or the company
 * master's owner adds one directly here.
 */
export default function Masters() {
  const s = useSamplingStore();

  const columns: MasterColumn<Company>[] = [
    { header: "Company", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];
  const fields: MasterFieldDef[] = [
    { key: "name", label: "Company", type: "text", required: true },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          The Orange O Tec entities a sampling request belongs to. Editable by the admins and the company master's owner
          (Setup → Master Owners).
        </p>
      </div>

      <MasterCrud<Company>
        singular="Company"
        rows={s.companies}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage("company")}
        emptyValues={{ name: "", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = { name: v.name.trim(), active, sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)) };
          if (id) await s.updateCompany(id, input);
          else await s.insertCompany(input);
        }}
        onToggleActive={async (row, active) => s.updateCompany(row.id, { name: row.name, active, sortOrder: row.sortOrder })}
      />
    </div>
  );
}
