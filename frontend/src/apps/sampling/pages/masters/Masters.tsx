import { useState } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useSamplingStore } from "../../store";
import type { Collector, Company, HandoverRecipient } from "../../types";

type Tab = "company" | "collector" | "recipient";
const TABS: { key: Tab; label: string }[] = [
  { key: "company", label: "Companies" },
  { key: "collector", label: "Collectors" },
  { key: "recipient", label: "Hand-over recipients" },
];

/**
 * Sampling Masters — three masters, tabbed:
 *   Company (structural), Collector and Hand-over recipient (each maps to an app
 *   user so the chosen person can action their step and see it in their queue).
 * Editable by admins and the relevant master's owner (Setup → Master Owners).
 */
export default function Masters() {
  const s = useSamplingStore();
  const [tab, setTab] = useState<Tab>("company");

  const userOptions: ComboOption[] = [...s.samplingUsers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name }));

  const companyColumns: MasterColumn<Company>[] = [
    { header: "Company", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];
  const companyFields: MasterFieldDef[] = [
    { key: "name", label: "Company", type: "text", required: true },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  // Shared shape for the two people-masters (Collector / Hand-over recipient).
  const personColumns = (): MasterColumn<Collector | HandoverRecipient>[] => [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Portal user", render: (r) => <span className="text-grey-2">{s.personName(r.userId)}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];
  const personFields: MasterFieldDef[] = [
    { key: "name", label: "Display name", type: "text", required: true, placeholder: "e.g. R&D lab" },
    { key: "userId", label: "Portal user", type: "select", required: true, options: userOptions, hint: "the app user who acts on this step" },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];
  const personInput = (v: Record<string, string>, active: boolean) => ({
    name: v.name.trim(),
    userId: v.userId,
    active,
    sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Companies, collectors and hand-over recipients. Collectors and recipients each map to a portal user so the
          chosen person can action their step. Editable by admins and each master's owner (Setup → Master Owners).
        </p>
      </div>

      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 text-[13px] font-semibold -mb-px border-b-2 ${
              tab === t.key ? "border-orange text-navy" : "border-transparent text-grey-2 hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" && (
        <MasterCrud<Company>
          singular="Company"
          rows={s.companies}
          columns={companyColumns}
          fields={companyFields}
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
      )}

      {tab === "collector" && (
        <MasterCrud<Collector>
          singular="Collector"
          rows={s.collectors}
          columns={personColumns()}
          fields={personFields}
          searchText={(r) => `${r.name} ${s.personName(r.userId)}`}
          canManage={s.canManage("collector")}
          emptyValues={{ name: "", userId: "", sortOrder: "0" }}
          toValues={(r) => ({ name: r.name, userId: r.userId, sortOrder: String(r.sortOrder) })}
          onSubmit={async (id, v, active) => {
            const input = personInput(v, active);
            if (id) await s.updateCollector(id, input);
            else await s.insertCollector(input);
          }}
          onToggleActive={async (row, active) =>
            s.updateCollector(row.id, { name: row.name, userId: row.userId, active, sortOrder: row.sortOrder })
          }
        />
      )}

      {tab === "recipient" && (
        <MasterCrud<HandoverRecipient>
          singular="Hand-over recipient"
          rows={s.recipients}
          columns={personColumns()}
          fields={personFields}
          searchText={(r) => `${r.name} ${s.personName(r.userId)}`}
          canManage={s.canManage("recipient")}
          emptyValues={{ name: "", userId: "", sortOrder: "0" }}
          toValues={(r) => ({ name: r.name, userId: r.userId, sortOrder: String(r.sortOrder) })}
          onSubmit={async (id, v, active) => {
            const input = personInput(v, active);
            if (id) await s.updateRecipient(id, input);
            else await s.insertRecipient(input);
          }}
          onToggleActive={async (row, active) =>
            s.updateRecipient(row.id, { name: row.name, userId: row.userId, active, sortOrder: row.sortOrder })
          }
        />
      )}
    </div>
  );
}
