import { useMemo, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { INK_COMPANIES, INK_SOURCES, fmtQty, newId, sourceLabel, type InkRow } from "../lib/inkMis";
import {
  handoffUrl, writeHandoff, type HandoffLine, type HandoffTarget, type OrderHandoff,
} from "../lib/orderHandoff";

/**
 * PLACE ORDER — from the Order now / Order soon cards straight to a purchase.
 *
 * Opens with the inks the card is showing, each with a suggested quantity: what it takes to
 * bring the Total back up to the month max level. The planner edits quantities, removes lines or
 * adds any other ink, picks the book, and submits. Submit:
 *   1. adds ONE "NEW ORDER" column to the ETD block with every line (Import, Domestic and Plant),
 *      so ETD total and Total move at once;
 *   2. hands the Import lines to Purchase RM Import and the Domestic lines to Purchase RM
 *      Domestic — a button each, opening the raise form pre-filled in a new tab;
 *   3. Plant lines stay here only.
 */

interface OrderLine {
  key: string;
  itemCode: string;
  description: string;
  names: string[];
  supplier: string;
  source: string;
  suggested: number;
  qty: string;
}

export interface PlacedOrder {
  companyKey: string;
  lines: { itemCode: string; qty: number }[];
}

/** Brings Total (stock + ETA + at port + plant + ETD) back up to the month max level. */
const suggestedQty = (r: InkRow) => Math.max(0, Math.ceil(r.monthMaxLevel - r.total));

const toLine = (r: InkRow, companyKey: string): OrderLine => {
  const own = r.sources.filter((s) => s.companyKey === companyKey).map((s) => s.item);
  const rest = r.sources.filter((s) => s.companyKey !== companyKey).map((s) => s.item);
  const suggested = suggestedQty(r);
  return {
    key: r.key,
    itemCode: r.itemCode,
    description: r.description,
    names: [...new Set([...own, ...rest])],
    supplier: r.supplier,
    source: r.source,
    suggested,
    qty: suggested > 0 ? String(suggested) : "",
  };
};

export default function PlaceOrderPanel({
  open,
  onClose,
  rows,
  allRows,
  companyKey,
  onPlace,
}: {
  open: boolean;
  onClose: () => void;
  /** The inks the picked card is showing — the panel starts with these. */
  rows: InkRow[];
  /** Every ink on the sheet, for "Add an ink". */
  allRows: InkRow[];
  /** The book tab in view; null on Combined. */
  companyKey: string | null;
  /** Adds the NEW ORDER column. */
  onPlace: (order: PlacedOrder) => void;
}) {
  const [company, setCompany] = useState(companyKey ?? "");
  const [lines, setLines] = useState<OrderLine[]>(() => rows.map((r) => toLine(r, companyKey ?? "")));
  const [adding, setAdding] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    count: number;
    qty: number;
    handoffs: { target: HandoffTarget; id: string; count: number }[];
    plant: number;
  }>(null);

  const label = (r: InkRow) => (r.itemCode ? `${r.description} — ${r.itemCode}` : r.description);
  const addable = useMemo(() => {
    const taken = new Set(lines.map((l) => l.key));
    return allRows.filter((r) => !taken.has(r.key));
  }, [allRows, lines]);

  const patch = (key: string, p: Partial<OrderLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const addInk = (text: string) => {
    setAdding(text);
    const r = addable.find((x) => label(x) === text);
    if (!r) return;
    setLines((ls) => [...ls, toLine(r, company)]);
    setAdding("");
  };

  const filled = lines.filter((l) => Number(l.qty) > 0);
  const totalQty = filled.reduce((t, l) => t + Number(l.qty), 0);

  const submit = () => {
    setErr(null);
    if (!company) return setErr("Pick the company this order is for.");
    if (filled.length === 0) return setErr("Type a quantity on at least one line.");
    const noCode = filled.filter((l) => !l.itemCode);
    if (noCode.length > 0) {
      return setErr(
        `${noCode.map((l) => l.description).join(", ")} ha${noCode.length === 1 ? "s" : "ve"} no item code, so the quantity has no column to sit in. Give ${noCode.length === 1 ? "it" : "them"} a code in the Item master, or remove the line.`,
      );
    }
    const noSource = filled.filter((l) => !l.source);
    if (noSource.length > 0) {
      return setErr(`Choose Import, Domestic or Plant for: ${noSource.map((l) => l.description).join(", ")}.`);
    }

    onPlace({ companyKey: company, lines: filled.map((l) => ({ itemCode: l.itemCode, qty: Number(l.qty) })) });

    const book = INK_COMPANIES.find((c) => c.key === company)!;
    const handoffs: { target: HandoffTarget; id: string; count: number }[] = [];
    for (const target of ["import", "domestic"] as HandoffTarget[]) {
      const mine = filled.filter((l) => l.source === target);
      if (mine.length === 0) continue;
      const h: OrderHandoff = {
        id: newId(),
        target,
        createdAt: new Date().toISOString(),
        companyKey: book.key,
        companyGuid: book.guid,
        companyLabel: book.label,
        lines: mine.map<HandoffLine>((l) => ({
          itemCode: l.itemCode,
          description: l.description,
          names: l.names,
          supplier: l.supplier,
          qty: Number(l.qty),
        })),
      };
      writeHandoff(h);
      handoffs.push({ target, id: h.id, count: mine.length });
    }
    setDone({
      count: filled.length,
      qty: totalQty,
      handoffs,
      plant: filled.filter((l) => l.source === "plant").length,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title={done ? "Order placed" : "Place order"}
      subtitle={
        done
          ? undefined
          : "Change any quantity, remove a line or add another ink, then Submit. The quantities go into a NEW ORDER column in the ETD block."
      }
      footer={
        done ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-3">
            {err && <span className="mr-auto text-sm text-red-700">{err}</span>}
            <span className="ml-auto text-sm text-muted-foreground">
              {filled.length} ink{filled.length === 1 ? "" : "s"} · {fmtQty(totalQty)} kg
            </span>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit}>Submit</Button>
          </div>
        )
      }
    >
      {done ? (
        <div className="space-y-4 text-sm">
          <p>
            A <strong>NEW ORDER</strong> column was added to the ETD block with{" "}
            <strong>{done.count}</strong> ink{done.count === 1 ? "" : "s"} ({fmtQty(done.qty)} kg). It is counted in
            ETD total and Total. Move it to ETD / ETA when the supplier confirms.
          </p>
          {done.handoffs.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <span>
                <strong>{h.count}</strong> {h.target === "import" ? "Import" : "Domestic"} ink{h.count === 1 ? "" : "s"} —{" "}
                {h.target === "import"
                  ? "add the vendor and shipment type, then raise the request."
                  : "check the lines and raise the request; the vendor is chosen at Sourcing."}
              </span>
              <Button
                className="ml-auto"
                onClick={() => window.open(handoffUrl(h.target, h.id), "_blank", "noopener")}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {h.target === "import" ? "Raise Import request" : "Raise Domestic request"}
              </Button>
            </div>
          ))}
          {done.plant > 0 && (
            <p className="text-muted-foreground">
              {done.plant} Plant ink{done.plant === 1 ? "" : "s"} saved on this sheet only — no purchase request.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="font-medium">Company</span>
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            >
              <option value="">Pick the company…</option>
              {INK_COMPANIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>

          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5">Item code</th>
                  <th className="px-2 py-1.5">Import / Domestic / Plant</th>
                  <th className="px-2 py-1.5">Supplier</th>
                  <th className="px-2 py-1.5 text-right">Suggested</th>
                  <th className="px-2 py-1.5 text-right">Qty to order</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                      No inks yet — add one below.
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.key} className="border-t">
                    <td className="px-2 py-1">{l.description}</td>
                    <td className={`px-2 py-1 ${l.itemCode ? "" : "text-red-700"}`}>{l.itemCode || "no code"}</td>
                    <td className="px-2 py-1">
                      <select
                        className={`h-7 rounded border bg-background px-1 ${l.source ? "" : "border-red-400"}`}
                        value={l.source}
                        onChange={(e) => patch(l.key, { source: e.target.value })}
                        title={l.source ? sourceLabel(l.source) : "Not set in the Item master — choose one"}
                      >
                        <option value="">Choose…</option>
                        {INK_SOURCES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">{l.supplier}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {l.suggested ? fmtQty(l.suggested) : "–"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        className="ml-auto h-7 w-24 text-right"
                        value={l.qty}
                        onChange={(e) => patch(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        aria-label={`Remove ${l.description}`}
                        title="Remove this line"
                        className="text-muted-foreground hover:text-red-600"
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" />
            <Input
              list="ink-order-add"
              className="h-8 max-w-md"
              placeholder="Add an ink — type its description or code"
              value={adding}
              onChange={(e) => addInk(e.target.value)}
            />
            <datalist id="ink-order-add">
              {addable.map((r) => (
                <option key={r.key} value={label(r)} />
              ))}
            </datalist>
          </div>
          <p className="text-xs text-muted-foreground">
            Suggested = month max level − Total. Import and Plant come from the Item master; a line where it is not set
            asks you to choose.
          </p>
        </div>
      )}
    </Modal>
  );
}
