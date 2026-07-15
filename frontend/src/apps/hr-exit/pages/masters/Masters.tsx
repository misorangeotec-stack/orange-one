import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import RequestMasterModal from "../../components/RequestMasterModal";
import { useExitStore } from "../../store";
import type { ExitMasterTable } from "../../data/exitWrites";
import type {
  ClearanceItem,
  ExitDocumentType,
  ExitMaster,
  ExitMasterType,
  ExitPayrollHead,
} from "../../types";

/**
 * HR Exit masters — why people leave, what they were issued, what they are owed and
 * owe, which letters close the file, and THE CLEARANCE CHECKLIST.
 *
 * The checklist being editable at all is the whole point: the source workflow names 8
 * clearance departments, and adding a 9th must never be a code change plus a
 * migration. It is one config-driven step, exactly as fms_hr_onboarding_items backs
 * HR's onboarding checklist.
 */

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** The two plain {name, active, sort} masters. */
function SimpleMaster({
  table,
  masterType,
  singular,
  rows,
  hint,
}: {
  table: ExitMasterTable;
  masterType: ExitMasterType;
  singular: string;
  rows: ExitMaster[];
  hint: string;
}) {
  const s = useExitStore();

  const columns: MasterColumn<ExitMaster>[] = [
    { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-24" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">{hint}</p>
      <MasterCrud<ExitMaster>
        singular={singular}
        rows={rows}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage(masterType)}
        emptyValues={{ name: "", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await s.updateMaster(table, id, input);
          else await s.insertMaster(table, input);
        }}
        onToggleActive={async (row, active) => {
          await s.updateMaster(table, row.id, { name: row.name, active, sortOrder: row.sortOrder });
        }}
      />
    </div>
  );
}

/** Document types — a letter with no PDF is a promise, not a document. */
function DocumentTypesMaster() {
  const s = useExitStore();

  const columns: MasterColumn<ExitDocumentType>[] = [
    { header: "Document", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "Needs a file",
      render: (r) => (r.requiresFile ? <span className="text-navy">Yes</span> : <span className="text-grey-2">No</span>),
      className: "w-32",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Document", type: "text", required: true, placeholder: "e.g. Relieving Letter" },
    {
      key: "requiresFile",
      label: "Must the signed copy be uploaded?",
      type: "select",
      required: true,
      options: YES_NO,
      hint: "A letter recorded as 'issued' with nothing attached is a promise, not a document.",
    },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        What HR issues at closure. Each active type becomes a row on the case's Documents panel; archiving a case is
        refused until the ones that need a file have one.
      </p>
      <MasterCrud<ExitDocumentType>
        singular="Document type"
        rows={s.documentTypes}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage("document_type")}
        emptyValues={{ name: "", requiresFile: "yes", sortOrder: "0" }}
        toValues={(r) => ({
          name: r.name,
          requiresFile: r.requiresFile ? "yes" : "no",
          sortOrder: String(r.sortOrder),
        })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            requiresFile: v.requiresFile === "yes",
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await s.updateDocumentType(id, input);
          else await s.insertDocumentType(input);
        }}
        onToggleActive={async (row, active) => {
          await s.updateDocumentType(row.id, {
            name: row.name,
            requiresFile: row.requiresFile,
            active,
            sortOrder: row.sortOrder,
          });
        }}
      />
    </div>
  );
}

