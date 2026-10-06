import { useNavigate, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import { SectionHeading } from "@/shared/components/ui/Readout";
import SavedDraftsPanel, { SaveDraftButton } from "@/shared/components/ui/SavedDraftsPanel";
import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import { useSession } from "@/core/platform/session";
import { useDispatchStore } from "../../store";
import SalesOrderFields from "../../components/SalesOrderFields";
import OrderLinesGrid from "../../components/OrderLinesGrid";
import { useSalesOrderForm, type SalesOrderDraft } from "./useSalesOrderForm";
import AccessDenied from "../system/AccessDenied";
import { DOC_TYPE_LABEL } from "../../lib/format";
import type { DocType } from "../../types";

/** `?type=` in the URL, so a refresh or a shared link lands on the same form. */
const TYPE_PARAM: Record<string, DocType> = { invoice: "invoice", dc: "delivery_challan" };
const PARAM_OF: Record<DocType, string> = { invoice: "invoice", delivery_challan: "dc" };

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
  return <NewOrderSteps />;
}

/**
 * DC-1 · TWO TABS, the same pattern as Production's Generate Issue Slip:
 * Sales Invoice | Delivery Challan. The tab decides what happens after Raise — a
 * delivery challan skips the credit check entirely — so it sits above the form.
 */
const TAB_DEFS: { key: DocType; label: string }[] = [
  { key: "invoice", label: DOC_TYPE_LABEL.invoice },
  { key: "delivery_challan", label: DOC_TYPE_LABEL.delivery_challan },
];

function NewOrderSteps() {
  const s = useDispatchStore();
  const [params, setParams] = useSearchParams();
  const docType: DocType = TYPE_PARAM[params.get("type") ?? ""] ?? "invoice";
  const challan = docType === "delivery_challan";

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Sales Order</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {challan
            ? "A delivery challan (FOC, ₹0 or ₹1 per line) skips the credit check and goes straight to the store for the material-status check."
            : "Raising an order sends it to the collection team for credit confirmation."}
          {s.orderNoPreview && <> It will be numbered <span className="font-semibold text-navy">{s.orderNoPreview}</span>.</>}
        </p>
      </div>

      <Tabs
        tabs={TAB_DEFS}
        active={docType}
        onChange={(k) => setParams({ type: PARAM_OF[k as DocType] }, { replace: true })}
      />

      {/* Keyed on the tab: switching rebuilds the form rather than carrying an
          invoice's half-typed state into a challan. */}
      <NewOrderForm key={docType} docType={docType} />
    </div>
  );
}

function NewOrderForm({ docType }: { docType: DocType }) {
  const s = useDispatchStore();
  const { user } = useSession();
  const nav = useNavigate();
  const f = useSalesOrderForm(undefined, { docType });
  const challan = f.form.docType === "delivery_challan";
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
      title: `${challan ? "DC · " : ""}${customer ?? "No customer yet"} · ${n} item${n === 1 ? "" : "s"}`,
      summary: [
        `Document: ${DOC_TYPE_LABEL[f.form.docType]}`,
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
    <div className="space-y-5">
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
          challan={challan}
        />
      </Card>

      {f.error && <p className="text-[13px] font-medium text-ryg-red">{f.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={f.busy}>{f.busy ? "Raising…" : challan ? "Raise delivery challan" : "Raise order"}</Button>
        <SaveDraftButton api={drafts} onSave={saveDraft} disabled={f.busy} />
        <Button variant="ghost" onClick={() => nav(-1)} disabled={f.busy}>Cancel</Button>
      </div>
    </div>
  );
}
