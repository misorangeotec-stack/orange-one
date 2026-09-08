import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useComplaintStore } from "../../store";
import {
  CAUSE_GROUPS,
  CAUSE_GROUP_LABEL,
  COMPLAINT_MASTER_TYPES,
  type CauseGroup,
  type ComplaintNature,
  type RootCause,
} from "../../types";
import { CAUSE_GROUP_TONE } from "../../lib/format";

/**
 * The module's own two masters.
 *
 * ⚠ THE CUSTOMER, THE VENDOR, THE ITEM AND THE INK CATEGORY ARE NOT HERE, and
 *   must never be. They are CENTRAL (`mst_parties`, `mst_items`, and
 *   `mst_items.category` — 96 hand-maintained values), governed in Admin →
 *   Masters and fed by the Tally sync. A per-module copy is the exact mistake
 *   `fms_dispatch_customers` made: a customer saved into it was invisible
 *   everywhere else, and that module now renders an explainer page where its
 *   master screen used to be. This is also OD-2's answered half — "remove them…
 *   they come from Tally only".
 *
 * Both grids get sorting, cascading per-column filters and the Excel round trip
 * from `MasterCrud` with no wiring here.
 */

const causeGroupOptions = CAUSE_GROUPS.map((g) => ({ value: g, label: CAUSE_GROUP_LABEL[g] }));

export default function Masters() {
  const s = useComplaintStore();
  const [tab, setTab] = useState<string>(COMPLAINT_MASTER_TYPES[0].value);

  const natureColumns: MasterColumn<ComplaintNature>[] = [
    { header: "Nature", render: (r) => r.name },
  ];

  const natureFields: MasterFieldDef[] = [
    { key: "name", label: "Nature of complaint", type: "text", required: true, placeholder: "e.g. Shade variation" },
  ];

  const rootCauseColumns: MasterColumn<RootCause>[] = [
    { header: "Root cause", render: (r) => r.name },
    {
      header: "Group",
      // ⚠ A rendered COMPONENT loses both its sort and its filter — `nodeText`
      //   cannot walk an unrendered element — so both are declared explicitly.
      render: (r) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium ${CAUSE_GROUP_TONE[r.causeGroup]}`}>
          {CAUSE_GROUP_LABEL[r.causeGroup]}
        </span>
      ),
      sortValue: (r) => CAUSE_GROUP_LABEL[r.causeGroup],
      filter: { get: (r) => CAUSE_GROUP_LABEL[r.causeGroup] },
    },
  ];

  const rootCauseFields: MasterFieldDef[] = [
    { key: "name", label: "Root cause", type: "text", required: true, placeholder: "e.g. Wrong storage temperature" },
    {
      key: "cause_group",
      label: "Group",
      // A fixed six-value vocabulary declared in code, so buttons rather than a
      // dropdown — it cannot grow without a migration.
      type: "choice",
      required: true,
      options: causeGroupOptions,
      hint: "what the Dashboard Paretos on",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          The two vocabularies this module owns. Customers, vendors, items and ink categories come
          from the central Tally masters and are managed in Admin → Masters.
        </p>
      </div>

      <Tabs
        tabs={COMPLAINT_MASTER_TYPES.map((m) => ({ key: m.value, label: m.plural }))}
        active={tab}
        onChange={setTab}
      />

      {tab === "nature" && (
        <MasterCrud<ComplaintNature>
          singular="nature of complaint"
          rows={s.natures}
          columns={natureColumns}
          fields={natureFields}
          searchText={(r) => r.name}
          defaultOrder={(r) => r.sortOrder}
          canManage={s.canManage("nature")}
          statusNote="A deactivated nature stops being offered on new complaints; those already raised on it are unaffected."
          emptyValues={{ name: "" }}
          toValues={(r) => ({ name: r.name })}
          onSubmit={(id, values, active) =>
            s.saveNature(id, {
              name: String(values.name ?? "").trim(),
              active,
              sortOrder: 0,
            })
          }
          onToggleActive={(row, active) => s.setMasterActive("fms_complaint_natures", row.id, active)}
        />
      )}

      {tab === "root_cause" && (
        <MasterCrud<RootCause>
          singular="root cause"
          rows={s.rootCauses}
          columns={rootCauseColumns}
          fields={rootCauseFields}
          searchText={(r) => `${r.name} ${CAUSE_GROUP_LABEL[r.causeGroup]}`}
          defaultOrder={(r) => r.sortOrder}
          canManage={s.canManage("root_cause")}
          statusNote="A deactivated root cause stops being offered at the investigation step; complaints already attributed to it keep it."
          emptyValues={{ name: "", cause_group: "" }}
          toValues={(r) => ({ name: r.name, cause_group: r.causeGroup })}
          onSubmit={(id, values, active) =>
            s.saveRootCause(id, {
              name: String(values.name ?? "").trim(),
              causeGroup: String(values.cause_group ?? "material") as CauseGroup,
              active,
              sortOrder: 0,
            })
          }
          onToggleActive={(row, active) =>
            s.setMasterActive("fms_complaint_root_causes", row.id, active)
          }
        />
      )}

      {!s.canManage("nature") && !s.canManage("root_cause") && (
        <Card className="p-4">
          <p className="text-[12.5px] text-grey-2">
            You can read these masters but not change them. An admin assigns owners in Setup →
            Master Owners.
          </p>
        </Card>
      )}
    </div>
  );
}
