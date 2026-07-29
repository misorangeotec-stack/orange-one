import { useState } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { useSamplingStore } from "../../store";
import {
  CONFIRMER_SOURCE_LABEL,
  type Collector,
  type Company,
  type Confirmer,
  type ConfirmerSource,
  type HandoverRecipient,
  type ResultRecipient,
  type Sender,
} from "../../types";

type Tab = "company" | "collector" | "recipient" | "sender" | "confirmer" | "result_recipient";
const TABS: { key: Tab; label: string }[] = [
  { key: "company", label: "Companies" },
  { key: "collector", label: "Collectors" },
  { key: "recipient", label: "Hand-over recipients" },
  { key: "sender", label: "Senders" },
  { key: "confirmer", label: "Receipt confirmers" },
  { key: "result_recipient", label: "Result handover to" },
];

const SOURCE_OPTIONS: ComboOption[] = [
  { value: "domestic", label: "Domestic" },
  { value: "export", label: "Export" },
];

/**
 * Sampling Masters — six masters, tabbed:
 *   Company (structural), and five people-masters — Collector, Hand-over
 *   recipient, Sender, Receipt confirmer and Result handover to — each mapping to
 *   an app user so the chosen person can action their step and see it in their
 *   queue (collect / receive inward; send / confirm receipt / take the result
 *   outward). Editable by admins and the relevant master's owner (Setup → Master
 *   Owners).
 *
 * Receipt confirmer is the one master with a SOURCE: who may confirm receipt is
 * mapped separately for Domestic and Export dispatches, so the two can be
 * different people. Everyone listed for a source can action confirm_receipt on
 * that source's requests, ON TOP of the step's owners in Setup.
 *
 * "Result handover to" feeds the dropdown at the outward Result step and replaced
 * a free-text box: the person picked is notified and can action the handover, and
 * a typed name could do neither.
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

  // Shared shape for the four plain people-masters (Collector / Hand-over
  // recipient / Sender / Result handover to). Receipt confirmer has its own,
  // because it carries a source.
  const personColumns = (): MasterColumn<Collector | HandoverRecipient | Sender | ResultRecipient>[] => [
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
          Companies, collectors, hand-over recipients, senders, receipt confirmers and result-handover recipients.
          Each people-master maps to a portal user so the chosen person can action their step; receipt confirmers are
          mapped separately for Domestic and Export. Editable by admins and each master's owner (Setup → Master Owners).
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

      {tab === "sender" && (
        <MasterCrud<Sender>
          singular="Sender"
          rows={s.senders}
          columns={personColumns()}
          fields={personFields}
          searchText={(r) => `${r.name} ${s.personName(r.userId)}`}
          canManage={s.canManage("sender")}
          emptyValues={{ name: "", userId: "", sortOrder: "0" }}
          toValues={(r) => ({ name: r.name, userId: r.userId, sortOrder: String(r.sortOrder) })}
          onSubmit={async (id, v, active) => {
            const input = personInput(v, active);
            if (id) await s.updateSender(id, input);
            else await s.insertSender(input);
          }}
          onToggleActive={async (row, active) =>
            s.updateSender(row.id, { name: row.name, userId: row.userId, active, sortOrder: row.sortOrder })
          }
        />
      )}

      {tab === "confirmer" && (
        <MasterCrud<Confirmer>
          singular="Receipt confirmer"
          rows={s.confirmers}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Portal user", render: (r) => <span className="text-grey-2">{s.personName(r.userId)}</span> },
            {
              header: "Source",
              render: (r) => <span className="font-medium text-navy">{CONFIRMER_SOURCE_LABEL[r.source]}</span>,
              className: "w-32",
            },
            { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
          ]}
          fields={[
            { key: "name", label: "Display name", type: "text", required: true, placeholder: "e.g. Export desk" },
            { key: "userId", label: "Portal user", type: "select", required: true, options: userOptions, hint: "the app user who confirms receipt" },
            {
              key: "source",
              label: "Source",
              type: "select",
              required: true,
              options: SOURCE_OPTIONS,
              hint: "which dispatches this person covers — add the same person twice to cover both",
            },
            { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
          ]}
          searchText={(r) => `${r.name} ${s.personName(r.userId)} ${CONFIRMER_SOURCE_LABEL[r.source]}`}
          canManage={s.canManage("confirmer")}
          emptyValues={{ name: "", userId: "", source: "domestic", sortOrder: "0" }}
          toValues={(r) => ({ name: r.name, userId: r.userId, source: r.source, sortOrder: String(r.sortOrder) })}
          onSubmit={async (id, v, active) => {
            const input = { ...personInput(v, active), source: (v.source || "domestic") as ConfirmerSource };
            if (id) await s.updateConfirmer(id, input);
            else await s.insertConfirmer(input);
          }}
          onToggleActive={async (row, active) =>
            s.updateConfirmer(row.id, {
              name: row.name,
              userId: row.userId,
              source: row.source,
              active,
              sortOrder: row.sortOrder,
            })
          }
        />
      )}

      {tab === "result_recipient" && (
        <MasterCrud<ResultRecipient>
          singular="Result handover recipient"
          rows={s.resultRecipients}
          columns={personColumns()}
          fields={[
            { key: "name", label: "Display name", type: "text", required: true, placeholder: "e.g. Marketing head" },
            {
              key: "userId",
              label: "Portal user",
              type: "select",
              required: true,
              options: userOptions,
              hint: "notified when a result lands, and able to action the handover",
            },
            { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
          ]}
          searchText={(r) => `${r.name} ${s.personName(r.userId)}`}
          canManage={s.canManage("result_recipient")}
          emptyValues={{ name: "", userId: "", sortOrder: "0" }}
          toValues={(r) => ({ name: r.name, userId: r.userId, sortOrder: String(r.sortOrder) })}
          onSubmit={async (id, v, active) => {
            const input = personInput(v, active);
            if (id) await s.updateResultRecipient(id, input);
            else await s.insertResultRecipient(input);
          }}
          onToggleActive={async (row, active) =>
            s.updateResultRecipient(row.id, { name: row.name, userId: row.userId, active, sortOrder: row.sortOrder })
          }
        />
      )}
    </div>
  );
}
