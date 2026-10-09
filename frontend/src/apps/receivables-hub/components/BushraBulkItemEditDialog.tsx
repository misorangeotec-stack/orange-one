/**
 * BULK admin edit — every product in the Sales Register's current view, one row each, fixed in one
 * sitting and saved with one button.
 *
 * Built for "(Not set)": it opens on the products missing a Sales-Type, Group or Category (or an
 * Ink Type on an ink), across whatever period and filters the register is showing. Each row is a
 * PRODUCT, not a voucher line — 40 invoices of one head are one row — and a save goes to the Bushra
 * Central Master for every company's copy, exactly as the one-line editor does
 * (lib/bushraSalesItemEdit.ts). Only cells the admin changes are written.
 *
 * Discount ledgers and names not in Central Masters are left out: there is no item to correct.
 */
import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { ITEM_TYPES, type ItemType } from "@/core/platform/liveMasters";
import { copiesOf, type BushraRegisterRow, type ItemLookup, type MasterCopy } from "@hub/lib/bushraSalesRegister";
import { saveItemClassifications, type EditField, type FieldEdit } from "@hub/lib/bushraSalesItemEdit";
import type { EditSuggestions } from "./BushraItemEditDialog";

type TextField = Exclude<EditField, "itemType">;
const TEXT_FIELDS: { key: TextField; label: string }[] = [
  { key: "inkType", label: "Ink Type" },
  { key: "groupName", label: "Group" },
  { key: "category", label: "Category" },
  { key: "color", label: "Colour" },
];
const FIELD_LABEL: Record<EditField, string> = {
  itemType: "Sales-Type", inkType: "Ink Type", groupName: "Group", category: "Category", color: "Colour",
};
const INK_TYPES = new Set<ItemType>(["ink", "provision_ink", "other_ink"]);
/** More rows than this are not drawn at once — every one carries five inputs. */
const MAX_ROWS = 400;

interface Product {
  key: string;
  name: string;
  copies: MasterCopy[];
  lines: number;
  revenue: number;
  /** What each field reads now. */
  now: Record<EditField, string>;
  missing: EditField[];
}

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const productKey = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

