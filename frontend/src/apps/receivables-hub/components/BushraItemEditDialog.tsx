/**
 * Admin edit of one register line's item — Sales-Type, Ink Type, Group, Category, Colour.
 *
 * Saved to the Bushra Central Master for every company's copy of the item
 * (lib/bushraSalesItemEdit.ts), so the correction is the Central Master's, not this page's.
 * Only the fields the admin touches are written; the rest keep whatever they hold now.
 */
import { useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import { Button } from "@hub/components/ui/button";
import { Input } from "@hub/components/ui/input";
import { ITEM_TYPES } from "@/core/platform/liveMasters";
import type { BushraRegisterRow, MasterCopy } from "@hub/lib/bushraSalesRegister";
import { isOverridden, saveItemClassification, type EditField, type FieldEdit } from "@hub/lib/bushraSalesItemEdit";

export interface EditSuggestions {
  inkType: string[];
  groupName: string[];
  category: string[];
  color: string[];
}

const TEXT_FIELDS: { key: Exclude<EditField, "itemType">; label: string }[] = [
  { key: "inkType", label: "Ink Type" },
  { key: "groupName", label: "Group" },
  { key: "category", label: "Category" },
  { key: "color", label: "Colour" },
];

export default function BushraItemEditDialog({
  row,
  copies,
  suggestions,
  userId,
  onClose,
  onSaved,
}: {
  row: BushraRegisterRow;
  copies: MasterCopy[];
  suggestions: EditSuggestions;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // What each field reads now — the row's own (merged, overridden) values, and the item's type.
  const initial = useMemo<Record<EditField, string>>(() => ({
    itemType: copies.find((c) => c.itemType)?.itemType ?? "",
    inkType: row.ink_type,
    groupName: row.item_group,
    category: row.item_category,
    color: row.colour,
  }), [copies, row]);

  const [values, setValues] = useState(initial);
  const [edits, setEdits] = useState<Partial<Record<EditField, FieldEdit>>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (key: EditField, raw: string) => {
    const value = key === "itemType" ? raw : raw.toUpperCase();
    setValues((v) => ({ ...v, [key]: value }));
    setEdits((e) => ({ ...e, [key]: { follow: false, value } }));
  };
  const follow = (key: EditField) => setEdits((e) => ({ ...e, [key]: { follow: true } }));
  const following = (key: EditField) => edits[key]?.follow === true;

  const dirty = Object.keys(edits).length > 0;
  const companies = new Set(copies.map((c) => c.companyGuid)).size;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await saveItemClassification(copies, edits, userId);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  const followButton = (key: EditField) =>
    (following(key) ? (
      <span className="text-[11px] text-muted-foreground">Will follow Central Masters</span>
    ) : isOverridden(copies, key) ? (
      <button type="button" onClick={() => follow(key)} className="text-[11px] text-primary hover:underline">
        Follow Central Masters
      </button>
    ) : null);

  return (
    <Modal
      open
      onClose={saving ? () => {} : onClose}
      title="Edit item classification"
      subtitle={row.particulars}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-9 rounded-button">Cancel</Button>
          <Button onClick={save} disabled={!dirty || saving} className="h-9 rounded-button bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Saved to the Bushra Central Master for all {copies.length} cop{copies.length === 1 ? "y" : "ies"} of this
          item ({companies} compan{companies === 1 ? "y" : "ies"}), so every Sales dashboard, this register and
          its export read the same. Only the fields you change are written.
        </p>

        <label className="block space-y-1">
          <span className="flex items-center justify-between text-xs font-medium">Sales-Type {followButton("itemType")}</span>
          <select
            value={following("itemType") ? "" : values.itemType}
            disabled={following("itemType")}
            onChange={(e) => set("itemType", e.target.value)}
            className="h-9 w-full rounded-input border border-border bg-surface px-2 text-sm"
          >
            <option value="">(Not set)</option>
            {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {row.sales_type_source === "Particulars" && (
            <span className="block text-[11px] text-muted-foreground">
              This line's Sales-Type ({row.sales_type}) comes from the tag in its Particulars, which always wins.
              The type set here applies wherever the item is billed without a tag.
            </span>
          )}
        </label>

        {TEXT_FIELDS.map(({ key, label }) => (
          <label key={key} className="block space-y-1">
            <span className="flex items-center justify-between text-xs font-medium">{label} {followButton(key)}</span>
            <Input
              value={following(key) ? "" : values[key]}
              placeholder={following(key) ? "Central Masters' value" : "(Not set)"}
              disabled={following(key)}
              onChange={(e) => set(key, e.target.value)}
              list={`bushra-edit-${key}`}
              className="h-9 rounded-input text-sm"
            />
            <datalist id={`bushra-edit-${key}`}>
              {suggestions[key].map((v) => <option key={v} value={v} />)}
            </datalist>
            {key === "inkType" && (
              <span className="block text-[11px] text-muted-foreground">Shown only on lines whose Sales-Type is Ink.</span>
            )}
          </label>
        ))}

        {err && <p className="text-sm text-destructive">Not saved: {err}</p>}
      </div>
    </Modal>
  );
}
