import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { SectionHeading } from "@/shared/components/ui/Readout";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { useSession } from "@/core/platform/session";
import { useDispatchStore } from "../../store";
import SalesOrderFields from "../../components/SalesOrderFields";
import OrderLinesGrid from "../../components/OrderLinesGrid";
import { useSalesOrderForm, type SalesOrderDraft } from "./useSalesOrderForm";
import AccessDenied from "../system/AccessDenied";

export default function NewOrder() {
  const s = useDispatchStore();

  /*
    ⚠ THE FORM MOUNTS ONLY ONCE THE MASTERS ARE HERE. `useSalesOrderForm` seeds
      the company and site in a lazy `useState` that runs once; the store renders
      its children while the query is in flight, so mounting it earlier would seed
      from empty lists and never retry. Waiting also stops `canRaise` — false
      until the config lands — flashing Access denied at someone who may raise.
  */
  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!s.canRaise) return <AccessDenied />;
  return <NewOrderForm />;
}

function NewOrderForm() {
  const s = useDispatchStore();
  const { user } = useSession();
  const nav = useNavigate();
  const f = useSalesOrderForm();
  // Saved drafts sit above the form; Continue loads one into it.
  const drafts = useSavedDrafts<SalesOrderDraft>("order-to-dispatch:order");

  const saveDraft = () => {
    const n = f.filledLines.length;
    const v = f.form;
    // Company, site and date are pre-filled, so they alone don't make a draft.
    if (!v.customerId && n === 0 && !v.customerPoNo.trim() && !v.orderRemarks.trim() && !v.customerLocation.trim()) {
      return Promise.reject(new Error("Nothing to save yet."));
    }
    const customer = s.customers.find((c) => c.id === v.customerId)?.name;
    return drafts.save({
      title: `${customer ?? "No customer yet"} · ${n} item${n === 1 ? "" : "s"}`,
      summary: [
        `Customer: ${customer ?? "—"}${v.customerLocation.trim() ? ` · ${v.customerLocation.trim()}` : ""}`,
        ...(v.customerPoNo.trim() ? [`Customer PO: ${v.customerPoNo.trim()}`] : []),
        ...f.filledLines.map((l) => {
          const it = s.items.find((i) => i.id === l.itemId);
          return `${it?.name ?? "Item not picked"} — ${l.quantity || "?"}${l.lineRemark.trim() ? ` (${l.lineRemark.trim()})` : ""}`;
        }),
        ...(v.orderRemarks.trim() ? [`Remarks: ${v.orderRemarks.trim()}`] : []),
      ],
      payload: f.snapshot(),
    });
  };

  const continueDraft = (payload: SalesOrderDraft) => {
    f.setError(null);
    f.restore(payload);
  };

  const submit = async () => {
    const problem = f.validate();
    if (problem) { f.setError(problem); return; }
    f.setBusy(true);
    f.setError(null);
    try {
      const id = await s.submitOrder(f.toInput(user.name));
      await drafts.finish();
      nav(`/order-to-dispatch/orders/${id}`);
    } catch (e) {
      f.setError(e instanceof Error ? e.message : "Could not raise the order.");
      f.setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Sales Order</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Raising an order sends it to the collection team for credit confirmation.
          {s.orderNoPreview && <> It will be numbered <span className="font-semibold text-navy">{s.orderNoPreview}</span>.</>}
        </p>
      </div>

      <SavedDraftsPanel api={drafts} onContinue={continueDraft} noun="order" />

      <Card className="p-5">
        <SalesOrderFields f={f} />
      </Card>

      <Card className="p-5 space-y-3">
        <SectionHeading>Items</SectionHeading>
        <OrderLinesGrid
          rows={f.lines}
          onRowsChange={f.setLines}
          customerId={f.form.customerId}
          itemType={f.itemType}
          onMapItem={(typed) => f.setMapping({ search: typed })}
          requested={f.requested?.from === "lines" ? f.requested.text : null}
        />
      </Card>

      {f.error && <p className="text-[13px] font-medium text-ryg-red">{f.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={f.busy}>{f.busy ? "Raising…" : "Raise order"}</Button>
        <SaveDraftButton api={drafts} onSave={saveDraft} disabled={f.busy} />
        <Button variant="ghost" onClick={() => nav(-1)} disabled={f.busy}>Cancel</Button>
      </div>
    </div>
  );
}
