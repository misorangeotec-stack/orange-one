import { useMemo } from "react";
import { Link } from "react-router-dom";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { useOcpiStore } from "../../store";
import { createMachine, setMachineActive, updateMachine } from "../../data/ocpiMachineWrites";
import { replaceMachineHeads } from "../../data/ocpiMasterWrites";
import { MACHINE_OPTIONS, type OcpiMachine } from "../../types";

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

  const categoryName = (id: string | null) =>
    (id ? s.machineCategories.find((c) => c.id === id)?.name : "") ?? "";

  /** The heads a machine carries, as one readable string. Empty is legitimate. */
  const headNames = (m: OcpiMachine) => s.headsFor(m.id).map((h) => h.name).join(", ");

  const optLabel = (v: string | null) =>
    v ? MACHINE_OPTIONS.find((o) => o.value === v)?.label.split(" — ")[0] ?? v : "—";

  const columns = useMemo<MasterColumn<OcpiMachine>[]>(
    () => [
      {
        header: "Machine code",
        render: (m) => (
          <span className="font-semibold text-navy">{m.name}</span>
        ),
        filter: { get: (m) => m.name },
      },
      {
        // ⚠ THE CODE AND THE BILLING NAME ARE TWO COLUMNS, NOT ONE CELL. The
        //   client asked for both to print, and a reader filtering on "the name"
        //   has to be able to pick which one they mean. `name` is untouched and
        //   is still the code every existing deal points at.
        header: "Billing name",
        render: (m) => m.billingName ?? <span className="text-grey-2">—</span>,
        filter: { get: (m) => m.billingName ?? "" },
      },
      {
        header: "Category",
        render: (m) => categoryName(m.categoryId) || <span className="text-grey-2">—</span>,
        filter: { get: (m) => categoryName(m.categoryId) },
      },
      {
        header: "Print heads",
        render: (m) => headNames(m) || <span className="text-grey-2">—</span>,
        // Ordered by how MANY heads, not by the joined text: "EX600 RC Katan,
        // Homer" would otherwise sort beside an unrelated single head.
        sortValue: (m) => s.headsFor(m.id).length,
        filter: { get: (m) => headNames(m) },
      },
      {
        header: "Dryer",
        render: (m) =>
          m.needsDryer === null ? <span className="text-grey-2">—</span> : m.needsDryer ? "Needs one" : "No dryer",
        sortValue: (m) => (m.needsDryer === null ? -1 : m.needsDryer ? 1 : 0),
        // Unanswered returns "" so it reads as "(Blank)", the same as an empty
        // Billing name or Model no. on this table. It used to hand-roll the
        // literal "Not set" — the only column here that worked, because its
        // author remembered a case the shared component did not handle. Now that
        // MasterCrud keeps blanks itself (OCPI-9), the workaround would be a
        // second spelling of "nothing here" on one screen.
        filter: {
          get: (m) => (m.needsDryer === null ? "" : m.needsDryer ? "Needs one" : "No dryer"),
        },
      },
      {
        header: "Centering",
        render: (m) => optLabel(m.optExternalCentering),
        filter: { get: (m) => optLabel(m.optExternalCentering) },
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

  const optionField = (key: string, label: string, hint?: string): MasterFieldDef => ({
    // No / Optional / Yes — a fixed vocabulary, and asked FOUR times on this
    // form, so it is the clearest case on the screen for showing the answers.
    key, label, type: "choice", hint,
    options: MACHINE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
  });

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Machine code", type: "text", required: true,
      hint: "What a salesperson picks on the quotation. Include the width and head count where models differ. Existing deals point at this, so changing it renames the machine everywhere." },
    { key: "billingName", label: "Billing name", type: "text",
      hint: "The full product name as it reads on an invoice, e.g. “Large format inkjet printer with 24 heads with std. accessories”. Prints beside the code." },
    { key: "categoryId", label: "Category", type: "select",
      options: s.machineCategories
        .filter((c) => c.active)
        .map((c) => ({ value: c.id, label: c.name })),
      hint: "Chosen first on the quotation, and it narrows the machine list." },
    {
      // ⚠ A MACHINE MAY HAVE SEVERAL HEADS. The client's sheet lists two in one
      //   cell for five machines, and confirmed that is real. The quotation
      //   SHOWS these and does not let the salesperson choose — so what is set
      //   here is what every future quotation for this machine will say.
      key: "headTypeIds",
      label: "Print heads",
      type: "custom",
      hint: "All of them. The quotation displays these and the salesperson cannot change them.",
      render: (value, onChange) => (
        <MultiSelect
          values={value ? value.split(",").filter(Boolean) : []}
          onChange={(ids) => onChange(ids.join(","))}
          options={s.headTypes.map((h) => ({ value: h.id, label: h.name }))}
          placeholder="No head mapped"
          searchable
          chips
        />
      ),
    },
    // ⚠ REQUIRED SINCE STAGE E, and that is load-bearing rather than tidy.
    //   `fms_ocpi_write_oc` treats a NULL flag as "no dryer" and nulls every
    //   dryer column on the deal; the form hides the whole Dryer details card
    //   for the same reason. Leaving this blank would therefore make a section
    //   silently unreachable for that model, with no error anywhere. All 28
    //   machines carry an answer today — this keeps the 29th from arriving
    //   without one.
    { key: "needsDryer", label: "Takes a dryer", type: "choice", required: true,
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      hint: "Per machine, not per category — the client sheet has Position Printer needing one while the three Pengdas in the same category do not. Decides whether the quotation shows the dryer section at all, so it must be answered." },
    /*
      ⚠ WHAT THESE FOUR STILL DO, now that three of them no longer hide
        anything (OCPI-10). They were the gate on all four questions; they are
        now the gate on ONE. The other three keep a smaller but real job: "yes"
        puts a "standard on this machine" note beside the question on the
        quotation, which is how a salesperson tells a genuinely optional extra
        from one the model always ships with. Left blank they say nothing, and
        the question is still asked. So none of the four is a field that does
        nothing — but only external centering changes what the form shows.
    */
    optionField("optAirBlade", "Air blade",
      "Shows a “standard on this machine” note beside the question on the quotation. It no longer decides whether the question is asked — air blade is asked on every deal."),
    optionField("optExternalCentering", "External centering",
      "THE ONE EXTRA THAT IS STILL A GATE. Decides whether the quotation asks about the centering system at all — both the tick in Deal inclusions and how the device ships and is invoiced. “No” or blank hides all of it."),
    optionField("optInkDustExhauster", "Ink dust exhauster",
      "Shows a “standard on this machine” note beside the question on the quotation. It no longer decides whether the question is asked."),
    optionField("optChillingSystem", "Chilling system",
      "Shows a “standard on this machine” note beside the question on the quotation. It no longer decides whether the question is asked."),
    { key: "docTitle", label: "Document heading", type: "choice", required: true,
      options: [
        { value: "ORDER CONFIRMATION", label: "ORDER CONFIRMATION" },
        { value: "OFFER QUOTE", label: "OFFER QUOTE" },
      ],
      hint: "P8D's deck is headed OFFER QUOTE — check before changing." },
    { key: "machineModelNo", label: "Manufacturer's model no.", type: "text",
      hint: "e.g. HM1800B-TK24. Available in templates as {{machine_model_no}}." },
    { key: "signoffStyle", label: "Sign-off wording", type: "choice",
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
        searchText={(m) =>
          `${m.name} ${m.billingName ?? ""} ${categoryName(m.categoryId)} ${headNames(m)} ${m.machineModelNo ?? ""} ${m.docTitle}`
        }
        defaultOrder={(m) => m.sortOrder}
        canManage={s.isAdmin}
        // True, and the master never said it: `QuotationForm` filters the model
        // dropdown to `m.active || m.id === draft.machineId`, so switching a
        // machine off stops it being quotable while a draft already sitting on it
        // keeps it. Without this nobody could tell whether deactivating would
        // break an open deal.
        statusNote="An inactive machine cannot be picked on a new quotation. Deals already raised on it are unaffected."
        emptyValues={{
          name: "",
          billingName: "",
          categoryId: "",
          headTypeIds: "",
          needsDryer: "",
          optAirBlade: "",
          optExternalCentering: "",
          optInkDustExhauster: "",
          optChillingSystem: "",
          docTitle: "ORDER CONFIRMATION",
          machineModelNo: "",
          signoffStyle: "approved_by",
          introText: "",
          sortOrder: "500",
        }}
        toValues={(m) => ({
          name: m.name,
          billingName: m.billingName ?? "",
          categoryId: m.categoryId ?? "",
          headTypeIds: s.headsFor(m.id).map((h) => h.id).join(","),
          // "" is UNSET and is not the same answer as "no" — a machine nobody
          // has mapped yet must not read as one that takes no dryer.
          needsDryer: m.needsDryer === null ? "" : m.needsDryer ? "yes" : "no",
          optAirBlade: m.optAirBlade ?? "",
          optExternalCentering: m.optExternalCentering ?? "",
          optInkDustExhauster: m.optInkDustExhauster ?? "",
          optChillingSystem: m.optChillingSystem ?? "",
          docTitle: m.docTitle,
          machineModelNo: m.machineModelNo ?? "",
          signoffStyle: m.signoffStyle,
          introText: m.introText ?? "",
          sortOrder: String(m.sortOrder),
        })}
        onSubmit={async (id, values, active) => {
          const patch = {
            name: values.name,
            billingName: values.billingName || null,
            categoryId: values.categoryId || null,
            // Three states, not two: "" means nobody has said yet.
            needsDryer: values.needsDryer === "" ? null : values.needsDryer === "yes",
            optAirBlade: values.optAirBlade || null,
            optExternalCentering: values.optExternalCentering || null,
            optInkDustExhauster: values.optInkDustExhauster || null,
            optChillingSystem: values.optChillingSystem || null,
            docTitle: values.docTitle,
            machineModelNo: values.machineModelNo || null,
            signoffStyle: values.signoffStyle,
            introText: values.introText || null,
            sortOrder: Number(values.sortOrder) || 500,
            active,
          };
          // ⚠ THE HEADS ARE A SEPARATE TABLE, so they are written after the row
          //   exists — which for a NEW machine means capturing the id createMachine
          //   returns. Writing them before would have nothing to hang them on.
          const machineId = id
            ? (await updateMachine(id, patch), id)
            : await createMachine({
                ...patch,
                supplyDescription: null,
                specRows: [],
                composition: [],
                headerFields: ["attn", "date", "ref", "address"],
                // A brand-new machine has no template until somebody builds one.
                hasTemplate: false,
              });
          await replaceMachineHeads(
            machineId,
            values.headTypeIds ? values.headTypeIds.split(",").filter(Boolean) : [],
          );
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