/** Payroll heads — the F&F line items. The app RECORDS amounts; it never computes them. */
function PayrollHeadsMaster() {
  const s = useExitStore();

  const KINDS = [
    { value: "addition", label: "Addition (paid to them)" },
    { value: "deduction", label: "Deduction (recovered from them)" },
  ];

  const columns: MasterColumn<ExitPayrollHead>[] = [
    { header: "Head", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
    {
      header: "Kind",
      render: (r) =>
        r.kind === "addition" ? (
          <span className="text-ryg-green font-medium">Addition</span>
        ) : (
          <span className="text-grey">Deduction</span>
        ),
      className: "w-32",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  const fields: MasterFieldDef[] = [
    { key: "name", label: "Head", type: "text", required: true, placeholder: "e.g. Notice Recovery" },
    { key: "kind", label: "Addition or deduction", type: "select", required: true, options: KINDS },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        The lines a full &amp; final settlement is built from. Payroll types the amounts against these heads — the app
        records the settlement, it does not calculate it.
      </p>
      <MasterCrud<ExitPayrollHead>
        singular="Payroll head"
        rows={s.payrollHeads}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage("payroll_head")}
        emptyValues={{ name: "", kind: "deduction", sortOrder: "0" }}
        toValues={(r) => ({ name: r.name, kind: r.kind, sortOrder: String(r.sortOrder) })}
        onSubmit={async (id, v, active) => {
          const input = {
            name: v.name.trim(),
            kind: (v.kind === "addition" ? "addition" : "deduction") as "addition" | "deduction",
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await s.updatePayrollHead(id, input);
          else await s.insertPayrollHead(input);
        }}
        onToggleActive={async (row, active) => {
          await s.updatePayrollHead(row.id, {
            name: row.name,
            kind: row.kind,
            active,
            sortOrder: row.sortOrder,
          });
        }}
      />
    </div>
  );
}

/**
 * THE CLEARANCE CHECKLIST — the richest master in the app.
 *
 * `dueDays` is SIGNED and negative is the NORMAL case: you cannot chase a laptop after
 * the person has walked out, so a clearance item is due BEFORE the last working day.
 * It is a plain master column, never an SLA rule, so it never passes through
 * `resolveStepSla` — which would silently swap a negative for the step's default.
 *
 * `satisfiedByStep` is deliberately NOT editable: it wires a row to a first-class
 * step's completion (Asset Return / Handover auto-tick the rows they cover, so Admin
 * and IT are not asked to sign the same thing twice). That is a code wiring, not a
 * data-entry field. The column is shown, so it is at least visible.
 */
function ClearanceItemsMaster() {
  const s = useExitStore();

  const peopleOptions: MultiOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.profiles],
  );

  const dueLabel = (n: number) => {
    if (n === 0) return "On the last working day";
    const d = Math.abs(n);
    const unit = `working day${d === 1 ? "" : "s"}`;
    return n < 0 ? `${d} ${unit} BEFORE the LWD` : `${d} ${unit} after the LWD`;
  };

  const columns: MasterColumn<ClearanceItem>[] = [
    { header: "Department", render: (r) => <span className="font-medium text-navy">{r.departmentLabel}</span>, className: "w-40" },
    { header: "Item", render: (r) => <span className="text-navy">{r.name}</span> },
    {
      header: "Owner",
      render: (r) =>
        r.ownerIsReportingManager ? (
          <span className="text-grey-2">The reporting manager</span>
        ) : r.ownerIds.length ? (
          <span className="text-navy">{r.ownerIds.map((id) => s.profileById(id)?.name ?? "Unknown").join(", ")}</span>
        ) : (
          <span className="text-grey-2">Falls back to the Clearance step owners</span>
        ),
      className: "w-56",
    },
    {
      header: "Due",
      render: (r) => (
        <span className={r.dueDays < 0 ? "text-orange font-medium" : "text-grey-2"}>{dueLabel(r.dueDays)}</span>
      ),
      className: "w-52",
    },
    {
      header: "Auto-ticked by",
      render: (r) =>
        r.satisfiedByStep ? (
          <span className="text-grey-2">{r.satisfiedByStep === "asset_return" ? "Asset Return" : "Handover"}</span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      className: "w-36",
    },
    { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
  ];

  const fields: MasterFieldDef[] = [
    {
      key: "departmentLabel",
      label: "Department",
      type: "text",
      required: true,
      placeholder: "e.g. IT",
      hint: "Free text, and free text on purpose — the eight clearance departments are not the portal's departments, and adding a ninth must never need a migration.",
    },
    { key: "name", label: "Item", type: "text", required: true, placeholder: "e.g. Laptop, email disable, system access" },
    { key: "description", label: "Description", type: "textarea", placeholder: "Optional — what this department must actually do" },
    {
      key: "ownerIsReportingManager",
      label: "Owned by the exiting employee's reporting manager?",
      type: "select",
      required: true,
      options: YES_NO,
      hint: "Yes routes this row per case, like a manager step. The named owners below are then ignored.",
    },
    {
      key: "ownerIds",
      label: "Owners",
      type: "custom",
      hint: "Who owes this row. Leave empty and it falls back to the owners of the Clearance step, so nothing is ever owed by nobody.",
      render: (value, onChange) => (
        <MultiSelect
          values={value ? value.split(",").filter(Boolean) : []}
          onChange={(ids) => onChange(ids.join(","))}
          options={peopleOptions}
          placeholder="Select owners"
        />
      ),
    },
    { key: "requiresFile", label: "Must a file be uploaded?", type: "select", required: true, options: YES_NO },
    { key: "allowsLink", label: "Can a Drive link be pasted?", type: "select", required: true, options: YES_NO },
    {
      key: "dueDays",
      label: "Working days from the last working day (negative = before)",
      type: "text",
      placeholder: "-1",
      hint: "Negative is the normal case: −1 means the day before they leave. 0 means on the last working day.",
    },
    { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" },
  ];

  /** Stable key for a new item, derived from its name. Existing keys never change. */
  const keyFor = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "item";

  /** Signed, and NOT clamped at zero — the whole point of this column. */
  const parseDueDays = (raw: string) => {
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) ? Math.max(-365, Math.min(365, n)) : 0;
  };

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-grey-2">
        The eight departments that must sign a leaver off. This list is materialised onto a case the moment its last
        working day is confirmed, and each row is <span className="font-semibold text-navy">snapshotted</span> — renaming
        an item next quarter never rewrites what last quarter's leaver was asked for. Deactivating one leaves past cases
        untouched. This is the one master that isn't requestable: it feeds no dropdown, so it's edited here directly.
      </p>
      <MasterCrud<ClearanceItem>
        singular="Clearance item"
        rows={s.clearanceItems}
        columns={columns}
        fields={fields}
        searchText={(r) => `${r.departmentLabel} ${r.name} ${r.description ?? ""}`}
        canManage={s.canManage("clearance_item")}
        emptyValues={{
          departmentLabel: "",
          name: "",
          description: "",
          ownerIsReportingManager: "no",
          ownerIds: "",
          requiresFile: "no",
          allowsLink: "no",
          dueDays: "-1",
          sortOrder: "0",
        }}
        toValues={(r) => ({
          departmentLabel: r.departmentLabel,
          name: r.name,
          description: r.description ?? "",
          ownerIsReportingManager: r.ownerIsReportingManager ? "yes" : "no",
          ownerIds: r.ownerIds.join(","),
          requiresFile: r.requiresFile ? "yes" : "no",
          allowsLink: r.allowsLink ? "yes" : "no",
          dueDays: String(r.dueDays),
          sortOrder: String(r.sortOrder),
        })}
        onSubmit={async (id, v, active) => {
          const existing = id ? s.clearanceItems.find((i) => i.id === id) : undefined;
          const input = {
            // Keep an existing item's key stable — code and past snapshots reference it.
            key: existing?.key ?? keyFor(`${v.departmentLabel} ${v.name}`),
            name: v.name.trim(),
            departmentLabel: v.departmentLabel.trim(),
            description: v.description.trim() || null,
            ownerIds: v.ownerIds ? v.ownerIds.split(",").filter(Boolean) : [],
            ownerIsReportingManager: v.ownerIsReportingManager === "yes",
            requiresFile: v.requiresFile === "yes",
            allowsLink: v.allowsLink === "yes",
            dueDays: parseDueDays(v.dueDays),
            active,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
          };
          if (id) await s.updateClearanceItem(id, input);
          else await s.insertClearanceItem(input);
        }}
        onToggleActive={async (row, active) => {
          await s.updateClearanceItem(row.id, {
            key: row.key,
            name: row.name,
            departmentLabel: row.departmentLabel,
            description: row.description,
            ownerIds: row.ownerIds,
            ownerIsReportingManager: row.ownerIsReportingManager,
            requiresFile: row.requiresFile,
            allowsLink: row.allowsLink,
            dueDays: row.dueDays,
            active,
            sortOrder: row.sortOrder,
          });
        }}
      />
    </div>
  );
}

export default function Masters() {
  const s = useExitStore();
  const [tab, setTab] = useState("clearance");
  const [raising, setRaising] = useState(false);

  const tabs = [
    { key: "clearance", label: "Clearance Checklist", count: s.clearanceItems.length },
    { key: "reasons", label: "Exit Reasons", count: s.reasons.length },
    { key: "assets", label: "Asset Types", count: s.assetTypes.length },
    { key: "documents", label: "Document Types", count: s.documentTypes.length },
    { key: "payroll", label: "Payroll Heads", count: s.payrollHeads.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Masters</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            The controlled lists that drive the exit process. Adding a clearance department, a reason or an F&amp;F head
            is a data change, never a code change. Each list is editable by the admins and by its assigned owner — set
            that in Setup → Master Owners; the ones you don't own are read-only here.
          </p>
        </div>
        <Button size="sm" onClick={() => setRaising(true)}>
          Request new entry
        </Button>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "clearance" && <ClearanceItemsMaster />}
      {tab === "reasons" && (
        <SimpleMaster
          table="fms_exit_reasons"
          masterType="reason"
          singular="Reason"
          rows={s.reasons}
          hint="Why the employee is leaving. Chosen on the case, and it is what drives the attrition-reason report."
        />
      )}
      {tab === "assets" && (
        <SimpleMaster
          table="fms_exit_asset_types"
          masterType="asset_type"
          singular="Asset type"
          rows={s.assetTypes}
          hint="What can be issued to an employee and must come back. Each active type becomes a row on the case's Asset Return panel."
        />
      )}
      {tab === "documents" && <DocumentTypesMaster />}
      {tab === "payroll" && <PayrollHeadsMaster />}

      {/* Four requestable masters — the Clearance Checklist is deliberately not one of
          them (it feeds no dropdown, and the DB CHECK refuses it), so it is absent from
          the picker inside. Its owner edits it on the tab above. */}
      <RequestMasterModal open={raising} onClose={() => setRaising(false)} masterType={null} />
    </div>
  );
}
