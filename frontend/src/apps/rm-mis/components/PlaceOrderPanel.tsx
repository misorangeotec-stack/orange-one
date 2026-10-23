import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, PanelRightOpen, Plus, X } from "lucide-react";
import Modal from "@/shared/components/ui/Modal";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { INK_COMPANIES, INK_SOURCES, fmtDays, fmtQty, newId, sourceLabel, type InkRow } from "../lib/rmMis";
import {
  readHandoff, writeHandoff, type HandoffLine, type HandoffTarget, type OrderHandoff,
} from "../lib/orderHandoff";
import RaiseSlider from "./RaiseSlider";

/**
 * PLACE ORDER — from the Order now / Order soon cards straight to a purchase.
 *
 * RM IMS copy of the Ink IMS panel (same flow, user 2026-10-23); its hand-offs carry `sheet: "rm"`.
 *
 * Opens with the items the card is showing, each with a suggested quantity: what it takes to
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
  /** The decision figures, as the dashboard shows them. */
  stock: number;
  total: number;
  monthAvg: number;
  leadTime: number;
  safety: number;
  /** Stock the lead time calls for: 3-month avg x lead time x safety (the Month max level). */
  required: number;
  daysCover: number | null;
  suggested: number;
  qty: string;
}

/** The panel's columns. Widths are dragged at the heading's right edge and remembered per browser. */
const COLS: { id: string; label: string; width: number; right?: boolean; title?: string }[] = [
  { id: "description", label: "Description", width: 220 },
  { id: "code", label: "Item code", width: 170 },
  { id: "source", label: "Import / Domestic / Plant", width: 120 },
  { id: "stock", label: "Stock", width: 80, right: true, title: "Stock in hand now" },
  { id: "avg", label: "Avg / month", width: 80, right: true, title: "3-month average consumption per month" },
  { id: "lead", label: "Lead time (months)", width: 75, right: true, title: "Months a replacement takes to arrive" },
  { id: "required", label: "Required", width: 90, right: true, title: "Stock needed for the lead time: avg / month x lead time x safety factor (the Month max level)" },
  { id: "days", label: "Days cover", width: 70, right: true, title: "How many working days the stock in hand lasts" },
  { id: "suggested", label: "Suggested", width: 85, right: true, title: "Required − stock − anything already arranged (ETA, at port, plant, ETD). Hover a figure for its working." },
  { id: "qty", label: "Qty to order", width: 110, right: true },
  { id: "remove", label: "", width: 34 },
];
const WIDTH_KEY = "rm-mis:order-panel-cols";

export interface PlacedOrder {
  companyKey: string;
  lines: { itemCode: string; qty: number }[];
  handoffs: { target: HandoffTarget; id: string }[];
}

/** Brings Total (stock + ETA + at port + plant + ETD) back up to the month max level. */
const suggestedQty = (r: InkRow) => Math.max(0, Math.ceil(r.monthMaxLevel - r.total));

