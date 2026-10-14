import { useState } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import Tabs from "@/shared/components/ui/Tabs";
import { saveMasterValue, setMasterValueActive } from "../data/mrWrites";
import { PageHeader } from "../components/Pills";
import { useMrStore } from "../store";
import { MASTER_LABEL, type MasterKind, type MasterValue } from "../types";

const KINDS: MasterKind[] = ["printer_brand", "ink_type", "condition", "location", "inquiry_status"];

const HINTS: Record<MasterKind, string> = {
  printer_brand: "The brands a machine can be listed under.",
  ink_type: "The inks a machine runs on.",
  condition: "How well a machine works. Old machines only, so there is no New.",
  location: "Saved places to pick from on the machine form, written as City, State.",
  inquiry_status: "The steps an inquiry moves through.",
};

/** A MasterCrud row: the portal's `value` shown as the name. */
type Row = MasterValue & { name: string };

/**
 * Inquiry statuses the module reads by NAME, with why. "New" is the one every new
 * inquiry starts at; "Closed won" asks to mark the machine Sold; the Dashboard counts
 * both closed ones. Renaming or switching any of them off would quietly break that.
 */
const HELD_STATUS: Record<string, string> = {
  New: "is the status every new inquiry starts at",
  "Closed won": "asks to mark the machine Sold and is counted on the Dashboard",
  "Closed lost": "is counted on the Dashboard",
};
const held = (m: { master: string; value: string } | undefined) =>
  m?.master === "inquiry_status" && m.value in HELD_STATUS ? HELD_STATUS[m.value] : null;

/**
 * The fixed lists the machine form and inquiries pick from, one tab per list.
 *
 * ⚠ Three inquiry statuses are held by NAME (HELD_STATUS): renaming or switching
 *   them off is refused here.
 */
export default function Masters() {
  const s = useMrStore();
  const [kind, setKind] = useState<MasterKind>("printer_brand");
  // MasterCrud shows a failed Activate/Deactivate only inside its edit dialog, so
  // a refusal from the row button would vanish. It is shown here instead.
  const [notice, setNotice] = useState<string | null>(null);

  const rows: Row[] = s.masters.filter((m) => m.master === kind).map((m) => ({ ...m, name: m.value }));

  const usedBy = (m: Row): number => {
    if (m.master === "inquiry_status") return s.inquiries.filter((i) => i.statusId === m.id).length;
    if (m.master === "location") return s.machines.filter((x) => [x.city, x.state].filter(Boolean).join(", ") === m.value).length;
    return s.machines.filter((x) => x.printerBrandId === m.id || x.inkTypeId === m.id || x.conditionId === m.id).length;
  };

  const columns: MasterColumn<Row>[] = [
    { header: MASTER_LABEL[kind].singular, render: (m) => <span className="font-medium text-navy">{m.value}</span> },
    { header: kind === "inquiry_status" ? "Inquiries" : "Machines", render: (m) => usedBy(m), sortValue: usedBy, className: "text-right" },
    { header: "Order", render: (m) => m.sortOrder, sortValue: (m) => m.sortOrder, className: "text-right" },
  ];

  const fields: MasterFieldDef[] = [
    {
      key: "value",
      label: MASTER_LABEL[kind].singular,
      type: "text",
      required: true,
      placeholder: kind === "location" ? "Surat, Gujarat" : undefined,
    },
    { key: "sortOrder", label: "Order", type: "text", hint: "Lower numbers come first", placeholder: "1" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Masters" sub="The lists the machine form and inquiries pick from." />
      <Tabs
        tabs={KINDS.map((k) => ({ key: k, label: MASTER_LABEL[k].plural, count: s.masters.filter((m) => m.master === k && m.active).length }))}
        active={kind}
        onChange={(k) => {
          setKind(k as MasterKind);
          setNotice(null);
        }}
      />
      <p className="text-[13px] text-grey-2">{HINTS[kind]}</p>
      {notice && <p className="rounded-lg bg-[#FFF4F4] px-3 py-2 text-[13px] text-ryg-red">{notice}</p>}
      <MasterCrud<Row>
        key={kind}
        singular={MASTER_LABEL[kind].singular}
        rows={rows}
        columns={columns}
        fields={fields}
        searchText={(m) => m.value}
        defaultOrder={(m) => m.sortOrder}
        canManage={s.canEdit}
        statusNote="Switching a value off removes it from the pickers. Machines and inquiries that already use it keep it."
        emptyValues={{ value: "", sortOrder: "" }}
        toValues={(m) => ({ value: m.value, sortOrder: String(m.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const value = v.value.trim();
          if (v.sortOrder && !/^-?\d+$/.test(v.sortOrder.trim())) throw new Error("Order must be a whole number.");
          if (kind === "location" && !/^[^,]+,\s*[^,]+$/.test(value)) throw new Error("Write a location as City, State, for example Surat, Gujarat.");
          const current = id ? s.masterById(id) : undefined;
          const why = held(current);
          if (current && why && (value !== current.value || !active)) {
            throw new Error(`"${current.value}" ${why}, so it cannot be renamed or switched off.`);
          }
          await saveMasterValue(id, kind, { value, sortOrder: v.sortOrder.trim() ? Number(v.sortOrder) : 0, active });
          await s.refresh();
        }}
        onToggleActive={async (m, active) => {
          setNotice(null);
          const why = held(m);
          if (why && !active) {
            setNotice(`"${m.value}" ${why}, so it cannot be switched off.`);
            return;
          }
          try {
            await setMasterValueActive(m.id, active);
            await s.refresh();
          } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </div>
  );
}
