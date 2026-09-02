import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useProductionStore } from "../../store";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import type { CoaParameter } from "../../types";

/**
 * COA PARAMETER MASTER — what a Certificate of Analysis measures.
 *
 * Its own screen rather than a row in PRODUCTION_MASTER_TYPES, for the reason
 * BOMs have one: a parameter carries a standard, an audience and an equipment
 * alongside its name, which the single-payload "request a new master" modal
 * cannot express — and the resolve RPC would drop the extras on approve without
 * anyone being told. Staying out of that registry keeps it out of the modal
 * automatically. It is still in PRODUCTION_OWNABLE_MASTER_TYPES, so it can have
 * an owner (Setup → Master Owners).
 *
 * ⚠ THIS MASTER DECLARES ITS OWN ORDER FIELD, and it is the only Production
 *   master that does. MasterCrud renders no input for `sortOrder` — every other
 *   tab shows the column but can only change it through the Excel round trip.
 *   Here the order IS the document: it decides the row order on the entry form
 *   and on both printed copies, so it has to be editable where the parameter is.
 */

/** Which generated copy prints a parameter. A genuinely fixed three-value
 *  vocabulary, hence `choice` (buttons) rather than a dropdown. */
const APPEARS_ON = [
  { value: "both", label: "Both" },
  { value: "customer", label: "Customer only" },
  { value: "internal", label: "Internal only" },
];

const appearsOnLabel = (v: string) => APPEARS_ON.find((o) => o.value === v)?.label ?? "Both";

export default function CoaParameterMaster() {
  const s = useProductionStore();
  const ctx = useMasterFieldCtx();

  const equipmentName = (r: CoaParameter) => s.testEquipmentById(r.testEquipmentId)?.name ?? "—";

  const columns: MasterColumn<CoaParameter>[] = [
    { header: "Parameter", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Standard", render: (r) => <span className="text-grey-2">{r.standard || "—"}</span>, className: "w-40" },
    { header: "Test Equipment", render: (r) => <span className="text-grey-2">{equipmentName(r)}</span>, className: "w-44" },
    { header: "Prints on", render: (r) => <span className="text-grey-2">{appearsOnLabel(r.appearsOn)}</span>, className: "w-32" },
    {
      header: "Order",
      // The rendered text is a number, and nodeText would sort it as a string
      // ("10" before "2"). Every other column reads correctly as written.
      render: (r) => <span className="text-grey-2 tabular-nums">{r.sortOrder}</span>,
      sortValue: (r) => r.sortOrder,
      className: "w-20",
    },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Parameter name", type: "text", required: true, placeholder: "e.g. Viscosity (cps)" },
    {
      key: "standard",
      label: "Standard",
      type: "text",
      placeholder: "e.g. 6.5 - 8.5",
      hint: "The default specification. Pre-fills every new COA and stays editable there, so correcting one lot never rewrites this.",
    },
    {
      key: "test_equipment_id",
      label: "Test Equipment",
      type: "select",
      options: ctx.testEquipmentOptions,
      placeholder: "Select equipment",
      hint: "Optional — not every parameter is measured on an instrument.",
    },
    {
      key: "appears_on",
      label: "Prints on",
      type: "choice",
      options: APPEARS_ON,
      hint: "Which generated copy shows this parameter. Entry captures every active parameter either way.",
    },
    {
      key: "sortOrder",
      label: "Order",
      type: "text",
      placeholder: "e.g. 1",
      hint: "Row order on the entry form and on both printed copies. Lowest first.",
    },
  ];

  return (
    <MasterCrud<CoaParameter>
      singular="COA Parameter"
      rows={s.coaParameters}
      columns={columns}
      fields={fields}
      searchText={(r) => `${r.name} ${r.standard ?? ""} ${equipmentName(r)}`}
      // Without this the list falls back to alphabetical, which is meaningless for
      // a document whose whole point is a fixed running order.
      defaultOrder={(r) => r.sortOrder}
      canManage={s.canManage("coa_parameter")}
      statusNote="A deactivated parameter drops off new COAs. Certificates already issued are untouched — every line is frozen onto the COA when it is saved."
      emptyValues={{ name: "", standard: "", test_equipment_id: "", appears_on: "both", sortOrder: "0" }}
      toValues={(r) => ({
        name: r.name,
        standard: r.standard ?? "",
        test_equipment_id: r.testEquipmentId ?? "",
        appears_on: r.appearsOn,
        sortOrder: String(r.sortOrder),
      })}
      onSubmit={async (id, v, active) => {
        const input = {
          name: v.name.trim(),
          active,
          sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          standard: v.standard.trim() || null,
          testEquipmentId: v.test_equipment_id || null,
          appearsOn: v.appears_on || "both",
        };
        if (id) await s.updateMaster("coa_parameter", id, input);
        else await s.insertMaster("coa_parameter", input);
      }}
      onToggleActive={async (row, active) =>
        s.updateMaster("coa_parameter", row.id, {
          name: row.name,
          active,
          sortOrder: row.sortOrder,
          standard: row.standard,
          testEquipmentId: row.testEquipmentId,
          appearsOn: row.appearsOn,
        })
      }
    />
  );
}