export default function BushraBulkItemEditDialog({
  rows, lookup, suggestions, userId, onClose, onSaved,
}: {
  rows: BushraRegisterRow[];
  lookup: ItemLookup;
  suggestions: EditSuggestions;
  userId: string;
  onClose: () => void;
  onSaved: (products: number) => void;
}) {
  /** One entry per product in the view, largest revenue first. */
  const products = useMemo(() => {
    const byKey = new Map<string, Product>();
    for (const r of rows) {
      if (r.is_discount || !r.in_masters) continue;
      const key = productKey(r.particulars);
      let p = byKey.get(key);
      if (!p) {
        const copies = copiesOf(lookup, r.particulars);
        const itemType = copies.find((c) => c.itemType)?.itemType ?? "";
        const now: Record<EditField, string> = {
          itemType, inkType: r.ink_type, groupName: r.item_group, category: r.item_category, color: r.colour,
        };
        const missing: EditField[] = [];
        if (!itemType) missing.push("itemType");
        if (itemType && INK_TYPES.has(itemType as ItemType) && !r.ink_type) missing.push("inkType");
        if (!r.item_group) missing.push("groupName");
        if (!r.item_category) missing.push("category");
        p = { key, name: r.particulars, copies, lines: 0, revenue: 0, now, missing };
        byKey.set(key, p);
      }
      p.lines++;
      p.revenue += r.revenue;
    }
    return [...byKey.values()].sort((a, b) => b.revenue - a.revenue);
  }, [rows, lookup]);

  const [onlyMissing, setOnlyMissing] = useState(true);
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, Partial<Record<EditField, FieldEdit>>>>({});
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<EditField>("category");
  const [bulkValue, setBulkValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter((p) =>
      (!onlyMissing || p.missing.length > 0 || edits[p.key]) && (!s || p.name.toLowerCase().includes(s)));
  }, [products, onlyMissing, q, edits]);
  const drawn = visible.slice(0, MAX_ROWS);

  const valueOf = (p: Product, key: EditField) => {
    const e = edits[p.key]?.[key];
    return e && !e.follow ? e.value : p.now[key];
  };
  const setCell = (p: Product, key: EditField, raw: string) => {
    const value = key === "itemType" ? raw : raw.toUpperCase();
    setEdits((all) => {
      const mine = { ...(all[p.key] ?? {}) };
      if (value === p.now[key]) delete mine[key];
      else mine[key] = { follow: false, value };
      const next = { ...all };
      if (Object.keys(mine).length) next[p.key] = mine; else delete next[p.key];
      return next;
    });
  };
  const applyToTicked = () => {
    const value = bulkField === "itemType" ? bulkValue : bulkValue.toUpperCase();
    for (const p of products) if (ticked.has(p.key)) setCell(p, bulkField, value);
  };

  const allTicked = drawn.length > 0 && drawn.every((p) => ticked.has(p.key));
  const toggleAll = () => setTicked(allTicked ? new Set() : new Set(drawn.map((p) => p.key)));
  const toggle = (k: string) => setTicked((t) => {
    const n = new Set(t);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const changed = Object.keys(edits).length;
  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const byKey = new Map(products.map((p) => [p.key, p]));
      await saveItemClassifications(
        Object.entries(edits).map(([k, e]) => ({ copies: byKey.get(k)!.copies, edits: e })),
        userId,
      );
      onSaved(changed);
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const cellCls = (p: Product, key: EditField) =>
    `h-8 w-full rounded-input text-xs ${edits[p.key]?.[key] ? "border-primary bg-primary/5"
      : p.missing.includes(key) ? "border-amber-400 bg-amber-50" : ""}`;

  return (
    <Modal
      open
      size="2xl"
      onClose={saving ? () => {} : onClose}
      title="Fix product classification"
      subtitle={`${products.length.toLocaleString("en-IN")} products in this view · ${products.filter((p) => p.missing.length).length.toLocaleString("en-IN")} with something Not set`}
      footer={
        <>
          {err && <span className="mr-auto text-sm text-destructive">Not saved: {err}</span>}
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-9 rounded-button">Cancel</Button>
          <Button onClick={save} disabled={!changed || saving} className="h-9 rounded-button bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Saving…" : `Save ${changed} product${changed === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          One row per product in the register's current period and filters. Saved to the Bushra Central Master
          for every company's copy, so every dashboard reads the same. Amber = Not set, blue = changed.
          Discount ledgers and names not in Central Masters are not listed.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Only products with something Not set
          </label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product…" className="h-8 w-56 rounded-input text-xs" />
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Set for {ticked.size} ticked:</span>
            <select value={bulkField} onChange={(e) => { setBulkField(e.target.value as EditField); setBulkValue(""); }}
                    className="h-8 rounded-input border border-border bg-surface px-2 text-xs">
              {(Object.keys(FIELD_LABEL) as EditField[]).map((k) => <option key={k} value={k}>{FIELD_LABEL[k]}</option>)}
            </select>
            {bulkField === "itemType" ? (
              <select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                      className="h-8 w-40 rounded-input border border-border bg-surface px-2 text-xs">
                <option value="">(Not set)</option>
                {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            ) : (
              <Input value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} list={`bulk-${bulkField}`}
                     className="h-8 w-48 rounded-input text-xs" placeholder="Value" />
            )}
            <Button variant="outline" onClick={applyToTicked} disabled={!ticked.size} className="h-8 rounded-button px-3 text-xs">Apply</Button>
          </div>
        </div>

        {TEXT_FIELDS.map(({ key }) => (
          <datalist key={key} id={`bulk-${key}`}>
            {suggestions[key].map((v) => <option key={v} value={v} />)}
          </datalist>
        ))}

        <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
          <table className="w-full min-w-[1100px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2"><input type="checkbox" checked={allTicked} onChange={toggleAll} title="Tick all shown" /></th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2 text-right">Lines</th>
                <th className="px-2 py-2 text-right">Revenue</th>
                <th className="px-2 py-2">Sales-Type</th>
                {TEXT_FIELDS.map((f) => <th key={f.key} className="px-2 py-2">{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {drawn.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">
                  {onlyMissing ? "Nothing is Not set in this view." : "No products match."}
                </td></tr>
              ) : drawn.map((p) => (
                <tr key={p.key} className="border-t border-border/40">
                  <td className="px-2 py-1"><input type="checkbox" checked={ticked.has(p.key)} onChange={() => toggle(p.key)} /></td>
                  <td className="px-2 py-1 min-w-[240px]">{p.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{p.lines}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">₹ {nf.format(p.revenue)}</td>
                  <td className="px-2 py-1 w-[140px]">
                    <select value={valueOf(p, "itemType")} onChange={(e) => setCell(p, "itemType", e.target.value)}
                            className={`${cellCls(p, "itemType")} border px-1`}>
                      <option value="">(Not set)</option>
                      {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  {TEXT_FIELDS.map(({ key }) => (
                    <td key={key} className="px-2 py-1 w-[170px]">
                      <Input value={valueOf(p, key)} onChange={(e) => setCell(p, key, e.target.value)}
                             list={`bulk-${key}`} placeholder="(Not set)" className={cellCls(p, key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">
            Showing the first {MAX_ROWS} of {visible.length.toLocaleString("en-IN")} by revenue — search or filter the register to reach the rest.
          </p>
        )}
      </div>
    </Modal>
  );
}
