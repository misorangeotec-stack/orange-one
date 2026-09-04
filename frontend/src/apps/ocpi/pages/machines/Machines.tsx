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
      hint: "THE BRANCH INPUT since OCPI-14. Chosen first on the quotation, it narrows the machine list AND decides whether the deal is asked about a dryer, a centering device and the three optional extras. Direct is asked all three; Sublimation, Other and POD are asked none. Edit what each category asks on the Masters screen." },
    {
      // ⚠ A MACHINE MAY HAVE SEVERAL HEADS. The client's sheet lists two in one
      //   cell for five machines, and confirmed that is real. The quotation
      //   SHOWS these and does not let the salesperson choose — so what is set
      //   here is what every future quotation for this machine will say.
      key: "headTypeIds",
      label: "Print heads",
      type: "custom",
      hint: "All of them. ONE mapped head is shown on the quotation and cannot be changed; TWO OR MORE become a choice the salesperson makes, because the client sheet reads “EX600 or RC” — an OR, not an AND.",
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
    /*
      🔴 THE THREE WARRANTIES, PER MODEL (OCPI-14). They were one company-wide
         SETTING — 12 months on the machine, 18 on the head, for all 28 models.
         The client's 01-09 sheet gives them per machine and shows why one figure
         could not work: 15 of the 28 carry NO head warranty at all, so Settings
         was quoting 18 months on fifteen models that offer none.

      🔴 BLANK MEANS NOT APPLICABLE, NOT UNKNOWN. The quotation does not ask the
         question and neither paper prints a line. It does NOT fall through to
         the Settings figure — that fallback exists only for a model nobody has
         filled in yet.

      ⚠ THERE IS NO SPARE-PARTS WARRANTY FIELD, and that is a finding rather than
        an omission: column S of the client's sheet reads "NA" on all 28 rows.
    */
    { key: "machineWarranty", label: "Machine warranty", type: "text",
      hint: "As it should print, e.g. “12 Months”. Blank means not applicable — the quotation will not ask and neither paper will print a line." },
    { key: "headWarranty", label: "Print-head warranty", type: "text",
      hint: "e.g. “18 Months”. Blank means not applicable. 15 of the 28 models carry none, which is why this is per machine and not a setting." },
    { key: "dryerWarranty", label: "Dryer warranty", type: "text",
      hint: "e.g. “12 Months”. Blank means not applicable. Only a model that takes a dryer should carry one." },
    /*
      🔴 THESE FIVE NO LONGER DECIDE ANYTHING (OCPI-14). Until now they were the
         branch inputs: `needsDryer` opened the Dryer section and
         `optExternalCentering` opened both centering questions, in the form AND
         in `fms_ocpi_write_oc`. The MACHINE CATEGORY decides all of it now —
         Direct carries a dryer, a centering device and the three extras;
         Sublimation, Other and POD carry none — so the flags are edited here as
         a RECORD OF WHAT EACH MODEL CAN TAKE and nothing reads them.

         They are kept, rather than deleted, because that record is real and the
         client may want it back as a second condition. But nobody should edit
         one expecting the quotation to change: it will not.

      ⚠ `needsDryer` STOPPED BEING REQUIRED at the same moment, and that is the
        same decision rather than a second one. It was required because
        `fms_ocpi_write_oc` read a NULL as "no dryer" and would have made a whole
        section silently unreachable. Nothing reads it, so a blank can no longer
        hide anything, and demanding an answer to a question that changes nothing
        is exactly the kind of control this repo keeps writing down as a fault.
    */
    { key: "needsDryer", label: "Takes a dryer", type: "choice",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
      hint: "REFERENCE ONLY since OCPI-14 — the machine category decides whether the quotation shows the dryer section. Records what this model can take." },
    optionField("optAirBlade", "Air blade",
      "REFERENCE ONLY since OCPI-14. The machine category decides whether the question is asked; this records what the model can take."),
    optionField("optExternalCentering", "External centering",
      "REFERENCE ONLY since OCPI-14. It used to be the one extra that was still a gate; the machine category decides now, so a Direct model is asked about centering whatever this says."),
    optionField("optInkDustExhauster", "Ink dust exhauster",
      "REFERENCE ONLY since OCPI-14. The machine category decides whether the question is asked."),
    optionField("optChillingSystem", "Chilling system",
      "REFERENCE ONLY since OCPI-14. The machine category decides whether the question is asked."),
    { key: "docTitle", label: "Document heading", type: "choice", required: true,
      options: [
        { value: "ORDER CONFIRMATION", label: "ORDER CONFIRMATION" },
        { value: "OFFER QUOTE", label: "OFFER QUOTE" },
      ],
      hint: "P8D's deck is headed OFFER QUOTE — check before changing." },
    { key: "machineModelNo", label: "Manufacturer's model no.", type: "text",
      hint: "e.g. HM1800B-TK24. Available in templates as {{machine_model_no}}. It also opens the Performa Invoice's subject line — “Model No: …” — which is omitted entirely when this is blank rather than printing a gap." },
    /*
      🔴 THE THREE PERFORMA-INVOICE FIELDS, AND THE ONE PLACE IN THIS MODULE WHERE
         BLANK MEANS *OMIT* (OCPI-36). Everywhere else an unanswered value rules an
         underscore run on the paper, on purpose, because the gap is a question
         somebody must answer. These are not that: a Surat-built Homer K24 has no
         country of origin to state, and a blank would invent a question.

         The live papers settle it. Of 34 real PI files, 4 carry an HSN code, 2 a
         country of origin, 1 a manufacturer, and 30 carry none of the three —
         every one that does is an IMPORTED machine. Leave them empty on a
         domestic model; that is the correct answer, not an unfinished one.
    */
    { key: "hsnCode", label: "HSN code", type: "text",
      hint: "Prints on the Performa Invoice beside the model, e.g. “HSN CODE: 84433910”. Leave blank on a domestic machine — the line is then left off the invoice entirely, not printed empty." },
    { key: "manufacturer", label: "Manufacturer (OEM)", type: "text",
      hint: "Prints as “MFG: HAN GLORY (HONG KONG) LIMITED” on the Performa Invoice. Blank leaves the line off. Only imported machines carry one." },
    { key: "countryOfOrigin", label: "Country of origin", type: "text",
      hint: "Prints on the Performa Invoice and in its Terms, e.g. “HONG KONG , CHINA”. Blank leaves both off — a Surat-built machine has none to state." },
    {
      /*
        ⚠ THE PAGE IS SHARED ACROSS A FAMILY, WHICH IS WHY THIS IS A PICKER AND
          NOT A BODY OF TEXT ON THE MACHINE. One "Key Benefits of Alpha II" page
          serves the 1.8 m, 1.9 m and 2.2 m models; one "KoloRado ALPHA III" page
          serves the 8-, 16- and 24-head Alpha 3.2s. Copying the copy onto each
          machine would mean three places to correct, which will not stay in step.

        ⚠ NONE IS A REAL ANSWER. Seven machines have no page and none is being
          invented for them; their PI simply prints the 2-page form, which folder
          107's ink and dryer invoices prove is correct.
      */
      key: "salesPageId", label: "Performa Invoice sales page", type: "select",
      options: s.salesPages
        .filter((p) => p.active)
        .map((p) => ({ value: p.id, label: `${p.name} — ${p.heading}` })),
      hint: "Page 2 of this machine's Performa Invoice. Shared across a family — several models point at one page. Leave it unset and the invoice prints without a sales page, which is a correct, shorter form and not a failure.",
    },
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
          machineWarranty: "",
          headWarranty: "",
          dryerWarranty: "",
          needsDryer: "",
          optAirBlade: "",
          optExternalCentering: "",
          optInkDustExhauster: "",
          optChillingSystem: "",
          docTitle: "ORDER CONFIRMATION",
          machineModelNo: "",
          hsnCode: "",
          manufacturer: "",
          countryOfOrigin: "",
          salesPageId: "",
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
          machineWarranty: m.machineWarranty ?? "",
          headWarranty: m.headWarranty ?? "",
          dryerWarranty: m.dryerWarranty ?? "",
          needsDryer: m.needsDryer === null ? "" : m.needsDryer ? "yes" : "no",
          optAirBlade: m.optAirBlade ?? "",
          optExternalCentering: m.optExternalCentering ?? "",
          optInkDustExhauster: m.optInkDustExhauster ?? "",
          optChillingSystem: m.optChillingSystem ?? "",
          docTitle: m.docTitle,
          machineModelNo: m.machineModelNo ?? "",
          hsnCode: m.hsnCode ?? "",
          manufacturer: m.manufacturer ?? "",
          countryOfOrigin: m.countryOfOrigin ?? "",
          salesPageId: m.salesPageId ?? "",
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
            machineWarranty: values.machineWarranty || null,
            headWarranty: values.headWarranty || null,
            dryerWarranty: values.dryerWarranty || null,
            needsDryer: values.needsDryer === "" ? null : values.needsDryer === "yes",
            optAirBlade: values.optAirBlade || null,
            optExternalCentering: values.optExternalCentering || null,
            optInkDustExhauster: values.optInkDustExhauster || null,
            optChillingSystem: values.optChillingSystem || null,
            docTitle: values.docTitle,
            machineModelNo: values.machineModelNo || null,
            // "" is stored as null, and null PRINTS NOTHING on the invoice.
            hsnCode: values.hsnCode || null,
            manufacturer: values.manufacturer || null,
            countryOfOrigin: values.countryOfOrigin || null,
            salesPageId: values.salesPageId || null,
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