const toLine = (r: InkRow, companyKey: string): OrderLine => {
  const own = r.sources.filter((s) => s.companyKey === companyKey).map((s) => s.item);
  const rest = r.sources.filter((s) => s.companyKey !== companyKey).map((s) => s.item);
  const suggested = suggestedQty(r);
  return {
    stock: r.stock,
    total: r.total,
    monthAvg: r.plan.threeMonthAvg,
    leadTime: r.plan.leadTime,
    safety: r.plan.safetyFactor,
    required: r.monthMaxLevel,
    daysCover: r.daysCover,
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
  onRaised,
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
  /** A Purchase request was raised from here — the sheet re-reads what is left to raise. */
  onRaised?: () => void;
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
  /** The purchase raise form slid in over the panel, and the requests raised per hand-off. */
  const [slider, setSlider] = useState<{ target: HandoffTarget; id: string } | null>(null);
  const [raised, setRaised] = useState<Record<string, string[]>>({});

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(WIDTH_KEY) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_KEY, JSON.stringify(widths));
    } catch {
      /* private mode: widths last this visit */
    }
  }, [widths]);
  const widthOf = (id: string) => widths[id] ?? COLS.find((c) => c.id === id)?.width ?? 80;
  const drag = useRef<{ id: string; x: number; w: number } | null>(null);
  const startResize = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { id, x: e.clientX, w: widthOf(id) };
    const move = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      setWidths((ws) => ({ ...ws, [d.id]: Math.max(40, d.w + ev.clientX - d.x) }));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const resetWidth = (id: string) =>
    setWidths((ws) => {
      const rest = { ...ws };
      delete rest[id];
      return rest;
    });

  const label = (r: InkRow) => (r.itemCode ? `${r.description} — ${r.itemCode}` : r.description);
  const addable = useMemo(() => {
    const taken = new Set(lines.map((l) => l.key));
    return allRows.filter((r) => !taken.has(r.key));
  }, [allRows, lines]);

  const patch = (key: string, p: Partial<OrderLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  /**
   * Adds only on a deliberate pick — a suggestion chosen from the list, or Enter on an exact
   * label. Matching on every keystroke added a shorter label (one ink's description) while the
   * planner was still typing a longer one.
   */
  const addInk = (text: string) => {
    const r = addable.find((x) => label(x) === text);
    if (!r) return false;
    setLines((ls) => [...ls, toLine(r, company)]);
    setAdding("");
    return true;
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

    const book = INK_COMPANIES.find((c) => c.key === company)!;
    const handoffs: { target: HandoffTarget; id: string; count: number }[] = [];
    for (const target of ["import", "domestic"] as HandoffTarget[]) {
      const mine = filled.filter((l) => l.source === target);
      if (mine.length === 0) continue;
      const h: OrderHandoff = {
        id: newId(),
        sheet: "rm",
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
    // The column remembers its hand-offs, so its heading can reopen an unraised request later.
    onPlace({
      companyKey: company,
      lines: filled.map((l) => ({ itemCode: l.itemCode, qty: Number(l.qty) })),
      handoffs: handoffs.map(({ target, id }) => ({ target, id })),
    });
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
          : "Change any quantity, remove a line or add another item, then Submit. The quantities go into a NEW ORDER column in the ETD block."
      }
      footer={
        done ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-3">
            {err && <span className="mr-auto text-sm text-red-700">{err}</span>}
            <span className="ml-auto text-sm text-muted-foreground">
              {filled.length} item{filled.length === 1 ? "" : "s"} · {fmtQty(totalQty)}
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
            <strong>{done.count}</strong> item{done.count === 1 ? "" : "s"} ({fmtQty(done.qty)}). It is counted in
            ETD total and Total. Move it to ETD / ETA when the supplier confirms.
          </p>
          {done.handoffs.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <span>
                <strong>{h.count}</strong> {h.target === "import" ? "Import" : "Domestic"} item{h.count === 1 ? "" : "s"} —{" "}
                {h.target === "import"
                  ? "add the vendor and shipment type, then raise the request."
                  : "check the lines and raise the request; the vendor is chosen at Sourcing."}
              </span>
              {(() => {
                const raisedIds = raised[h.id] ?? [];
                // After a request, the hand-off keeps only the inks it did not cover (gone = all done).
                const left = raisedIds.length > 0 ? (readHandoff(h.id)?.lines.length ?? 0) : h.count;
                const kind = h.target === "import" ? "Import" : "Domestic";
                return (
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    {raisedIds.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        {raisedIds.length === 1 ? "Request raised" : `${raisedIds.length} requests raised`}
                        <a
                          href={`${h.target === "import" ? "/import" : "/procurement"}/requests/${raisedIds[raisedIds.length - 1]}`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-0.5 underline"
                        >
                          open <ExternalLink className="h-3 w-3" />
                        </a>
                      </span>
                    )}
                    {left > 0 && (
                      <Button onClick={() => setSlider({ target: h.target, id: h.id })}>
                        <PanelRightOpen className="mr-2 h-4 w-4" />
                        {raisedIds.length > 0 ? `Raise ${kind} request for the ${left} left` : `Raise ${kind} request`}
                      </Button>
                    )}
                  </span>
                );
              })()}
            </div>
          ))}
          {slider && (
            <RaiseSlider
              target={slider.target}
              inkId={slider.id}
              onClose={() => setSlider(null)}
              onSubmitted={(requestId) => {
                setRaised((r) => ({ ...r, [slider.id]: [...(r[slider.id] ?? []), requestId] }));
                setSlider(null);
                onRaised?.();
              }}
            />
          )}
          {done.plant > 0 && (
            <p className="text-muted-foreground">
              {done.plant} Plant item{done.plant === 1 ? "" : "s"} saved on this sheet only — no purchase request.
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
            <table
              className="table-fixed text-[12px]"
              style={{ width: COLS.reduce((t, c) => t + widthOf(c.id), 0) }}
            >
              <colgroup>
                {COLS.map((c) => (
                  <col key={c.id} style={{ width: widthOf(c.id) }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted text-left">
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c.id}
                      title={c.title}
                      className={`relative px-2 py-1.5 align-bottom leading-tight ${c.right ? "text-right" : ""}`}
                    >
                      {c.label}
                      {c.id !== "remove" && (
                        <span
                          role="separator"
                          aria-label={`Resize ${c.label}`}
                          title="Drag to resize, double-click to reset"
                          onMouseDown={startResize(c.id)}
                          onDoubleClick={() => resetWidth(c.id)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={COLS.length} className="px-2 py-6 text-center text-muted-foreground">
                      No items yet — add one below.
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.key} className="border-t">
                    <td className="truncate px-2 py-1" title={l.description}>{l.description}</td>
                    <td className={`truncate px-2 py-1 ${l.itemCode ? "" : "text-red-700"}`} title={l.itemCode}>
                      {l.itemCode || "no code"}
                    </td>
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
                    <td className="px-2 py-1 text-right tabular-nums">{fmtQty(l.stock)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.monthAvg ? fmtQty(l.monthAvg) : "–"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.leadTime || "–"}</td>
                    <td
                      className="px-2 py-1 text-right font-semibold tabular-nums"
                      title={`${fmtQty(l.monthAvg)} × ${l.leadTime} months × safety ${l.safety}`}
                    >
                      {l.required ? fmtQty(l.required) : "–"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtDays(l.daysCover)}</td>
                    <td
                      className="px-2 py-1 text-right tabular-nums text-muted-foreground"
                      title={
                        l.total !== l.stock
                          ? `Required ${fmtQty(l.required)} − stock ${fmtQty(l.stock)} − already arranged ${fmtQty(l.total - l.stock)} (ETA, at port, plant, ETD)`
                          : `Required ${fmtQty(l.required)} − stock ${fmtQty(l.stock)}`
                      }
                    >
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
              list="rm-order-add"
              className="h-8 max-w-md"
              placeholder="Add an item — type its description or code"
              value={adding}
              onChange={(e) => {
                // A datalist pick arrives as a replacement (or with no inputType at all), not typing.
                const kind = (e.nativeEvent as InputEvent).inputType;
                if ((kind === undefined || kind === "insertReplacementText") && addInk(e.target.value)) return;
                setAdding(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addInk(adding);
              }}
            />
            <datalist id="rm-order-add">
              {addable.map((r) => (
                <option key={r.key} value={label(r)} />
              ))}
            </datalist>
          </div>
          <p className="text-xs text-muted-foreground">
            Required = avg / month × lead time × safety factor (the Month max level). Suggested = Required − stock − anything already arranged (hover a figure for its working).
            Drag a heading's right edge to resize it; double-click the edge to reset. Import / Domestic / Plant comes
            from the Item master; a line where it is not set asks you to choose.
          </p>
        </div>
      )}
    </Modal>
  );
}
