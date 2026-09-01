import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useOcpiStore } from "../../store";
import {
  insertNamedMaster, updateNamedMaster,
  insertMachineCategory, updateMachineCategory,
  insertDryer, updateDryer,
} from "../../data/ocpiMasterWrites";
import type { OcpiDryer, OcpiMasterType, OcpiNamedMaster } from "../../types";

/**
 * ⚠ TWO OF THESE TABS ARE NOT MASTER *TYPES*.
 *
 *   `machine_category` and `dryer` are screens, not entries in
 *   `OcpiMasterType` — that union is a wire contract mirrored in six places
 *   (the type, two SQL check constraints, the elsif chain in
 *   fms_ocpi_resolve_master_request, Settings → Master owners, and
 *   RequireMasterOwner), and widening it would buy a "request a new category"
 *   flow nobody asked for. They borrow an existing owner instead, and
 *   `OWNED_BY` below is the single place that says which — it must agree with
 *   the RLS policies in migration 20261021130000.
 */
type Tab = Exclude<OcpiMasterType, "machine"> | "machine_category" | "dryer";

const TABS: { key: Tab; label: string }[] = [
  { key: "machine_category", label: "Machine categories" },
  { key: "head_type", label: "Print-head types" },
  { key: "ink_type", label: "Ink types" },
  { key: "dryer_type", label: "Dryer categories" },
  { key: "dryer", label: "Dryers" },
];

/** Which master's owner may edit each tab. Mirrors the RLS in 20261021130000. */
const OWNED_BY: Record<Tab, OcpiMasterType> = {
  head_type: "head_type",
  ink_type: "ink_type",
  dryer_type: "dryer_type",
  machine_category: "machine",
  dryer: "dryer_type",
};

/**
 * The OCPI setup masters.
 *
 * ⚠ THESE THREE LISTS USED TO LIVE IN THE CODE. They were `as const` arrays in
 *   lib/fieldSpec.ts, transcribed off the Microsoft form, so adding a print head
 *   meant a code change and a deploy — and in the meantime whoever needed it
 *   typed it free-hand, which is how one head model ends up in the data as four
 *   different strings.
 *
 * ⚠ MACHINES ARE NOT A TAB HERE, on purpose. A machine is not a name in a list:
 *   it carries a whole order-confirmation template — spec rows, composition,
 *   header fields, a dozen sections of legal boilerplate. Squeezing that into a
 *   MasterCrud row would make the important half of it invisible. It keeps its
 *   own screen, and this page links to it so the two are not hidden from each
 *   other.
 *
 * ⚠ DEACTIVATE, NEVER DELETE — MasterCrud's own rule, and it matters here: a
 *   deal that quoted "RICOH GEN 6 HEAD" stores the TEXT, so deleting the row
 *   would not corrupt old deals, but it would make the same head unpickable and
 *   invite somebody to re-add it with different spelling.
 */
