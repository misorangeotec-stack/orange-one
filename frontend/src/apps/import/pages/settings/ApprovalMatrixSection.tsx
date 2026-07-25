import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useImportStore } from "../../store";
import type { ApprovalBand } from "../../types";

/**
 * Approvals config (admin). Import is a pure quantity requisition — approvals no
 * longer route by value. This is simply the list of people who may approve a
 * requisition: EVERY request routes to every active approver here, regardless of
 * quantity. Configure one person, or a small list.
 *
 * It is still backed by the fms_import_approval_matrix table (each row = one
 * approver); the amount columns are written 0 / no-limit and never used.
 */
export default function ApprovalMatrixSection() {
  const s = useImportStore();
  const [editing, setEditing] = useState<ApprovalBand | null>(null);
  const [creating, setCreating] = useState(false);
  const [approver, setApprover] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const peopleOptions: ComboOption[] = useMemo(
    () =>
      [...s.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.profiles]
  );

  const approvers = useMemo(
    () => [...s.approvalBands].sort((a, b) => a.sortOrder - b.sortOrder),
    [s.approvalBands]
  );

  const openCreate = () => {
    setApprover("");
    setActive(true);
    setErr(null);
    setCreating(true);
    setEditing(null);
  };
  const openEdit = (b: ApprovalBand) => {
    setApprover(b.approverUserId);
    setActive(b.active);
    setErr(null);
    setEditing(b);
    setCreating(false);
  };
  const close = () => {
    setCreating(false);
    setEditing(null);
    setErr(null);
  };

  const save = async () => {
    setErr(null);
    if (!approver) return setErr("Select an approver.");
    // A duplicate approver would just be a second identical row — block it.
    if (approvers.some((b) => b.approverUserId === approver && b.id !== editing?.id)) {
      return setErr("That person is already an approver.");
    }

    setBusy(true);
    try {
      const input = {
        // The label is cosmetic now; store the person's name so legacy reads stay
        // meaningful. Amount range is unused — a single open band.
        tierLabel: s.profileById(approver)?.name ?? "Approver",
        minAmount: 0,
        maxAmount: null,
        approverUserId: approver,
        sortOrder: editing?.sortOrder ?? approvers.length,
        active,
      };
      if (editing) await s.editApprovalBand(editing.id, input);
      else await s.createApprovalBand(input);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: ApprovalBand) => {
    try {
      await s.removeApprovalBand(b.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] text-grey-2">
          Every requisition goes to these approvers, regardless of quantity. Add one person, or a small list.
        </p>
        <Button size="sm" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add approver
        </Button>
      </div>

      <Card className="overflow-hidden">
        {approvers.length === 0 ? (
          <EmptyState
            title="No approvers yet"
            message="Add at least one approver so requisitions can be approved."
            actionLabel="Add approver"
            onAction={openCreate}
          />
        ) : (
          <ScrollableTable>
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line">
                  <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>
                  <th className="font-medium px-4 py-3">Approver</th>
                  <th className="font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {approvers.map((b) => (
                  <tr key={b.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button onClick={() => openEdit(b)} className="text-[12.5px] font-semibold text-orange hover:underline mr-3">
                        Edit
                      </button>
                      <button onClick={() => remove(b)} className="text-[12.5px] font-semibold text-ryg-red hover:underline">
                        Delete
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{s.profileById(b.approverUserId)?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                          b.active ? "text-ryg-green bg-[#E9F8EF]" : "text-grey-2 bg-page"
                        }`}
                      >
                        {b.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
      </Card>

      <Modal
        open={creating || editing !== null}
        onClose={close}
        title={editing ? "Edit approver" : "Add approver"}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add approver"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <FieldLabel label="Approver" required>
            <Combobox value={approver} onChange={setApprover} options={peopleOptions} placeholder="Select approver" autoAdvance />
          </FieldLabel>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-orange" />
            <span className="text-[13px] text-navy">Active</span>
          </label>
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>
    </div>
  );
}
