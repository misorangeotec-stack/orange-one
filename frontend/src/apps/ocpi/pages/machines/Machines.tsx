import { useMemo } from "react";
import { Link } from "react-router-dom";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useOcpiStore } from "../../store";
import { createMachine, setMachineActive, updateMachine } from "../../data/ocpiMachineWrites";
import type { OcpiMachine } from "../../types";

/**
 * The machine master — which is also the order-confirmation template list.
 *
 * ⚠ THIS IS THE QUOTATION'S MODEL DROPDOWN. It is not a lookup table beside the
 *   real list; there is no other list. The Microsoft form's 25 options and the
 *   ten PowerPoint templates were different vocabularies that could not be
 *   reconciled by name — "Alpha 2 - 8 Heads machine" is three different decks —
 *   so the master IS the vocabulary, and adding a machine here is how a new
 *   model becomes quotable.
 *
 * ⚠ THE TEMPLATE ITSELF IS EDITED ON ITS OWN PAGE. Specification rows,
 *   composition bullets and the boilerplate sections are ordered documents, and
 *   MasterCrud's form is built for flat values — a JSON blob in a textarea is not
 *   an editor. This screen owns the machine's identity; "Template" opens the
 *   rest.
 */
export default function Machines() {
  const s = useOcpiStore();

  const columns = useMemo<MasterColumn<OcpiMachine>[]>(
    () => [
      {
        header: "Machine",
        render: (m) => (
          <span className="font-semibold text-navy">{m.name}</span>
        ),
        filter: { get: (m) => m.name },
      },
      {
        header: "Document heading",
        render: (m) => m.docTitle,
        filter: { get: (m) => m.docTitle },
      },
      {
        header: "Model no.",
        render: (m) => m.machineModelNo ?? "—",
        filter: { get: (m) => m.machineModelNo ?? "" },
      },
      {
        header: "Template",
        render: (m) =>
          m.hasTemplate ? (
            <Link to={`/ocpi/machines/${m.id}`} className="font-medium text-orange hover:underline">
              {m.specRows.length} specs · {s.sectionsFor(m.id).length} sections
            </Link>
          ) : (
            <Link to={`/ocpi/machines/${m.id}`} className="text-grey-2 hover:text-orange hover:underline">
              not built yet
            </Link>
          ),
        // Ordered and filtered by the ANSWER, not by the link text — otherwise
        // "12 specs" sorts beside "not built yet" and the column tells you
        // nothing about which machines are ready.
        sortValue: (m) => (m.hasTemplate ? 1 : 0),
        filter: { get: (m) => (m.hasTemplate ? "Ready" : "Not built yet") },
      },
      {
        header: "Sign-off",
        render: (m) => (m.signoffStyle === "checked_by" ? "Checked By" : "Approved By"),
        filter: { get: (m) => (m.signoffStyle === "checked_by" ? "Checked By" : "Approved By") },
      },
    ],
    [s],
  );

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Machine name", type: "text", required: true,
      hint: "What a salesperson picks on the quotation. Include the width and head count where models differ." },
    { key: "docTitle", label: "Document heading", type: "select", required: true,
      options: [
        { value: "ORDER CONFIRMATION", label: "ORDER CONFIRMATION" },
        { value: "OFFER QUOTE", label: "OFFER QUOTE" },
      ],
      hint: "P8D's deck is headed OFFER QUOTE — check before changing." },
    { key: "machineModelNo", label: "Manufacturer's model no.", type: "text",
      hint: "e.g. HM1800B-TK24. Available in templates as {{machine_model_no}}." },
    { key: "signoffStyle", label: "Sign-off wording", type: "select",
      options: [
        { value: "approved_by", label: "Prepared By / Approved By" },
        { value: "checked_by", label: "Prepared By / Checked By" },
      ] },
    { key: "introText", label: "Opening line", type: "textarea",
      hint: "“Following up your kind order, we are glad to confirm the supply of …”" },
    { key: "sortOrder", label: "Sort order", type: "text" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Machines</h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">
          Every model that can be quoted, and the detailed sheet&rsquo;s template behind it. A
          machine with no template can still be quoted and still goes all the way through — it
          simply issues the summary sheet alone, and the salesperson is told so before they send it.
        </p>
      </div>

      <MasterCrud<OcpiMachine>
        singular="machine"
        rows={s.machines}
        columns={columns}
        fields={fields}
        searchText={(m) => `${m.name} ${m.machineModelNo ?? ""} ${m.docTitle}`}
        defaultOrder={(m) => m.sortOrder}
        canManage={s.isAdmin}
        emptyValues={{
          name: "",
          docTitle: "ORDER CONFIRMATION",
          machineModelNo: "",
          signoffStyle: "approved_by",
          introText: "",
          sortOrder: "500",
        }}
        toValues={(m) => ({
          name: m.name,
          docTitle: m.docTitle,
          machineModelNo: m.machineModelNo ?? "",
          signoffStyle: m.signoffStyle,
          introText: m.introText ?? "",
          sortOrder: String(m.sortOrder),
        })}
        onSubmit={async (id, values, active) => {
          const patch = {
            name: values.name,
            docTitle: values.docTitle,
            machineModelNo: values.machineModelNo || null,
            signoffStyle: values.signoffStyle,
            introText: values.introText || null,
            sortOrder: Number(values.sortOrder) || 500,
            active,
          };
          if (id) await updateMachine(id, patch);
          else
            await createMachine({
              ...patch,
              supplyDescription: null,
              specRows: [],
              composition: [],
              headerFields: ["attn", "date", "ref", "address"],
              // A brand-new machine has no template until somebody builds one.
              hasTemplate: false,
            });
          await s.refresh();
        }}
        onToggleActive={async (row, active) => {
          await setMachineActive(row.id, active);
          await s.refresh();
        }}
      />
    </div>
  );
}