export default function Masters() {
  const s = useOcpiStore();
  const [tab, setTab] = useState<Tab>("head_type");

  const rowsFor = (t: Tab): OcpiNamedMaster[] =>
    t === "head_type" ? s.headTypes
      : t === "ink_type" ? s.inkTypes
        : t === "machine_category" ? s.machineCategories
          : s.dryerTypes;

  const canManage = s.canManageMaster(OWNED_BY[tab]);

  /** A dryer category name, for the Dryers tab. */
  const categoryOf = (id: string) => s.dryerTypes.find((d) => d.id === id)?.name ?? "—";

  /*
    ⚠ ONE COLUMN SET, FOUR TABS — so the marker column is added only on the tab
      that has a marker. `means_no_dryer` exists on fms_ocpi_dryer_types alone;
      a "Means" column over print heads would be a column that is blank on every
      row, which reads as data missing rather than as a column that does not
      apply here.
  */
  const columns: MasterColumn<OcpiNamedMaster>[] = [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    ...(tab === "dryer_type"
      ? [
          {
            header: "Means",
            render: (r: OcpiNamedMaster) =>
              r.meansNoDryer ? (
                <span className="rounded-full bg-navy/5 px-2 py-0.5 text-[12px] font-semibold text-navy">
                  no dryer on the deal
                </span>
              ) : (
                <span className="text-grey-2">a real dryer category</span>
              ),
            // The rendered text is what to sort and filter by, so neither needs
            // declaring — MasterCrud reads it off the cell.
          },
        ]
      : []),
    /*
      OCPI-14 · the same idea again, on the tab that has the flags. A machine
      category decides what the quotation ASKS — one column saying so beats
      three yes/no columns nobody would read across.
    */
    ...(tab === "machine_category"
      ? [
          {
            header: "The quotation asks about",
            render: (r: OcpiNamedMaster) => {
              const asks = [
                r.showsDryer ? "dryer" : null,
                r.showsCentering ? "centering device" : null,
                r.showsExtras ? "air blade · ink dust · chilling" : null,
              ].filter(Boolean);
              return asks.length ? (
                <span className="text-navy">{asks.join(" · ")}</span>
              ) : (
                <span className="text-grey-2">ink, spare parts and head only</span>
              );
            },
          },
        ]
      : []),
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Name", type: "text", required: true, hint: "Exactly as it should read on the quotation." },
    /*
      ⚠ ONLY ON THE MACHINE-CATEGORY TAB, for the same reason the "Means" column
        is only on the dryer one: these three columns exist on
        fms_ocpi_machine_categories alone, and offering them over print heads
        would be three controls that write nothing.

      🔴 THESE ARE THE BRANCH INPUTS (OCPI-14). Turning one off stops the
         quotation asking that group on every deal in this category — AND makes
         `fms_ocpi_write_oc` null those columns on the next save of any such
         deal. That is the intended behaviour, not a side effect, but it is why
         these are admin controls and not a per-deal answer.
    */
    ...(tab === "machine_category"
      ? ([
          { key: "showsDryer", label: "Asks about a dryer", type: "choice",
            options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
            hint: "Shows the Dryer details card and the Dryer row in Shipment & invoice. Yes on Direct only — all 11 Direct machines take a dryer and no other machine does." },
          { key: "showsCentering", label: "Asks about a centering device", type: "choice",
            options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
            hint: "Shows the Centering device inclusion in section B and its Shipment & invoice row." },
          { key: "showsExtras", label: "Asks about the optional extras", type: "choice",
            options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
            hint: "Air blade, ink dust exhauster and chilling system. Where this is No the three are recorded as No on the deal rather than left unanswered." },
        ] as MasterFieldDef[])
      : []),
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0", hint: "Lower comes first in the dropdown." },
  ];

  const label = TABS.find((t) => t.key === tab)!.label;
  const singular = label.replace(/s$/, "");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          The lists a quotation picks from. Editable by admins and by each list&rsquo;s owner
          (Settings → Master owners). For print heads, inks and dryer categories, anyone else can ask
          for an entry and it appears under Master requests &mdash; <b className="text-navy">machine
          categories and dryers cannot be requested</b>, so an owner adds those directly.
        </p>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[13.5px] font-semibold text-navy">Machines are edited on their own screen</p>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            A machine carries its whole order-confirmation template, not just a name.
          </p>
        </div>
        <Link
          to="/ocpi/machines"
          className="rounded-xl border border-line px-3.5 py-2 text-[13px] font-semibold text-navy transition hover:border-orange hover:text-orange"
        >
          Open Machines
        </Link>
      </Card>

      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
              tab === t.key ? "border-orange text-navy" : "border-transparent text-grey-2 hover:text-navy"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/*
        ⚠ SAYING IT ON SCREEN IS HALF THE GUARD, and the database holds the other
          half — a trigger refuses the rename outright, so this is an explanation
          rather than the enforcement. Both exist because the quiet failure would
          be invisible: a deal stores the category's NAME as text, so renaming
          the row would leave every saved deal pointing at a category the master
          no longer knows.
      */}
      {tab === "dryer_type" && (
        <Card className="border-ryg-yellow/40 bg-[#FFFCF3] p-4">
          <p className="text-[13px] font-medium text-navy">
            The category marked <b>&ldquo;no dryer on the deal&rdquo;</b> cannot be renamed
          </p>
          <p className="mt-1 text-[13px] text-grey">
            The quotation form recognises it by that marking and hides every dryer question below
            it. Deals already saved store the category as <b className="text-navy">text</b>, so a
            rename would leave them pointing at a category that no longer exists &mdash; the
            database refuses it. Deactivate it instead. Everything else on this tab, including its
            sort order, edits normally, and a second category can be marked the same way in SQL.
          </p>
        </Card>
      )}

      {tab === "dryer" ? (
        /*
          ⚠ ITS OWN INSTANCE, because a dryer is the one list here that is not
            just a name — it belongs to a dryer CATEGORY, and the quotation
            filters this list by the category the salesperson picked. Casting it
            through the name-only MasterCrud above would have hidden that field.
        */
        <MasterCrud<OcpiDryer>
          key={tab}
          singular="dryer"
          rows={s.dryers}
          columns={[
            { header: "Dryer", render: (r) => <span className="font-medium text-navy">{r.name}</span>,
              filter: { get: (r) => r.name } },
            { header: "Category", render: (r) => categoryOf(r.dryerTypeId),
              filter: { get: (r) => categoryOf(r.dryerTypeId) } },
            { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
          ]}
          fields={[
            { key: "name", label: "Dryer name", type: "text", required: true,
              hint: "Exactly as it should read on the quotation." },
            { key: "dryerTypeId", label: "Dryer category", type: "select", required: true,
              // ⚠ THE MARKER, NOT THE NAME (OCPI-8). This read
              //   `d.name !== "Not Applicable"` until the marker column existed —
              //   a category that means "no dryer" cannot own a dryer, and the
              //   row now says so itself rather than being recognised by spelling.
              options: s.dryerTypes
                .filter((d) => d.active && !d.meansNoDryer)
                .map((d) => ({ value: d.id, label: d.name })),
              hint: "Indian or Chinese. The quotation asks for the category first, then offers only the dryers inside it." },
            { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
          ]}
          searchText={(r) => `${r.name} ${categoryOf(r.dryerTypeId)}`}
          defaultOrder={(r) => r.sortOrder}
          canManage={canManage}
          emptyValues={{ name: "", dryerTypeId: "", sortOrder: "0" }}
          toValues={(r) => ({
            name: r.name, dryerTypeId: r.dryerTypeId, sortOrder: String(r.sortOrder),
          })}
          onSubmit={async (id, v, active) => {
            const input = {
              name: v.name.trim(),
              dryerTypeId: v.dryerTypeId,
              active,
              sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            };
            if (id) await updateDryer(id, input);
            else await insertDryer(input);
            await s.refresh();
          }}
          onToggleActive={async (row, active) => {
            await updateDryer(row.id, {
              name: row.name, dryerTypeId: row.dryerTypeId, active, sortOrder: row.sortOrder,
            });
            await s.refresh();
          }}
        />
      ) : (
        <MasterCrud<OcpiNamedMaster>
          key={tab}
          singular={singular}
          rows={rowsFor(tab)}
          columns={columns}
          fields={fields}
          searchText={(r) => r.name}
          defaultOrder={(r) => r.sortOrder}
          canManage={canManage}
          emptyValues={{
            name: "", sortOrder: "0",
            showsDryer: "no", showsCentering: "no", showsExtras: "no",
          }}
          toValues={(r) => ({
            name: r.name,
            sortOrder: String(r.sortOrder),
            showsDryer: r.showsDryer ? "yes" : "no",
            showsCentering: r.showsCentering ? "yes" : "no",
            showsExtras: r.showsExtras ? "yes" : "no",
          })}
          onSubmit={async (id, v, active) => {
            const input = {
              name: v.name.trim(),
              active,
              sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            };
            if (tab === "machine_category") {
              // ⚠ THE FLAGS GO ONLY ON THIS TAB. The other three vocabularies
              //   share this form and have no such columns.
              const cat = {
                ...input,
                showsDryer: v.showsDryer === "yes",
                showsCentering: v.showsCentering === "yes",
                showsExtras: v.showsExtras === "yes",
              };
              if (id) await updateMachineCategory(id, cat);
              else await insertMachineCategory(cat);
            } else if (id) await updateNamedMaster(tab, id, input);
            else await insertNamedMaster(tab, input);
            await s.refresh();
          }}
          onToggleActive={async (row, active) => {
            const input = { name: row.name, active, sortOrder: row.sortOrder };
            if (tab === "machine_category") await updateMachineCategory(row.id, input);
            else await updateNamedMaster(tab, row.id, input);
            await s.refresh();
          }}
        />
      )}
    </div>
  );
}
