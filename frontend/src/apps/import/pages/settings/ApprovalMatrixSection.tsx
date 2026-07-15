import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useImportStore } from "../../store";
import type { ApprovalBand } from "../../types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Approval Matrix config (admin). Each active band maps a value range to an
 * approver; a request line's value routes to the band that contains it. The top
 * band can be left open-ended (no max).
 */
export default function ApprovalMatrixSection() {
  const s = useImportStore();
  const [editing, setEditing] = useState<ApprovalBand | null>(null);
  const [creating, setCreating] = useState(false);
  const [tierLabel, setTierLabel] = useState("");
  const [minAmount, setMinAmount] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");
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

  const bands = useMemo(
    () => [...s.approvalBands].sort((a, b) => a.sortOrder - b.sortOrder || a.minAmount - b.minAmount),
    [s.approvalBands]
  );

  const openCreate = () => {
    setTierLabel("");
    setMinAmount("0");
    setMaxAmount("");
    setApprover("");
    setActive(true);
    setErr(null);
    setCreating(true);
    setEditing(null);
  };
  const openEdit = (b: ApprovalBand) => {
    setTierLabel(b.tierLabel);
    setMinAmount(String(b.minAmount));
    setMaxAmount(b.maxAmount === null ? "" : String(b.maxAmount));
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
    if (!tierLabel.trim()) return setErr("Tier label is required.");
    if (!approver) return setErr("An approver is required.");
    const min = Number(minAmount);
    const max = maxAmount.trim() === "" ? null : Number(maxAmount);
    if (Number.isNaN(min) || min < 0) return setErr("Min amount must be 0 or more.");
    if (max !== null && (Number.isNaN(max) || max < min)) return setErr("Max amount must be blank or ≥ min.");

    setBusy(true);
    try {
      const input = {
        tierLabel: tierLabel.trim(),
        minAmount: min,
        maxAmount: max,
        approverUserId: approver,
        sortOrder: editing?.sortOrder ?? bands.length,
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
          A line's value (Final Qty × Final Rate, incl. GST) routes to the band that contains it.
        </p>
        <Button size="sm" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add band
        </Button>
      </div>

      <Card className="overflow-hidden">
        {bands.length === 0 ? (
          <EmptyState
            title="No approval bands yet"
            message="Add at least one band so approvals can route by value."
            actionLabel="Add band"
            onAction={openCreate}
          />
        ) : (
          <ScrollableTable>
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line">
                  <th className="font-medium px-4 py-3">Tier</th>
                  <th className="font-medium px-4 py-3">Min</th>
                  <th className="font-medium px-4 py-3">Max</th>
                  <th className="font-medium px-4 py-3">Approver</th>
                  <th className="font-medium px-4 py-3">Status</th>
                  <th className="font-medium px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b) => (
                  <tr key={b.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                    <td className="px-4 py-3 font-medium text-navy whitespace-nowrap">{b.tierLabel}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{inr(b.minAmount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{b.maxAmount === null ? "No limit" : inr(b.maxAmount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.profileById(b.approverUserId)?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                          b.active ? "text-ryg-green bg-[#E9F8EF]" : "text-grey-2 bg-page"
                        }`}
                      >
                        {b.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(b)} className="text-[12.5px] font-semibold text-orange hover:underline mr-3">
                        Edit
                      </button>
                      <button onClick={() => remove(b)} className="text-[12.5px] font-semibold text-ryg-red hover:underline">
                        Delete
                      </button>
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
        title={editing ? "Edit band" : "Add band"}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add band"}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <FieldLabel label="Tier label" required>
            <TextInput value={tierLabel} onChange={(e) => setTierLabel(e.target.value)} placeholder="e.g. L1 — Purchase Head" />
          </FieldLabel>
          <div className="grid grid-cols-2 gap-3">
            <FieldLabel label="Min amount (₹)" required>
              <TextInput type="number" min={0} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
            </FieldLabel>
            <FieldLabel label="Max amount (₹)" hint="blank = no limit">
              <TextInput type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="No limit" />
            </FieldLabel>
          </div>
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
