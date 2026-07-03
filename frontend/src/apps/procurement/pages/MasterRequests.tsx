import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Tabs from "@/shared/components/ui/Tabs";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { formatDate } from "@/shared/lib/time";
import { useProcurementStore } from "../store";
import { MASTER_TYPES, type MasterRequest, type MasterType } from "../types";

type Values = Record<string, string>;

interface ReqField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  options?: ComboOption[];
}

/** Field descriptor per master type for the approve (edit-before-add) modal. */
function fieldsFor(mt: MasterType, categoryOptions: ComboOption[], itemGroupOptions: ComboOption[]): ReqField[] {
  switch (mt) {
    case "company":
      return [
        { key: "name", label: "Company name", type: "text", required: true },
        { key: "location", label: "Location", type: "text" },
      ];
    case "category":
      return [{ key: "name", label: "Category name", type: "text", required: true }];
    case "item_group":
      return [
        { key: "category_id", label: "Category", type: "select", required: true, options: categoryOptions },
        { key: "name", label: "Item group name", type: "text", required: true },
      ];
    case "item":
      return [
        { key: "item_group_id", label: "Item Group", type: "select", required: true, options: itemGroupOptions },
        { key: "name", label: "Item name", type: "text", required: true },
        { key: "unit", label: "Unit", type: "text" },
      ];
    case "vendor":
      return [
        { key: "name", label: "Vendor name", type: "text", required: true },
        { key: "gstin", label: "GSTIN", type: "text" },
        { key: "contact_name", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
      ];
  }
}

const typeLabel = (mt: MasterType) => MASTER_TYPES.find((m) => m.value === mt)?.label ?? mt;

/** A short human summary of what was proposed. */
function summarize(r: MasterRequest): string {
  const p = r.proposedPayload as Record<string, string>;
  return p.name || JSON.stringify(p);
}

/**
 * Master Requests queue — incoming "Request new …" submissions. Admins and the
 * relevant master's manager can approve (creating the real master row, editable
 * first) or reject with a reason. Everyone may view status of requests.
 */
export default function MasterRequests() {
  const s = useProcurementStore();
  const [tab, setTab] = useState("pending");
  const [approving, setApproving] = useState<MasterRequest | null>(null);
  const [rejecting, setRejecting] = useState<MasterRequest | null>(null);
  const [values, setValues] = useState<Values>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );
  const itemGroupOptions: ComboOption[] = useMemo(
    () =>
      s.itemGroups
        .filter((g) => g.active)
        .map((g) => ({ value: g.id, label: g.name, sublabel: s.categoryById(g.categoryId)?.name })),
    [s.itemGroups, s]
  );

  const rows = useMemo(() => {
    const list = tab === "pending" ? s.masterRequests.filter((r) => r.status === "pending") : s.masterRequests;
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [s.masterRequests, tab]);

  const pg = usePagination(rows, { resetKey: tab });

  const openApprove = (r: MasterRequest) => {
    setValues({ ...(r.proposedPayload as Values) });
    setErr(null);
    setApproving(r);
  };
  const openReject = (r: MasterRequest) => {
    setNote("");
    setErr(null);
    setRejecting(r);
  };

  const doApprove = async () => {
    if (!approving) return;
    const fields = fieldsFor(approving.masterType, categoryOptions, itemGroupOptions);
    for (const f of fields) {
      if (f.required && !values[f.key]?.trim()) {
        setErr(`${f.label} is required.`);
        return;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      await s.resolveMasterRequest(approving.id, true, values, null);
      setApproving(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (!rejecting) return;
    if (!note.trim()) {
      setErr("A reason is required to reject.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await s.resolveMasterRequest(rejecting.id, false, null, note.trim());
      setRejecting(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusBadge = (st: MasterRequest["status"]) => {
    const map = {
      pending: "text-orange bg-orange-soft",
      approved: "text-ryg-green bg-[#E9F8EF]",
      rejected: "text-ryg-red bg-[#FDECEC]",
    } as const;
    return (
      <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${map[st]}`}>
        {st}
      </span>
    );
  };

  const tabs = [
    { key: "pending", label: "Pending", count: s.masterRequests.filter((r) => r.status === "pending").length },
    { key: "all", label: "All", count: s.masterRequests.length },
  ];

  const approveFields = approving ? fieldsFor(approving.masterType, categoryOptions, itemGroupOptions) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Master Requests</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          New-master-entry requests raised from across the workflow. Approve to add them to the master, or reject with a reason.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No requests" message="New-master requests will appear here for review." />
        ) : (
          <>
            <ScrollableTable>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line">
                    <th className="font-medium px-4 py-3">Type</th>
                    <th className="font-medium px-4 py-3">Proposed</th>
                    <th className="font-medium px-4 py-3">Requested by</th>
                    <th className="font-medium px-4 py-3">Date</th>
                    <th className="font-medium px-4 py-3">Status</th>
                    <th className="font-medium px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((r) => {
                    const canResolve = r.status === "pending" && s.canManage(r.masterType);
                    return (
                      <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                        <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{typeLabel(r.masterType)}</td>
                        <td className="px-4 py-3">{summarize(r)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{s.profileById(r.requestedBy)?.name ?? "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                        <td className="px-4 py-3">{statusBadge(r.status)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {canResolve ? (
                            <>
                              <button onClick={() => openApprove(r)} className="text-[12.5px] font-semibold text-ryg-green hover:underline mr-3">
                                Approve
                              </button>
                              <button onClick={() => openReject(r)} className="text-[12.5px] font-semibold text-ryg-red hover:underline">
                                Reject
                              </button>
                            </>
                          ) : (
                            <span className="text-grey-2 text-[12.5px]">{r.status === "pending" ? "—" : r.reviewNote || "—"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={pg} rowsLabel="requests" />
          </>
        )}
      </Card>

      {/* Approve modal — edit before adding */}
      <Modal
        open={approving !== null}
        onClose={() => setApproving(null)}
        title={`Approve ${approving ? typeLabel(approving.masterType) : ""}`}
        subtitle="Review and adjust the details, then add it to the master."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setApproving(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={doApprove} disabled={busy}>
              {busy ? "Adding…" : "Approve & add"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          {approveFields.map((f) => (
            <FieldLabel key={f.key} label={f.label} required={f.required}>
              {f.type === "select" ? (
                <Combobox
                  value={values[f.key] ?? ""}
                  onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
                  options={f.options ?? []}
                  placeholder="Select…"
                  autoAdvance
                />
              ) : f.type === "textarea" ? (
                <TextArea rows={3} value={values[f.key] ?? ""} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} />
              ) : (
                <TextInput value={values[f.key] ?? ""} onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))} />
              )}
            </FieldLabel>
          ))}
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>

      {/* Reject modal — reason required */}
      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting ? typeLabel(rejecting.masterType) : ""}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={doReject} disabled={busy}>
              {busy ? "Rejecting…" : "Reject"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FieldLabel label="Reason" required>
            <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this being rejected?" />
          </FieldLabel>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
