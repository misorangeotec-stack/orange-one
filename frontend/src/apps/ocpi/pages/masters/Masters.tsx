import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useOcpiStore } from "../../store";
import { insertNamedMaster, updateNamedMaster } from "../../data/ocpiMasterWrites";
import type { OcpiMasterType, OcpiNamedMaster } from "../../types";

type Tab = Exclude<OcpiMasterType, "machine">;

const TABS: { key: Tab; label: string }[] = [
  { key: "head_type", label: "Print-head types" },
  { key: "ink_type", label: "Ink types" },
  { key: "dryer_type", label: "Dryer types" },
];

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
    t === "head_type" ? s.headTypes : t === "ink_type" ? s.inkTypes : s.dryerTypes;

  const columns: MasterColumn<OcpiNamedMaster>[] = [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Name", type: "text", required: true, hint: "Exactly as it should read on the quotation." },
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
          (Settings → Master owners); anyone else can ask for an entry and it appears under
          Master requests.
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

      <MasterCrud<OcpiNamedMaster>
        key={tab}
        singular={singular}
        rows={rowsFor(tab)}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        defaultOrder={(r) => r.sortOrder}
        canManage={s.canManageMaster(tab)}
        emptyValues={{ name: "", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await updateNamedMaster(tab, id, input);
          else await insertNamedMaster(tab, input);
          await s.refresh();
        }}
        onToggleActive={async (row, active) => {
          await updateNamedMaster(tab, row.id, { name: row.name, active, sortOrder: row.sortOrder });
          await s.refresh();
        }}
      />
    </div>
  );
}
